"""Copy Masterlog from one PC to another over your home network.

The PC you already use shares; the new PC receives. Nothing goes through the internet:
  1. The new PC finds the other one with a broadcast on your local network (only answered while
     "Set up another PC" is open on the PC that shares, for ten minutes at most).
  2. The two PCs agree on a one-time key (X25519). Both screens show a six-digit code made from that key;
     you check they match and press Send on the sharing PC. A matching code means nobody in between
     (another device on the Wi-Fi) is listening or pretending to be one of your PCs.
  3. Everything is sent once, encrypted with AES-256-GCM, and the connection closes.
Only private network addresses (home or office LAN) are accepted.
"""
import base64
import ipaddress
import json
import os
import socket
import struct
import threading
import time

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

PORT = 47615
ASK, ANSWER = b"MASTERLOG?1", b"MASTERLOG!1 "
MAX_FRAME = 400 * 1024 * 1024
SHARE_MINUTES = 10


def _private(ip):
    try:
        a = ipaddress.ip_address(ip.split("%")[0])
        return a.is_private or a.is_link_local or a.is_loopback
    except ValueError:
        return False


def _send(sock, data: bytes):
    sock.sendall(struct.pack(">I", len(data)) + data)


def _recv_exact(sock, n):
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(min(1 << 20, n - len(buf)))
        if not chunk:
            raise ConnectionError("The other PC closed the connection.")
        buf += chunk
    return bytes(buf)


def _recv(sock):
    n = struct.unpack(">I", _recv_exact(sock, 4))[0]
    if n > MAX_FRAME:
        raise ValueError("Too much data from the other PC.")
    return _recv_exact(sock, n)


def _pub_bytes(priv):
    return priv.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def session_keys(priv, their_pub: bytes, sharer_pub: bytes, receiver_pub: bytes):
    """The shared AES key and the six-digit code both screens show."""
    shared = priv.exchange(X25519PublicKey.from_public_bytes(their_pub))
    okm = HKDF(algorithm=hashes.SHA256(), length=36, salt=sharer_pub + receiver_pub, info=b"masterlog pair v1").derive(shared)
    code = int.from_bytes(okm[32:36], "big") % 1_000_000
    return okm[:32], f"{code // 1000:03d} {code % 1000:03d}"


def seal(key, obj, label):
    nonce = os.urandom(12)
    return nonce + AESGCM(key).encrypt(nonce, json.dumps(obj).encode("utf-8"), label)


def unseal(key, blob, label):
    return json.loads(AESGCM(key).decrypt(blob[:12], blob[12:], label).decode("utf-8"))


def local_ips():
    out = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            out.add(info[4][0])
    except OSError:
        pass
    try:  # the address used to reach the network, even without DNS for the host name
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("192.168.0.1", 9))
        out.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    return sorted(ip for ip in out if _private(ip) and not ip.startswith("127."))


