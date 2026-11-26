"""Big gaming events on Home, like Steam's banner: showcases (State of Play, Nintendo Direct, Xbox Games Showcase,
PC Gaming Show, Summer Game Fest, Future Games Show, gamescom Opening Night Live), The Game Awards, TennoCon and
the big sales (Steam's seasonal sales, Next Fest, Scream Fest, other stores' holiday sales).

Where the dates come from:
- Steam's sales and Next Fest: Valve's own published schedule (the Steamworks page), read once a day.
- Dates confirmed when this list was written (The Game Awards 2026 on 10 December, the Steam Winter Sale...).
- Showcases, which are usually announced only a few days ahead: announcement headlines in official and press feeds
  (PlayStation Blog, Xbox Wire, Gematsu, Nintendo Life, VGC and the News tab's sources), read for the event's name
  and a date ('State of Play returns tomorrow at 2pm PT'). A sighting is remembered, so it stays after the
  article scrolls off the feed. Only events from a few days before they start until just after they end are shown.

Every event links to its official streams and site, and sales to their store."""
import html
import json
import os
import re
import threading
import time
import urllib.request
from datetime import datetime, timedelta, timezone

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
DAY = 86400
SOON = 3 * DAY          # most events appear three days before they start

YT = "https://www.youtube.com/@{}/streams"
TW = "https://www.twitch.tv/{}"
SERIES = {
    "tga": {"name": "The Game Awards", "kind": "Awards show", "theme": "tga", "hours": 3.5, "lead": 21 * DAY,
            "match": r"\bthe game awards\b(?! (?:20\d\d )?(?:nominee|winner|vote|predict))",
            "watch": [("YouTube", YT.format("thegameawards")), ("Twitch", TW.format("thegameawards"))],
            "links": [("Official site", "https://thegameawards.com"), ("All nominees", "https://thegameawards.com/nominees")]},
    "sop": {"name": "State of Play", "kind": "PlayStation showcase", "theme": "ps", "hours": 1, "match": r"\bstate of play\b",
            "watch": [("YouTube", YT.format("PlayStation")), ("Twitch", TW.format("playstation"))],
            "links": [("PlayStation Blog", "https://blog.playstation.com/")]},
    "direct": {"name": "Nintendo Direct", "kind": "Nintendo showcase", "theme": "nintendo", "hours": 1,
               "match": r"\bnintendo direct\b|\bdirect partner showcase\b",
               "watch": [("YouTube", YT.format("NintendoAmerica")), ("Twitch", TW.format("nintendo"))],
               "links": [("Nintendo Direct", "https://www.nintendo.com/us/nintendo-direct/")]},
    "xbox": {"name": "Xbox Games Showcase", "kind": "Xbox showcase", "theme": "xbox", "hours": 2,
             "match": r"\bxbox games showcase\b|\bxbox developer direct\b|\bxbox partner preview\b",
             "watch": [("YouTube", YT.format("Xbox")), ("Twitch", TW.format("xbox"))],
             "links": [("Xbox Wire", "https://news.xbox.com/")]},
    "pcgs": {"name": "PC Gaming Show", "kind": "Showcase", "theme": "pc", "hours": 2, "match": r"\bpc gaming show\b",
             "watch": [("YouTube", YT.format("PCGamer")), ("Twitch", TW.format("pcgamer"))],
             "links": [("Official site", "https://www.pcgamingshow.com/")]},
    "sgf": {"name": "Summer Game Fest", "kind": "Showcase", "theme": "sgf", "hours": 2, "match": r"\bsummer game fest\b",
            "watch": [("YouTube", YT.format("SummerGameFest")), ("Twitch", TW.format("summergamefest"))],
            "links": [("Official site", "https://www.summergamefest.com/")]},
    "fgs": {"name": "Future Games Show", "kind": "Showcase", "theme": "fgs", "hours": 1.5, "match": r"\bfuture games show\b",
            "watch": [("YouTube", YT.format("GamesRadar")), ("Twitch", TW.format("gamesradar"))],
            "links": [("Official site", "https://www.futuregamesshow.com/")]},
    "onl": {"name": "gamescom Opening Night Live", "kind": "Showcase", "theme": "gamescom", "hours": 2,
            "match": r"\bopening night live\b|\bgamescom onl\b",
            "watch": [("YouTube", YT.format("gamescom")), ("Twitch", TW.format("gamescom"))],
            "links": [("gamescom", "https://www.gamescom.global/")]},
    "tennocon": {"name": "TennoCon", "kind": "Warframe convention", "theme": "tenno", "hours": 8, "match": r"\btennocon\b",
                 "watch": [("YouTube", YT.format("PlayWarframe")), ("Twitch", TW.format("warframe"))],
                 "links": [("TennoCon", "https://www.warframe.com/tennocon")]},
    "steam_sale": {"name": "Steam Sale", "kind": "Sale", "theme": "steam", "sale": True,
                   "links": [("Open the Steam store", "https://store.steampowered.com/")]},
    "next_fest": {"name": "Steam Next Fest", "kind": "Demo festival", "theme": "nextfest", "sale": True,
                  "links": [("Next Fest on Steam", "https://store.steampowered.com/sale/nextfest")]},
    "scream": {"name": "Steam Scream Fest", "kind": "Halloween sale", "theme": "halloween", "sale": True,
               "links": [("Open the Steam store", "https://store.steampowered.com/")]},
    "steam_awards": {"name": "The Steam Awards", "kind": "Community awards", "theme": "steam", "sale": False,
                     "links": [("Nominate and vote", "https://store.steampowered.com/steamawards")]},
    "ps_sale": {"name": "PlayStation Store sale", "kind": "Sale", "theme": "ps", "sale": True,
                "match": r"\b(days of play|playstation store (?:holiday|black friday|winter|spring|summer|halloween|christmas) sale)\b",
                "links": [("PlayStation Store deals", "https://store.playstation.com/en-us/pages/deals")]},
    "epic_sale": {"name": "Epic Games Store sale", "kind": "Sale", "theme": "epic", "sale": True,
                  "match": r"\bepic (?:games store )?(?:mega|holiday|spring|summer|black friday) sale\b",
                  "links": [("Epic Games Store", "https://store.epicgames.com/en-US/free-games")]},
}
SEASON_THEME = {"winter": "winter", "spring": "spring", "summer": "summer", "autumn": "autumn"}

