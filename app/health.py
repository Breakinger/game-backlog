"""Which outside sources are working: every web request the app makes is noted (when a site last answered, and
what went wrong when it didn't), so a source that quietly stops working shows up in Settings → Sources instead
of just leaving a blank section. Only the site, the time and a short reason are kept; never the address asked
for, keys or tokens."""
import json
import os
import socket
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

# site -> (source, what Masterlog uses it for); sites not listed are grouped under their own name
HOSTS = {
    "en.wikipedia.org": ("wikipedia", "Wikipedia", "Wiki tab, awards, Game of the Year winners, release years"),
    "www.pcgamingwiki.com": ("pcgw", "PCGamingWiki", "Fixes and save locations in the Wiki tab"),
    "api.igdb.com": ("igdb", "IGDB", "Covers, art and release dates for console games"),
    "id.twitch.tv": ("igdb", "IGDB", "Covers, art and release dates for console games"),
    "store.steampowered.com": ("steam_store", "Steam Store", "Prices, descriptions, release dates, Steam Deck ratings"),
    "api.steampowered.com": ("steam_api", "Steam Web API", "Your Steam library, hours, achievements, news, Steam Family"),
    "partner.steamgames.com": ("steam_schedule", "Steam sale schedule", "Dates of Steam's seasonal sales and Next Fest"),
    "www.protondb.com": ("protondb", "ProtonDB", "How well games run on the Steam Deck"),
    "script.google.com": ("sheet", "Your sheet's connection", "Reading and saving your games"),
    "script.googleusercontent.com": ("sheet", "Your sheet's connection", "Reading and saving your games"),
    "docs.google.com": ("sheet", "Your sheet's connection", "Reading and saving your games"),
    "www.steamgriddb.com": ("sgdb", "SteamGridDB", "Clean covers without logos"),
    "api.github.com": ("github", "GitHub", "Checking for Masterlog updates"),
    "github.com": ("github", "GitHub", "Checking for Masterlog updates"),
    "www.metacritic.com": ("metacritic", "Metacritic", "Critic and user scores"),
    "backend.metacritic.com": ("metacritic", "Metacritic", "Critic and user scores"),
    "store.playstation.com": ("psstore", "PlayStation Store", "PlayStation prices and ratings"),
    "www.cheapshark.com": ("cheapshark", "CheapShark", "PC store prices"),
    "nbg.gov.ge": ("rates", "Exchange rates", "Prices in lari"),
    "open.er-api.com": ("rates", "Exchange rates", "Prices in lari"),
    "www.googleapis.com": ("youtube", "YouTube", "Trailers and videos"),
    "blog.playstation.com": ("event_news", "Event announcements", "Spotting showcases (State of Play, Nintendo Direct...)"),
    "news.xbox.com": ("event_news", "Event announcements", "Spotting showcases (State of Play, Nintendo Direct...)"),
    "www.gematsu.com": ("event_news", "Event announcements", "Spotting showcases (State of Play, Nintendo Direct...)"),
    "www.nintendolife.com": ("event_news", "Event announcements", "Spotting showcases (State of Play, Nintendo Direct...)"),
    "www.videogameschronicle.com": ("event_news", "Event announcements", "Spotting showcases (State of Play, Nintendo Direct...)"),
    "feeds.feedburner.com": ("news", "News feeds", "The News tab"),
    "www.ign.com": ("news", "News feeds", "The News tab"),
    "www.pcgamer.com": ("news", "News feeds", "The News tab"),
    "kotaku.com": ("news", "News feeds", "The News tab"),
    "www.eurogamer.net": ("news", "News feeds", "The News tab"),
    "news.google.com": ("news", "News feeds", "The News tab"),
    "bsky.app": ("news", "News feeds", "The News tab"),
    "www.reddit.com": ("reddit", "Reddit", "Deals subreddits and community news"),
    "old.reddit.com": ("reddit", "Reddit", "Deals subreddits and community news"),
    "oauth.reddit.com": ("reddit", "Reddit", "Deals subreddits and community news"),
    "mapgenie.io": ("mapgenie", "Map Genie", "Interactive maps in the Wiki tab"),
    "thegameawards.com": ("event_art", "Event pages", "Official art for the Events banner"),
    "openlibrary.org": ("books", "Open Library", "Book covers and details"),
    "www.googleapis.com/books": ("books", "Open Library", "Book covers and details"),
    "www.nexusmods.com": ("nexus", "Nexus Mods", "Mod pages"),
    "api.nexusmods.com": ("nexus", "Nexus Mods", "Mod pages"),
    "itch.io": ("itch", "itch.io", "Your itch.io library"),
    "api.humble.com": ("bundles", "Bundles", "Humble and Fanatical bundles"),
    "www.humblebundle.com": ("bundles", "Bundles", "Humble and Fanatical bundles"),
    "www.fanatical.com": ("bundles", "Bundles", "Humble and Fanatical bundles"),
}
DAY = 86400


