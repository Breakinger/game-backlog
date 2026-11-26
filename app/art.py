"""Cover art and store links. Covers come from the official store art first (Steam's library cover, the PlayStation
Store's portrait cover), then IGDB's box art, then SteamGridDB, and are cached on disk so each is downloaded once."""
import base64
import difflib
import io
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request

import saver

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) GameBacklog/1.0"
MISS_RETRY_DAYS = 7


def _norm(s):
    s = s.lower().replace("&", "and")
    s = re.sub(r"[™®©:'’!.,\-–()]", " ", s)
    s = re.sub(r"\b(the|edition|remastered|remake|definitive|goty|game of the year)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def similar(a, b):
    return difflib.SequenceMatcher(None, _norm(a), _norm(b)).ratio()


ROMAN = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7, "viii": 8, "ix": 9, "x": 10, "xi": 11, "xii": 12,
         "xiii": 13, "xiv": 14, "xv": 15, "xvi": 16}


def numerals(s):
    """The sequel numbers in a title: 'Red Dead Redemption 2' -> {2}, 'Final Fantasy VII' -> {7}."""
    out = set()
    for tok in _norm(s).split():
        if tok.isdigit():
            out.add(int(tok))
        elif tok in ROMAN and tok not in ("i", "x", "v"):  # lone I, V and X are too often words or letters
            out.add(ROMAN[tok])
    return out


def same_title(a, b, threshold=0.86):
    """True when two names are the same game: close enough, and the sequel numbers agree, so
    'Baldur's Gate 3' never matches 'Baldur's Gate' and 'Red Dead Redemption 2' never matches the first one."""
    na, nb = _norm(a), _norm(b)
    if na == nb:
        return True
    if numerals(a) != numerals(b):
        return False
    short, long_ = sorted((na, nb), key=len)
    if long_.startswith(short + " ") and set(long_[len(short):].split()) <= EDITION_WORDS:
        return True
    return difflib.SequenceMatcher(None, na, nb).ratio() >= threshold


EDITION_WORDS = {"intergrade", "deluxe", "complete", "enhanced", "ultimate", "gold", "premium", "directors", "director", "s",
                 "cut", "anniversary", "hd", "standard", "digital", "for", "ps4", "ps5", "nintendo", "switch", "2", "pc"}
def _company_words(names):
    stop = {"inc", "ltd", "llc", "co", "corp", "studio", "studios", "games", "entertainment", "interactive", "the", "software",
            "productions", "digital", "sa", "gmbh", "ab", "and", "pc", "port", "team"}
    out = set()
    for n in names:
        out |= {w for w in re.findall(r"[a-z0-9]+", (n or "").lower()) if w not in stop and len(w) > 1}
    return out


def companies_agree(meta, developers, publishers):
    """True unless your sheet names a developer/publisher and the store lists completely different ones."""
    mine = _company_words([meta.get("developer"), meta.get("publisher")])
    theirs = _company_words(list(developers) + list(publishers))
    if not mine or not theirs:
        return True
    return bool(mine & theirs)


COVER_VERSION = 5   # 5: no platform strips printed on the art (Masterlog draws its own band); 4: the cover shape (2:3)
APPID_VERSION = 2  # raising this re-downloads every cover you didn't pick yourself
PC_PLATFORMS = {"Steam", "GOG", "Epic Games", "EA", "EA App", "Ubisoft Connect", "PC (Other)", "itch.io", "Emulation", ""}
PS_PLATFORMS = {"PS5", "PS4", "PS2"}
NINTENDO = {"Switch 2", "Switch"}
USER_CHOSEN = ("custom", "picked")


def plat_group(p):
    """Covers differ between PlayStation, Nintendo and PC boxes, not between PC launchers."""
    return "ps" if p in PS_PLATFORMS else "nin" if p in NINTENDO else "pc"
STEAM_CDN = "https://shared.akamai.steamstatic.com/store_item_assets/"


def _get(url, headers=None, timeout=15):
    h = {"User-Agent": UA}
    h.update(headers or {})
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
        return r.read(), r.headers.get("Content-Type", "")


# ---------- cover shape ----------
SHAPE = 2 / 3          # the cover window on the cases
SHAPE_OK = 0.06        # within 6%: a real cover (box scans are 3:4, about 12% off)


