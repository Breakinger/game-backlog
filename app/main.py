"""Masterlog: a console-style library for your games and books, on top of your Google Sheet."""
import base64
import hashlib
import socket
import json
import os
import re
import sys
import threading
import time
import urllib.parse
import webbrowser

import accounts
import art
import http.server
import igdb
import info
import saver
import secrets
import youtube
import feeds
import deals
import modpacks
import pair
import twitch
import names
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
            "heroic_linked": False, "big_picture": False, "ambience_path": "", "steam_cc": "GE", "ps_locale": "en-us",
            "money": "native", "auto_names": True, "scale": 1, "ui_state": {}, "eshop_country": "DE"}
PREFS = ("view_mode", "refresh_minutes", "sound_on", "ambient_volume", "fx_volume", "intro", "big_picture",
         "steam_cc", "ps_locale", "money", "auto_names", "scale", "ui_state", "eshop_country", "classic")
PRIVATE = ("sgdb_key", "sheet_key", "ambience_path")
# what stays with each PC when you copy Masterlog to another one
MACHINE_ONLY = ("ambience_path", "heroic_linked", "big_picture", "state_meta", "pair_pending", "joined")
# small things kept the same on all your PCs through your sheet's script (version 3)
SHARED_PREFS = ("classic", "steam_cc", "ps_locale", "money", "auto_names", "eshop_country", "ranking")
AUDIO_TYPES = {".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".m4a": "audio/mp4", ".aac": "audio/aac",
               ".wav": "audio/wav", ".flac": "audio/flac", ".webm": "audio/webm"}
COPY_LIMIT = 60 * 1024 * 1024  # smaller files are copied next to the settings, so moving the original doesn't break it


def audio_marks(path):
    """Intro and loop marks stored in the file's tags as MASTERLOG_LOOP=<intro end>,<loop end>,<crossfade>."""
    import re
    try:
        with open(path, "rb") as f:
            head = f.read(256 * 1024)
        m = re.search(rb"MASTERLOG_LOOP=([\d.]+),([\d.]+),([\d.]+)", head)
        if m:
            return {"intro_end": float(m.group(1)), "loop_end": float(m.group(2)), "xfade": float(m.group(3))}
    except OSError:
        pass
    return {"intro_end": 0, "loop_end": 0, "xfade": 3}


class BrowserFetch:
    """Reads a Reddit listing through a hidden window of the app's own browser engine (Edge WebView2). Reddit turns away
    plain requests from apps but serves a normal browser, and since November 2025 it no longer hands out app IDs.
    Only reddit.com pages are ever loaded here, and only to read public posts."""
    HOSTS = ("www.reddit.com", "old.reddit.com")

    def __init__(self):
        self.lock = threading.Lock()
        self.win = None
        self.origin = None
        self.ready = threading.Event()

    def get(self, url, timeout=25):
        import webview
        u = urllib.parse.urlsplit(url)
        if u.scheme != "https" or u.netloc not in self.HOSTS:
            raise ValueError("only Reddit pages are read this way")
        origin = f"https://{u.netloc}"
        with self.lock:
            if self.win is None or self.origin != origin:
                self.ready.clear()
                if self.win is None:
                    self.win = webview.create_window("Masterlog · Reddit reader", origin + "/robots.txt", hidden=True, width=480, height=320)
                    self.win.events.loaded += lambda *a: self.ready.set()
                else:
                    self.win.load_url(origin + "/robots.txt")
                self.origin = origin
                if not self.ready.wait(timeout):
                    self.origin = None
                    raise TimeoutError("Reddit didn't load")
            path = url[len(origin):]
            # same-origin fetch inside the page, so it goes out exactly like the browser's own request
            self.win.evaluate_js("window.__ml = null; fetch(" + json.dumps(path) + ", {credentials: 'include', headers: {Accept: 'application/json'}})"
                                 ".then(r => r.ok ? r.text() : Promise.reject('HTTP ' + r.status))"
                                 ".then(t => { window.__ml = {ok: true, t: t}; }).catch(e => { window.__ml = {ok: false, e: String(e)}; }); 1")
            end = time.time() + timeout
            while time.time() < end:
                r = self.win.evaluate_js("window.__ml")
                if r:
                    if not r.get("ok"):
                        raise IOError(r.get("e") or "Reddit refused")
                    return r.get("t") or ""
                time.sleep(0.3)
            raise TimeoutError("Reddit didn't answer")


