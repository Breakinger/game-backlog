"""The News catalog: leaks and rumours, breaking news from the gaming press, Marvel & DC spoilers, and updates for
your own games. Reads public RSS feeds and Reddit's public listings; nothing is posted or logged in."""
import concurrent.futures as cf
import html
import json
import re
import threading
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from datetime import datetime

BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
REDDIT_UA = "windows:masterlog:1.0 (personal game backlog app)"
FRESH = 15 * 60   # each source is fetched at most every 15 minutes

SECTIONS = {
    "leaks": [("reddit", "GamingLeaksAndRumours", "r/GamingLeaksAndRumours")],
    "marvel": [("reddit", "MarvelStudiosSpoilers", "r/MarvelStudiosSpoilers"), ("reddit", "DCULeaks", "r/DCULeaks")],
    "breaking": [
        ("rss", ["https://feeds.feedburner.com/ign/games-all", "https://www.ign.com/rss/v2/articles/feed?categories=games"], "IGN"),
        ("rss", ["https://www.pcgamer.com/rss/"], "PC Gamer"),
        ("rss", ["https://kotaku.com/rss"], "Kotaku"),
        ("rss", ["https://www.eurogamer.net/feed"], "Eurogamer"),
        ("steam", 593110, "Steam"),
        ("rss", ["https://news.google.com/rss/search?q=" + urllib.parse.quote("site:bloomberg.com video games when:14d") + "&hl=en-US&gl=US&ceid=US:en"], "Bloomberg"),
        ("rss", ["https://bsky.app/profile/jasonschreier.bsky.social/rss"], "Jason Schreier"),
    ],
}
NS = {"media": "http://search.yahoo.com/mrss/", "atom": "http://www.w3.org/2005/Atom", "content": "http://purl.org/rss/1.0/modules/content/"}


def _get(url, ua=BROWSER_UA, timeout=15, accept="*/*"):
    req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": accept, "Accept-Language": "en-US,en;q=0.9"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _clean(text, limit=300):
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = html.unescape(re.sub(r"\s+", " ", text)).strip()
    return text if len(text) <= limit else text[:limit].rsplit(" ", 1)[0] + "…"


def _date(s):
    if not s:
        return 0
    try:
        return int(parsedate_to_datetime(s).timestamp())
    except Exception:
        pass
    try:
        return int(datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())
    except Exception:
        return 0


def _img_in(text):
    m = re.search(r"<img[^>]+src=[\"']([^\"']+)", text or "", re.I)
    return html.unescape(m.group(1)) if m else None


def parse_feed(raw, source):
    """RSS 2.0 or Atom into news items, with a thumbnail wherever the feed has one."""
    root = ET.fromstring(raw)
    out = []
    items = root.findall(".//item") or root.findall(".//atom:entry", NS)
    for it in items:
        atom = it.tag.endswith("entry")
        title = (it.findtext("atom:title", "", NS) if atom else it.findtext("title")) or ""
        if atom:
            link_el = it.find("atom:link[@rel='alternate']", NS)
            if link_el is None:
                link_el = it.find("atom:link", NS)
            link = link_el.get("href") if link_el is not None else ""
            date = _date(it.findtext("atom:published", "", NS) or it.findtext("atom:updated", "", NS))
            body = it.findtext("atom:content", "", NS) or it.findtext("atom:summary", "", NS)
        else:
            link = it.findtext("link") or ""
            date = _date(it.findtext("pubDate") or it.findtext("{http://purl.org/dc/elements/1.1/}date"))
            body = it.findtext("content:encoded", "", NS) or it.findtext("description") or ""
        thumb = None
        for tag in ("media:thumbnail", "media:content", "media:group/media:content", "media:group/media:thumbnail"):
            el = it.find(tag, NS)
            if el is not None and el.get("url") and (el.get("medium") in (None, "image") or tag.endswith("thumbnail")):
                thumb = el.get("url")
                break
        if not thumb:
            enc = it.find("enclosure")
            if enc is not None and (enc.get("type") or "").startswith("image"):
                thumb = enc.get("url")
        thumb = thumb or _img_in(body)
        src = it.find("source")
        label = source
        if source == "Bloomberg" and src is not None and src.text:
            if "bloomberg" not in src.text.lower():
                continue
            if title.endswith(" - " + src.text):
                title = title[: -len(src.text) - 3]
        summary = _clean(body)
        if source == "Jason Schreier":
            title, summary = (summary[:140] + ("…" if len(summary) > 140 else "")), ""
        out.append({"title": html.unescape(title).strip(), "url": link, "date": date, "source": label,
                    "summary": summary if summary != title else "", "thumb": thumb})
    return out