def image_size(b):
    """Width and height from a PNG, JPEG, WebP or GIF header, without decoding the image."""
    try:
        if b[:8] == b"\x89PNG\r\n\x1a\n":
            return int.from_bytes(b[16:20], "big"), int.from_bytes(b[20:24], "big")
        if b[:6] in (b"GIF87a", b"GIF89a"):
            return int.from_bytes(b[6:8], "little"), int.from_bytes(b[8:10], "little")
        if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
            kind = b[12:16]
            if kind == b"VP8 ":
                return int.from_bytes(b[26:28], "little") & 0x3FFF, int.from_bytes(b[28:30], "little") & 0x3FFF
            if kind == b"VP8L":
                bits = int.from_bytes(b[21:25], "little")
                return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
            if kind == b"VP8X":
                return int.from_bytes(b[24:27], "little") + 1, int.from_bytes(b[27:30], "little") + 1
        if b[:2] == b"\xff\xd8":
            i = 2
            while i < len(b) - 9:
                if b[i] != 0xFF:
                    i += 1
                    continue
                marker = b[i + 1]
                if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                    return int.from_bytes(b[i + 7:i + 9], "big"), int.from_bytes(b[i + 5:i + 7], "big")
                if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                    i += 2
                    continue
                i += 2 + int.from_bytes(b[i + 2:i + 4], "big")
    except Exception:
        pass
    return None


try:
    from PIL import Image
except Exception:   # the cover still works without it, just without strip detection
    Image = None


def _kind(c):
    r, g, b = c
    if min(c) > 205:
        return "white"
    if max(c) < 42:
        return "black"
    if r > 150 and g < 80 and b < 95:
        return "red"
    if b > 120 and b > r + 45 and b >= g:
        return "blue"
    if g > 130 and g > r + 35 and g > b + 35:
        return "green"
    return None


def banner_rows(img):
    """How many pixel rows at the top of box art are a platform strip (the PS5 white bar, the PS4 blue bar, Switch red,
    Xbox white or green, PS2 black), or 0. A strip is a band of one colour across the top with a clean edge under it."""
    if Image is None or not img:
        return 0
    try:
        im = Image.open(io.BytesIO(img)).convert("RGB")
    except Exception:
        return 0
    W, H = im.size
    if W < 50 or H < 50:
        return 0
    w = 64
    h = max(16, round(w * H / W))
    px = im.resize((w, h)).load()

    def share(y, kind):
        return sum(1 for x in range(w) if _kind(px[x, y]) == kind) / w
    counts = {}
    for x in range(w):
        k = _kind(px[x, 1])
        counts[k] = counts.get(k, 0) + 1
    band = max((k for k in counts if k), key=lambda k: counts[k], default=None)
    if not band or counts[band] / w < 0.55:
        return 0
    end = 0
    for y in range(1, int(h * 0.2) + 1):
        if share(y, band) < 0.42:
            end = y
            break
    if not end or not (0.04 <= end / h <= 0.17):
        return 0
    below = [share(y, band) for y in range(end, min(h, end + 3))]
    need = 0.25 if band in ("white", "black") else 0.35
    if max(below) > need:
        return 0
    return min(H - 1, round((end + 1) / h * H))


def without_banner(img):
    """The art with its platform strip cut off (JPEG), or None when there isn't one."""
    rows = banner_rows(img)
    if not rows:
        return None
    im = Image.open(io.BytesIO(img)).convert("RGB")
    out = io.BytesIO()
    im.crop((0, rows, im.size[0], im.size[1])).save(out, "JPEG", quality=92)
    return out.getvalue()


def shape_off(img):
    """How far an image is from the cover shape: 0 is a perfect 2:3, 0.12 a 3:4 box scan, unknown counts as far."""
    size = image_size(img or b"")
    if not size or not size[0] or not size[1]:
        return 1.0
    return abs(size[0] / size[1] - SHAPE) / SHAPE


