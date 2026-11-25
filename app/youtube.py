"""Trailers from YouTube, matched to the ones Steam shows. Works without any key by reading YouTube's search
page; with a YouTube Data API key (optional) it uses the official API instead."""
import json
import re
import urllib.parse
import urllib.request

from art import _norm, numerals

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
TRAILER_RE = re.compile(r"\b(trailer|teaser|gameplay|reveal|launch|announce(ment)?|overview|story|cinematic|showcase|accolades)\b", re.I)
JUNK_RE = re.compile(r"\b(reaction|reacts?|review|explained|fan[- ]?made|concept|breakdown|leak(ed)?|theory|ranking|ranked|vs\.?|"
                     r"comparison|compared|\bmods?\b|walkthrough|let'?s play|part \d+|full game|playthrough|speedrun|tips|guide|"
                     r"analysis|everything we know|recap|predictions?|honest|parody|meme|ai[- ]generated|unreal engine 5 concept)\b", re.I)
OFFICIAL = {"playstation", "xbox", "nintendo of america", "nintendo", "ign", "gamespot", "steam", "bandai namco america",
            "ubisoft", "ea", "electronic arts", "bethesda softworks", "rockstar games", "capcom usa", "square enix",
            "sega", "warner bros. games", "xbox game studios", "devolver digital", "annapurna interactive", "the game awards"}
STOP = {"the", "of", "a", "an", "and", "edition", "game"}


