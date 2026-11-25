"""Game and book info from public sources: Metacritic, Steam, PlayStation Store, Wikipedia, Google News,
Open Library and Google Books. Everything is cached on disk so the app stays fast and polite."""
import concurrent.futures as cf
import html
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

from art import similar, _norm
import saver
import youtube

BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
MC = "https://backend.metacritic.com"
DAY = 86400
TTL = {"about": 30 * DAY, "media": 7 * DAY, "ratings": 3 * DAY, "dlcs": 7 * DAY, "wiki": 30 * DAY, "news": 6 * 3600, "trailers": 14 * DAY, "watch": 2 * DAY, "updated": 12 * 3600, "book": 30 * DAY}
NEW_UPDATE_DAYS = 14
CACHE_VERSION = 3
PATCH_RE = re.compile(r"\b(patch|update|hotfix|hot-fix|version\s*\d|v\d+\.\d+|release notes)\b", re.I)
JUNK_DLC_RE = re.compile(r"soundtrack|\bost\b|art ?book|wallpaper|avatar|theme|\bskin|costume|outfit|cosmetic|bonus content|digital extras|pre-?order", re.I)


def _get(url, headers=None, timeout=15):
    h = {"User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9"}
    h.update(headers or {})
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def _json(url, headers=None, timeout=15):
    return json.loads(_get(url, headers, timeout))


def _mc(path):
    return _json(MC + path, {"Referer": "https://www.metacritic.com/", "Origin": "https://www.metacritic.com", "Accept": "application/json"})


def _clean(text, limit=420):
    text = re.sub(r"\[/?[a-z0-9*]+[^\]]*\]", " ", text or "")       # Steam BBCode
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(re.sub(r"https?://\S+", "", text))
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[:limit].rsplit(" ", 1)[0] + "…"


class Cache:
    def __init__(self, data_dir):
        self.path = os.path.join(data_dir, "info_cache.json")
        self.lock = threading.Lock()
        try:
            with open(self.path, encoding="utf-8") as f:
                self.data = json.load(f)
        except Exception:
            self.data = {}
        if self.data.get("_v") != CACHE_VERSION:
            # matching got stricter: forget info that may belong to a similarly named game
            self.data = {"_v": CACHE_VERSION}

    def get(self, kind, key):
        e = (self.data.get(kind) or {}).get(key) if isinstance(self.data.get(kind), dict) else None
        if e and time.time() - e["t"] < TTL[kind]:
            return e["v"]
        return None

    def put(self, kind, key, value):
        with self.lock:
            self.data.setdefault(kind, {})[key] = {"t": time.time(), "v": value}
        saver.save_later(self.path, lambda: self.data, lock=self.lock)

    def forget(self, key):
        """Drop everything cached about one game (Refresh info)."""
        with self.lock:
            for kind in self.data.values():
                if isinstance(kind, dict):
                    kind.pop(key, None)
                    for k in [k for k in kind if k.startswith(key + "|")]:
                        kind.pop(k, None)
        saver.save_later(self.path, lambda: self.data, lock=self.lock)


# ---------------- Metacritic ----------------

MC_PLATFORM = {"PS5": "PlayStation 5", "PS4": "PlayStation 4", "PS2": "PlayStation 2", "Switch 2": "Nintendo Switch 2",
               "Switch": "Nintendo Switch", "Steam": "PC", "GOG": "PC", "Epic Games": "PC", "Ubisoft Connect": "PC",
               "EA App": "PC", "PC (Other)": "PC", "Emulation": None}


def mc_search(query, limit=10):
    q = urllib.parse.quote(query.replace("/", " "))
    data = _mc(f"/finder/metacritic/search/{q}/web?offset=0&limit={limit}&mcoTypeId=13")
    return (data.get("data") or {}).get("items") or []


def mc_best(name):
    items = [i for i in mc_search(name) if i.get("slug")]
    if not items:
        return None
    best = max(items, key=lambda i: (similar(name, i.get("title", "")), (i.get("criticScoreSummary") or {}).get("score") or 0))
    return best if similar(name, best.get("title", "")) >= 0.6 else None