# Dates confirmed when this was written (times as announced; Steam sales start and end at 10am Pacific)
KNOWN = [
    {"series": "steam_awards", "title": "The Steam Awards: nominations", "start": "2026-11-26T00:00:00Z", "end": "2026-11-30T18:00:00Z",
     "note": "Nominate your favourite games of the year in each category."},
    {"series": "tga", "title": "The Game Awards 2026", "start": "2026-12-11T01:00:00Z", "end": "2026-12-11T04:30:00Z",
     "note": "Live from the Peacock Theater in Los Angeles: the year's awards and world premieres."},
    {"series": "steam_sale", "title": "Steam Winter Sale", "season": "winter", "start": "2026-12-17T18:00:00Z", "end": "2027-01-04T18:00:00Z"},
    {"series": "next_fest", "title": "Steam Next Fest: February", "start": "2027-02-22T18:00:00Z", "end": "2027-03-01T18:00:00Z"},
    {"series": "steam_sale", "title": "Steam Spring Sale", "season": "spring", "start": "2027-03-18T17:00:00Z", "end": "2027-03-25T17:00:00Z"},
    {"series": "next_fest", "title": "Steam Next Fest: June", "start": "2027-06-14T17:00:00Z", "end": "2027-06-21T17:00:00Z"},
    {"series": "steam_sale", "title": "Steam Summer Sale", "season": "summer", "start": "2027-06-24T17:00:00Z", "end": "2027-07-08T17:00:00Z"},
]

NEWS_FEEDS = [
    ("PlayStation Blog", "https://blog.playstation.com/feed/"),
    ("Xbox Wire", "https://news.xbox.com/en-us/feed/"),
    ("Gematsu", "https://www.gematsu.com/feed"),
    ("Nintendo Life", "https://www.nintendolife.com/feeds/latest"),
    ("VGC", "https://www.videogameschronicle.com/feed/"),
]
STEAM_SCHEDULE = "https://partner.steamgames.com/doc/marketing/upcoming_events"

MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
MONTH_RX = r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"


# ---------------- time zones (without a time zone database: Windows Python doesn't ship one) ----------------

