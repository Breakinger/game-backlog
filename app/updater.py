"""One-click updates from GitHub Releases.

Windows lets a running .exe be renamed but not overwritten, so an update downloads the new build next to
the app, renames the running file to *.old.exe, moves the new one into its place, starts it, and exits.
The leftover *.old.exe is deleted the next time the app starts.
"""
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request

from version import VERSION

REPO = "Breakinger/game-backlog"
ASSET = "GameBacklog.exe"
UA = "GameBacklog-updater"


def _ver(v):
    try:
        return tuple(int(x) for x in str(v).lstrip("v").split("."))
    except ValueError:
        return (0,)


def frozen():
    return getattr(sys, "frozen", False) and sys.platform == "win32"


class Updater:
    def __init__(self):
        self.progress = {"state": "idle", "done": 0, "total": 0, "error": None}
        self.latest = None

    def cleanup(self):
        if not frozen():
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
        asset = next((a for a in rel.get("assets", []) if a.get("name") == ASSET), None)
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
        exe = sys.executable
        folder = os.path.dirname(exe)
        new = os.path.join(folder, "GameBacklog.new.exe")
        old = os.path.splitext(exe)[0] + ".old.exe"
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
                if f.read(2) != b"MZ":
                    raise ValueError("The download isn't a Windows program.")
            if self.progress["total"] and os.path.getsize(new) != self.progress["total"]:
                raise ValueError("The download was cut off. Try again.")
            self.progress["state"] = "installing"
            if os.path.exists(old):
                os.remove(old)
            os.replace(exe, old)
            os.replace(new, exe)
        except PermissionError:
            self._undo(exe, new, old)
            self.progress.update(state="error", error="Windows didn't allow replacing the app in this folder. Move GameBacklog.exe to a folder you own, like Documents, and try again.")
            return self.progress["error"]
        except Exception as e:
            self._undo(exe, new, old)
            self.progress.update(state="error", error=str(e) or e.__class__.__name__)
            return self.progress["error"]
        self.progress["state"] = "restarting"
        env = {k: v for k, v in os.environ.items() if not k.startswith(("_PYI", "_MEI"))}
        env["PYINSTALLER_RESET_ENVIRONMENT"] = "1"
        flags = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
        subprocess.Popen([exe], cwd=folder, env=env, creationflags=flags, close_fds=True)
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