def mc_details(slug):
    item = (_mc(f"/games/metacritic/{slug}/web?componentName=product&componentType=Product").get("data") or {}).get("item") or {}
    try:
        user = (_mc(f"/reviews/metacritic/user/games/{slug}/stats/web").get("data") or {}).get("item") or {}
    except Exception:
        user = {}
    crit = item.get("criticScoreSummary") or {}
    plats = []
    for p in item.get("platforms") or []:
        s = (p.get("criticScoreSummary") or {}).get("score")
        plats.append({"name": p.get("name"), "score": s, "count": (p.get("criticScoreSummary") or {}).get("reviewCount")})
    return {
        "title": item.get("title") or slug,
        "url": f"https://www.metacritic.com/game/{slug}/",
        "critic": crit.get("score"), "critic_count": crit.get("reviewCount"),
        "user": user.get("score"), "user_count": user.get("reviewCount"), "user_sentiment": user.get("sentiment"),
        "platforms": plats,
        "release": item.get("releaseDate"),
    }


# ---------------- Steam ----------------

def steam_details(appid):
    data = _json(f"https://store.steampowered.com/api/appdetails?appids={appid}&l=english&cc=US")
    d = (data.get(str(appid)) or {}).get("data") or {}
    return d


def steam_reviews(appid):
    data = _json(f"https://store.steampowered.com/appreviews/{appid}?json=1&language=all&purchase_type=all&num_per_page=0&filter=summary")
    q = data.get("query_summary") or {}
    total = q.get("total_reviews") or 0
    if not total:
        return None
    return {"label": q.get("review_score_desc"), "percent": round(100 * (q.get("total_positive") or 0) / total), "count": total,
            "url": f"https://store.steampowered.com/app/{appid}/#app_reviews_hash"}


# ---------------- PlayStation Store ----------------

def ps_store_rating(name):
    html_ = _get(f"https://store.playstation.com/en-us/search/{urllib.parse.quote(name)}", timeout=20)
    ids = []
    for m in re.finditer(r'/en-us/concept/(\d+)', html_):
        if m.group(1) not in ids:
            ids.append(m.group(1))
    for cid in ids[:3]:
        page = _get(f"https://store.playstation.com/en-us/concept/{cid}", timeout=20)
        title = re.search(r"<title>([^<|]+)", page)
        if not title or similar(name, html.unescape(title.group(1))) < 0.55:
            continue
        avg = re.search(r'"averageRating"\s*:\s*([\d.]+)', page)
        cnt = re.search(r'"totalRatingsCount"\s*:\s*(\d+)', page)
        if avg:
            return {"stars": round(float(avg.group(1)), 2), "count": int(cnt.group(1)) if cnt else None,
                    "url": f"https://store.playstation.com/en-us/concept/{cid}"}
    return None


# ---------------- Wikipedia ----------------

