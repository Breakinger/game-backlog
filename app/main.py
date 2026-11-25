"""Game Backlog desktop app. Opens a console-style window on top of your Google Sheet."""
import json
import os
import sys
import threading
import time
import webbrowser

import art
import sheet

APP_NAME = "GameBacklog"


def data_dir():
    base = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), ".config")
    d = os.path.join(base, APP_NAME)
    os.makedirs(d, exist_ok=True)
    return d


def resource(rel):
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, rel)


DEFAULTS = {"sheet_url": sheet.DEFAULT_SHEET, "sgdb_key": "", "refresh_minutes": 2, "sounds": False}


class Api:
    """Every public method here can be called from the page as window.pywebview.api.<name>()."""

    def __init__(self):
        self._dir = data_dir()
        self._settings_path = os.path.join(self._dir, "settings.json")
        self._cache_path = os.path.join(self._dir, "last_sync.json")
        self._settings = dict(DEFAULTS)
        try:
            with open(self._settings_path, encoding="utf-8") as f:
                self._settings.update(json.load(f))
        except Exception:
            pass
        self._art = art.Art(self._dir)
        self._art.sgdb_key = self._settings.get("sgdb_key", "")
        self._sync_lock = threading.Lock()

    # ----- settings -----
    def get_settings(self):
        s = dict(self._settings)
        s["has_sgdb_key"] = bool(s.get("sgdb_key"))
        s["sgdb_key"] = ""  # never send the key back to the page
        s["data_dir"] = self._dir
        return s

    def save_settings(self, new):
        new = dict(new or {})
        if not new.get("sgdb_key"):
            new.pop("sgdb_key", None)  # empty field = keep the saved key
        if new.get("clear_sgdb_key"):
            new["sgdb_key"] = ""
        new.pop("clear_sgdb_key", None)
        for k in ("sheet_url", "sgdb_key", "refresh_minutes", "sounds"):
            if k in new:
                self._settings[k] = new[k]
        self._art.sgdb_key = self._settings.get("sgdb_key", "")
        with open(self._settings_path, "w", encoding="utf-8") as f:
            json.dump(self._settings, f, indent=2)
        return self.get_settings()

    # ----- data -----
    def cached(self):
        try:
            with open(self._cache_path, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None

    def sync(self):
        with self._sync_lock:
            try:
                games, plays = sheet.load(self._settings.get("sheet_url"))
            except Exception as e:  # report, keep showing the last good data
                return {"error": str(e) or e.__class__.__name__}
            data = {"games": games, "playthroughs": plays, "synced_at": time.time()}
            with open(self._cache_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
            return data

    # ----- art & links -----
    def cover(self, name):
        try:
            return self._art.cover(name)
        except Exception:
            return None

    def links(self, game):
        appid = None
        try:
            appid = self._art.steam_appid(game.get("name", ""))
        except Exception:
            pass
        return art.links_for(game, appid)

    def clear_covers(self):
        self._art.clear()
        return True

    def open(self, url):
        try:
            if sys.platform == "win32":
                os.startfile(url)  # handles steam://, heroic:// and normal links
            else:
                webbrowser.open(url)
            return True
        except Exception as e:
            return str(e)

    def open_sheet(self):
        link = self._settings.get("sheet_url") or sheet.DEFAULT_SHEET
        return self.open(link) if link else "No sheet link yet."


def main():
    import webview  # imported here so the rest can be tested without a GUI
    api = Api()
    webview.create_window(
        "Game Backlog", resource(os.path.join("ui", "index.html")), js_api=api,
        width=1480, height=920, min_size=(1100, 700), background_color="#0A1430",
    )
    webview.start(gui="edgechromium" if sys.platform == "win32" else None)


if __name__ == "__main__":
    main()