def _source(host):
    host = (host or "").lower()
    if host in HOSTS:
        return HOSTS[host]
    if host.endswith(".fandom.com"):
        return ("fandom", "Fandom wikis", "Game wikis in the Wiki tab")
    if host.endswith(".wiki.fextralife.com"):
        return ("fextralife", "Fextralife wikis", "Game wikis in the Wiki tab")
    if host.endswith(".steamstatic.com") or host.endswith(".akamaihd.net"):
        return ("steam_cdn", "Steam images", "Covers, screenshots and news pictures")
    if host.endswith("playstation.com") or host.endswith("playstation.net"):
        return ("psstore", "PlayStation Store", "PlayStation prices and ratings")
    return (host, host, "")


def _local(host):
    import ipaddress
    if host in ("localhost", "") or host.endswith(".local"):
        return True
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_private or ip.is_loopback or ip.is_link_local
    except ValueError:
        return False


def _reason(e):
    if isinstance(e, urllib.error.HTTPError):
        return {401: "the site refused the key (401)", 403: "the site turned the app away (403)", 429: "too many requests for now (429)"}.get(
            e.code, f"the site answered with an error ({e.code})")
    r = getattr(e, "reason", e)
    if isinstance(r, socket.timeout) or isinstance(e, (socket.timeout, TimeoutError)) or "timed out" in str(r):
        return "no answer in time"
    if isinstance(r, ssl.SSLError):
        return "secure connection failed"
    if isinstance(r, socket.gaierror):
        return "couldn't find the site (no internet?)"
    if isinstance(r, ConnectionRefusedError) or isinstance(r, ConnectionResetError):
        return "connection refused or dropped"
    return (e.__class__.__name__ + (f": {r}" if r and r is not e else ""))[:120]


class Health:
    def __init__(self, data_dir):
        self.path = os.path.join(data_dir, "sources.json")
        self.lock = threading.Lock()
        self.timer = None
        try:
            with open(self.path, encoding="utf-8") as f:
                self.data = json.load(f)
        except (OSError, ValueError):
            self.data = {}

    def _save_soon(self):
        if self.timer:
            return
        def save():
            self.timer = None
            with self.lock:
                snap = json.dumps(self.data)
            tmp = self.path + ".tmp"
            try:
                with open(tmp, "w", encoding="utf-8") as f:
                    f.write(snap)
                os.replace(tmp, self.path)
            except OSError:
                pass
        self.timer = threading.Timer(20, save)
        self.timer.daemon = True
        self.timer.start()

    def record(self, url_or_key, ok, reason=None, label=None, purpose=None):
        """A request finished: ok, or failed with a short reason. url_or_key is a full address (only its site is
        kept) or a source key for checks that aren't web requests ('goty_parse')."""
        if "://" in str(url_or_key):
            host = urllib.parse.urlsplit(url_or_key).hostname or ""
            if _local(host):
                return   # your own PCs (copying between them) and the app itself aren't outside sources
            key, name, what = _source(host)
        else:
            key, name, what = url_or_key, label or url_or_key, purpose or ""
        now = time.time()
        with self.lock:
            e = self.data.setdefault(key, {"name": name, "what": what})
            e["name"], e["what"] = name, what or e.get("what", "")
            if ok:
                e["ok_t"] = now
                e.pop("fail_since", None)
            else:
                e["fail_t"] = now
                e["err"] = reason or "failed"
                if not e.get("fail_since") or (e.get("ok_t") or 0) > e["fail_since"]:
                    e["fail_since"] = now
            e["n"] = e.get("n", 0) + 1
        self._save_soon()

    def report(self):
        now = time.time()
        out = []
        with self.lock:
            items = list(self.data.items())
        for key, e in items:
            ok_t, fail_t = e.get("ok_t") or 0, e.get("fail_t") or 0
            failing = fail_t > ok_t
            since = e.get("fail_since") or fail_t
            status = "failing" if failing and now - since > DAY else "trouble" if failing else "ok"
            out.append({"key": key, "name": e.get("name") or key, "what": e.get("what") or "", "status": status,
                        "ok_t": ok_t or None, "fail_t": fail_t or None, "since": since if failing else None,
                        "err": e.get("err") if failing else None, "last_err": e.get("err")})
        order = {"failing": 0, "trouble": 1, "ok": 2}
        out.sort(key=lambda s: (order[s["status"]], s["name"].lower()))
        return {"sources": out, "alert": any(s["status"] == "failing" for s in out)}


H = None   # the app's instance, set by install()


def record(*a, **k):
    if H:
        try:
            H.record(*a, **k)
        except Exception:
            pass


def install(data_dir):
    """Start noting every web request the app makes through urllib (all of its own requests go that way)."""
    global H
    H = Health(data_dir)
    orig = urllib.request.urlopen
    if getattr(orig, "_masterlog", False):
        return H

    def tracked(req, *a, **k):
        url = req.full_url if hasattr(req, "full_url") else str(req)
        try:
            r = orig(req, *a, **k)
        except urllib.error.HTTPError as e:
            # 'not found' means the site answered: a missing page, not a broken source
            record(url, e.code in (404, 410), None if e.code in (404, 410) else _reason(e))
            raise
        except Exception as e:
            record(url, False, _reason(e))
            raise
        record(url, True)
        return r
    tracked._masterlog = True
    urllib.request.urlopen = tracked
    return H
