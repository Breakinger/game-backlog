"""Game Backlog desktop app. Opens a console-style window on top of your Google Sheet."""
import json
import os
import sys
import threading
import time
import webbrowser

import art
import info
import sheet
import updater
from version import VERSION

APP_NAME = "GameBacklog"


def data_dir():
    base = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), ".config")
    d = os.path.join(base, APP_NAME)
    os.makedirs(d, exist_ok=True)
    return d


def resource(rel):
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, rel)


DEFAULTS = {"sheet_url": sheet.DEFAULT_SHEET, "sheet_key": "", "sgdb_key": "", "refresh_minutes": 2, "sounds": False,
            "view_mode": "covers"}
PRIVATE = ("sgdb_key", "sheet_key")


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
        self._info = info.Info(self._dir, self._art)
        self._updater = updater.Updater()
        self._updater.cleanup()
        self._sync_lock = threading.Lock()
        self._client = None
        self._window = None

    # ----- settings -----
    def get_settings(self):
        s = {k: v for k, v in self._settings.items() if k not in PRIVATE}
        s["has_sgdb_key"] = bool(self._settings.get("sgdb_key"))
        s["connected"] = bool(sheet.is_script_link(self._settings.get("sheet_url")) and self._settings.get("sheet_key"))
        s["link_kind"] = "script" if sheet.is_script_link(self._settings.get("sheet_url")) else ("csv" if self._settings.get("sheet_url") else "")
        s["data_dir"] = self._dir
        s["version"] = VERSION
        return s

    def _write_settings(self):
        tmp = self._settings_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self._settings, f, indent=2)
        os.replace(tmp, self._settings_path)

    def save_settings(self, new):
        new = dict(new or {})
        if not new.get("sgdb_key"):
            new.pop("sgdb_key", None)  # empty field = keep the saved key
        if new.get("clear_sgdb_key"):
            new["sgdb_key"] = ""
        new.pop("clear_sgdb_key", None)
        result = {}
        link = (new.get("sheet_url") or "").strip()
        if "sheet_url" in new and link != self._settings.get("sheet_url"):
            self._settings["sheet_url"] = link
            self._settings["sheet_key"] = ""
            self._client = None
            if sheet.is_script_link(link):
                try:
                    c = sheet.ScriptClient(link)
                    out = c.pair()
                    self._settings["sheet_key"] = c.key
                    result["paired"] = out.get("title") or True
                except Exception as e:
                    result["pair_error"] = str(e)
        for k in ("sgdb_key", "refresh_minutes", "sounds", "view_mode"):
            if k in new:
                self._settings[k] = new[k]
        self._art.sgdb_key = self._settings.get("sgdb_key", "")
        self._write_settings()
        s = self.get_settings()
        s.update(result)
        return s

    def set_pref(self, key, value):
        if key in ("view_mode", "refresh_minutes", "sounds"):
            self._settings[key] = value
            self._write_settings()
        return True

    # ----- data -----
    def cached(self):
        try:
            with open(self._cache_path, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None

    def _script(self):
        url, key = self._settings.get("sheet_url"), self._settings.get("sheet_key")
        if not (sheet.is_script_link(url) and key):
            return None
        if not self._client or self._client.url != url.strip():
            self._client = sheet.ScriptClient(url, key)
        return self._client

    def sync(self):
        with self._sync_lock:
            try:
                client = self._script()
                if client:
                    data = client.read()
                elif sheet.is_script_link(self._settings.get("sheet_url")):
                    raise PermissionError("the app isn't paired with the sheet's script yet. Open Settings and paste the Web app link again.")
                else:
                    data = sheet.load_csv(self._settings.get("sheet_url"))
            except Exception as e:  # report, keep showing the last good data
                return {"error": str(e) or e.__class__.__name__, "code": getattr(e, "code", None)}
            data["can_edit"] = bool(client)
            data["synced_at"] = time.time()
            data["playthroughs"] = data.pop("plays")
            data["playthroughs_options"] = data.pop("plays_options")
            with open(self._cache_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
            return data

    def edit(self, tab, row, name, changes):
        client = self._script()
        if not client:
            return {"error": "Editing needs the sheet connection. Open Settings to set it up."}
        try:
            if not client.headers:
                client.read()
            return client.update(tab, row, name, changes)
        except Exception as e:
            return {"error": str(e)}

    def add(self, tab, values):
        client = self._script()
        if not client:
            return {"error": "Adding needs the sheet connection. Open Settings to set it up."}
        try:
            if not client.headers:
                client.read()
            return client.add(tab, values)
        except Exception as e:
            return {"error": str(e)}

    # ----- art, info & links -----
    def cover(self, name):
        try:
            return self._art.cover(name)
        except Exception:
            return None

    def book_cover(self, title, author=""):
        try:
            return self._art.book_cover(title, author)
        except Exception:
            return None

    def links(self, game):
        appid = None
        try:
            appid = self._art.steam_appid(game.get("name", ""))
        except Exception:
            pass
        return art.links_for(game, appid)

    def ratings(self, game):
        return _safe(self._info.ratings, game)

    def dlcs(self, game):
        return _safe(self._info.dlcs, game) or []

    def wiki(self, game):
        return _safe(self._info.wiki, game)

    def news(self, game):
        return _safe(self._info.news, game) or []

    def updated(self, games):
        return _safe(self._info.updated, games) or {}

    def book_info(self, book):
        return _safe(self._info.book, book)

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
        link = self._settings.get("sheet_url") or ""
        if sheet.is_script_link(link):
            return "Open the sheet from Google Drive."
        return self.open(link) if link else "No sheet link yet."

    def connection_script(self):
        with open(resource(os.path.join("ui", "connect.gs")), encoding="utf-8") as f:
            return f.read()

    # ----- updates -----
    def update_check(self):
        try:
            return self._updater.check()
        except Exception as e:
            return {"error": str(e), "current": VERSION}

    def update_apply(self):
        err = self._updater.apply()
        if err:
            return {"error": err}
        threading.Timer(0.8, self._quit).start()
        return {"ok": True}

    def update_progress(self):
        return self._updater.progress

    def _quit(self):
        try:
            if self._window:
                self._window.destroy()
        finally:
            os._exit(0)


def _safe(fn, *a):
    try:
        return fn(*a)
    except Exception:
        return None


def main():
    import webview  # imported here so the rest can be tested without a GUI
    api = Api()
    api._window = webview.create_window(
        "Game Backlog", resource(os.path.join("ui", "index.html")), js_api=api,
        width=1480, height=920, min_size=(1100, 700), background_color="#0A1430",
    )
    webview.start(gui="edgechromium" if sys.platform == "win32" else None)


if __name__ == "__main__":
    main()
