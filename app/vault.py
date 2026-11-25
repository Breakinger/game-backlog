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
else:  # development only; the shipped app is Windows
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
            with open(tmp, "wb") as f:
                f.write(blob)
            os.replace(tmp, self.path)

    def has(self, key):
        return bool(self._data.get(key))
