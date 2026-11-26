"""Masterlog's own title bar on Windows, like Steam's: the window keeps its native frame, so Windows still resizes it
from every edge, snaps it and maximizes it, but the caption strip is removed and the app's top bar takes its place
(drag it to move the window, double-click it to maximize, and the minimize/maximize/close buttons live there).

Everything here is plain Win32 through ctypes. If any step fails the window simply keeps its normal title bar."""
import ctypes
import sys
import threading

GWL_STYLE = -16
WS_CAPTION = 0x00C00000
WS_THICKFRAME = 0x00040000
WS_SYSMENU = 0x00080000
WS_MINIMIZEBOX = 0x00020000
WS_MAXIMIZEBOX = 0x00010000
SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOZORDER, SWP_NOMOVE, SWP_NOSIZE = 0x20, 0x10, 0x4, 0x2, 0x1
SW_MAXIMIZE, SW_MINIMIZE, SW_RESTORE = 3, 6, 9
WM_NCLBUTTONDOWN, HTCAPTION = 0x00A1, 2
VK_LBUTTON = 0x01
DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND = 33, 2
DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE = 34, 0xFFFFFFFE
DWMWA_CAPTION_COLOR, DWMWA_USE_IMMERSIVE_DARK_MODE = 35, 20

ok = sys.platform == "win32"
if ok:
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    dwm = ctypes.windll.dwmapi
    user32.GetWindowLongW.restype = ctypes.c_long
    user32.GetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.SetWindowLongW.restype = ctypes.c_long
    user32.SetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_long]
    user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_uint]
    user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.IsZoomed.argtypes = [wintypes.HWND]
    user32.IsIconic.argtypes = [wintypes.HWND]
    user32.SendMessageW.argtypes = [wintypes.HWND, ctypes.c_uint, wintypes.WPARAM, wintypes.LPARAM]
    user32.GetKeyState.argtypes = [ctypes.c_int]
    user32.GetKeyState.restype = ctypes.c_short
    dwm.DwmSetWindowAttribute.argtypes = [wintypes.HWND, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD]


def _attr(hwnd, attr, value):
    v = ctypes.c_uint(value)
    try:
        return dwm.DwmSetWindowAttribute(hwnd, attr, ctypes.byref(v), ctypes.sizeof(v))
    except Exception:
        return -1


class Chrome:
    def __init__(self, window):
        self.window = window
        self.hwnd = None
        self.applied = False
        self.lock = threading.Lock()

    def _form(self):
        return getattr(self.window, "native", None)

    def _on_ui(self, fn):
        """Runs fn on the window's own thread (Win32 mouse capture belongs to it)."""
        form = self._form()
        if form is None:
            return fn()
        try:
            from System import Action   # pythonnet, which pywebview's Windows backend runs on
            if form.InvokeRequired:
                form.Invoke(Action(fn))
                return None
        except Exception:
            pass
        return fn()

    def _handle(self):
        form = self._form()
        try:
            return int(form.Handle.ToInt64()) if form is not None else None
        except Exception:
            return None

    def apply(self):
        """Removes the caption strip, keeping the resize frame and window commands."""
        if not ok:
            return False
        with self.lock:
            hwnd = self._handle()
            if not hwnd:
                return False
            self.hwnd = hwnd

            def go():
                style = user32.GetWindowLongW(hwnd, GWL_STYLE)
                new = (style & ~WS_CAPTION) | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX
                if new != style:
                    user32.SetWindowLongW(hwnd, GWL_STYLE, new)
                    user32.SetWindowPos(hwnd, None, 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOMOVE | SWP_NOSIZE)
                _attr(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, 1)
                _attr(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND)
                _attr(hwnd, DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE)
            try:
                self._on_ui(go)
                self.applied = (user32.GetWindowLongW(hwnd, GWL_STYLE) & WS_CAPTION) != WS_CAPTION
            except Exception:
                self.applied = False
            return self.applied

    def tint(self, rgb=0x30140A):
        """Fallback when the caption stays: paint it in Masterlog's navy (Windows 11), so it reads as part of the app."""
        if ok and self._handle():
            _attr(self._handle(), DWMWA_USE_IMMERSIVE_DARK_MODE, 1)
            _attr(self._handle(), DWMWA_CAPTION_COLOR, rgb)

    def drag(self):
        hwnd = self.hwnd or self._handle()
        if not ok or not hwnd:
            return False

        def go():
            if user32.GetKeyState(VK_LBUTTON) & 0x8000:
                user32.ReleaseCapture()
                user32.SendMessageW(hwnd, WM_NCLBUTTONDOWN, HTCAPTION, 0)   # Windows' own move loop: snap and shake work
        threading.Thread(target=lambda: self._on_ui(go), daemon=True).start()
        return True

    def minimize(self):
        if ok and (self.hwnd or self._handle()):
            user32.ShowWindow(self.hwnd or self._handle(), SW_MINIMIZE)

    def toggle_max(self):
        hwnd = self.hwnd or self._handle()
        if not ok or not hwnd:
            return False
        user32.ShowWindow(hwnd, SW_RESTORE if user32.IsZoomed(hwnd) else SW_MAXIMIZE)
        return bool(user32.IsZoomed(hwnd))

    def maximized(self):
        hwnd = self.hwnd or self._handle()
        return bool(ok and hwnd and user32.IsZoomed(hwnd))