class Art:
    def __init__(self, data_dir):
        self.dir = os.path.join(data_dir, "covers")
        os.makedirs(self.dir, exist_ok=True)
        self.index_path = os.path.join(data_dir, "covers.json")
        self.appid_path = os.path.join(data_dir, "steam_appids.json")
        self.lock = threading.Lock()
        self.index = self._read(self.index_path)
        self.appids = self._read(self.appid_path)
        if self.appids.get("_v") != APPID_VERSION:
            self.appids = {"_v": APPID_VERSION}   # earlier matches were looser; your linked accounts fill exact IDs back in
        self.sgdb_key = ""
        self.igdb = None      # set by the app when IGDB is configured
        self.meta_lookup = lambda name: None  # the app supplies developer/publisher from your sheet
        self.mc_cover = lambda name: None     # the app supplies Metacritic box art as a last resort
        self.url_base = None  # set by the app: covers are served as local files instead of inline data

    @staticmethod
    def _read(p):
        try:
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def _save(self):
        saver.save_later(self.index_path, lambda: self.index, lock=self.lock)
        saver.save_later(self.appid_path, lambda: self.appids, lock=self.lock)

    # ---------- Steam ----------
    def steam_appid(self, name):
        key = _norm(name)
        if key in self.appids:
            return self.appids[key] or None
        appid = None
        try:
            q = urllib.parse.quote(name)
            body, _ = _get(f"https://store.steampowered.com/api/storesearch/?term={q}&l=english&cc=US")
            items = [it for it in json.loads(body).get("items", []) if same_title(name, it.get("name", ""), 0.8)]
            items.sort(key=lambda it: (_norm(it.get("name", "")) != key, -similar(name, it.get("name", ""))))
            meta = self.meta_lookup(name) or {}
            for it in items[:4]:
                # cross-check with the developer and publisher in your sheet, so a same-named game never slips in
                if meta.get("developer") or meta.get("publisher"):
                    try:
                        d = json.loads(_get(f"https://store.steampowered.com/api/appdetails?appids={it['id']}&l=english")[0]).get(str(it["id"])) or {}
                        d = d.get("data") or {}
                    except Exception:
                        d = {}
                    if d and not companies_agree(meta, d.get("developers") or [], d.get("publishers") or []):
                        continue
                appid = int(it["id"])
                break
        except Exception:
            return None  # network problem: don't cache
        self.appids[key] = appid or 0
        self._save()
        return appid

    def remember_appid(self, name, appid):
        """An exact Steam ID from your linked account beats any search."""
        key = _norm(name)
        if appid and self.appids.get(key) != int(appid):
            self.appids[key] = int(appid)
            self._save()

    # ---------- where covers come from ----------
    def _sgdb_game(self, name, appid=None):
        """SteamGridDB's entry for this exact game: by Steam ID when known, otherwise a careful name match."""
        auth = {"Authorization": f"Bearer {self.sgdb_key}"}
        if appid:
            try:
                body, _ = _get(f"https://www.steamgriddb.com/api/v2/games/steam/{appid}", auth)
                g = json.loads(body).get("data")
                if g:
                    return g
            except Exception:
                pass
        body, _ = _get(f"https://www.steamgriddb.com/api/v2/search/autocomplete/{urllib.parse.quote(name)}", auth)
        games = [g for g in json.loads(body).get("data", [])[:8] if same_title(name, g.get("name", ""))]
        if not games:
            return None
        # same name, several games (Deadlock 1996 vs Deadlock 2024): the exact, verified, newest one
        return max(games, key=lambda g: (_norm(g.get("name", "")) == _norm(name), bool(g.get("verified")), g.get("release_date") or 0))

    def sgdb_grids(self, name, appid=None, limit=1):
        if not self.sgdb_key:
            return []
        g = self._sgdb_game(name, appid)
        if not g:
            return []
        auth = {"Authorization": f"Bearer {self.sgdb_key}"}
        body, _ = _get(f"https://www.steamgriddb.com/api/v2/grids/game/{g['id']}?dimensions=600x900,342x482,660x930&types=static&nsfw=false&humor=false", auth)
        grids = sorted(json.loads(body).get("data", []), key=lambda x: -(x.get("score") or 0))
        return [{"url": x["url"], "thumb": x.get("thumb") or x["url"], "source": "SteamGridDB", "note": (x.get("author") or {}).get("name", "")}
                for x in grids[:limit]]

    def steam_cover_urls(self, appid):
        """Steam's official library cover (the portrait art in your Steam library), newest asset paths first."""
        urls = []
        try:
            req = json.dumps({"ids": [{"appid": int(appid)}], "context": {"language": "english", "country_code": "US"},
                              "data_request": {"include_assets": True}})
            body, _ = _get("https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=" + urllib.parse.quote(req))
            item = ((json.loads(body).get("response") or {}).get("store_items") or [{}])[0]
            a = item.get("assets") or {}
            fmt = a.get("asset_url_format")
            if fmt:
                for k in ("library_capsule_2x", "library_capsule"):
                    if a.get(k):
                        urls.append(STEAM_CDN + fmt.replace("${FILENAME}", a[k]))
        except Exception:
            pass
        for f in ("library_600x900_2x.jpg", "library_600x900.jpg"):
            urls.append(f"{STEAM_CDN}steam/apps/{appid}/{f}")
        urls.append(f"https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/library_600x900.jpg")
        return urls

    def _first_image(self, urls, min_bytes=4000):
        for url in urls:
            try:
                img, ctype = _get(url, timeout=25)
                if img and "image" in ctype and len(img) >= min_bytes:
                    return img
            except Exception:
                continue
        return None

    def igdb_cover_url(self, name):
        if not (self.igdb and self.igdb.configured()):
            return None
        g = self.igdb.game(name)
        if g and g.get("cover") and same_title(name, g.get("name", name), 0.8):
            return self.igdb.img(g["cover"]["image_id"], "t_cover_big_2x")
        return None

    def ps_cover_urls(self, name, platform="PS5"):
        """The PlayStation Store's own portrait cover for the game."""
        loc = "en-us"
        html_, _ = _get(f"https://store.playstation.com/{loc}/search/{urllib.parse.quote(name)}", {"Accept-Language": "en-US"}, timeout=20)
        html_ = html_.decode("utf-8", "replace")
        out = []
        for m in re.finditer(r'/(?:en-us)/concept/(\d+)', html_):
            cid = m.group(1)
            if any(cid in u for u in out):
                continue
            page, _ = _get(f"https://store.playstation.com/{loc}/concept/{cid}", timeout=20)
            page = page.decode("utf-8", "replace")
            title = re.search(r"<title>([^<|]+)", page)
            t = title.group(1).replace("&amp;", "&").strip() if title else ""
            if not t or not same_title(name, re.sub(r"\s*(PS4|PS5|PS4 & PS5|PS5 & PS4)\s*$", "", t), 0.8):
                continue
            for role in ("PORTRAIT_BANNER", "GAMEHUB_COVER_ART"):
                mm = re.search(r'"role"\s*:\s*"' + role + r'"[^}]*?"url"\s*:\s*"(https://image\.api\.playstation\.com[^"]+)"', page) or \
                     re.search(r'"url"\s*:\s*"(https://image\.api\.playstation\.com[^"]+)"[^}]*?"role"\s*:\s*"' + role + '"', page)
                if mm:
                    out.append(mm.group(1) + "?w=720")
            if out:
                break
            if len(out) > 3:
                break
        return out

    def _official(self, name, platform, hints):
        """The first source with a proper portrait cover wins. Box scans (console banner on top, 3:4) and wide art
        are kept only as a last resort, closest shape first."""
        best, best_src, best_off = None, None, 9
        for img, src in self._official_all(name, platform, hints):
            clean = without_banner(img)
            if clean:                       # box art with a console strip: keep the art, lose the strip, rank it lower
                img, penalty = clean, 0.1
            else:
                penalty = 0
            off = shape_off(img)
            if off <= SHAPE_OK and not penalty:
                return img, src
            if off + penalty < best_off:
                best, best_src, best_off = img, src, off + penalty
        if self.sgdb_key and best_off > SHAPE_OK:   # SteamGridDB's covers are made to the exact shape
            appid = hints.get("appid") or self.steam_appid(name)
            try:
                for x in self.sgdb_grids(name, appid, limit=6):
                    img = self._first_image([x["url"]])
                    if img and shape_off(img) <= SHAPE_OK and not banner_rows(img):
                        return img, "sgdb"
            except Exception:
                pass
        return best, best_src

    def _official_all(self, name, platform, hints):
        """Official art for the platform you own it on. Returns (image bytes, source) or (None, None)."""
        appid = hints.get("appid") or (self.steam_appid(name) if platform in PC_PLATFORMS or platform in PS_PLATFORMS | NINTENDO else None)
        order = []
        if platform in PS_PLATFORMS:
            if hints.get("ps_art"):
                order.append(("psn", lambda: [hints["ps_art"]]))
            if platform != "PS2":
                order.append(("psstore", lambda: self.ps_cover_urls(name, platform)))
            order.append(("igdb", lambda: [self.igdb_cover_url(name)]))
        elif platform in NINTENDO:
            order.append(("igdb", lambda: [self.igdb_cover_url(name)]))
        else:
            if appid:
                order.append(("steam", lambda: self.steam_cover_urls(appid)))
            order.append(("igdb", lambda: [self.igdb_cover_url(name)]))
        order.append(("sgdb", lambda: [x["url"] for x in self.sgdb_grids(name, appid)]))
        if appid and platform not in PC_PLATFORMS:
            order.append(("steam", lambda: self.steam_cover_urls(appid)))
        order.append(("metacritic", lambda: [self.mc_cover(name)]))
        for src, urls in order:
            try:
                for u in [u for u in urls() if u][:4]:
                    img = self._first_image([u])
                    if img:
                        yield img, src
                        if shape_off(img) <= SHAPE_OK and not banner_rows(img):
                            return
            except Exception:
                continue

    def candidates(self, name, platform="", hints=None, query=None):
        """Every cover we can find for the picker, official ones first."""
        hints = hints or {}
        q = query or name
        appid = hints.get("appid") if not query else None
        appid = appid or self.steam_appid(q)
        out, seen = [], set()

        def add(url, source, note=""):
            if url and url not in seen:
                seen.add(url)
                out.append({"url": url, "thumb": url, "source": source, "note": note})
        if hints.get("ps_art") and not query:
            add(hints["ps_art"], "PlayStation", "your library")
        if appid:
            urls = self.steam_cover_urls(appid)
            ok = self._first_image(urls[:3])
            if ok:
                # find which one worked so the picker shows the official file itself
                for u in urls[:3]:
                    try:
                        img, ct = _get(u)
                        if "image" in ct and len(img) > 4000:
                            add(u, "Steam", "official library cover")
                            break
                    except Exception:
                        continue
        if platform in PS_PLATFORMS or not platform:
            try:
                for u in self.ps_cover_urls(q, platform)[:2]:
                    add(u, "PlayStation Store", "official")
            except Exception:
                pass
        try:
            add(self.igdb_cover_url(q), "IGDB", "box art")
        except Exception:
            pass
        try:
            add(self.mc_cover(q), "Metacritic", "box art")
        except Exception:
            pass
        try:
            for x in self.sgdb_grids(q, appid, limit=30):
                add(x["url"], "SteamGridDB", x["note"])
        except Exception:
            pass
        return out

    def set_from_url(self, name, url):
        """Save a cover picked in the app. Only images over https, at most 25 MB."""
        if not url.startswith("https://"):
            raise ValueError("Only https images can be used.")
        img, ctype = _get(url, timeout=30)
        if "image" not in ctype or len(img) > 25 * 1024 * 1024 or len(img) < 1000:
            raise ValueError("That link isn't a usable image.")
        key = _norm(name)
        old = self.index.get(key, {}).get("file")
        if old:
            try:
                os.remove(os.path.join(self.dir, old))
            except OSError:
                pass
        uri = self._store(key, img, "picked", suffix="-picked")
        self.index[key]["url"] = url
        self._save()
        return uri

    def cover(self, name, platform="", hints=None):
        """A URL (or data: URI) for the game's cover, or None. Your own picks are never replaced."""
        hints = hints or {}
        key = _norm(name)
        entry = self.index.get(key)
        if entry:
            fname = entry.get("file")
            have = fname and os.path.exists(os.path.join(self.dir, fname))
            if have and entry.get("v", 1) < COVER_VERSION and entry.get("src") not in USER_CHOSEN and plat_group(entry.get("plat", "")) == plat_group(platform or ""):
                try:
                    with open(os.path.join(self.dir, fname), "rb") as fh:
                        data = fh.read()
                        if shape_off(data) <= SHAPE_OK and not banner_rows(data):
                            entry["v"] = COVER_VERSION    # already the right shape: keep it
                            self._save()
                except OSError:
                    pass
            current = entry.get("v", 1) >= COVER_VERSION and plat_group(entry.get("plat", "")) == plat_group(platform or "")
            if have and (entry.get("src") in USER_CHOSEN or current):
                return self._data_uri(os.path.join(self.dir, fname))
            if not fname and current and time.time() - entry.get("t", 0) < MISS_RETRY_DAYS * 86400:
                return None
            if have and entry.get("v", 1) >= COVER_VERSION and time.time() - entry.get("t", 0) < 86400:
                return self._data_uri(os.path.join(self.dir, fname))   # asked for under another platform today: don't flip-flop
        img, src = self._official(name, platform or "", hints)
        if not img:
            if entry and entry.get("file") and os.path.exists(os.path.join(self.dir, entry["file"])):
                # nothing better found: keep the old one, but don't keep searching on every start
                entry.update({"v": COVER_VERSION, "plat": platform or "", "t": time.time()})
                self._save()
                return self._data_uri(os.path.join(self.dir, entry["file"]))
            self.index[key] = {"file": "", "t": time.time(), "src": "none", "v": COVER_VERSION, "plat": platform or ""}
            self._save()
            return None
        old = (entry or {}).get("file")
        uri = self._store(key, img, src)
        if old and old != self.index[key]["file"]:
            try:
                os.remove(os.path.join(self.dir, old))
            except OSError:
                pass
        self.index[key].update({"v": COVER_VERSION, "plat": platform or ""})
        self._save()
        return uri

    # ---------- book covers ----------
    @staticmethod
    def book_key(title, author=""):
        return "book|" + _norm(title) + "|" + _norm(author)

    def book_candidates(self, title, author="", query=None):
        """Every cover we can find for a book: each Open Library edition, then Google Books."""
        q_title = query or title
        out, seen = [], set()

        def add(url, source, note=""):
            if url and url not in seen:
                seen.add(url)
                out.append({"url": url, "thumb": url.replace("-L.jpg", "-M.jpg"), "source": source, "note": note})
        try:
            q = "title=" + urllib.parse.quote(q_title) + ("&author=" + urllib.parse.quote(author) if author and not query else "")
            body, _ = _get("https://openlibrary.org/search.json?limit=12&fields=title,cover_i,first_publish_year,ratings_count&" + q)
            docs = sorted([d for d in json.loads(body).get("docs", []) if d.get("cover_i")],
                          key=lambda x: (-similar(q_title, x.get("title", "")), -(x.get("ratings_count") or 0)))
            for d in docs[:12]:
                add(f"https://covers.openlibrary.org/b/id/{d['cover_i']}-L.jpg?default=false", "Open Library", str(d.get("first_publish_year") or ""))
        except Exception:
            pass
        try:
            qq = f'intitle:"{q_title}"' + (f' inauthor:"{author}"' if author and not query else "")
            body, _ = _get("https://www.googleapis.com/books/v1/volumes?maxResults=12&q=" + urllib.parse.quote(qq))
            for it in json.loads(body).get("items", []):
                v = it.get("volumeInfo") or {}
                links = v.get("imageLinks") or {}
                url = links.get("thumbnail") or links.get("smallThumbnail")
                if url:
                    url = url.replace("http://", "https://").replace("&edge=curl", "").replace("zoom=1", "zoom=0")
                    add(url, "Google Books", " · ".join(x for x in (v.get("publisher"), (v.get("publishedDate") or "")[:4]) if x))
        except Exception:
            pass
        return out

    def _replace(self, key, img, src, suffix):
        old = self.index.get(key, {}).get("file")
        if old:
            try:
                os.remove(os.path.join(self.dir, old))
            except OSError:
                pass
        return self._store(key, img, src, suffix=suffix)

    def set_book_from_url(self, title, author, url):
        if not url.startswith("https://"):
            raise ValueError("Only https images can be used.")
        img, ctype = _get(url, timeout=30)
        if "image" not in ctype or len(img) > 25 * 1024 * 1024 or len(img) < 1000:
            raise ValueError("That link isn't a usable image.")
        key = self.book_key(title, author)
        uri = self._replace(key, img, "picked", "-picked")
        self.index[key]["url"] = url
        self._save()
        return uri

    def set_book_custom(self, title, author, src_path):
        with open(src_path, "rb") as f:
            img = f.read()
        if len(img) > 25 * 1024 * 1024:
            raise ValueError("That image is over 25 MB.")
        return self._replace(self.book_key(title, author), img, "custom", "-custom")

    def forget_book(self, title, author="", mine_too=False):
        """Refresh info drops the downloaded cover; your own pick goes only when you ask for the automatic one back."""
        key = self.book_key(title, author)
        e = self.index.get(key)
        if e and (mine_too or e.get("src") not in USER_CHOSEN):
            self.index.pop(key, None)
            if e.get("file"):
                try:
                    os.remove(os.path.join(self.dir, e["file"]))
                except OSError:
                    pass
            self._save()

    # ---------- your own covers travel with you to your other PCs ----------
    def mine(self, with_files=False):
        out = {}
        for k, e in self.index.items():
            if e.get("src") not in USER_CHOSEN or not e.get("file"):
                continue
            item = {"src": e["src"], "url": e.get("url", ""), "file": e["file"], "t": e.get("t", 0)}
            if with_files:
                try:
                    with open(os.path.join(self.dir, e["file"]), "rb") as f:
                        item["data"] = base64.b64encode(f.read()).decode()
                except OSError:
                    continue
            out[k] = item
        return out

    def adopt(self, key, item):
        """Take a cover from your other PC: the image itself, or its source link to fetch again."""
        cur = self.index.get(key) or {}
        if cur.get("src") in USER_CHOSEN and cur.get("url") == item.get("url") and cur.get("t", 0) >= item.get("t", 0) and cur.get("file") \
                and os.path.exists(os.path.join(self.dir, cur["file"])):
            return False
        if item.get("data"):
            img = base64.b64decode(item["data"])
        elif item.get("url", "").startswith("https://"):
            img, ctype = _get(item["url"], timeout=30)
            if "image" not in ctype or len(img) < 1000:
                return False
        else:
            return False
        uri = self._replace(key, img, item.get("src") or "picked", "-" + (item.get("src") or "picked"))
        self.index[key].update({"url": item.get("url", ""), "t": item.get("t") or time.time()})
        self._save()
        return bool(uri)

    def book_cover(self, title, author=""):
        key = self.book_key(title, author)
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
        keep = {e.get("file") for e in self.index.values() if e.get("src") in USER_CHOSEN}
        for f in os.listdir(self.dir):
            if f in keep:
                continue
            try:
                os.remove(os.path.join(self.dir, f))
            except OSError:
                pass
        self.index = {k: e for k, e in self.index.items() if e.get("src") in USER_CHOSEN}
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

    def forget(self, name):
        """Refresh info: drop the downloaded cover, wide art and Steam match for one game (your own picks stay)."""
        key = _norm(name)
        for k in (key, "hero|" + key):
            e = self.index.get(k)
            if e and e.get("src") not in USER_CHOSEN:
                self.index.pop(k, None)
                if e.get("file"):
                    try:
                        os.remove(os.path.join(self.dir, e["file"]))
                    except OSError:
                        pass
        self.appids.pop(key, None)
        if self.igdb:
            self.igdb.cache.pop(name.lower().strip(), None)
        self._save()

    def rename_custom(self, old, new):
        e = self.index.get(_norm(old))
        if e and e.get("src") in USER_CHOSEN:
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
        if entry and entry.get("v", 1) >= COVER_VERSION:
            fname = entry.get("file")
            if fname and os.path.exists(os.path.join(self.dir, fname)):
                return self._data_uri(os.path.join(self.dir, fname))
            if not fname and time.time() - entry.get("t", 0) < MISS_RETRY_DAYS * 86400:
                return None
        img, src = None, None
        if self.sgdb_key:
            try:
                auth = {"Authorization": f"Bearer {self.sgdb_key}"}
                best = self._sgdb_game(name, self.steam_appid(name))
                if best:
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
        if not img and self.igdb and self.igdb.configured():
            try:
                g = self.igdb.game(name) or {}
                pics = (g.get("artworks") or []) + (g.get("screenshots") or [])
                if pics:
                    img, _ = _get(self.igdb.img(pics[0]["image_id"], "t_1080p"), timeout=30)
                    src = "igdb"
            except Exception:
                img = None
        uri = self._store(key, img, src)
        self.index[key]["v"] = COVER_VERSION
        self._save()
        return uri


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