class ItchBridge:
    """The only thing itch.io pages opened inside Masterlog can do: add the game you're looking at to your wishlist."""

    def __init__(self, api):
        self._api = api
        self._last = 0

    def add_to_wishlist(self, url, title):
        host = urllib.parse.urlparse(url or "").netloc.lower()
        if not (host == "itch.io" or host.endswith(".itch.io")) or not (title or "").strip():
            return {"error": "Open a game's page on itch.io first."}
        if time.time() - self._last < 2:
            return {"error": "One at a time."}
        self._last = time.time()
        name = re.sub(r"\s+by\s+.+$", "", title.split(" - itch.io")[0].split(" by ")[0]).strip()[:120]
        client = self._api._script()
        if not client:
            return {"error": "Adding needs the sheet connection (Masterlog Settings)."}
        try:
            if not client.headers:
                client.read()
            client.add("games", {"name": name, "status": "Wishlist", "platform": "itch.io", "play_on": "PC", "format": "Digital", "store_link": url.split("?")[0]})
            self._api._itch_added.append(name)
            return {"ok": True, "name": name}
        except Exception as e:
            return {"error": str(e)}


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
        self._vault = vault.Vault(self._dir)
        self._igdb = igdb.IGDB(self._vault)
        self._art.igdb = self._igdb
        self._art.meta_lookup = self._meta
        self._art.mc_cover = lambda name: _safe(info.mc_cover, name)
        self._igdb.meta_lookup = self._meta
        self._info = info.Info(self._dir, self._art, self._igdb)
        self._info.youtube_key = lambda: (self._vault.get("youtube") or {}).get("key")
        self._feeds = feeds.Feeds()
        feeds.REDDIT_APP["id"] = (self._vault.get("reddit") or {}).get("id")
        feeds.BROWSER_FETCH["fn"] = BrowserFetch().get
        self._twitch = twitch.Twitch(self._igdb)
        self._deals = deals.Deals(self._art, self._dir)
        self._deals.ebay = deals.Ebay(self._vault)
        self._renamed = []   # official-title renames done in the background, for the page to announce
        self._itch_added = []
        threading.Thread(target=self._deals_loop, daemon=True).start()
        self._names_path = os.path.join(self._dir, "names.json")
        try:
            with open(self._names_path, encoding="utf-8") as f:
                self._names = json.load(f)
        except Exception:
            self._names = {}
        threading.Thread(target=self._names_loop, daemon=True).start()
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
        app = self

        class Handler(http.server.SimpleHTTPRequestHandler):
            def do_GET(self):
                if self.path.split("?", 1)[0] == f"/{token}/~ambience":
                    return self._ambience()
                if self.path.startswith("/ui/"):
                    return self._ui()
                return super().do_GET()

            def _ui(self):
                """The app's own page, served from http://localhost so embedded Twitch and YouTube players accept it."""
                name = os.path.basename(urllib.parse.unquote(self.path[4:].split("?", 1)[0])) or "index.html"
                types = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8"}
                ext = os.path.splitext(name)[1].lower()
                path = resource(os.path.join("ui", name))
                if ext not in types or not os.path.isfile(path):
                    return self.send_error(404)
                with open(path, "rb") as f:
                    body = f.read()
                self.send_response(200)
                self.send_header("Content-Type", types[ext])
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                http.server.BaseHTTPRequestHandler.end_headers(self)
                self.wfile.write(body)

            def _ambience(self):
                path = app._ambience_file()
                if not path:
                    return self.send_error(404)
                size = os.path.getsize(path)
                start, end = 0, size - 1
                rng = self.headers.get("Range", "")
                if rng.startswith("bytes="):
                    a, _, b = rng[6:].split(",")[0].partition("-")
                    try:
                        if a:
                            start, end = int(a), (int(b) if b else size - 1)
                        elif b:
                            start = max(0, size - int(b))
                    except ValueError:
                        start, end = 0, size - 1
                    end = min(end, size - 1)
                    if start > end:
                        self.send_response(416); self.send_header("Content-Range", f"bytes */{size}"); self.end_headers(); return
                    self.send_response(206); self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                else:
                    self.send_response(200)
                self.send_header("Content-Type", AUDIO_TYPES.get(os.path.splitext(path)[1].lower(), "application/octet-stream"))
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Length", str(end - start + 1))
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Access-Control-Allow-Origin", "*")
                http.server.BaseHTTPRequestHandler.end_headers(self)
                try:
                    with open(path, "rb") as f:
                        f.seek(start)
                        left = end - start + 1
                        while left > 0:
                            chunk = f.read(min(256 * 1024, left))
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                            left -= len(chunk)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass

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
            self._ambience_url = self._art.url_base + "~ambience"
            self._ui_url = f"http://localhost:{srv.server_address[1]}/ui/index.html"
            self._ui_host = "localhost"
        except Exception:
            self._art.url_base = None  # fall back to inline images

    # ----- settings -----
    def get_settings(self):
        s = {k: v for k, v in self._settings.items() if k not in PRIVATE}
        s["has_sgdb_key"] = bool(self._settings.get("sgdb_key"))
        s["has_igdb"] = self._igdb.configured()
        s["has_youtube"] = self._vault.has("youtube")
        s["has_reddit"] = self._vault.has("reddit")
        s["has_nexus"] = self._vault.has("nexus")
        s["sealed"] = bool(self._vault.get("sync"))
        s["has_ebay"] = self._deals.ebay.configured() if getattr(self, "_deals", None) else False
        s["connected"] = bool(sheet.is_script_link(self._settings.get("sheet_url")) and self._settings.get("sheet_key"))
        s["link_kind"] = "script" if sheet.is_script_link(self._settings.get("sheet_url")) else ("csv" if self._settings.get("sheet_url") else "")
        s["data_dir"] = self._dir
        s["ambience"] = self._ambience_info()
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
            self._settings.pop("pair_pending", None)
            if sheet.is_script_link(link):
                try:
                    c = sheet.ScriptClient(link)
                    if not self._vault.get("device"):
                        self._vault.set("device", pair.new_device())
                    out = c.pair(socket.gethostname(), self._vault.get("device")["pub"])
                    if out.get("key"):
                        self._settings["sheet_key"] = c.key
                        result["paired"] = out.get("title") or True
                    elif out.get("pending"):
                        # another PC already uses this sheet: wait until you allow this one in the sheet
                        self._settings["pair_pending"] = {"id": out["pending"], "code": out.get("code"), "title": out.get("title"), "tab": out.get("tab")}
                        result["pending"] = self._settings["pair_pending"]
                except Exception as e:
                    result["pair_error"] = str(e)
        region = (self._settings.get("steam_cc"), self._settings.get("ps_locale"), self._settings.get("eshop_country"))
        for k in ("sgdb_key",) + PREFS:
            if k in new:
                self._settings[k] = new[k]
        if region != (self._settings.get("steam_cc"), self._settings.get("ps_locale"), self._settings.get("eshop_country")):
            self._deals.state["t"] = 0      # new region: fetch prices again
            for e in self._deals.state.get("games", {}).values():
                e.pop("ps", None)
                e.pop("steam_ends", None)
                e.pop("eshop", None)
        self._art.sgdb_key = self._settings.get("sgdb_key", "")
        self._write_settings()
        s = self.get_settings()
        s.update(result)
        return s

    def pair_poll(self):
        """While you're allowing this PC in the sheet: has it been allowed yet?"""
        pend = self._settings.get("pair_pending")
        if not pend:
            return {"none": True}
        try:
            c = sheet.ScriptClient(self._settings.get("sheet_url") or "")
            out = c.device_poll(pend["id"])
        except Exception as e:
            if getattr(e, "code", None) in ("denied", "gone"):
                self._settings.pop("pair_pending", None)
                self._write_settings()
                return {"error": str(e)}
            return {"waiting": True, "code": pend.get("code"), "note": str(e)}
        if out.get("key"):
            self._settings["sheet_key"] = out["key"]
            self._settings["joined"] = True      # account keys come sealed from your other PC
            self._settings.pop("pair_pending", None)
            self._client = None
            self._write_settings()
            return {"ok": True, "title": out.get("title")}
        return {"waiting": True, "code": pend.get("code")}

    def pair_cancel(self):
        self._settings.pop("pair_pending", None)
        self._settings["sheet_url"] = ""
        self._write_settings()
        return True

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
            if client and (data.get("script_version") or 1) >= 4:
                data["state_changed"] = getattr(self, "_state_changed", False)
                self._state_changed = False
                if not getattr(self, "_state_busy", False):
                    threading.Thread(target=self._state_sync_bg, args=(client,), daemon=True).start()
            if data.get("ranking") is None:
                data["ranking"] = [{"rank": i + 1, "game": n} for i, n in enumerate(self._local_ranking())]
                data["ranking_local"] = True
            elif self._settings.get("ranking") and client:
                # you reordered while the old script was in place: move that order into the sheet now
                try:
                    client.rank(self._settings["ranking"])
                    data["ranking"] = [{"rank": i + 1, "game": n} for i, n in enumerate(self._settings["ranking"])]
                    self._settings.pop("ranking", None)
                    self._write_settings()
                except Exception:
                    pass
            data["synced_at"] = time.time()
            data["playthroughs"] = data.pop("plays")
            data["playthroughs_options"] = data.pop("plays_options")
            with open(self._cache_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
            return data

    # ----- your ranking -----
    def _local_ranking(self):
        r = self._settings.get("ranking")
        if r is None:
            with open(resource("top100.txt"), encoding="utf-8") as f:
                r = [l.strip() for l in f if l.strip()]
        return r

    def save_ranking(self, names):
        """Saves the order to the sheet's Ranking tab (or, with an older connection script, on this PC)."""
        names = [n for n in (names or []) if (n or "").strip()]
        client = self._script()
        if client:
            try:
                client.rank(names)
                return {"ok": True, "where": "sheet"}
            except Exception as e:
                if "Unknown action" not in str(e):
                    return {"error": str(e)}
        self._settings["ranking"] = names
        self._write_settings()
        return {"ok": True, "where": "local"}

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

    # ----- deleting (with undo) -----
    def delete_item(self, tab, row, name):
        client = self._script()
        if not client:
            return {"error": "Deleting needs the sheet connection. Open Settings to set it up."}
        try:
            out = client.delete(tab, row, name)
        except Exception as e:
            msg = str(e)
            if "Unknown action" in msg:
                msg = "Deleting needs the newest connection script. In Settings → Sheet & sources, copy the script into your sheet and deploy a new version."
            return {"error": msg}
        if not hasattr(self, "_deleted"):
            self._deleted = {}
        tok = secrets.token_hex(6)
        self._deleted[tok] = out.get("deleted")
        return {"ok": True, "undo": tok}

    def undo_delete(self, tok):
        d = getattr(self, "_deleted", {}).pop(tok, None)
        client = self._script()
        if not d or not client:
            return {"error": "That can't be undone any more."}
        try:
            client.restore(d)
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}

    # ----- Top 100 games that aren't in your library yet -----
    def _guess_platform(self, name):
        """Where you have it, going by your linked accounts; otherwise PC (Other), for you to change."""
        for src, entry in (self._accounts.state.get("sources") or {}).items():
            for a in entry.get("games") or []:
                if a.get("platform") and art.same_title(name, a.get("name", ""), 0.85):
                    return a["platform"]
        return "PC (Other)"

    def add_from_ranking(self, names):
        client = self._script()
        if not client:
            return {"error": "Adding needs the sheet connection."}
        try:
            if not client.headers:
                client.read()
        except Exception as e:
            return {"error": str(e)}
        added, failed = [], []
        for n in (names or [])[:25]:
            n = (n or "").strip()
            if not n:
                continue
            plat = self._guess_platform(n)
            try:
                out = client.add("games", {"name": n, "status": "Completed", "platform": plat, "format": "Digital",
                                           "notes": "Added from your Top 100"})
                added.append({"name": n, "platform": plat, "row": out.get("row")})
            except Exception as e:
                failed.append({"name": n, "error": str(e)})
        return {"added": added, "failed": failed}

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
    def cover(self, name, platform=""):
        try:
            return self._art.cover(name, platform or "", self._cover_hints(name))
        except Exception:
            return None

    def cover_options(self, name, platform="", query=""):
        """Covers to choose from in the app: official store art first, then IGDB and SteamGridDB."""
        try:
            return {"items": self._art.candidates(name, platform or "", self._cover_hints(name), (query or "").strip() or None)}
        except Exception as e:
            return {"items": [], "error": str(e)}

    def pick_cover(self, name, url):
        try:
            return {"uri": self._art.set_from_url(name, url)}
        except Exception as e:
            return {"error": str(e)}

    def book_cover(self, title, author=""):
        try:
            return self._art.book_cover(title, author)
        except Exception:
            return None

    # the same cover tools for books
    def book_cover_options(self, book, query=""):
        try:
            return {"items": self._art.book_candidates(book.get("name", ""), book.get("author", ""), (query or "").strip() or None)}
        except Exception as e:
            return {"items": [], "error": str(e)}

    def pick_book_cover(self, book, url):
        try:
            return {"uri": self._art.set_book_from_url(book.get("name", ""), book.get("author", ""), url)}
        except Exception as e:
            return {"error": str(e)}

    def set_book_cover(self, book):
        import webview
        paths = self._window.create_file_dialog(webview.OPEN_DIALOG, file_types=("Images (*.png;*.jpg;*.jpeg;*.webp)",))
        if not paths:
            return None
        try:
            return self._art.set_book_custom(book.get("name", ""), book.get("author", ""), paths[0])
        except Exception as e:
            return {"error": str(e)}

    def clear_book_cover(self, book):
        self._art.forget_book(book.get("name", ""), book.get("author", ""), mine_too=True)
        return self.book_cover(book.get("name", ""), book.get("author", ""))

    def refresh_book(self, book):
        """Fetch a book's cover, ratings and description again."""
        title, author = book.get("name", ""), book.get("author", "")
        self._art.forget_book(title, author)
        self._info.cache.forget(art.Art.book_key(title, author))
        return {"ok": True, "uri": self.book_cover(title, author)}

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

    # ----- ambience track -----
    def _ambience_file(self):
        p = self._settings.get("ambience_path") or ""
        return p if p and os.path.isfile(p) else None

    def _ambience_info(self):
        p = self._ambience_file()
        if not p or not getattr(self, "_ambience_url", None):
            return None
        marks = audio_marks(p)
        return {"url": f"{self._ambience_url}?v={int(os.path.getmtime(p))}", "name": self._settings.get("ambience_name") or os.path.basename(p), **marks}

    def choose_ambience(self):
        import shutil
        import webview
        paths = self._window.create_file_dialog(webview.OPEN_DIALOG, file_types=("Audio (*.mp3;*.ogg;*.opus;*.m4a;*.aac;*.wav;*.flac;*.webm)",))
        if not paths:
            return None
        src = paths[0]
        ext = os.path.splitext(src)[1].lower()
        if ext not in AUDIO_TYPES:
            return {"error": "That isn't an audio file Masterlog can play."}
        try:
            dest = src
            if os.path.getsize(src) <= COPY_LIMIT:
                os.makedirs(os.path.join(self._dir, "audio"), exist_ok=True)
                for old in os.listdir(os.path.join(self._dir, "audio")):
                    if old.startswith("ambience."):
                        os.remove(os.path.join(self._dir, "audio", old))
                dest = os.path.join(self._dir, "audio", "ambience" + ext)
                shutil.copyfile(src, dest)
            self._settings["ambience_path"] = dest
            self._settings["ambience_name"] = os.path.basename(src)
            self._write_settings()
        except OSError as e:
            return {"error": f"Couldn't use that file: {e}"}
        info_ = self._ambience_info()
        if info_:
            info_["name"] = os.path.basename(src)
        return {"ambience": info_}

    def clear_ambience(self):
        self._settings["ambience_path"] = ""
        self._write_settings()
        return {"ambience": None}

    def clear_cover(self, name):
        self._art.clear_custom(name)
        return self.cover(name)

    # ----- linked accounts -----
    def _meta(self, name):
        """Developer and publisher from your sheet, used to double-check every store match."""
        c = getattr(self, "_meta_cache", None)
        if not c or time.time() - c[0] > 60:
            c = (time.time(), {art._norm(g["name"]): {"developer": g.get("developer"), "publisher": g.get("publisher")} for g in self._sheet_games()})
            self._meta_cache = c
        return c[1].get(art._norm(name))

    def _sheet_games(self):
        data = self.cached() or {}
        return data.get("games") or []

    def _facts(self):
        """What your linked accounts say about each sheet game. Kept for a minute: covers ask for it a lot."""
        c = getattr(self, "_facts_cache", None)
        if c and time.time() - c[0] < 60:
            return c[1]
        try:
            facts = self._accounts.match(self._sheet_games())["facts"]
        except Exception:
            facts = {}
        for name, f in facts.items():
            if f.get("appid"):
                self._art.remember_appid(name, f["appid"])
        self._facts_cache = (time.time(), facts)
        return facts

    def _cover_hints(self, name):
        f = self._facts().get(name) or {}
        return {"appid": f.get("appid"), "ps_art": f.get("ps_art")}

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

    def candidate_cover(self, name, platform="", appid=None, art_url=None):
        """Cover for a game that's on your account but not in the sheet yet, so you can recognise it."""
        try:
            return self._art.cover(name, platform or "", {"appid": appid, "ps_art": art_url})
        except Exception:
            return None

    def hide_games(self, ids, restore=False):
        """Never suggest these again (or bring them back)."""
        return {"hidden": self._accounts.blacklist(ids or [], remove=bool(restore))}

    def hidden_games(self):
        bl = set(self._accounts.state.get("blacklist") or [])
        out = []
        for src, e in self._accounts.state["sources"].items():
            for a in (e.get("games") or []) + (e.get("wishlist") or []):
                if a["id"] in bl:
                    out.append(dict(a, source=src))
        return out

    def import_games(self, items):
        """Adds games found on your accounts to the sheet."""
        client = self._script()
        if not client:
            return {"error": "Adding games needs the sheet connection. Open Settings to set it up."}
        added, failed = [], []
        if not client.headers:
            client.read()
        for it in items or []:
            values = {"name": it["name"], "status": "Wishlist" if it.get("wishlist") else (it.get("status") or "Library"), "platform": it.get("platform") or "Steam",
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

    def media(self, game):
        return _safe(self._info.media, game) or {"shots": [], "videos": []}

    def set_igdb(self, client_id, secret):
        try:
            self._igdb.set_credentials(client_id, secret)
            return {"ok": True}
        except Exception as e:
            self._vault.set("igdb", None)
            return {"error": str(e) or "Couldn't connect to IGDB."}

    # ----- deals, prices and official titles -----
    def _deals_inputs(self):
        games = self._sheet_games()
        wish = [g for g in games if g.get("status") == "Wishlist"]
        owned = [g for g in games if g.get("status") in ("Playing", "Paused", "Library", "Completed", "Live service")]
        return wish, owned

    def _dlc_cached(self, game):
        e = self._info.cache.data.get("dlcs", {}).get(info.Info._key(game))
        return (e or {}).get("v") or []

    def _run_deals(self):
        wish, owned = self._deals_inputs()
        if not wish and not owned:
            return
        facts, wish_dlc = {}, []
        try:
            m = self._accounts.match(self._sheet_games())
            facts = m["facts"]
            for src, e in self._accounts.state["sources"].items():
                wish_dlc += [w["appid"] for w in e.get("wishlist") or [] if w.get("dlc")]
        except Exception:
            pass
        extra = {"appids": {n: f["appid"] for n, f in facts.items() if f.get("appid")}, "wish_dlc": wish_dlc, "owned_marks": self.dlc_marks()}
        self._deals.refresh(wish, owned, self._settings.get("steam_cc") or "GE", self._settings.get("ps_locale") or "en-us", self._dlc_cached,
                            extra=extra, eshop_country=self._settings.get("eshop_country") or "DE",
                            news_lookup=lambda name: info.google_news(name, 20))
        self._apply_renames()

    def _deals_loop(self):
        time.sleep(25)
        while True:
            try:
                if time.time() - (self._deals.state.get("t") or 0) > 3 * 3600:
                    self._run_deals()
            except Exception:
                pass
            time.sleep(20 * 60)

    def _apply_renames(self):
        """Wishlist games that got their official full title: renamed in the sheet (with undo in the app)."""
        props = self._deals.state.get("renames") or {}
        if not props or not self._settings.get("auto_names", True):
            return
        client = self._script()
        if not client:
            return
        wish = {g["name"]: g for g in self._sheet_games() if g.get("status") == "Wishlist"}
        for old, hit in list(props.items()):
            g = wish.get(old)
            if not g or hit.get("done") or hit.get("undone") or hit.get("suggest"):
                continue   # titles only seen in the news wait for you to confirm them
            r = self.edit("games", g.get("row"), old, {"name": hit["name"]})
            if r and not r.get("error"):
                hit["done"] = time.time()
                self._renamed.append({"old": old, "new": hit["name"], "source": hit["source"], "row": g.get("row")})
                g2 = self._deals.state["games"].pop(old, None)
                if g2:
                    self._deals.state["games"][hit["name"]] = g2
        self._deals._remember()

    # ----- official titles for every game (fixes missing covers, manuals and ratings) -----
    def _names_loop(self):
        time.sleep(40)
        while True:
            try:
                self._fix_names()
            except Exception:
                pass
            time.sleep(30 * 60)

    def _fix_names(self):
        if not self._settings.get("auto_names", True) or not self._script():
            return
        games = [g for g in self._sheet_games() if g.get("type") != "Modded" and g.get("name")]
        # games with no cover go first: their name is the likeliest reason
        def missing(g):
            e = self._art.index.get(art._norm(g["name"]))
            return not (e and e.get("file"))
        games.sort(key=lambda g: not missing(g))
        checked = 0
        for g in games:
            k = art._norm(g["name"])
            e = self._names.get(k)
            if e and time.time() - e.get("t", 0) < (3 if missing(g) else 30) * 86400:
                continue
            hit = names.official_title(g["name"], self._meta(g["name"]), self._igdb, info.mc_search)
            self._names[k] = {"t": time.time(), "hit": hit}
            if hit and not self._names.get("undo:" + k):
                r = self.edit("games", g.get("row"), g["name"], {"name": hit["name"]})
                if r and not r.get("error"):
                    self._renamed.append({"old": g["name"], "new": hit["name"], "source": hit["source"], "row": g.get("row")})
                    self._art.forget(hit["name"])
            saver.save_later(self._names_path, lambda: self._names)
            checked += 1
            if checked >= 40:
                break
            time.sleep(1.5)

    def deals(self, force=False):
        wish, _ = self._deals_inputs()
        if force or (not self._deals.running and time.time() - (self._deals.state.get("t") or 0) > 3 * 3600):
            threading.Thread(target=self._run_deals, daemon=True).start()
        snap = self._deals.snapshot([g["name"] for g in wish])
        snap["links"] = {g["name"]: deals.physical_links(g["name"], g.get("platform")) for g in wish
                         if g.get("platform") in deals.PHYSICAL_LABEL}
        snap["running"] = self._deals.running or force
        return snap

    # ----- DLC you own (Steam doesn't share DLC ownership, so you tick it once; Steam wishlist DLC is spotted on its own) -----
    def _dlc_path(self):
        return os.path.join(self._dir, "dlc_owned.json")

    def dlc_marks(self):
        try:
            with open(self._dlc_path(), encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def mark_dlc(self, game, dlc, owned):
        marks = self.dlc_marks()
        g = marks.setdefault(game, {})
        if owned:
            g[dlc] = True
        else:
            g.pop(dlc, None)
        tmp = self._dlc_path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(marks, f, ensure_ascii=False)
        os.replace(tmp, self._dlc_path())
        return marks

    # ----- watch: Twitch streams and YouTube videos inside the app -----
    def watch(self, game):
        name = (game or {}).get("name", "")
        out = {"twitch": {"items": []}, "youtube": [], "host": getattr(self, "_ui_host", "127.0.0.1")}
        try:
            out["twitch"] = self._twitch.streams(name)
        except Exception as e:
            out["twitch"] = {"items": [], "error": str(e)}
        key = info.Info._key(game) + "|watch"
        hit = self._info.cache.get("watch", key)
        if hit is None:
            try:
                hit = youtube.videos(name, self._info.youtube_key())
                if hit:
                    self._info.cache.put("watch", key, hit)
            except Exception:
                hit = []
        out["youtube"] = hit or []
        return out

    # ----- modpacks from your mod managers -----
    def modpacks_scan(self):
        found = modpacks.scan((self._vault.get("nexus") or {}).get("key"))
        have = {art._norm(g["name"]) for g in self._sheet_games()}
        for p in found["items"]:
            p["name"] = f"{p['game']}: {p['profile']}"
            p["added"] = art._norm(p["name"]) in have
        return found

    def add_modpack(self, p):
        client = self._script()
        if not client:
            return {"error": "Adding needs the sheet connection. Open Settings to set it up."}
        if not client.headers:
            client.read()
        notes = f"{p.get('manager')} profile" + (f" · {p.get('mods')} mods" if p.get("mods") else "") + (f" · {p.get('detail')}" if p.get("detail") else "")
        values = {"name": p["name"], "status": "Playing", "platform": "PC (Other)" if p.get("game") == "Minecraft" else "Steam",
                  "play_on": "PC", "format": "Digital", "type": "Modded", "modded": True, "notes": notes}
        if str(p.get("url") or "").startswith("https://www.nexusmods.com/"):
            values["store_link"] = p["url"]
        try:
            client.add("games", values)
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}

    def refresh_game(self, game):
        """Fetch everything about one game again: cover, art, synopsis, ratings, DLC, trailers, news."""
        name = (game or {}).get("name", "")
        if not name:
            return False
        self._info.cache.forget(info.Info._key(game))
        self._art.forget(name)
        self._facts_cache = None
        # the usual reason info is missing: a name the stores don't use
        hit = _safe(names.official_title, name, self._meta(name), self._igdb, info.mc_search)
        if hit and self._script():
            g = next((x for x in self._sheet_games() if x["name"] == name), None)
            r = self.edit("games", (g or {}).get("row"), name, {"name": hit["name"]}) if g else None
            if r and not r.get("error"):
                self._art.forget(hit["name"])
                return {"renamed": hit["name"], "source": hit["source"], "row": g.get("row")}
        return {"ok": True}

    def apply_rename(self, old):
        hit = (self._deals.state.get("renames") or {}).get(old)
        g = next((g for g in self._sheet_games() if g["name"] == old), None)
        if not hit or not g:
            return {"error": "That suggestion is gone."}
        r = self.edit("games", g.get("row"), old, {"name": hit["name"]})
        if r and not r.get("error"):
            hit["done"] = time.time()
            self._deals._remember()
        return r

    def renamed(self):
        """Renames done since the page last asked."""
        out, self._renamed = self._renamed, []
        return out

    def undo_rename(self, old, new, row):
        props = self._deals.state.get("renames") or {}
        if old in props:
            props[old]["undone"] = time.time()
        self._deals._remember()
        self._names["undo:" + art._norm(old)] = True   # don't rename it again
        saver.save_later(self._names_path, lambda: self._names)
        return self.edit("games", row, new, {"name": old})

    # ----- News catalog -----
    def news_section(self, name):
        if name == "yours":
            games = [g for g in self._sheet_games() if g.get("status") in
                     ("Playing", "Paused", "Library", "Live service", "Wishlist", "Completed") or g.get("type") == "Live service"]
            games.sort(key=lambda g: (g.get("status") not in ("Playing", "Live service"), g.get("status") == "Completed"))
            return _safe(self._info.your_news, games) or {"items": [], "pending": 0}
        return _safe(self._feeds.section, name) or {"items": [], "errors": ["Couldn't load the news."]}

    def set_youtube_key(self, key):
        """Optional: the official YouTube Data API instead of reading YouTube's search page."""
        key = (key or "").strip()
        if not key:
            self._vault.set("youtube", None)
            return {"ok": True, "removed": True}
        try:
            youtube.search_api("Masterlog test trailer", key, 1)
        except Exception as e:
            return {"error": f"YouTube didn't accept that key ({e})."}
        self._vault.set("youtube", {"key": key})
        return {"ok": True}

    # ----- pages opened inside Masterlog (wikis, maps, itch.io) -----
    def open_inside(self, url, title="Masterlog"):
        """Opens a web page in its own Masterlog window (wikis and maps work fine there, unlike in an embedded frame)."""
        import webview
        if not re.match(r"^https://", url or ""):
            return {"error": "Only https pages can be opened."}
        win = webview.create_window(f"{title} · Masterlog", url, width=1320, height=860, background_color="#0A1430")
        return {"ok": bool(win)}

    def browse_itch(self, url="https://itch.io/games"):
        """itch.io inside Masterlog, with an 'Add to Masterlog wishlist' button on every game page."""
        import webview
        if not hasattr(self, "_itch_bridge"):
            self._itch_bridge = ItchBridge(self)
        win = webview.create_window("itch.io · Masterlog", url, js_api=self._itch_bridge, width=1320, height=860, background_color="#0A1430")
        script = r"""
(function () {
  if (document.getElementById('ml-add')) return;
  var og = document.querySelector('meta[property="og:title"]');
  var isGame = /\.itch\.io$/.test(location.hostname) && location.pathname.split('/').filter(Boolean).length === 1;
  if (!isGame) return;
  var b = document.createElement('button');
  b.id = 'ml-add'; b.textContent = '+ Add to Masterlog wishlist';
  b.style.cssText = 'position:fixed;right:22px;bottom:22px;z-index:2147483647;padding:12px 18px;border-radius:999px;border:0;font:600 14px Segoe UI,sans-serif;background:#4A8CFF;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.4);cursor:pointer';
  b.onclick = function () {
    var t = (og && og.content) || document.title;
    window.pywebview.api.add_to_wishlist(location.href, t).then(function (r) {
      b.textContent = r && r.ok ? '\u2713 Added "' + r.name + '"' : (r && r.error) || 'Could not add it';
      b.style.background = r && r.ok ? '#2F9E44' : '#C92A2A';
    });
  };
  document.body.appendChild(b);
})();"""
        win.events.loaded += lambda: win.evaluate_js(script)
        return {"ok": True}

    def itch_added(self):
        out, self._itch_added = self._itch_added, []
        return out

    def set_reddit_app(self, app_id):
        """Optional: a free Reddit app ID, so Reddit lets Masterlog read the subreddits."""
        app_id = (app_id or "").strip()
        self._vault.set("reddit", {"id": app_id} if app_id else None)
        feeds.REDDIT_APP["id"] = app_id or None
        feeds._reddit_token.update(token=None, until=0)
        if not app_id:
            return {"ok": True, "removed": True}
        try:
            feeds._reddit_oauth()
        except Exception as e:
            self._vault.set("reddit", None)
            feeds.REDDIT_APP["id"] = None
            return {"error": f"Reddit didn't accept that app ID ({e}). Make sure the app type is 'installed app'."}
        self._feeds.cache.clear()
        return {"ok": True}

    def set_nexus_key(self, key):
        """Optional: your free personal Nexus Mods API key, to list the mods you track and endorse there."""
        key = (key or "").strip()
        if not key:
            self._vault.set("nexus", None)
            return {"ok": True, "removed": True}
        try:
            who = modpacks.nexus_validate(key)
        except Exception as e:
            return {"error": f"Nexus Mods didn't accept that key ({e})."}
        self._vault.set("nexus", {"key": key})
        return {"ok": True, "name": who.get("name")}

    def nexus_link(self, name):
        return _safe(modpacks.nexus_link, name, (self._vault.get("nexus") or {}).get("key")) or ""

    def set_ebay_keys(self, client_id, secret):
        """Optional: your free eBay developer keys, for the cheapest physical copy of wishlist games."""
        client_id, secret = (client_id or "").strip(), (secret or "").strip()
        if not client_id or not secret:
            self._vault.set("ebay", None)
            self._vault.set("ebay_token", None)
            return {"ok": True, "removed": True}
        self._vault.set("ebay", {"id": client_id, "secret": secret})
        self._vault.set("ebay_token", None)
        try:
            self._deals.ebay._token()
        except Exception as e:
            self._vault.set("ebay", None)
            return {"error": f"eBay didn't accept those keys ({e})."}
        self._deals.state["t"] = 0
        return {"ok": True}

    def milestones(self, game):
        return _safe(self._info.milestones, game) or []

    def updated(self, games):
        return _safe(self._info.updated, games) or {}

    def awards(self, game):
        """Awards the game won in real life (Wikipedia's accolades), for the All Time Classic."""
        name = (game or {}).get("name", "")
        key = info._norm(name)
        hit = self._info.cache.get("awards", key)
        if hit is not None:
            return hit
        out = _safe(info.awards, name)
        if out is not None:
            self._info.cache.put("awards", key, out)
        return out or {"wins": [], "goty": 0, "nominations": 0}

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

    def toggle_big_picture(self):
        """Borderless fullscreen: no window frame, no taskbar."""
        if not self._window:
            return False
        self._window.toggle_fullscreen()
        self._fullscreen = not getattr(self, "_fullscreen", bool(self._settings.get("big_picture")))
        return self._fullscreen

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

    # ----- your other PCs: copy everything once over your network, then keep in step through the sheet -----
    def _bundle(self):
        if not self._vault.get("sync"):   # the key your PCs use to seal account keys they share through the sheet
            self._vault.set("sync", {"key": base64.b64encode(os.urandom(32)).decode()})
        saver.flush()   # anything still waiting to be written goes in too
        files = {"accounts.json": base64.b64encode(json.dumps(self._accounts.state).encode()).decode(),
                 "names.json": base64.b64encode(json.dumps(self._names).encode()).decode()}
        for name in ("dlc_owned.json", "last_sync.json"):
            try:
                with open(os.path.join(self._dir, name), "rb") as f:
                    files[name] = base64.b64encode(f.read()).decode()
            except OSError:
                pass
        audio = None
        p = self._ambience_file()
        if p and os.path.getsize(p) <= 60 * 1024 * 1024:
            with open(p, "rb") as f:
                audio = {"ext": os.path.splitext(p)[1].lower(), "data": base64.b64encode(f.read()).decode()}
        return {"v": 1, "from": socket.gethostname(), "t": time.time(), "version": VERSION,
                "settings": {k: v for k, v in self._settings.items() if k not in MACHINE_ONLY},
                "vault": {k: v for k, v in self._vault._data.items() if k != "device"}, "files": files, "covers": self._art.mine(with_files=True), "audio": audio}

    def _apply_bundle(self, b):
        if b.get("v") != 1:
            raise ValueError("That PC runs a different Masterlog. Update both and try again.")
        for name, data in (b.get("files") or {}).items():
            if name not in ("accounts.json", "names.json", "dlc_owned.json", "last_sync.json"):
                continue
            tmp = os.path.join(self._dir, name + ".tmp")
            with open(tmp, "wb") as f:
                f.write(base64.b64decode(data))
            os.replace(tmp, os.path.join(self._dir, name))
        for k, v in (b.get("vault") or {}).items():
            self._vault.set(k, v)          # sealed again with this PC's own Windows protection
        covers = 0
        for k, item in (b.get("covers") or {}).items():
            covers += bool(_safe(self._art.adopt, k, item))
        incoming = {k: v for k, v in (b.get("settings") or {}).items() if k not in MACHINE_ONLY}
        self._settings.update(incoming)
        a = b.get("audio")
        if a and a.get("ext") in AUDIO_TYPES:
            folder = os.path.join(self._dir, "audio")
            os.makedirs(folder, exist_ok=True)
            dest = os.path.join(folder, "ambience" + a["ext"])
            with open(dest, "wb") as f:
                f.write(base64.b64decode(a["data"]))
            self._settings["ambience_path"] = dest
        self._settings.pop("state_meta", None)
        self._write_settings()
        self._client = None
        saver.flush()
        return {"from": b.get("from"), "keys": sorted(k for k in (b.get("vault") or {}) if k != "sync"), "covers": covers, "audio": bool(a),
                "sheet": bool(incoming.get("sheet_key"))}

    def share_start(self):
        if not getattr(self, "_share", None):
            self._share = pair.Share(self._bundle)
        try:
            return self._share.start()
        except OSError as e:
            return {"stage": "error", "error": f"Couldn't open the network for sharing ({e})."}

    def share_status(self):
        return getattr(self, "_share", None) and self._share.state or {"stage": "off"}

    def share_decide(self, ok):
        if getattr(self, "_share", None):
            self._share.decide(ok)
        return True

    def share_stop(self):
        if getattr(self, "_share", None):
            self._share.stop()
        return True

    def receive_find(self):
        try:
            return {"pcs": pair.discover()}
        except OSError as e:
            return {"pcs": [], "error": str(e)}

    def receive_start(self, ip, port=None):
        if not getattr(self, "_receive", None):
            self._receive = pair.Receive(self._apply_bundle)
        try:
            return self._receive.start((ip or "").strip(), port or pair.PORT)
        except ValueError as e:
            return {"stage": "error", "error": str(e)}

    def receive_status(self):
        return getattr(self, "_receive", None) and self._receive.state or {"stage": "off"}

    def restart_app(self):
        """After copying from another PC: start again so every account and key is picked up."""
        if getattr(sys, "frozen", False):
            env = {k: v for k, v in os.environ.items() if not k.startswith(("_PYI", "_MEI"))}
            env["PYINSTALLER_RESET_ENVIRONMENT"] = "1"
            import subprocess
            subprocess.Popen([sys.executable], cwd=os.path.dirname(sys.executable), env=env,
                             creationflags=0x00000008 | 0x00000200, close_fds=True)
            threading.Timer(0.6, self._quit).start()
        return True

    # keeping your PCs in step: small things only, through your sheet's script; account keys go encrypted
    def _state_sections(self):
        out = {"prefs": {k: self._settings.get(k) for k in SHARED_PREFS if k in self._settings},
               "blacklist": sorted(self._accounts.state.get("blacklist") or []),
               "dlc": self.dlc_marks(), "names": self._names,
               "covers": {k: {kk: v[kk] for kk in ("src", "url", "t")} for k, v in self._art.mine().items() if v.get("url")},
               "files": self._files_local()}
        sync = (self._vault.get("sync") or {}).get("key")
        if sync:
            secret = {k: v for k, v in self._vault._data.items() if k not in ("sync", "device")}
            out["secrets"] = {"blob": base64.b64encode(pair.seal(base64.b64decode(sync), secret, b"masterlog secrets")).decode(),
                              "hash": hashlib.sha256(json.dumps(secret, sort_keys=True).encode()).hexdigest()}
        return out

    def _apply_section(self, name, data):
        if name == "prefs":
            self._settings.update({k: v for k, v in (data or {}).items() if k in SHARED_PREFS})
            self._write_settings()
        elif name == "blacklist":
            self._accounts.state["blacklist"] = sorted(set(data or []))
            self._accounts._save()
        elif name == "dlc":
            tmp = self._dlc_path() + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data or {}, f, ensure_ascii=False)
            os.replace(tmp, self._dlc_path())
        elif name == "names":
            self._names = data or {}
            saver.save_later(self._names_path, lambda: self._names)
        elif name == "covers":
            for k, item in (data or {}).items():
                _safe(self._art.adopt, k, item)
        elif name == "files":
            self._files_pull(self._script(), data)
        elif name == "secrets":
            sync = (self._vault.get("sync") or {}).get("key")
            if not sync:
                raise ValueError("no sealing key yet")
            if sync and data and data.get("blob"):
                secret = pair.unseal(base64.b64decode(sync), base64.b64decode(data["blob"]), b"masterlog secrets")
                for k in set(self._vault._data) - set(secret) - {"sync", "device"}:
                    self._vault.set(k, None)
                for k, v in secret.items():
                    if k not in ("sync", "device"):
                        self._vault.set(k, v)
                feeds.REDDIT_APP["id"] = (self._vault.get("reddit") or {}).get("id")

    def _files_local(self):
        out = {}
        p = self._ambience_file()
        if p and os.path.getsize(p) <= 20 * 1024 * 1024:
            out["ambience" + os.path.splitext(p)[1].lower()] = {"t": int(os.path.getmtime(p)), "size": os.path.getsize(p)}
        for k, e in self._art.mine().items():
            if e.get("src") == "custom":
                path = os.path.join(self._art.dir, e["file"])
                if os.path.exists(path) and os.path.getsize(path) <= 20 * 1024 * 1024:
                    out["cover-" + hashlib.sha1(k.encode()).hexdigest()[:16] + os.path.splitext(e["file"])[1]] = {"t": int(e.get("t") or 0), "size": os.path.getsize(path), "key": k}
        return out

    def _files_push(self, client, local, remote):
        for name, f in local.items():
            r = remote.get(name)
            if r and r.get("t", 0) >= f["t"]:
                continue
            path = self._ambience_file() if name.startswith("ambience") else os.path.join(self._art.dir, self._art.index[f["key"]]["file"])
            with open(path, "rb") as fh:
                data = base64.b64encode(fh.read()).decode()
            ext = os.path.splitext(name)[1]
            mime = AUDIO_TYPES.get(ext) or {".png": "image/png", ".webp": "image/webp"}.get(ext, "image/jpeg")
            client.file_put(name, data, mime)

    def _files_pull(self, client, remote):
        local = self._files_local()
        for name, f in (remote or {}).items():
            mine = local.get(name)
            if mine and mine.get("t", 0) >= f.get("t", 0):
                continue
            data = (client.file_get(name) or {}).get("data")
            if not data:
                continue
            if name.startswith("ambience"):
                ext = os.path.splitext(name)[1]
                if ext not in AUDIO_TYPES:
                    continue
                folder = os.path.join(self._dir, "audio")
                os.makedirs(folder, exist_ok=True)
                for old in os.listdir(folder):
                    if old.startswith("ambience"):
                        try:
                            os.remove(os.path.join(folder, old))
                        except OSError:
                            pass
                dest = os.path.join(folder, "ambience" + ext)
                with open(dest, "wb") as fh:
                    fh.write(base64.b64decode(data))
                os.utime(dest, (f["t"], f["t"]))
                self._settings["ambience_path"] = dest
                self._write_settings()
            elif f.get("key"):
                self._art.adopt(f["key"], {"src": "custom", "data": data, "t": f.get("t")})

    def _state_sync_bg(self, client):
        self._state_busy = True
        try:
            if self._state_sync(client):
                self._state_changed = True
        except Exception:
            pass
        finally:
            self._state_busy = False

    def _state_sync(self, client):
        if not self._vault.get("sync") and not self._settings.get("joined"):
            self._vault.set("sync", {"key": base64.b64encode(os.urandom(32)).decode()})
        meta = self._settings.setdefault("state_meta", {})      # section -> {"hash", "t"} as this PC last knew it
        got = client.state_get() or {}
        remote = got.get("state") or {}
        local = self._state_sections()
        now = time.time()
        for name, data in local.items():
            h = data["hash"] if name == "secrets" else hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
            if name not in meta:
                # first time this PC takes part: what your other PCs already shared wins over this PC's blank slate
                meta[name] = {"hash": h, "t": 0 if name in remote else now}
            elif meta[name].get("hash") != h:
                meta[name] = {"hash": h, "t": now}             # changed here since last time
        # a PC you allowed in the sheet gets the sealing key from one of your other PCs, wrapped for it alone
        if not self._vault.get("sync") and got.get("wrapped") and self._vault.get("device"):
            try:
                self._vault.set("sync", {"key": base64.b64encode(pair.unwrap(got["wrapped"], self._vault.get("device"))).decode()})
                local = self._state_sections()
                meta.pop("secrets", None)
            except Exception:
                pass
        if self._vault.get("sync"):
            for want in got.get("keys_wanted") or []:
                try:
                    client.device_wrap(want["id"], pair.wrap(base64.b64decode(self._vault.get("sync")["key"]), want["pub"]))
                except Exception:
                    continue
        push, changed = {}, False
        for name in set(local) | set(remote):
            mine, theirs = meta.get(name), remote.get(name)
            if theirs and (not mine or theirs.get("t", 0) > mine.get("t", 0)):
                try:
                    self._apply_section(name, theirs.get("data"))
                    applied = self._state_sections().get(name)
                    h = applied["hash"] if name == "secrets" else hashlib.sha256(json.dumps(applied, sort_keys=True).encode()).hexdigest()
                    meta[name] = {"hash": h, "t": theirs.get("t", 0)}
                    changed = True
                except Exception:
                    continue
            elif mine and name in local and (not theirs or mine.get("t", 0) > theirs.get("t", 0)):
                push[name] = {"t": mine["t"], "data": local[name]}
        if "files" in push:
            try:
                self._files_push(client, local["files"], (remote.get("files") or {}).get("data") or {})
            except Exception:
                push.pop("files")
        if push:
            client.state_put(push)
        self._write_settings()
        return changed

    def _quit(self):
        saver.flush()   # os._exit skips the usual on-close writes
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
    ui_url = getattr(api, "_ui_url", None)
    api._window = webview.create_window(
        "Masterlog", ui_url or resource(os.path.join("ui", "index.html")), js_api=api,
        width=1480, height=920, min_size=(1100, 700), background_color="#0A1430",
        fullscreen=bool(api._settings.get("big_picture")),
    )
    api._fullscreen = bool(api._settings.get("big_picture"))
    # served over http://127.0.0.1 rather than file://, so embedded YouTube trailers know where they're playing
    webview.start(gui="edgechromium" if sys.platform == "win32" else None, http_server=not ui_url)


if __name__ == "__main__":
    main()