def _nth_sunday(year, month, n):
    d = datetime(year, month, 1)
    d += timedelta(days=(6 - d.weekday()) % 7)
    return d + timedelta(weeks=n - 1)


def _last_sunday(year, month):
    d = datetime(year, month + 1, 1) - timedelta(days=1) if month < 12 else datetime(year, 12, 31)
    return d - timedelta(days=(d.weekday() + 1) % 7)


def _us_dst(dt):
    return _nth_sunday(dt.year, 3, 2) <= dt.replace(tzinfo=None) < _nth_sunday(dt.year, 11, 1)


def _eu_dst(dt):
    return _last_sunday(dt.year, 3) <= dt.replace(tzinfo=None) < _last_sunday(dt.year, 10)


def _offset(zone, local):
    z = zone.upper().replace(".", "")
    if z in ("PT", "PST", "PDT", "PACIFIC"):
        return -7 if _us_dst(local) else -8
    if z in ("ET", "EST", "EDT", "EASTERN"):
        return -4 if _us_dst(local) else -5
    if z in ("BST", "UK"):
        return 1 if _eu_dst(local) else 0
    if z in ("CET", "CEST"):
        return 2 if _eu_dst(local) else 1
    if z in ("GMT", "UTC"):
        return 0
    if z == "JST":
        return 9
    return None


# ---------------- reading a date out of an announcement ----------------

def extract_when(text, published):
    """(start as a Unix time, has a time of day) for the first date in text, read relative to when it was
    published: 'tomorrow', 'this Thursday', 'June 4', '4 June', with '2pm PT' / '22:00 CET' when given."""
    t = " " + (text or "").lower() + " "
    pub = datetime.fromtimestamp(published, timezone.utc)
    day = None
    m = re.search(MONTH_RX + r"\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?!:)", t) or None
    m2 = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?" + MONTH_RX + r"\b", t)
    if m:
        day = (MONTHS[m.group(1)[:3]], int(m.group(2)))
    elif m2:
        day = (MONTHS[m2.group(2)[:3]], int(m2.group(1)))
    date = None
    if day:
        mon, d = day
        try:
            date = datetime(pub.year, mon, d)
            if date < pub.replace(tzinfo=None) - timedelta(days=60):
                date = datetime(pub.year + 1, mon, d)
        except ValueError:
            date = None
    elif re.search(r"\b(today|tonight|later today)\b", t):
        date = datetime(pub.year, pub.month, pub.day)
    elif re.search(r"\btomorrow\b", t):
        date = datetime(pub.year, pub.month, pub.day) + timedelta(days=1)
    else:
        w = re.search(r"\b(?:this|next|on|for|airs|returns|streams)\s+(" + "|".join(WEEKDAYS) + r")\b", t) \
            or re.search(r"\b(" + "|".join(WEEKDAYS) + r")\b(?=[^.]{0,20}\b\d{1,2}(?::\d{2})?\s*(?:a\.?m|p\.?m))", t)
        if w:
            target = WEEKDAYS.index(w.group(1))
            ahead = (target - pub.weekday()) % 7 or 7
            date = datetime(pub.year, pub.month, pub.day) + timedelta(days=ahead)
    if date is None:
        return None, False
    tm = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\s*(pt|pst|pdt|et|est|edt|bst|gmt|utc|cet|cest|jst)\b", t) \
        or re.search(r"\b(\d{1,2}):(\d{2})\s*()(pt|pst|pdt|et|est|edt|bst|gmt|utc|cet|cest|jst)\b", t)
    if tm:
        h, mi = int(tm.group(1)), int(tm.group(2) or 0)
        ap = (tm.group(3) or "").replace(".", "")
        if ap == "pm" and h < 12:
            h += 12
        if ap == "am" and h == 12:
            h = 0
        local = date.replace(hour=h, minute=mi)
        off = _offset(tm.group(4), local)
        if off is not None and 0 <= h < 24:
            return int((local - timedelta(hours=off)).replace(tzinfo=timezone.utc).timestamp()), True
    # a date with no time: count it from 9am Pacific, when most showcases are in the afternoon in Europe
    local = date.replace(hour=9)
    return int((local - timedelta(hours=_offset("PT", local))).replace(tzinfo=timezone.utc).timestamp()), False


def _iso(s):
    return int(datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())


# ---------------- Steam's published schedule ----------------