def reddit(sub, label):
    """A subreddit's newest posts. Uses Reddit's public JSON, falling back to its RSS feed."""
    try:
        data = json.loads(_get(f"https://www.reddit.com/r/{sub}/new.json?limit=50&raw_json=1", REDDIT_UA, accept="application/json"))
        out = []
        for c in (data.get("data") or {}).get("children") or []:
            p = c.get("data") or {}
            if p.get("over_18") or p.get("stickied"):
                continue
            thumb = None
            imgs = ((p.get("preview") or {}).get("images") or [])
            if imgs:
                res = imgs[0].get("resolutions") or []
                pick = next((r for r in res if r.get("width", 0) >= 320), None) or (res[-1] if res else imgs[0].get("source"))
                thumb = pick and pick.get("url")
            elif str(p.get("thumbnail", "")).startswith("http"):
                thumb = p["thumbnail"]
            link = p.get("url_overridden_by_dest") or ""
            domain = p.get("domain") or ""
            out.append({"title": html.unescape(p.get("title", "")), "url": "https://www.reddit.com" + p.get("permalink", ""),
                        "date": int(p.get("created_utc") or 0), "source": label, "summary": _clean(p.get("selftext", ""), 260),
                        "thumb": thumb, "flair": p.get("link_flair_text") or "", "spoiler": bool(p.get("spoiler")),
                        "score": p.get("score"), "comments": p.get("num_comments"),
                        "link": link if link and "reddit.com" not in domain and not domain.startswith("self.") else "",
                        "domain": domain if domain and not domain.startswith("self.") else ""})
        return out
    except Exception:
        raw = _get(f"https://www.reddit.com/r/{sub}/new/.rss", REDDIT_UA)
        items = parse_feed(raw, label)
        for i in items:
            i["summary"] = ""
        return items


def steam_news_hub(appid, label):
    data = json.loads(_get(f"https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid={appid}&count=15&maxlength=400&format=json"))
    out = []
    for it in (data.get("appnews") or {}).get("newsitems") or []:
        body = it.get("contents") or ""
        m = re.search(r"\{STEAM_CLAN_IMAGE\}(/[^\s\]\[\"'<>]+\.(?:png|jpe?g|gif|webp))", body, re.I)
        thumb = "https://clan.akamai.steamstatic.com/images" + m.group(1) if m else _img_in(body)
        out.append({"title": html.unescape(it.get("title", "")), "url": it.get("url"), "date": int(it.get("date") or 0),
                    "source": label, "summary": _clean(re.sub(r"\[/?[a-z0-9*]+[^\]]*\]", " ", body)), "thumb": thumb})
    return out


class Feeds:
    def __init__(self):
        self.cache = {}     # source label -> (time, items, error)
        self.lock = threading.Lock()
        self.pool = cf.ThreadPoolExecutor(max_workers=6)

    def _load(self, kind, arg, label):
        hit = self.cache.get(label)
        if hit and time.time() - hit[0] < FRESH:
            return hit
        try:
            if kind == "reddit":
                items = reddit(arg, label)
            elif kind == "steam":
                items = steam_news_hub(arg, label)
            else:
                items, err = None, None
                for url in arg:
                    try:
                        items = parse_feed(_get(url), label)
                        break
                    except Exception as e:
                        err = e
                if items is None:
                    raise err or IOError("no feed")
            entry = (time.time(), items, None)
        except Exception as e:
            old = hit[1] if hit else []
            entry = (time.time() - FRESH + 120, old, f"{label}: {e.__class__.__name__}")  # try again in two minutes
        with self.lock:
            self.cache[label] = entry
        return entry

    def section(self, name, limit=120):
        sources = SECTIONS.get(name) or []
        futures = [self.pool.submit(self._load, *s) for s in sources]
        items, errors = [], []
        for f in futures:
            _, got, err = f.result()
            items += got
            if err:
                errors.append(err)
        seen, out = set(), []
        for i in sorted(items, key=lambda x: -(x.get("date") or 0)):
            k = (i.get("url") or i.get("title", "")).split("?")[0]
            if k in seen:
                continue
            seen.add(k)
            out.append(i)
        return {"items": out[:limit], "errors": errors, "sources": [s[2] for s in sources]}