def _get(url, headers=None, timeout=15):
    h = {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", "Cookie": "CONSENT=YES+1; SOCS=CAI"}
    h.update(headers or {})
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def _seconds(text):
    parts = [int(p) for p in re.findall(r"\d+", text or "")]
    s = 0
    for p in parts:
        s = s * 60 + p
    return s or None


def _walk(node, key):
    """Every dict stored under `key` anywhere in YouTube's page data."""
    stack = [node]
    while stack:
        n = stack.pop()
        if isinstance(n, dict):
            for k, v in n.items():
                if k == key and isinstance(v, dict):
                    yield v
                else:
                    stack.append(v)
        elif isinstance(n, list):
            stack.extend(reversed(n))


def _text(t):
    if not t:
        return ""
    if "simpleText" in t:
        return t["simpleText"]
    return "".join(r.get("text", "") for r in t.get("runs") or [])


def search_page(query, limit=10):
    """YouTube's own search results, read from the page (no key needed)."""
    page = _get("https://www.youtube.com/results?sp=EgIQAQ%253D%253D&search_query=" + urllib.parse.quote(query))
    m = re.search(r"var ytInitialData\s*=\s*(\{.*?\});\s*</script>", page, re.S) or re.search(r'window\["ytInitialData"\]\s*=\s*(\{.*?\});', page, re.S)
    if not m:
        return []
    data = json.loads(m.group(1))
    out = []
    for v in _walk(data, "videoRenderer"):
        vid = v.get("videoId")
        if not vid:
            continue
        badges = json.dumps(v.get("ownerBadges") or [])
        out.append({"id": vid, "title": _text(v.get("title")), "channel": _text(v.get("ownerText")),
                    "verified": "VERIFIED" in badges or "OFFICIAL_ARTIST" in badges,
                    "seconds": _seconds(_text(v.get("lengthText"))), "published": _text(v.get("publishedTimeText"))})
        if len(out) >= limit:
            break
    return out


def search_api(query, key, limit=10):
    """The official YouTube Data API (100 quota units per search; the free daily quota is 10,000)."""
    url = ("https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults="
           f"{limit}&q={urllib.parse.quote(query)}&key={urllib.parse.quote(key)}")
    data = json.loads(_get(url))
    return [{"id": it["id"]["videoId"], "title": (it.get("snippet") or {}).get("title", ""),
             "channel": (it.get("snippet") or {}).get("channelTitle", ""), "verified": False, "seconds": None,
             "published": (it.get("snippet") or {}).get("publishedAt", "")}
            for it in data.get("items") or [] if (it.get("id") or {}).get("videoId")]


def _tokens(s):
    return [t for t in _norm(s).split() if t not in STOP]


def score(video, game, wanted="", owners=()):
    """How sure we are this is an official trailer for this game. Below zero means no."""
    title = video.get("title", "")
    import html
    title = html.unescape(title)
    nt = _norm(title)
    words = set(nt.split())
    need = _tokens(game)
    if not need or not all(t in words for t in need):
        return -1
    if numerals(game) - numerals(title):
        return -1  # 'Red Dead Redemption Trailer' is not the trailer for Red Dead Redemption 2
    extra = numerals(title) - numerals(game)
    if extra and not wanted:
        return -1
    if JUNK_RE.search(title) or not TRAILER_RE.search(title):
        return -1
    if video.get("seconds") and video["seconds"] > 12 * 60:
        return -1
    s = 1.0
    ch = _norm(video.get("channel", ""))
    if video.get("verified"):
        s += 1.0
    if ch in OFFICIAL or any(o and (_norm(o) in ch or ch in _norm(o)) for o in owners if o):
        s += 2.0
    if wanted:
        wt = [t for t in _tokens(wanted) if t not in need]
        if wt:
            s += 2.0 * sum(t in words for t in wt) / len(wt)
    if "official" in words:
        s += 0.5
    return s


def trailers(game, steam_names=(), owners=(), igdb_ids=(), api_key=None, limit=6):
    """Official trailers for a game: the ones Steam lists, matched on YouTube, then IGDB's picks, then a plain search."""
    find = (lambda q: search_api(q, api_key, 8)) if api_key else (lambda q: search_page(q, 12))
    out, seen = [], set()

    def add(vid, name, channel=""):
        if vid and vid not in seen and len(out) < limit:
            seen.add(vid)
            out.append({"name": name or "Trailer", "youtube": vid, "channel": channel,
                        "thumb": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"})

    names = []
    for n in steam_names:
        n = re.sub(r"\s+", " ", n or "").strip()
        if n and _norm(n) not in {_norm(x) for x in names}:
            names.append(n)
    queries = [(f"{game} {n}" if _norm(game) not in _norm(n) else n, n) for n in names[:4]]
    for q, wanted in queries:
        try:
            res = find(q)
        except Exception:
            continue
        best = max(res, key=lambda v: score(v, game, wanted, owners), default=None)
        if best and score(best, game, wanted, owners) >= 1.5:
            add(best["id"], wanted, best["channel"])
    for vid in igdb_ids:
        add(vid, "Trailer")
    if len(out) < 3:
        for q in (f"{game} official trailer", f"{game} gameplay trailer"):
            try:
                res = find(q)
            except Exception:
                continue
            for v in sorted(res, key=lambda v: -score(v, game, "", owners)):
                if score(v, game, "", owners) >= 2.0:
                    add(v["id"], v["title"], v["channel"])
            if len(out) >= 3:
                break
    return out


def videos(game, api_key=None, limit=12):
    """Recent and popular videos about a game (gameplay, reviews, guides), for watching in the app."""
    find = (lambda q: search_api(q, api_key, limit)) if api_key else (lambda q: search_page(q, limit + 6))
    out, seen = [], set()
    for q in (f"{game} gameplay", f"{game}"):
        try:
            res = find(q)
        except Exception:
            continue
        need = _tokens(game)
        for v in res:
            words = set(_norm(v.get("title", "")).split())
            if v["id"] in seen or not all(t in words for t in need) or (numerals(game) - numerals(v.get("title", ""))):
                continue
            seen.add(v["id"])
            out.append({"youtube": v["id"], "name": v.get("title"), "channel": v.get("channel"), "published": v.get("published"),
                        "seconds": v.get("seconds"), "thumb": f"https://i.ytimg.com/vi/{v['id']}/mqdefault.jpg"})
        if len(out) >= limit:
            break
    return out[:limit]