def _plain(page):
    page = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", page, flags=re.S | re.I)
    page = re.sub(r"</(tr|p|div|h\d|li|br)>|<br\s*/?>", "\n", page, flags=re.I)
    page = re.sub(r"</t[dh]>", " | ", page, flags=re.I)
    return html.unescape(re.sub(r"<[^>]+>", " ", page))


def parse_steam_schedule(page):
    """Seasonal sales, Next Fests and Scream Fest from Valve's 'Upcoming Steam sales and events' page."""
    text = _plain(page)
    out = []
    pt = lambda y, mon, d, h=10: int((datetime(y, mon, d, h) - timedelta(hours=_offset("PT", datetime(y, mon, d, h)))).replace(tzinfo=timezone.utc).timestamp())
    for m in re.finditer(r"(Spring|Summer|Autumn|Fall|Winter) Sale (\d{4})\s*\|?\s*([A-Z][a-z]+) (\d{1,2}), (\d{4})\s*[-–]\s*([A-Z][a-z]+) (\d{1,2}), (\d{4})", text):
        season = m.group(1).lower().replace("fall", "autumn")
        s = pt(int(m.group(5)), MONTHS[m.group(3)[:3].lower()], int(m.group(4)))
        e = pt(int(m.group(8)), MONTHS[m.group(6)[:3].lower()], int(m.group(7)))
        out.append({"series": "steam_sale", "title": f"Steam {m.group(1).replace('Fall', 'Autumn')} Sale", "season": season, "start": s, "end": e, "source": "Steam"})
    for m in re.finditer(r"Next Fest\s*\|?\s*([A-Z][a-z]+) (\d{1,2})\s*[-–]\s*(?:([A-Z][a-z]+) )?(\d{1,2}), (\d{4})", text):
        y = int(m.group(5))
        m1, m2 = MONTHS[m.group(1)[:3].lower()], MONTHS[(m.group(3) or m.group(1))[:3].lower()]
        y1 = y - 1 if m1 > m2 else y
        out.append({"series": "next_fest", "title": f"Steam Next Fest: {m.group(1)}", "start": pt(y1, m1, int(m.group(2))),
                    "end": pt(y, m2, int(m.group(4))), "source": "Steam"})
    # themed fests sit under '2026 Fests'-style headings; only Scream Fest (Halloween) is shown
    year = None
    for line in text.split("\n"):
        h = re.search(r"\b(20\d\d) Fests\b", line)
        if h:
            year = int(h.group(1))
        if year and re.search(r"scream", line, re.I):
            ds = re.findall(r"\b([A-Z][a-z]{2})[a-z]* (\d{1,2})\b", line)
            if len(ds) >= 2:
                (a, b), (c, d) = ds[0], ds[1]
                if a.lower() in MONTHS and c.lower() in MONTHS:
                    y2 = year + (1 if MONTHS[c.lower()] < MONTHS[a.lower()] else 0)
                    out.append({"series": "scream", "title": "Steam Scream Fest", "start": pt(year, MONTHS[a.lower()], int(b)),
                                "end": pt(y2, MONTHS[c.lower()], int(d)), "source": "Steam"})
    return out


# ---------------- announcements in the news ----------------

def sightings(items):
    """Events spotted in news items: [{series, title, start, timed, url, source}]."""
    out = []
    for it in items:
        title = it.get("title") or ""
        text = f"{title}. {it.get('summary') or ''}"
        published = int(it.get("date") or 0)
        if not published:
            continue
        for key, s in SERIES.items():
            rx = s.get("match")
            if not rx or not re.search(rx, title, re.I):
                continue
            # an announcement says when ('announced', 'set for', 'returns', 'airs', 'tomorrow'); a recap doesn't
            if re.search(r"\b(everything announced|recap|biggest announcements|all the announcements|every announcement|round-?up|review)\b", title, re.I):
                continue
            # read the date from the sentence that names the event
            sentences = [x for x in re.split(r"(?<=[.!?])\s+", text) if re.search(rx, x, re.I)] or [title]
            found = [extract_when(x, published) for x in sentences[:4]]
            found = [f for f in found if f[0]]
            # prefer a sentence that gives the time of day, as long as it's the same day
            start, timed = (found[0] if found else (None, False))
            for f in found:
                if f[1] and start and abs(f[0] - start) < DAY:
                    start, timed = f
                    break
            if not start or not (published - DAY <= start <= published + 120 * DAY):
                continue
            out.append({"series": key, "title": s["name"], "start": start, "timed": timed,
                        "url": it.get("url"), "source": it.get("source"), "headline": title})
    return out


