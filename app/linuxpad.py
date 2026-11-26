"""Controllers on Linux (the Steam Deck), read straight from the system.

Qt's browser engine doesn't pass controllers to the page, so Masterlog reads them itself from /dev/input, the same
way games do, and hands the page the same button layout a browser would (the 'standard' gamepad: A B X Y, bumpers,
triggers, sticks, D-pad). On the Steam Deck in Gaming Mode, Steam Input presents the Deck's controls as an Xbox
controller, which is read here like any other. Only reads; nothing is ever written to a device."""
import fcntl
import glob
import os
import select
import struct
import threading
import time

EV_KEY, EV_ABS = 0x01, 0x03
EVENT = struct.Struct("llHHi")          # struct input_event on 64-bit Linux
ABSINFO = struct.Struct("iiiiii")       # value, minimum, maximum, fuzz, flat, resolution


def _IOR(t, nr, size):
    return (2 << 30) | (size << 16) | (ord(t) << 8) | nr


def EVIOCGABS(axis):
    return _IOR("E", 0x40 + axis, ABSINFO.size)


def EVIOCGNAME(n=256):
    return _IOR("E", 0x06, n)


def EVIOCGBIT(ev, n):
    return _IOR("E", 0x20 + ev, n)


# Linux key codes -> standard gamepad button index (W3C 'standard' mapping, Xbox positions)
BUTTONS = {
    0x130: 0,   # BTN_SOUTH (A)
    0x131: 1,   # BTN_EAST (B)
    0x133: 2,   # BTN_NORTH: Xbox X on the xpad driver (left face button)
    0x134: 3,   # BTN_WEST: Xbox Y on the xpad driver (top face button)
    0x136: 4,   # BTN_TL (LB)
    0x137: 5,   # BTN_TR (RB)
    0x138: 6,   # BTN_TL2 (LT as a button, on pads with digital triggers)
    0x139: 7,   # BTN_TR2
    0x13a: 8,   # BTN_SELECT (View / Share / −)
    0x13b: 9,   # BTN_START (Menu / Options / +)
    0x13d: 10,  # BTN_THUMBL
    0x13e: 11,  # BTN_THUMBR
    0x220: 12, 0x221: 13, 0x222: 14, 0x223: 15,   # BTN_DPAD_UP/DOWN/LEFT/RIGHT
    0x13c: 16,  # BTN_MODE (Xbox / PS / Steam button)
}
# axis code -> (kind, index): sticks go to axes 0-3, triggers to buttons 6/7, the hat to D-pad buttons
ABS_X, ABS_Y, ABS_Z, ABS_RX, ABS_RY, ABS_RZ, ABS_HAT0X, ABS_HAT0Y = 0, 1, 2, 3, 4, 5, 0x10, 0x11
ABS_GAS, ABS_BRAKE = 0x09, 0x0a
AXES = {ABS_X: ("axis", 0), ABS_Y: ("axis", 1), ABS_RX: ("axis", 2), ABS_RY: ("axis", 3),
        ABS_Z: ("trigger", 6), ABS_RZ: ("trigger", 7), ABS_BRAKE: ("trigger", 6), ABS_GAS: ("trigger", 7)}


