"""One-click updates from GitHub Releases.

Windows lets a running .exe be renamed but not overwritten, so an update downloads the new build next to
the app, renames the running file to *.old.exe, moves the new one into its place, starts it, and exits.
The leftover *.old.exe is deleted the next time the app starts.
"""
import json
import os
import sys
import threading
import time
import urllib.request

import platforms
from version import VERSION

REPO = "Breakinger/game-backlog"
# Windows builds update from the .exe; the Steam Deck (Linux) build from its AppImage
ASSETS = ("Masterlog-SteamDeck.AppImage",) if platforms.LINUX else ("Masterlog.exe", "GameBacklog.exe")
UA = "Masterlog-updater"


def _ver(v):
    try:
        return tuple(int(x) for x in str(v).lstrip("v").split("."))
    except ValueError:
        return (0,)


def frozen():
    return bool(platforms.installed())


class Updater:
    def __init__(self):
        self.progress = {"state": "idle", "done": 0, "total": 0, "error": None}
        self.latest = None

    def cleanup(self):
        if not frozen():
            return
        if not platforms.WINDOWS:
            return
        exe = sys.executable
        old = os.path.splitext(exe)[0] + ".old.exe"
        def rm():
            for _ in range(20):
                try:
                    if os.path.exists(old):
                        os.remove(old)
                    return
                except OSError:
                    time.sleep(0.5)
        threading.Thread(target=rm, daemon=True).start()

    def check(self):
        req = urllib.request.Request(f"https://api.github.com/repos/{REPO}/releases/latest",
                                     headers={"User-Agent": UA, "Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=15) as r:
            rel = json.load(r)
        assets = {a.get("name"): a for a in rel.get("assets", [])}
        asset = next((assets[n] for n in ASSETS if n in assets), None)
        tag = rel.get("tag_name", "")
        self.latest = {"version": tag.lstrip("v"), "url": asset and asset["browser_download_url"],
                       "size": asset and asset.get("size"), "notes": rel.get("body") or "", "page": rel.get("html_url")}
        return {"current": VERSION, "latest": self.latest["version"],
                "available": bool(asset) and VERSION != "dev" and _ver(tag) > _ver(VERSION),
                "can_install": frozen(), "page": self.latest["page"]}

    def apply(self):
        """Downloads and installs the latest build, then restarts. Returns an error string or None."""
        if not frozen():
            return "Updates install only in the built app. Download the new version from the Releases page."
        if not self.latest:
            self.check()
        if not self.latest or not self.latest.get("url"):
            return "No new version to install."
        exe = platforms.installed()
        folder = os.path.dirname(exe)
        ext = ".exe" if platforms.WINDOWS else ".AppImage"
        new = os.path.join(folder, "Masterlog.new" + ext)
        old = os.path.splitext(exe)[0] + ".old" + ext
        self.progress = {"state": "downloading", "done": 0, "total": self.latest.get("size") or 0, "error": None}
        try:
            req = urllib.request.Request(self.latest["url"], headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r, open(new, "wb") as f:
                self.progress["total"] = int(r.headers.get("Content-Length") or self.progress["total"] or 0)
                while True:
                    chunk = r.read(256 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
                    self.progress["done"] += len(chunk)
            with open(new, "rb") as f:
                magic = f.read(4)
            if platforms.WINDOWS and magic[:2] != b"MZ":
                raise ValueError("The download isn't a Windows program.")
            if not platforms.WINDOWS and magic != b"\x7fELF":
                raise ValueError("The download isn't a Linux program.")
            if self.progress["total"] and os.path.getsize(new) != self.progress["total"]:
                raise ValueError("The download was cut off. Try again.")
            self.progress["state"] = "installing"
            if platforms.WINDOWS:
                # Windows won't overwrite a running .exe, but it will rename it
                if os.path.exists(old):
                    os.remove(old)
                os.replace(exe, old)
                os.replace(new, exe)
            else:
                # Linux keeps the running copy alive in memory, so the file can be swapped in place
                os.chmod(new, 0o755)
                os.replace(new, exe)
        except PermissionError:
            self._undo(exe, new, old)
            self.progress.update(state="error", error="The app's folder doesn't allow replacing it. Move Masterlog to a folder you own (like Documents, or your home folder on the Steam Deck) and try again.")
            return self.progress["error"]
        except Exception as e:
            self._undo(exe, new, old)
            self.progress.update(state="error", error=str(e) or e.__class__.__name__)
            return self.progress["error"]
        self.progress["state"] = "restarting"
        platforms.relaunch()
        return None

    @staticmethod
    def _undo(exe, new, old):
        try:
            if not os.path.exists(exe) and os.path.exists(old):
                os.replace(old, exe)
            if os.path.exists(new):
                os.remove(new)
        except OSError:
            pass