class Events:
    def __init__(self, data_dir, feeds=None):
        self.path = os.path.join(data_dir, "events.json")
        self.feeds = feeds
        self.lock = threading.Lock()
        self.busy = False
        try:
            with open(self.path, encoding="utf-8") as f:
                self.store = json.load(f)
        except (OSError, ValueError):
            self.store = {"t": 0, "steam": [], "seen": []}

    def _get(self, url, timeout=20):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", "replace")

    def refresh(self):
        if self.busy:
            return
        self.busy = True
        try:
            store = dict(self.store)
            try:
                found = parse_steam_schedule(self._get(STEAM_SCHEDULE))
                if found:
                    store["steam"] = found
            except Exception:
                pass
            items = []
            if self.feeds is not None:
                try:
                    import feeds as feedmod
                    for label, url in NEWS_FEEDS:
                        try:
                            items += feedmod.parse_feed(feedmod._get(url), label)
                        except Exception:
                            pass
                    items += (self.feeds.section("breaking") or {}).get("items") or []
                except Exception:
                    pass
            now = time.time()
            seen = [s for s in store.get("seen") or [] if s["start"] > now - 7 * DAY]
            for s in sightings(items):
                # the same event seen in several articles: keep one, preferring an exact time
                same = next((x for x in seen if x["series"] == s["series"] and abs(x["start"] - s["start"]) < 1.5 * DAY), None)
                if same:
                    if s["timed"] and not same.get("timed"):
                        same.update(s)
                    continue
                seen.append(s)
            store["seen"] = seen
            store["t"] = now
            with self.lock:
                self.store = store
                tmp = self.path + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(store, f)
                os.replace(tmp, self.path)
        finally:
            self.busy = False

    def current(self, now=None):
        """Events live now or starting soon, most important first."""
        now = now or time.time()
        if time.time() - (self.store.get("t") or 0) > 3 * 3600 and not self.busy:
            threading.Thread(target=self.refresh, daemon=True).start()
        pool = []
        for k in KNOWN:
            pool.append({**k, "start": _iso(k["start"]), "end": _iso(k["end"]), "timed": True, "source": "Confirmed"})
        for s in self.store.get("steam") or []:
            pool.append({**s, "timed": True})
        for s in self.store.get("seen") or []:
            hours = SERIES[s["series"]].get("hours", 2)
            pool.append({**s, "end": s["start"] + int(hours * 3600) if s.get("timed") else s["start"] + DAY})
        out, keys = [], set()
        for e in sorted(pool, key=lambda e: e["start"]):
            ser = SERIES.get(e["series"]) or {}
            lead = ser.get("lead", SOON)
            after = 12 * 3600 if not ser.get("sale") else 0       # a show's replay stays up for half a day
            if not (e["start"] - lead <= now <= e["end"] + after):
                continue
            key = (e["series"], int(e["start"] // DAY))
            if key in keys or any(k[0] == e["series"] and abs(k[1] - e["start"] // DAY) <= 1 for k in keys):
                continue
            keys.add(key)
            state = "live" if e["start"] <= now < e["end"] else "ended" if now >= e["end"] else "soon"
            theme = SEASON_THEME.get(e.get("season"), ser.get("theme", "steam"))
            out.append({"id": f"{e['series']}-{int(e['start'])}", "series": e["series"], "title": e.get("title") or ser.get("name"),
                        "kind": ser.get("kind", "Event"), "theme": theme, "sale": bool(ser.get("sale")), "start": e["start"],
                        "end": e["end"], "timed": bool(e.get("timed", True)), "state": state, "note": e.get("note") or "",
                        "watch": ser.get("watch") or [], "links": ser.get("links") or [],
                        "source": e.get("source"), "url": e.get("url"), "headline": e.get("headline")})
        rank = {"live": 0, "soon": 1, "ended": 2}
        prio = lambda e: 0 if e["series"] == "tga" else 1 if not e["sale"] else 2
        out.sort(key=lambda e: (rank[e["state"]], prio(e), e["start"]))
        return {"events": out, "checked": self.store.get("t") or 0}