def wikipedia(query, hint="video game"):
    s = _json("https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=6&srsearch="
              + urllib.parse.quote(f"{query} {hint}"))
    results = (s.get("query") or {}).get("search") or []
    if not results:
        return None
    base = re.sub(r"\s*\(.*?\)\s*", " ", query).strip()
    def score(r):
        t = r["title"]
        bonus = 0.15 if hint.split()[0] in t.lower() or "game" in t.lower() or "novel" in t.lower() else 0
        return similar(base, re.sub(r"\s*\(.*?\)", "", t)) + bonus
    best = max(results, key=score)
    if score(best) < 0.55:
        return None
    sm = _json("https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(best["title"].replace(" ", "_")))
    if sm.get("type") == "disambiguation":
        return None
    return {"title": sm.get("title"), "extract": sm.get("extract"),
            "url": ((sm.get("content_urls") or {}).get("desktop") or {}).get("page"),
            "thumb": (sm.get("thumbnail") or {}).get("source")}


# ---------------- news ----------------

CLAN_BASE = 103582791429521408
EVENT_KIND = {14: "major", 13: "update", 12: "minor", 10: "release", 28: "news"}
MINOR_RE = re.compile(r"\b(hot-?fix|bug ?fix|patch notes|known issues|maintenance|server)\b", re.I)
MAJOR_RE = re.compile(r"\b(major update|expansion|new season|season \d+|chapter \d+|update \d+|out now|launches|1\.0|dlc)\b", re.I)


def _img_from(text):
    m = re.search(r"\{STEAM_CLAN_IMAGE\}(/[^\s\]\[\"'<>]+\.(?:png|jpe?g|gif|webp))", text or "", re.I)
    if m:
        return "https://clan.akamai.steamstatic.com/images" + m.group(1)
    m = re.search(r"(?:\[img\]|<img[^>]+src=[\"'])(https?://[^\]\"'<>\s]+)", text or "", re.I)
    return m.group(1) if m else None


def steam_events(appid, count=30):
    """Steam's 'What's New' feed: every post is typed (patch, regular update, major update) and carries artwork."""
    data = _json(f"https://store.steampowered.com/events/ajaxgetpartnereventspageable/?clan_accountid=0&appid={appid}"
                 f"&offset=0&count={count}&l=english&origin=https:%2F%2Fstore.steampowered.com")
    out = []
    for ev in data.get("events") or []:
        body = ev.get("announcement_body") or {}
        try:
            jd = json.loads(ev.get("jsondata") or "{}")
        except Exception:
            jd = {}
        clan = int(ev.get("clan_steamid") or 0) - CLAN_BASE if ev.get("clan_steamid") else None
        def img(key):
            arr = [x for x in (jd.get(key) or []) if x]
            return f"https://clan.akamai.steamstatic.com/images/{clan}/{arr[0]}" if arr and clan and clan > 0 else None
        title = html.unescape(ev.get("event_name") or body.get("headline") or "")
        kind = EVENT_KIND.get(int(ev.get("event_type") or 0), "news")
        if kind in ("news", "update") and MINOR_RE.search(title):
            kind = "minor"
        if kind == "update" and MAJOR_RE.search(title):
            kind = "major"
        start = int(ev.get("rtime32_start_time") or body.get("posttime") or 0)
        out.append({
            "title": title, "date": int(body.get("posttime") or start or 0), "start": start,
            "url": f"https://store.steampowered.com/news/app/{appid}/view/{body.get('gid') or ev.get('gid')}",
            "source": "Steam", "summary": _clean(body.get("body", ""), 320),
            "thumb": img("localized_capsule_image") or img("localized_title_image") or _img_from(body.get("body")),
            "kind": kind, "patch": kind in ("minor", "update", "major"), "upcoming": start > time.time(),
        })
    return out


def steam_news(appid, count=12):
    data = _json(f"https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid={appid}&count={count}&maxlength=0&format=json")
    out = []
    for it in (data.get("appnews") or {}).get("newsitems") or []:
        official = it.get("feedname") == "steam_community_announcements"
        tags = it.get("tags") or []
        title = html.unescape(it.get("title", ""))
        patch = official and ("patchnotes" in tags or bool(PATCH_RE.search(title)))
        out.append({
            "title": title, "url": it.get("url"), "date": int(it.get("date") or 0),
            "source": "Steam" if official else (it.get("feedlabel") or "News"),
            "summary": _clean(it.get("contents", "")), "thumb": _img_from(it.get("contents")),
            "patch": patch, "kind": ("minor" if MINOR_RE.search(title) else "major" if MAJOR_RE.search(title) else "update") if patch else "news",
        })
    return out


def google_news(query, count=10):
    url = ("https://news.google.com/rss/search?q=" + urllib.parse.quote(f'"{query}"')
           + "&hl=en-US&gl=US&ceid=US:en")
    root = ET.fromstring(_get(url))
    out = []
    for it in root.iter("item"):
        title = it.findtext("title") or ""
        src = it.find("source")
        try:
            date = int(parsedate_to_datetime(it.findtext("pubDate")).timestamp())
        except Exception:
            date = 0
        source = src.text if src is not None else ""
        if source and title.endswith(" - " + source):
            title = title[: -len(source) - 3]
        patch = bool(PATCH_RE.search(title)) and _norm(query) in _norm(title)
        out.append({"title": html.unescape(title), "url": it.findtext("link"), "date": date, "source": source or "News",
                    "summary": "", "thumb": None, "patch": patch,
                    "kind": ("minor" if MINOR_RE.search(title) else "major" if MAJOR_RE.search(title) else "update") if patch else "news"})
        if len(out) >= count:
            break
    return out


# ---------------- the service the app calls ----------------

class Info:
    def __init__(self, data_dir, art, igdb=None):
        self.cache = Cache(data_dir)
        self.art = art
        self.igdb = igdb
        self.pool = cf.ThreadPoolExecutor(max_workers=6)
        self.youtube_key = lambda: None  # the app sets this when you add a YouTube API key
        self._updates_running = False

    @staticmethod
    def _key(game):
        return _norm(game.get("name", ""))

    def _appid(self, game):
        try:
            return self.art.steam_appid(game.get("name", ""))
        except Exception:
            return None

    # ----- ratings -----
    def ratings(self, game):
        key = self._key(game) + "|" + (game.get("platform") or "")
        hit = self.cache.get("ratings", key)
        if hit is not None:
            return hit
        name, plat = game.get("name", ""), game.get("platform", "")
        appid = self._appid(game)
        jobs = {"mc": self.pool.submit(lambda: (lambda b: mc_details(b["slug"]) if b else None)(mc_best(name)))}
        if appid:
            jobs["steam"] = self.pool.submit(steam_reviews, appid)
            jobs["steam_app"] = self.pool.submit(steam_details, appid)
        if plat in ("PS5", "PS4", "PS2"):
            jobs["ps"] = self.pool.submit(ps_store_rating, name)
        res = {}
        for k, f in jobs.items():
            try:
                res[k] = f.result(timeout=40)
            except Exception:
                res[k] = None
        mc = res.get("mc")
        if not mc and res.get("steam_app") and res["steam_app"].get("metacritic"):
            m = res["steam_app"]["metacritic"]
            mc = {"title": name, "url": m.get("url"), "critic": m.get("score"), "platforms": [], "user": None}
        main_platform = MC_PLATFORM.get(plat)
        primary, others = None, []
        for p in (mc or {}).get("platforms") or []:
            if p["score"] is None:
                continue
            if p["name"] == main_platform and primary is None:
                primary = p
            else:
                others.append(p)
        out = {
            "metacritic": mc and {k: mc.get(k) for k in ("title", "url", "critic", "critic_count", "user", "user_count", "user_sentiment")},
            "platform_score": primary, "platform_name": main_platform,
            "other_platforms": sorted(others, key=lambda p: -(p["score"] or 0)),
            "steam": res.get("steam"), "playstation": res.get("ps"),
            "appid": appid,
        }
        if any([out["metacritic"], out["steam"], out["playstation"]]):
            self.cache.put("ratings", key, out)
        return out

    # ----- DLC -----
    def dlcs(self, game):
        key = self._key(game)
        hit = self.cache.get("dlcs", key)
        if hit is not None:
            return hit
        name = game.get("name", "")
        appid = self._appid(game)
        found = {}
        if appid:
            try:
                ids = (steam_details(appid).get("dlc") or [])[:24]
            except Exception:
                ids = []
            def one(dlc_id):
                d = steam_details(dlc_id)
                if not d or JUNK_DLC_RE.search(d.get("name", "")):
                    return None
                rv = None
                try:
                    rv = steam_reviews(dlc_id)
                except Exception:
                    pass
                price = (d.get("price_overview") or {})
                return {"name": d.get("name"), "steam": rv, "release": (d.get("release_date") or {}).get("date"),
                        "url": f"https://store.steampowered.com/app/{dlc_id}", "price": price.get("final_formatted"),
                        "cents": price.get("initial") or price.get("final") or 0, "art": d.get("header_image") or d.get("capsule_image"),
                        "summary": _clean(d.get("short_description", ""), 220), "coming": (d.get("release_date") or {}).get("coming_soon")}
            for r in self.pool.map(lambda i: _safe(one, i), ids):
                if r and r.get("name"):
                    found[_dlc_key(name, r["name"])] = r
        # bigger expansions also have Metacritic pages of their own
        try:
            base = _norm(name)
            for it in mc_search(name, 20):
                t = it.get("title", "")
                # expansions are titled "Game: Expansion" or "Game - Expansion"; "Game 2" or "Game Nightreign" are new games
                if _norm(t) == base or not re.match(re.escape(name.strip()) + r"\s*[:\-–]\s*\S", t, re.I) \
                        or "edition" in t.lower() or "collection" in t.lower():
                    continue
                score = (it.get("criticScoreSummary") or {}).get("score")
                k = _dlc_key(name, t)
                match = found.get(k) or next((v for kk, v in found.items() if kk and k and (similar(kk, k) > 0.8 or (min(len(kk), len(k)) >= 4 and (kk in k or k in kk)))), None)
                imgs = it.get("images") or []
                art = next((f"https://www.metacritic.com/a/img/catalog{i['bucketPath']}" for i in imgs if i.get("bucketPath")), None)
                entry = match or found.setdefault(k, {"name": t, "steam": None, "release": it.get("releaseDate"), "art": art,
                                                      "url": f"https://www.metacritic.com/game/{it['slug']}/", "summary": _clean(it.get("description", ""), 220)})
                entry.setdefault("art", art)
                entry["metacritic"] = score
                entry["metacritic_url"] = f"https://www.metacritic.com/game/{it['slug']}/"
        except Exception:
            pass
        for d in found.values():
            n = d.get("name", "")
            d["kind"] = "upgrade" if UPGRADE_RE.search(n) else "dlc"
            d["major"] = d["kind"] == "dlc" and (d.get("metacritic") is not None or (d.get("cents", 0) >= 1499 and bool(EXPANSION_RE.search(n + " " + d.get("summary", "")))))
        out = sorted(found.values(), key=lambda d: (d["kind"] == "upgrade", not d["major"], -(d.get("metacritic") or 0), -((d.get("steam") or {}).get("count") or 0)))
        self.cache.put("dlcs", key, out)
        return out

    # ----- back-of-the-box synopsis (official text first) -----
    def about(self, game):
        key = self._key(game)
        hit = self.cache.get("about", key)
        if hit is not None:
            return hit
        text, long_text, source, facts = "", "", None, {}
        appid = self._appid(game)
        if appid:
            try:
                d = steam_details(appid)
                text = _clean(d.get("short_description", ""), 900)
                long_text = _clean(d.get("about_the_game") or d.get("detailed_description") or "", 4000)
                source = "Steam store page" if text else None
                facts = {"release": (d.get("release_date") or {}).get("date"), "developers": d.get("developers"),
                         "publishers": d.get("publishers"), "genres": [g.get("description") for g in d.get("genres") or []]}
            except Exception:
                pass
        if not text and self.igdb:
            try:
                ig = self.igdb.game(game.get("name", ""))
                if ig and ig.get("summary"):
                    text, source = _clean(ig["summary"], 900), "IGDB"
                    long_text = _clean(ig.get("storyline") or "", 4000)
            except Exception:
                pass
        if not text:
            try:
                best = mc_best(game.get("name", ""))
                if best and best.get("description"):
                    text, source = _clean(best.get("description", ""), 900), "Metacritic"
            except Exception:
                pass
        if not text:
            try:
                w = wikipedia(game.get("name", ""), ("video game " + (game.get("developer") or "")).strip())
                if w and w.get("extract"):
                    sentences = re.split(r"(?<=[.!?])\s+", w["extract"])
                    text, source = " ".join(sentences[:3]), "Wikipedia"
            except Exception:
                pass
        out = {"text": text, "long": long_text if long_text and long_text[:200] != text[:200] else "", "source": source, **facts}
        if text:
            self.cache.put("about", key, out)
        return out

    # ----- screenshots and trailers -----
    def media(self, game):
        """Screenshots from Steam (or IGDB), and trailers from YouTube matched to the ones Steam lists,
        so they play right in the app."""
        key = self._key(game)
        hit = self.cache.get("media", key)
        if hit is not None and hit.get("v") == 2:
            return hit
        shots, steam_videos, names, owners, igdb_ids = [], [], [], [], []
        appid = self._appid(game)
        if appid:
            try:
                d = steam_details(appid)
                owners = (d.get("developers") or []) + (d.get("publishers") or [])
                for m in d.get("movies") or []:
                    mp4, webm = m.get("mp4") or {}, m.get("webm") or {}
                    names.append(m.get("name") or "")
                    steam_videos.append({"name": m.get("name"), "thumb": m.get("thumbnail"),
                                         "mp4": mp4.get("max") or mp4.get("480"), "webm": webm.get("max") or webm.get("480"),
                                         "hls": m.get("hls_h264"), "page": f"https://store.steampowered.com/app/{appid}"})
                for sh in d.get("screenshots") or []:
                    shots.append({"thumb": sh.get("path_thumbnail"), "full": sh.get("path_full")})
            except Exception:
                pass
        if self.igdb:
            try:
                ig = self.igdb.game(game.get("name", "")) or {}
                igdb_ids = [v["video_id"] for v in ig.get("videos") or [] if v.get("video_id")]
                if not shots:
                    for sh in (ig.get("screenshots") or []) + (ig.get("artworks") or []):
                        shots.append({"thumb": self.igdb.img(sh["image_id"], "t_screenshot_med"), "full": self.igdb.img(sh["image_id"], "t_1080p")})
            except Exception:
                pass
        videos = self.trailers(game, names, owners or [game.get("developer"), game.get("publisher")], igdb_ids)
        if not videos:
            videos = steam_videos  # can't be matched on YouTube: offer Steam's own (they open on Steam if they can't play here)
        out = {"shots": shots[:20], "videos": videos[:8], "v": 2}
        if shots or videos:
            self.cache.put("media", key, out)
        return out

    def trailers(self, game, steam_names=(), owners=(), igdb_ids=()):
        key = self._key(game)
        hit = self.cache.get("trailers", key)
        if hit is not None:
            return hit
        try:
            vids = youtube.trailers(game.get("name", ""), steam_names, [o for o in owners if o], igdb_ids, self.youtube_key())
        except Exception:
            return []
        if vids:
            self.cache.put("trailers", key, vids)
        return vids

    # ----- wiki -----
    def wiki(self, game):
        key = self._key(game)
        hit = self.cache.get("wiki", key)
        if hit is not None:
            return hit
        try:
            w = wikipedia(game.get("name", ""), ("video game " + (game.get("developer") or "")).strip())
        except Exception:
            return None
        q = urllib.parse.quote(game.get("name", ""))
        out = {"wikipedia": w,
               "fandom": f"https://community.fandom.com/wiki/Special:Search?query={q}&scope=cross-wiki",
               "pcgamingwiki": f"https://www.pcgamingwiki.com/w/index.php?search={q}"}
        self.cache.put("wiki", key, out)
        return out

    # ----- news -----
    def news(self, game):
        key = self._key(game)
        hit = self.cache.get("news", key)
        if hit is not None:
            return hit
        appid = self._appid(game)
        items = []
        if appid:
            try:
                items = steam_events(appid)
            except Exception:
                items = []
            if not items:
                try:
                    items = steam_news(appid)
                except Exception:
                    items = []
        if len(items) < 5:
            try:
                items += google_news(game.get("name", ""), 10 - len(items))
            except Exception:
                pass
        items.sort(key=lambda i: -i["date"])
        self.cache.put("news", key, items)
        self._remember_update(game, items)
        return items

    # ----- the News catalog's "Your games" -----
    def your_news(self, games, days=45):
        """Updates and news for the games you own or want, newest first. Uses what's already fetched and
        quietly refreshes the rest in the background, so opening the tab is instant."""
        out, stale = [], []
        cutoff = time.time() - days * DAY
        for g in games:
            e = self.cache.data.get("news", {}).get(self._key(g))
            if not e or time.time() - e["t"] >= TTL["news"]:
                stale.append(g)
            for i in (e or {}).get("v") or []:
                if (i.get("date") or 0) >= cutoff:
                    out.append(dict(i, game=g.get("name"), status=g.get("status")))
        if stale and not getattr(self, "_news_running", False):
            self._news_running = True
            def warm():
                try:
                    for g in stale[:80]:
                        try:
                            self.news(g)
                        except Exception:
                            pass
                        time.sleep(0.8)
                finally:
                    self._news_running = False
            threading.Thread(target=warm, daemon=True).start()
        out.sort(key=lambda i: -(i.get("start") if i.get("upcoming") else i.get("date") or 0))
        return {"items": out[:200], "pending": len(stale)}

    # ----- milestones for live-service games -----
    def milestones(self, game):
        items = self.news(game)
        out = [i for i in items if i.get("kind") in ("major", "release") or (i.get("kind") == "update" and i.get("thumb"))]
        return sorted(out, key=lambda i: -(i.get("start") or i["date"]))[:24]

    # ----- "Newly updated!" -----
    def _remember_update(self, game, items):
        cutoff = time.time() - NEW_UPDATE_DAYS * DAY
        patch = next((i for i in items if i.get("patch") and i["date"] >= cutoff), None)
        self.cache.put("updated", self._key(game), patch and {"date": patch["date"], "title": patch["title"], "url": patch["url"]})

    def updated(self, games):
        """Known 'newly updated' flags; starts a slow background check for the rest."""
        out, todo = {}, []
        for g in games:
            e = self.cache.data.get("updated", {}).get(self._key(g))
            if e and time.time() - e["t"] < TTL["updated"]:
                if e["v"]:
                    out[g["name"]] = e["v"]
            else:
                todo.append(g)
        if todo and not self._updates_running:
            self._updates_running = True
            threading.Thread(target=self._check_updates, args=(todo,), daemon=True).start()
        cutoff = time.time() - NEW_UPDATE_DAYS * DAY
        return {k: v for k, v in out.items() if v["date"] >= cutoff}

    def _check_updates(self, games):
        try:
            for g in games:
                appid = self._appid(g)
                try:
                    items = (steam_events(appid, 10) or steam_news(appid, 8)) if appid else google_news(g.get("name", ""), 8)
                except Exception:
                    continue
                self._remember_update(g, items)
                time.sleep(1.2)
        finally:
            self._updates_running = False

    # ----- books -----
    def book(self, book):
        key = "book|" + _norm(book.get("name", "")) + "|" + _norm(book.get("author", ""))
        hit = self.cache.get("book", key)
        if hit is not None:
            return hit
        title, author = book.get("name", ""), book.get("author", "")
        out = {"openlibrary": None, "google": None, "wikipedia": None,
               "goodreads": "https://www.goodreads.com/search?q=" + urllib.parse.quote(f"{title} {author}")}
        try:
            ol = _json("https://openlibrary.org/search.json?limit=5&fields=key,title,author_name,cover_i,first_publish_year,"
                       "number_of_pages_median,ratings_average,ratings_count&title=" + urllib.parse.quote(title)
                       + "&author=" + urllib.parse.quote(author))
            docs = ol.get("docs") or []
            if docs:
                d = max(docs, key=lambda x: (similar(title, x.get("title", "")), x.get("ratings_count") or 0))
                out["openlibrary"] = {"url": "https://openlibrary.org" + d.get("key", ""), "year": d.get("first_publish_year"),
                                      "pages": d.get("number_of_pages_median"), "rating": d.get("ratings_average"),
                                      "count": d.get("ratings_count"), "cover_id": d.get("cover_i")}
        except Exception:
            pass
        try:
            gb = _json("https://www.googleapis.com/books/v1/volumes?maxResults=5&q="
                       + urllib.parse.quote(f'intitle:"{title}" inauthor:"{author}"'))
            items = gb.get("items") or []
            if items:
                v = max(items, key=lambda i: (similar(title, (i.get("volumeInfo") or {}).get("title", "")),
                                              (i.get("volumeInfo") or {}).get("ratingsCount") or 0))["volumeInfo"]
                img = (v.get("imageLinks") or {}).get("thumbnail") or (v.get("imageLinks") or {}).get("smallThumbnail")
                out["google"] = {"url": v.get("infoLink"), "rating": v.get("averageRating"), "count": v.get("ratingsCount"),
                                 "pages": v.get("pageCount"), "published": v.get("publishedDate"),
                                 "description": _clean(v.get("description", ""), 600),
                                 "image": img and img.replace("http://", "https://").replace("&edge=curl", "")}
        except Exception:
            pass
        try:
            out["wikipedia"] = wikipedia(title + (" " + author if author else ""), "novel")
        except Exception:
            pass
        self.cache.put("book", key, out)
        return out


UPGRADE_RE = re.compile(r"upgrade|deluxe edition|season pass|expansion pass|bundle|digital deluxe|premium edition|gold edition", re.I)
EXPANSION_RE = re.compile(r"expansion|story|campaign|chapter|episode|new (?:region|land|area|zone)|adventure|dlc", re.I)


def _dlc_key(base, name):
    n = _norm(name)
    b = _norm(base)
    return (n[len(b):].strip() if n.startswith(b) else n) or n


def _safe(fn, *a):
    try:
        return fn(*a)
    except Exception:
        return None