class Share:
    """The PC you already use: answers the new PC, shows the code, sends once you confirm."""

    def __init__(self, make_bundle, name=None):
        self.make_bundle = make_bundle
        self.name = name or socket.gethostname()
        self.state = {"stage": "off"}
        self._approve = threading.Event()
        self._decision = None
        self._stop = threading.Event()
        self._socks = []

    def start(self):
        self.stop()
        self._stop.clear()
        tcp = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        tcp.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            tcp.bind(("0.0.0.0", PORT))
        except OSError:
            tcp.bind(("0.0.0.0", 0))
        tcp.listen(1)
        tcp.settimeout(1.0)
        udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        udp.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            udp.bind(("0.0.0.0", PORT))
        except OSError:
            udp = None
        self._socks = [s for s in (tcp, udp) if s]
        self.port = tcp.getsockname()[1]
        self.until = time.time() + SHARE_MINUTES * 60
        self.state = {"stage": "waiting", "ips": local_ips(), "port": self.port, "name": self.name, "until": self.until}
        if udp:
            udp.settimeout(1.0)
            threading.Thread(target=self._answer, args=(udp,), daemon=True).start()
        threading.Thread(target=self._serve, args=(tcp,), daemon=True).start()
        return self.state

    def stop(self):
        self._stop.set()
        self._decision = False
        self._approve.set()
        for s in self._socks:
            try:
                s.close()
            except OSError:
                pass
        self._socks = []
        if self.state.get("stage") not in ("done", "error"):
            self.state = {"stage": "off"}

    def decide(self, ok):
        self._decision = bool(ok)
        self._approve.set()

    def _answer(self, udp):
        while not self._stop.is_set() and time.time() < self.until:
            try:
                data, addr = udp.recvfrom(256)
            except socket.timeout:
                continue
            except OSError:
                break
            if data == ASK and _private(addr[0]):
                try:
                    udp.sendto(ANSWER + json.dumps({"port": self.port, "name": self.name}).encode(), addr)
                except OSError:
                    pass

    def _serve(self, tcp):
        while not self._stop.is_set() and time.time() < self.until:
            try:
                conn, addr = tcp.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            if not _private(addr[0]):
                conn.close()
                continue
            try:
                self._handle(conn, addr)
            except Exception as e:
                if not self._stop.is_set():
                    self.state = {**self.state, "stage": "error", "error": str(e) or e.__class__.__name__}
            finally:
                conn.close()
            if self.state.get("stage") == "done":
                break
        if self.state.get("stage") in ("waiting", "code"):
            self.state = {**self.state, "stage": "expired"}
        self.stop()

    def _handle(self, conn, addr):
        conn.settimeout(30)
        hello = json.loads(_recv(conn).decode("utf-8"))
        if hello.get("v") != 1 or not hello.get("pub"):
            raise ValueError("That isn't Masterlog on the other end.")
        theirs = base64.b64decode(hello["pub"])
        priv = X25519PrivateKey.generate()
        mine = _pub_bytes(priv)
        _send(conn, json.dumps({"v": 1, "pub": base64.b64encode(mine).decode(), "name": self.name}).encode())
        key, code = session_keys(priv, theirs, mine, theirs)
        self._approve.clear()
        self._decision = None
        self.state = {**self.state, "stage": "code", "code": code, "peer": str(hello.get("name") or addr[0])[:60], "peer_ip": addr[0]}
        self._approve.wait(180)
        if not self._decision:
            try:
                _send(conn, seal(key, {"denied": True}, b"masterlog bundle"))
            except OSError:
                pass
            self.state = {**self.state, "stage": "waiting", "code": None, "peer": None, "note": "Cancelled. The other PC can try again."}
            return
        self.state = {**self.state, "stage": "sending"}
        bundle = self.make_bundle()
        blob = seal(key, bundle, b"masterlog bundle")
        conn.settimeout(120)
        _send(conn, blob)
        ack = unseal(key, _recv(conn), b"masterlog ack")
        if not ack.get("ok"):
            raise RuntimeError(ack.get("error") or "The other PC couldn't save everything.")
        self.state = {**self.state, "stage": "done", "size": len(blob)}


def discover(timeout=2.5):
    """Masterlog PCs on this network that have 'Set up another PC' open."""
    found = {}
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    s.settimeout(0.4)
    targets = {"255.255.255.255"}
    for ip in local_ips():  # also each network's own broadcast address (assumes a /24, the usual home network)
        targets.add(".".join(ip.split(".")[:3]) + ".255")
    mine = set(local_ips())
    end = time.time() + timeout
    sent = 0
    while time.time() < end:
        if time.time() > sent + 0.8:
            for t in targets:
                try:
                    s.sendto(ASK, (t, PORT))
                except OSError:
                    pass
            sent = time.time()
        try:
            data, addr = s.recvfrom(512)
        except socket.timeout:
            continue
        except OSError:
            break
        if data.startswith(ANSWER) and _private(addr[0]) and addr[0] not in mine:
            try:
                info = json.loads(data[len(ANSWER):].decode("utf-8"))
                found[addr[0]] = {"ip": addr[0], "port": int(info.get("port") or PORT), "name": str(info.get("name") or addr[0])[:60]}
            except Exception:
                continue
    s.close()
    return list(found.values())