def _bits(buf):
    return {i for i in range(len(buf) * 8) if buf[i // 8] >> (i % 8) & 1}


class Pad:
    def __init__(self, path):
        self.path = path
        self.fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
        try:
            self.name = fcntl.ioctl(self.fd, EVIOCGNAME(), bytes(256)).split(b"\0", 1)[0].decode("utf-8", "replace")
        except OSError:
            self.name = "Controller"
        self.ranges = {}
        for code in list(AXES) + [ABS_HAT0X, ABS_HAT0Y]:
            try:
                _, lo, hi, _, flat, _ = ABSINFO.unpack(fcntl.ioctl(self.fd, EVIOCGABS(code), bytes(ABSINFO.size)))
                if hi > lo:
                    self.ranges[code] = (lo, hi, flat)
            except OSError:
                pass
        # PlayStation and Nintendo drivers name the face buttons by position (north = top), the Xbox driver by
        # letter (X = left); the page wants positions, so those two swap for the Xbox-style devices
        self.positional = any(w in self.name.lower() for w in ("sony", "dualsense", "dualshock", "wireless controller", "nintendo", "pro controller", "joy-con"))
        self.buttons = [0.0] * 17
        self.axes = [0.0] * 4
        self.stamp = time.time()

    def _norm(self, code, v):
        lo, hi, flat = self.ranges.get(code, (-32768, 32767, 0))
        if code in AXES and AXES[code][0] == "trigger":
            return max(0.0, min(1.0, (v - lo) / (hi - lo)))
        mid = (lo + hi) / 2
        if abs(v - mid) <= flat:
            return 0.0
        return max(-1.0, min(1.0, (v - mid) / ((hi - lo) / 2)))

    def handle(self, etype, code, value):
        if etype == EV_KEY and code in BUTTONS:
            i = BUTTONS[code]
            if self.positional and i in (2, 3):
                i = 5 - i
            self.buttons[i] = 1.0 if value else 0.0
        elif etype == EV_ABS:
            if code in AXES:
                kind, i = AXES[code]
                n = self._norm(code, value)
                if kind == "axis":
                    self.axes[i] = n
                else:
                    self.buttons[i] = n
            elif code == ABS_HAT0X:
                self.buttons[14], self.buttons[15] = float(value < 0), float(value > 0)
            elif code == ABS_HAT0Y:
                self.buttons[12], self.buttons[13] = float(value < 0), float(value > 0)
        self.stamp = time.time()

    def close(self):
        try:
            os.close(self.fd)
        except OSError:
            pass


def _is_gamepad(path):
    """A device with face buttons and a stick: a controller, not a keyboard, mouse or touchpad."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
    except OSError:
        return False
    try:
        keys = _bits(fcntl.ioctl(fd, EVIOCGBIT(EV_KEY, 96), bytes(96)))
        absb = _bits(fcntl.ioctl(fd, EVIOCGBIT(EV_ABS, 8), bytes(8)))
        return 0x130 in keys and ABS_X in absb and ABS_Y in absb
    except OSError:
        return False
    finally:
        os.close(fd)


class Pads:
    """Watches /dev/input for controllers in a background thread; the page polls state()."""
    def __init__(self):
        self.pads = {}
        self.lock = threading.Lock()
        self.thread = None
        self.last_scan = 0

    def available(self):
        return bool(glob.glob("/dev/input/event*"))

    def start(self):
        if self.thread is None:
            self.thread = threading.Thread(target=self._run, daemon=True, name="linuxpad")
            self.thread.start()

    def _scan(self):
        self.last_scan = time.time()
        for path in sorted(glob.glob("/dev/input/event*")):
            if path in self.pads or not _is_gamepad(path):
                continue
            try:
                pad = Pad(path)
            except OSError:
                continue   # no permission for this device
            with self.lock:
                self.pads[path] = pad

    def _drop(self, path):
        with self.lock:
            pad = self.pads.pop(path, None)
        if pad:
            pad.close()

    def _run(self):
        while True:
            if time.time() - self.last_scan > 3:
                self._scan()
            fds = {p.fd: path for path, p in list(self.pads.items())}
            if not fds:
                time.sleep(1)
                continue
            try:
                ready, _, _ = select.select(list(fds), [], [], 0.5)
            except (OSError, ValueError):
                ready = []
            for fd in ready:
                path = fds[fd]
                pad = self.pads.get(path)
                if not pad:
                    continue
                try:
                    data = os.read(fd, EVENT.size * 64)
                except BlockingIOError:
                    continue
                except OSError:
                    self._drop(path)   # unplugged
                    continue
                for i in range(0, len(data) - EVENT.size + 1, EVENT.size):
                    _, _, etype, code, value = EVENT.unpack_from(data, i)
                    pad.handle(etype, code, value)

    def state(self):
        """The controller used most recently, in the browser's standard layout, or None."""
        self.start()
        with self.lock:
            pads = list(self.pads.values())
        if not pads:
            return None
        pad = max(pads, key=lambda p: p.stamp)
        return {"id": pad.name, "buttons": [round(b, 3) for b in pad.buttons], "axes": [round(a, 3) for a in pad.axes]}
