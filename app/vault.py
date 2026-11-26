"""Encrypted storage for account keys and tokens.

On Windows the data is sealed with DPAPI (CryptProtectData), the same mechanism Windows uses for saved
Wi-Fi and browser passwords: only your Windows user account on this PC can decrypt it. Copying the file to
another PC or account makes it useless. Secrets are never sent to the page, the sheet, or GitHub.
"""
import base64
import json
import os
import sys
import threading

if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes

    class _Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    _crypt32 = ctypes.windll.crypt32
    _kernel32 = ctypes.windll.kernel32
    _ENTROPY = b"Masterlog/vault/v1"

    def _blob(data):
        buf = ctypes.create_string_buffer(data, len(data))
        return _Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), buf

    def _protect(data: bytes) -> bytes:
        inp, _a = _blob(data)
        ent, _b = _blob(_ENTROPY)
        out = _Blob()
        if not _crypt32.CryptProtectData(ctypes.byref(inp), "Masterlog", ctypes.byref(ent), None, None, 0x01, ctypes.byref(out)):
            raise OSError("Windows couldn't encrypt the vault.")
        try:
            return ctypes.string_at(out.pbData, out.cbData)
        finally:
            _kernel32.LocalFree(out.pbData)

    def _unprotect(data: bytes) -> bytes:
        inp, _a = _blob(data)
        ent, _b = _blob(_ENTROPY)
        out = _Blob()
        if not _crypt32.CryptUnprotectData(ctypes.byref(inp), None, ctypes.byref(ent), None, None, 0x01, ctypes.byref(out)):
            raise OSError("Windows couldn't decrypt the vault.")
        try:
            return ctypes.string_at(out.pbData, out.cbData)
        finally:
            _kernel32.LocalFree(out.pbData)
elif sys.platform.startswith("linux"):
    # Linux (Steam Deck): AES-256-GCM with a key kept outside the app's data folder, readable only by your user
    # account (like ~/.ssh), and bound to this machine's ID, so a copy of the vault on another machine or account
    # can't be opened.
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    from cryptography.hazmat.primitives import hashes

    _MAGIC = b"MLV1"

    def _key_file():
        base = os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")
        d = os.path.join(base, "masterlog-keys")
        os.makedirs(d, mode=0o700, exist_ok=True)
        try:
            os.chmod(d, 0o700)
        except OSError:
            pass
        return os.path.join(d, "vault.key")

    def _machine_id():
        for p in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
            try:
                with open(p, "rb") as f:
                    v = f.read().strip()
                    if v:
                        return v
            except OSError:
                pass
        return b"no-machine-id"

    def _key():
        path = _key_file()
        try:
            with open(path, "rb") as f:
                secret = f.read()
        except FileNotFoundError:
            secret = os.urandom(32)
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(secret)
        if len(secret) != 32:
            raise OSError("The vault key is damaged.")
        info = b"Masterlog/vault/v1|" + _machine_id() + b"|" + str(os.getuid()).encode()
        return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=info).derive(secret)

    def _protect(data: bytes) -> bytes:
        nonce = os.urandom(12)
        return _MAGIC + nonce + AESGCM(_key()).encrypt(nonce, data, _MAGIC)

    def _unprotect(data: bytes) -> bytes:
        if not data.startswith(_MAGIC):
            raise OSError("Not a Masterlog vault.")
        return AESGCM(_key()).decrypt(data[4:16], data[16:], _MAGIC)
else:  # development only (macOS and other systems aren't shipped)
    def _protect(data: bytes) -> bytes:
        return b"DEV:" + base64.b64encode(data)

    def _unprotect(data: bytes) -> bytes:
        return base64.b64decode(data[4:])


class Vault:
    def __init__(self, data_dir):
        self.path = os.path.join(data_dir, "vault.bin")
        self.lock = threading.Lock()
        self._data = {}
        try:
            with open(self.path, "rb") as f:
                self._data = json.loads(_unprotect(f.read()).decode("utf-8"))
        except FileNotFoundError:
            pass
        except Exception:
            self._data = {}  # unreadable (other user/PC): start clean rather than crash

    def get(self, key, default=None):
        return self._data.get(key, default)

    def set(self, key, value):
        with self.lock:
            if value in (None, "", {}):
                self._data.pop(key, None)
            else:
                self._data[key] = value
            blob = _protect(json.dumps(self._data).encode("utf-8"))
            tmp = self.path + ".tmp"
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(blob)
            os.replace(tmp, self.path)

    def has(self, key):
        return bool(self._data.get(key))