class Receive:
    """The new PC: connects, shows the code, waits for the other PC to send, then hands over what it got."""

    def __init__(self, apply_bundle, name=None):
        self.apply_bundle = apply_bundle
        self.name = name or socket.gethostname()
        self.state = {"stage": "off"}

    def start(self, ip, port=PORT):
        if not _private(ip):
            raise ValueError("Only PCs on your own network can be used.")
        self.state = {"stage": "connecting", "peer": ip}
        threading.Thread(target=self._run, args=(ip, int(port or PORT)), daemon=True).start()
        return self.state

    def _run(self, ip, port):
        try:
            conn = socket.create_connection((ip, port), timeout=8)
        except OSError:
            self.state = {"stage": "error", "error": "Couldn't reach that PC. Check that Masterlog shows 'Set up another PC' there, and that Windows allowed it on the network."}
            return
        try:
            conn.settimeout(30)
            priv = X25519PrivateKey.generate()
            mine = _pub_bytes(priv)
            _send(conn, json.dumps({"v": 1, "pub": base64.b64encode(mine).decode(), "name": self.name}).encode())
            reply = json.loads(_recv(conn).decode("utf-8"))
            theirs = base64.b64decode(reply["pub"])
            key, code = session_keys(priv, theirs, theirs, mine)
            self.state = {"stage": "code", "code": code, "peer": str(reply.get("name") or ip)[:60]}
            conn.settimeout(240)
            bundle = unseal(key, _recv(conn), b"masterlog bundle")
            if bundle.get("denied"):
                self.state = {"stage": "error", "error": "The other PC cancelled. Check the codes match and try again."}
                return
            self.state = {**self.state, "stage": "saving"}
            try:
                summary = self.apply_bundle(bundle) or {}
                _send(conn, seal(key, {"ok": True}, b"masterlog ack"))
                self.state = {**self.state, "stage": "done", "summary": summary}
            except Exception as e:
                _send(conn, seal(key, {"ok": False, "error": str(e)}, b"masterlog ack"))
                raise
        except Exception as e:
            self.state = {"stage": "error", "error": str(e) or e.__class__.__name__}
        finally:
            conn.close()


# ---------- through your sheet: a new PC's own key pair, and the sealing key wrapped for it ----------
def new_device():
    priv = X25519PrivateKey.generate()
    raw = priv.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
    return {"priv": base64.b64encode(raw).decode(), "pub": base64.b64encode(_pub_bytes(priv)).decode()}


def wrap(secret: bytes, their_pub_b64: str) -> str:
    """Seal `secret` so only the PC holding the matching private key can open it."""
    theirs = base64.b64decode(their_pub_b64)
    eph = X25519PrivateKey.generate()
    eph_pub = _pub_bytes(eph)
    k = HKDF(algorithm=hashes.SHA256(), length=32, salt=eph_pub + theirs, info=b"masterlog wrap v1").derive(eph.exchange(X25519PublicKey.from_public_bytes(theirs)))
    nonce = os.urandom(12)
    return base64.b64encode(eph_pub + nonce + AESGCM(k).encrypt(nonce, secret, b"masterlog wrap")).decode()


def unwrap(blob_b64: str, device: dict) -> bytes:
    blob = base64.b64decode(blob_b64)
    priv = X25519PrivateKey.from_private_bytes(base64.b64decode(device["priv"]))
    mine = base64.b64decode(device["pub"])
    eph_pub, nonce, ct = blob[:32], blob[32:44], blob[44:]
    k = HKDF(algorithm=hashes.SHA256(), length=32, salt=eph_pub + mine, info=b"masterlog wrap v1").derive(priv.exchange(X25519PublicKey.from_public_bytes(eph_pub)))
    return AESGCM(k).decrypt(nonce, ct, b"masterlog wrap")
