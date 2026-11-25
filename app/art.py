"""Cover art and store links. Covers come from SteamGridDB (if you set a key) or Steam's library art,
and are cached on disk so each one is downloaded once."""
import base64
import difflib
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) GameBacklog/1.0"
MISS_RETRY_DAYS = 7


def _norm(s):
    s = s.lower().replace("&", "and")
    s = re.sub(r"[™®©:'’!.,\-–()]", " ", s)
    s = re.sub(r"\b(the|edition|remastered|remake|definitive|goty|game of the year)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def similar(a, b):
    return difflib.SequenceMatcher(None, _norm(a), _norm(b)).ratio()


def _get(url, headers=None, timeout=15):
    h = {"User-Agent": UA}
    h.update(headers or {})
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
        return r.read(), r.headers.get("Content-Type", "")


class Art:
    def __init__(self, data_dir):
        self.dir = os.path.join(data_dir, "covers")
        os.makedirs(self.dir, exist_ok=True)
        self.index_path = os.path.join(data_dir, "covers.json")
        self.appid_path = os.path.join(data_dir, "steam_appids.json")
        self.lock = threading.Lock()
        self.index = self._read(self.index_path)
        self.appids = self._read(self.appid_path)
        self.sgdb_key = ""
        self.url_base = None  # set by the app: covers are served as local files instead of inline data

    @staticmethod
    def _read(p):
        try:
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def _save(self):
        with self.lock:
            for p, d in ((self.index_path, self.index), (self.appid_path, self.appids)):
                tmp = p + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(d, f, ensure_ascii=False, indent=0)
                os.replace(tmp, p)

    # ---------- Steam ----------
    def steam_appid(self, name):
        key = _norm(name)
        if key in self.appids:
            return self.appids[key] or None
        appid = None
        try:
            q = urllib.parse.quote(name)
            body, _ = _get(f"https://store.steampowered.com/api/storesearch/?term={q}&l=english&cc=US")
            items = json.loads(body).get("items", [])
            best = max(items, key=lambda it: similar(name, it.get("name", "")), default=None)
            if best and similar(name, best.get("name", "")) >= 0.72:
                appid = int(best["id"])
        except Exception:
            return None  # network problem: don't cache
        self.appids[key] = appid or 0
        self._save()
        return appid

    # ---------- covers ----------
    def _sgdb(self, name):
        if not self.sgdb_key:
            return None
        auth = {"Authorization": f"Bearer {self.sgdb_key}"}
        q = urllib.parse.quote(name)
        body, _ = _get(f"https://www.steamgriddb.com/api/v2/search/autocomplete/{q}", auth)
        games = json.loads(body).get("data", [])
        if not games:
            return None
        best = max(games[:5], key=lambda g: similar(name, g.get("name", "")))
        body, _ = _get(f"https://www.steamgriddb.com/api/v2/grids/game/{best['id']}?dimensions=600x900,342x482,660x930&types=static&nsfw=false", auth)
        grids = json.loads(body).get("data", [])
        if not grids:
            return None
        grids.sort(key=lambda g: -(g.get("score") or 0))
        img, _ = _get(grids[0]["url"], timeout=25)
        return img

    def _steam_art(self, name):
        appid = self.steam_appid(name)
        if not appid:
            return None
        for url in (f"https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/{appid}/library_600x900.jpg",
                    f"https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/library_600x900.jpg"):
            try:
                img, ctype = _get(url)
                if img and "image" in ctype:
                    return img
            except Exception:
                continue
        return None

    def cover(self, name):
        """Returns a data: URI for the game's cover, or None."""
        key = _norm(name)
        entry = self.index.get(key)
        if entry:
            fname = entry.get("file")
            if fname and os.path.exists(os.path.join(self.dir, fname)):
                return self._data_uri(os.path.join(self.dir, fname))
            if not fname and time.time() - entry.get("t", 0) < MISS_RETRY_DAYS * 86400 and not (self.sgdb_key and entry.get("src") != "sgdb"):
                return None
        img, src = None, None
        try:
            img = self._sgdb(name)
            src = "sgdb" if img else None
        except Exception:
            img = None
        if not img:
            try:
                img = self._steam_art(name)
                src = "steam" if img else None
            except Exception:
                img = None
        if not img:
            self.index[key] = {"file": "", "t": time.time(), "src": "sgdb" if self.sgdb_key else "none"}
            self._save()
            return None
        ext = ".png" if img[:4] == b"\x89PNG" else ".webp" if img[8:12] == b"WEBP" else ".jpg"
        fname = re.sub(r"[^a-z0-9]+", "-", key)[:60].strip("-") + ext
        with open(os.path.join(self.dir, fname), "wb") as f:
            f.write(img)
        self.index[key] = {"file": fname, "t": time.time(), "src": src}
        self._save()
        return self._data_uri(os.path.join(self.dir, fname))

    # ---------- book covers ----------
    def book_cover(self, title, author=""):
        key = "book|" + _norm(title) + "|" + _norm(author)
        entry = self.index.get(key)
        if entry:
            fname = entry.get("file")
            if fname and os.path.exists(os.path.join(self.dir, fname)):
                return self._data_uri(os.path.join(self.dir, fname))
            if not fname and time.time() - entry.get("t", 0) < MISS_RETRY_DAYS * 86400:
                return None
        img, src = None, None
        try:
            q = "title=" + urllib.parse.quote(title) + ("&author=" + urllib.parse.quote(author) if author else "")
            body, _ = _get("https://openlibrary.org/search.json?limit=5&fields=title,cover_i,ratings_count&" + q)
            docs = [d for d in json.loads(body).get("docs", []) if d.get("cover_i")]
            if docs:
                d = max(docs, key=lambda x: (similar(title, x.get("title", "")), x.get("ratings_count") or 0))
                img, ctype = _get(f"https://covers.openlibrary.org/b/id/{d['cover_i']}-L.jpg?default=false", timeout=25)
                if "image" not in ctype or len(img) < 2000:
                    img = None
                src = "openlibrary" if img else None
        except Exception:
            img = None
        if not img:
            try:
                q = urllib.parse.quote(f'intitle:"{title}"' + (f' inauthor:"{author}"' if author else ""))
                body, _ = _get(f"https://www.googleapis.com/books/v1/volumes?maxResults=5&q={q}")
                for it in json.loads(body).get("items", []):
                    links = (it.get("volumeInfo") or {}).get("imageLinks") or {}
                    url = links.get("thumbnail") or links.get("smallThumbnail")
                    if url:
                        url = url.replace("http://", "https://").replace("&edge=curl", "").replace("zoom=1", "zoom=0")
                        img, ctype = _get(url, timeout=25)
                        if "image" in ctype and len(img) > 2000:
                            src = "google"
                            break
                        img = None
            except Exception:
                img = None
        return self._store(key, img, src)

    def _store(self, key, img, src, suffix=""):
        if not img:
            self.index[key] = {"file": "", "t": time.time(), "src": "none"}
            self._save()
            return None
        ext = ".png" if img[:4] == b"\x89PNG" else ".webp" if img[8:12] == b"WEBP" else ".jpg"
        fname = re.sub(r"[^a-z0-9]+", "-", key)[:70].strip("-") + suffix + ext
        with open(os.path.join(self.dir, fname), "wb") as f:
            f.write(img)
        self.index[key] = {"file": fname, "t": time.time(), "src": src}
        self._save()
        return self._data_uri(os.path.join(self.dir, fname))

    def _data_uri(self, path):
        if self.url_base:
            return f"{self.url_base}{urllib.parse.quote(os.path.basename(path))}?v={int(os.path.getmtime(path))}"
        return self._inline(path)

    @staticmethod
    def _inline(path):
        ext = os.path.splitext(path)[1].lower()
        mime = {".png": "image/png", ".webp": "image/webp"}.get(ext, "image/jpeg")
        with open(path, "rb") as f:
            return f"data:{mime};base64," + base64.b64encode(f.read()).decode()

    def clear(self):
        keep = {e.get("file") for e in self.index.values() if e.get("src") == "custom"}
        for f in os.listdir(self.dir):
            if f in keep:
                continue
            try:
                os.remove(os.path.join(self.dir, f))
            except OSError:
                pass
        self.index = {k: e for k, e in self.index.items() if e.get("src") == "custom"}
        self._save()

    # ---------- your own covers (modlists, fan art) ----------
    def set_custom(self, name, src_path):
        with open(src_path, "rb") as f:
            img = f.read()
        if len(img) > 25 * 1024 * 1024:
            raise ValueError("That image is over 25 MB.")
        key = _norm(name)
        old = self.index.get(key, {}).get("file")
        if old:
            try:
                os.remove(os.path.join(self.dir, old))
            except OSError:
                pass
        uri = self._store(key, img, "custom", suffix="-custom")
        return uri

    def rename_custom(self, old, new):
        e = self.index.get(_norm(old))
        if e and e.get("src") == "custom":
            self.index[_norm(new)] = self.index.pop(_norm(old))
            self._save()

    def clear_custom(self, name):
        key = _norm(name)
        e = self.index.pop(key, None)
        if e and e.get("file"):
            try:
                os.remove(os.path.join(self.dir, e["file"]))
            except OSError:
                pass
        self._save()

    # ---------- wide artwork for the detail view ----------
    def hero(self, name):
        key = "hero|" + _norm(name)
        entry = self.index.get(key)
        if entry:
            fname = entry.get("file")
            if fname and os.path.exists(os.path.join(self.dir, fname)):
                return self._data_uri(os.path.join(self.dir, fname))
            if not fname and time.time() - entry.get("t", 0) < MISS_RETRY_DAYS * 86400:
                return None
        img, src = None, None
        if self.sgdb_key:
            try:
                auth = {"Authorization": f"Bearer {self.sgdb_key}"}
                body, _ = _get(f"https://www.steamgriddb.com/api/v2/search/autocomplete/{urllib.parse.quote(name)}", auth)
                games = json.loads(body).get("data", [])
                if games:
                    best = max(games[:5], key=lambda g: similar(name, g.get("name", "")))
                    body, _ = _get(f"https://www.steamgriddb.com/api/v2/heroes/game/{best['id']}?types=static&nsfw=false", auth)
                    heroes = sorted(json.loads(body).get("data", []), key=lambda g: -(g.get("score") or 0))
                    if heroes:
                        img, _ = _get(heroes[0]["url"], timeout=30)
                        src = "sgdb"
            except Exception:
                img = None
        if not img:
            appid = self.steam_appid(name)
            if appid:
                for url in (f"https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/{appid}/library_hero.jpg",
                            f"https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/library_hero.jpg",
                            f"https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/header.jpg"):
                    try:
                        img, ctype = _get(url)
                        if img and "image" in ctype:
                            src = "steam"
                            break
                        img = None
                    except Exception:
                        img = None
        return self._store(key, img, src)


OWNED = {"Library", "Playing", "Paused", "Completed", "Dropped"}


def links_for(game, appid=None, heroic=None):
    """Buttons for the detail panel: the platform's library first if you own it, otherwise its store."""
    name = game.get("name", "")
    q = urllib.parse.quote(name)
    plat = game.get("platform", "")
    owned = game.get("status") in OWNED
    out = []

    def add(label, url, primary=False):
        out.append({"label": label, "url": url, "primary": primary})

    if plat == "Steam":
        if appid:
            if owned:
                add("Play on Steam", f"steam://rungameid/{appid}", True)
                add("Open in Steam library", f"steam://nav/games/details/{appid}")
            add("Steam store page", f"https://store.steampowered.com/app/{appid}", not owned)
        else:
            add("Find on Steam", f"https://store.steampowered.com/search/?term={q}", True)
    elif plat in ("PS5", "PS4"):
        if owned:
            add("PlayStation library", "https://library.playstation.com/recently-purchased", True)
        add("PlayStation Store", f"https://store.playstation.com/en-us/search/{q}", not owned)
    elif plat in ("Switch 2", "Switch"):
        add("Nintendo eShop", f"https://www.nintendo.com/us/search/#q={q}", True)
    elif plat == "PS2":
        add("PlayStation Store (PS2 Classics)", f"https://store.playstation.com/en-us/search/{q}", True)
    elif plat in ("GOG", "Epic Games"):
        if owned:
            if heroic:
                add("Play in Heroic", f"heroic://launch/{heroic['runner']}/{heroic['app']}", True)
                add("Open Heroic", "heroic://")
            else:
                add("Play in Heroic", "heroic://", True)
        if plat == "GOG":
            add("GOG store page", f"https://www.gog.com/en/games?query={q}", not owned)
        else:
            add("Epic Games Store", f"https://store.epicgames.com/en-US/browse?q={q}&sortBy=relevancy", not owned)
    elif plat == "Ubisoft Connect":
        if owned:
            add("Open Ubisoft Connect", "uplay://", True)
        add("Ubisoft Store", f"https://store.ubisoft.com/search?q={q}", not owned)
    elif plat in ("EA", "EA App"):
        if owned:
            add("Open EA app", "origin2://", True)
        add("EA store page", f"https://www.ea.com/search?q={q}", not owned)
    elif plat == "itch.io":
        add("Open on itch.io", game.get("store_link") or f"https://itch.io/search?q={q}", True)
    if game.get("store_link"):
        for o in out:
            o["primary"] = False
        out.insert(0, {"label": "Open your saved link", "url": game["store_link"], "primary": True})
    if appid and plat != "Steam":
        add("Steam store page", f"https://store.steampowered.com/app/{appid}")
    add("HowLongToBeat", f"https://howlongtobeat.com/?q={q}")
    if not any(o["primary"] for o in out) and out:
        out[0]["primary"] = True
    return out
