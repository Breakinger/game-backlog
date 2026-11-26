"""What differs between Windows and Linux (the Steam Deck): where the app lives, how it restarts, how links open."""
import os
import subprocess
import sys

WINDOWS = sys.platform == "win32"
LINUX = sys.platform.startswith("linux")


def appimage():
    """The .AppImage file Masterlog was started from on Linux, or None."""
    p = os.environ.get("APPIMAGE")
    return p if LINUX and p and os.path.isfile(p) else None


def installed():
    """The file an update replaces: the .exe on Windows, the .AppImage on Linux. None when running from source."""
    if not getattr(sys, "frozen", False):
        return None
    if WINDOWS:
        return sys.executable
    return appimage()


def on_deck():
    """True on a Steam Deck (or another SteamOS handheld)."""
    if not LINUX:
        return False
    if os.environ.get("SteamDeck") == "1":
        return True
    try:
        with open("/sys/devices/virtual/dmi/id/board_vendor") as f:
            vendor = f.read().strip()
        with open("/sys/devices/virtual/dmi/id/product_name") as f:
            product = f.read().strip()
        return vendor == "Valve" and product in ("Jupiter", "Galileo")
    except OSError:
        return False


def game_mode():
    """Started from Steam's Gaming Mode (full screen, controller first)."""
    return LINUX and (os.environ.get("SteamGamepadUI") == "1" or os.environ.get("XDG_CURRENT_DESKTOP", "").lower() == "gamescope"
                      or bool(os.environ.get("GAMESCOPE_WAYLAND_DISPLAY")))


def clean_env():
    """The environment for programs Masterlog starts. The built app points the library path at its own bundled
    libraries; other programs (a browser, Steam, the next Masterlog) must get the system's back."""
    env = {k: v for k, v in os.environ.items() if not k.startswith(("_PYI", "_MEI"))}
    if LINUX and getattr(sys, "frozen", False):
        for var in ("LD_LIBRARY_PATH", "QT_PLUGIN_PATH", "QML2_IMPORT_PATH", "QTWEBENGINEPROCESS_PATH", "QTWEBENGINE_RESOURCES_PATH",
                    "QTWEBENGINE_LOCALES_PATH", "GTK_PATH", "GIO_MODULE_DIR", "SSL_CERT_FILE"):
            orig = env.pop(var + "_ORIG", None)
            if orig is not None:
                env[var] = orig
            else:
                env.pop(var, None)
    env["PYINSTALLER_RESET_ENVIRONMENT"] = "1"
    return env


def relaunch():
    """Start a fresh copy of the installed app (after an update or after copying from another PC)."""
    target = installed()
    if not target:
        return False
    if WINDOWS:
        subprocess.Popen([target], cwd=os.path.dirname(target), env=clean_env(),
                         creationflags=0x00000008 | 0x00000200, close_fds=True)   # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    else:
        subprocess.Popen([target], cwd=os.path.dirname(target), env=clean_env(), start_new_session=True, close_fds=True,
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return True


def open_url(url):
    """Open a link or a launcher link (steam://, heroic://) with whatever the system uses for it."""
    if WINDOWS:
        os.startfile(url)
        return
    if LINUX:
        subprocess.Popen(["xdg-open", url], env=clean_env(), start_new_session=True,
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return
    import webbrowser
    webbrowser.open(url)


def open_folder(path):
    if WINDOWS:
        os.startfile(path)
    else:
        open_url(path)
