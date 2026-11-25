"""Writes JSON files a moment after the last change instead of on every change, so busy background work
(covers, news, prices) doesn't keep rewriting big files. Everything pending is written when the app closes."""
import atexit
import json
import os
import threading

_pending = {}
_lock = threading.Lock()


def _write(path, get):
    data = get()
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def save_later(path, get, delay=3.0, lock=None):
    """Schedule `get()` to be written to `path`. Repeated calls within `delay` seconds collapse into one write."""
    def run():
        with _lock:
            _pending.pop(path, None)
        try:
            if lock:
                with lock:
                    _write(path, get)
            else:
                _write(path, get)
        except Exception:
            pass
    with _lock:
        if path in _pending:
            return
        t = threading.Timer(delay, run)
        t.daemon = True
        _pending[path] = (t, get, lock)
        t.start()


@atexit.register
def flush():
    with _lock:
        items = list(_pending.items())
        _pending.clear()
    for path, (t, get, lock) in items:
        t.cancel()
        try:
            _write(path, get)
        except Exception:
            pass
