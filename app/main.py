"""Masterlog: a console-style library for your games and books, on top of your Google Sheet."""
import json
import os
import sys
import threading
import time
import urllib.parse
import webbrowser

import accounts
import art
import http.server
import info
import secrets
import socketserver
import sheet
import updater
import vault
from version import VERSION

APP_NAME = "Masterlog"
OLD_NAME = "GameBacklog"


def data_dir():
    base = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), ".config")
    d, old = os.path.join(base, APP_NAME), os.path.join(base, OLD_NAME)
    if not os.path.exists(d) and os.path.isdir(old):
        try:
            os.replace(old, d)  # carry settings and covers over from the Game Backlog days
        except OSError:
            return old
    os.makedirs(d, exist_ok=True)
    return d


def resource(rel):
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, rel)


DEFAULTS = {"sheet_url": sheet.DEFAULT_SHEET, "sheet_key": "", "sgdb_key": "", "refresh_minutes": 2,
            "view_mode": "covers", "sound_on": True, "ambient_volume": 0.35, "fx_volume": 0.5, "intro": True,
            "heroic_linked": False}
PREFS = ("view_mode", "refresh_minutes", "sound_on", "ambient_volume", "fx_volume", "intro")
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
        self._serve_covers()
        self._info = info.Info(self._dir, self._art)
        self._vault = vault.Vault(self._dir)
        self._accounts = accounts.Accounts(self._dir, self._vault, self._settings)
        threading.Thread(target=self._account_loop, daemon=True).start()
        self._updater = updater.Updater()
        self._updater.cleanup()
        self._sync_lock = threading.Lock()
        self._client = None
        self._window = None

    def _serve_covers(self):
        """Covers go to the page as local file URLs, not as huge inline strings: much lighter on memory."""
        folder, token = self._art.dir, secrets.token_urlsafe(16)

        class Handler(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *a, **k):
                super().__init__(*a, directory=folder, **k)

            def translate_path(self, path):
                path = path.split("?", 1)[0]
                if not path.startswith(f"/{token}/"):
                    return os.path.join(folder, "__denied__")
                name = os.path.basename(urllib.parse.unquote(path[len(token) + 2:]))
                return os.path.join(folder, name) if name and not name.startswith(".") else os.path.join(folder, "__denied__")

            def end_headers(self):
                self.send_header("Cache-Control", "max-age=31536000, immutable")
                self.send_header("Access-Control-Allow-Origin", "*")
                super().end_headers()

            def log_message(self, *a):
                pass

        try:
            class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
                daemon_threads = True
            srv = Server(("127.0.0.1", 0), Handler)
            threading.Thread(target=srv.serve_forever, daemon=True).start()
            self._art.url_base = f"http://127.0.0.1:{srv.server_address[1]}/{token}/"
        except Exception:
            self._art.url_base = None  # fall back to inline images

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
        for k in ("sgdb_key",) + PREFS:
            if k in new:
                self._settings[k] = new[k]
        self._art.sgdb_key = self._settings.get("sgdb_key", "")
        self._write_settings()
        s = self.get_settings()
        s.update(result)
        return s

    def set_pref(self, key, value):
        if key in PREFS:
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
            out = client.update(tab, row, name, changes)
            new = (changes.get("name") or "").strip()
            if tab == "games" and new and new != name:
                for p in client.read().get("plays") or []:   # keep replays attached to the renamed game
                    if p["game"] == name:
                        client.update("plays", p["row"], name, {"game": new})
                self._art.rename_custom(name, new)
            return out
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
        facts = self._facts().get(game.get("name"), {})
        appid = facts.get("appid")
        if not appid:
            try:
                appid = self._art.steam_appid(game.get("name", ""))
            except Exception:
                pass
        return art.links_for(game, appid, facts.get("heroic"))

    def hero(self, name):
        try:
            return self._art.hero(name)
        except Exception:
            return None

    def about(self, game):
        return _safe(self._info.about, game) or {}

    def set_cover(self, name):
        import webview
        paths = self._window.create_file_dialog(webview.OPEN_DIALOG, file_types=("Images (*.png;*.jpg;*.jpeg;*.webp)",))
        if not paths:
            return None
        try:
            return self._art.set_custom(name, paths[0])
        except Exception as e:
            return {"error": str(e)}

    def clear_cover(self, name):
        self._art.clear_custom(name)
        return self.cover(name)

    # ----- linked accounts -----
    def _sheet_games(self):
        data = self.cached() or {}
        return data.get("games") or []

    def _facts(self):
        try:
            return self._accounts.match(self._sheet_games())["facts"]
        except Exception:
            return {}

    def accounts_status(self):
        return self._accounts.status()

    def link_account(self, source, a="", b=""):
        try:
            fn = {"steam": lambda: self._accounts.link_steam(a, b), "psn": lambda: self._accounts.link_psn(a),
                  "heroic": self._accounts.link_heroic, "itch": lambda: self._accounts.link_itch(a)}[source]
            out = fn()
            self._write_settings()
            threading.Thread(target=self._accounts.sync, daemon=True).start()
            return out
        except Exception as e:
            return {"error": str(e) or e.__class__.__name__}

    def unlink_account(self, source):
        self._accounts.unlink(source)
        self._write_settings()
        return self._accounts.status()

    def accounts_sync(self):
        threading.Thread(target=self._accounts.sync, daemon=True).start()
        return True

    def account_data(self):
        try:
            return self._accounts.match(self._sheet_games())
        except Exception as e:
            return {"facts": {}, "candidates": [], "new": [], "error": str(e)}

    def accounts_seen(self):
        self._accounts.mark_seen()
        return True

    def import_games(self, items):
        """Adds games found on your accounts to the sheet."""
        client = self._script()
        if not client:
            return {"error": "Adding games needs the sheet connection. Open Settings to set it up."}
        added, failed = [], []
        if not client.headers:
            client.read()
        for it in items or []:
            values = {"name": it["name"], "status": it.get("status") or "Library", "platform": it.get("platform") or "Steam",
                      "format": "Digital"}
            if it.get("platform") in ("Steam", "GOG", "Epic Games", "EA", "Ubisoft Connect", "itch.io", "PC (Other)"):
                values["play_on"] = "PC"
            if it.get("store_link"):
                values["store_link"] = it["store_link"]
            try:
                client.add("games", values)
                added.append(it["name"])
            except Exception as e:
                failed.append(f"{it['name']}: {e}")
        self._accounts.mark_seen()
        return {"added": added, "failed": failed}

    def _account_loop(self):
        time.sleep(8)
        while True:
            if any(self._accounts.linked(s) for s in ("steam", "psn", "heroic", "itch")):
                try:
                    self._accounts.sync()
                except Exception:
                    pass
            time.sleep(30 * 60)

    def ratings(self, game):
        return _safe(self._info.ratings, game)

    def dlcs(self, game):
        return _safe(self._info.dlcs, game) or []

    def wiki(self, game):
        return _safe(self._info.wiki, game)

    def news(self, game):
        return _safe(self._info.news, game) or []

    def milestones(self, game):
        return _safe(self._info.milestones, game) or []

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
    # let the startup sound and ambience play without waiting for a click
    os.environ.setdefault("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--autoplay-policy=no-user-gesture-required")
    import webview  # imported here so the rest can be tested without a GUI
    api = Api()
    api._window = webview.create_window(
        "Masterlog", resource(os.path.join("ui", "index.html")), js_api=api,
        width=1480, height=920, min_size=(1100, 700), background_color="#0A1430",
    )
    webview.start(gui="edgechromium" if sys.platform == "win32" else None)


if __name__ == "__main__":
    main()
