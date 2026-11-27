"""When a game came out: its first release (date and platforms), the platforms it was ported to later ('PC port,
26 Sep 2026'), and newer versions of it (a remake, a remaster, an enhanced edition).

Sources, best first: IGDB (dates per platform, and its remake/remaster links) when you've added your IGDB key,
then Wikipedia's infobox, then Steam for the PC date. A release date you set yourself (in Modify, saved in your
sheet's 'Release date' column) always wins, and also tells Masterlog which of two same-named games you mean
(Resident Evil 4 from 2005, or the 2023 remake), so the right cover and details are found."""
import re
import time
from datetime import datetime, timezone

MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
DATE_RX = re.compile(r"(?:(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+((?:19|20)\d\d))|"
                     r"(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+((?:19|20)\d\d))|"
                     r"(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+((?:19|20)\d\d))|((?:19|20)\d\d)", re.I)

# An edition of a game (Special, Definitive, Legendary, Game of the Year, Director's Cut…) is the same game, updated:
# it keeps the original's release date, and its own date shows as a line under it. A remaster or remake sold as a new
# game under a new name ("Oblivion Remastered", "Resident Evil 4" from 2023 is set apart by its date) is a new release.
# An update that stays on the game's own store page (The Witcher 3's next-gen update) keeps its name, so it was never
# anything but the original.
EDITION_RX = re.compile(r"[\s:\-–—(]+(?:the\s+)?(special|definitive|legendary|complete|ultimate|enhanced|anniversary|"
                        r"game of the year|goty|deluxe|digital deluxe|gold|premium|extended|director'?s|final|collector'?s)"
                        r"(?:\s+(edition|cut))?\)?\s*$", re.I)
NEW_RELEASE_RX = re.compile(r"\b(remaster(?:ed)?|remake|reimagined|reforged|reborn)\b", re.I)


def edition_of(name):
    """'The Elder Scrolls V: Skyrim Special Edition' → ('The Elder Scrolls V: Skyrim', 'Special Edition'), or None
    when the name isn't an edition of another game (or is a remaster or remake, which count as new releases)."""
    name = (name or "").strip()
    if not name or NEW_RELEASE_RX.search(name):
        return None
    m = EDITION_RX.search(name)
    if not m:
        return None
    word, tail = m.group(1).lower(), (m.group(2) or "").lower()
    if word.startswith(("director", "final")):
        if tail != "cut":
            return None
    elif word not in ("game of the year", "goty") and tail != "edition":
        return None
    base = name[:m.start()].strip(" :-–—(")
    if len(base) < 2:
        return None
    return base, re.sub(r"\s+", " ", m.group(0).strip(" :-–—()"))


# platform names, as IGDB and Wikipedia write them, to the short names Masterlog shows
PLATFORMS = [
    (r"\bpc\b|windows|microsoft windows|\bwin\b|steam", "PC"), (r"playstation 5|\bps5\b", "PS5"), (r"playstation 4|\bps4\b", "PS4"),
    (r"playstation 3|\bps3\b", "PS3"), (r"playstation 2|\bps2\b", "PS2"), (r"playstation portable|\bpsp\b", "PSP"),
    (r"playstation vita|\bvita\b", "PS Vita"), (r"\bplaystation\b(?! \d)|\bps1\b|\bpsx\b", "PS1"),
    (r"xbox series|series x", "Xbox Series X|S"), (r"xbox one", "Xbox One"), (r"xbox 360", "Xbox 360"), (r"\bxbox\b", "Xbox"),
    (r"switch 2", "Switch 2"), (r"nintendo switch|\bswitch\b|\bns\b", "Switch"), (r"wii u", "Wii U"), (r"\bwii\b", "Wii"),
    (r"gamecube", "GameCube"), (r"nintendo 64|\bn64\b", "N64"), (r"\b3ds\b", "3DS"), (r"\bds\b", "DS"), (r"game boy advance|\bgba\b", "GBA"),
    (r"mac|macos|os x", "Mac"), (r"linux", "Linux"), (r"stadia", "Stadia"), (r"\bios\b|iphone", "iOS"), (r"android", "Android"),
    (r"dreamcast", "Dreamcast"), (r"steam deck", "Steam Deck"),
]


def short_platform(name):
    n = (name or "").lower()
    for rx, short in PLATFORMS:
        if re.search(rx, n):
            return short
    return (name or "").strip()


def _ts(y, m=1, d=1):
    try:
        return int(datetime(int(y), int(m), int(d), tzinfo=timezone.utc).timestamp())
    except ValueError:
        return None


def parse_dates(text):
    """[(unix time, precision)] for every date in a piece of text: '25 February 2022', 'February 25, 2022',
    'March 2017', or a bare year. Precision is 'day', 'month' or 'year'."""
    out = []
    for m in DATE_RX.finditer(text or ""):
        if m.group(1):
            out.append((_ts(m.group(3), MONTHS[m.group(2)[:3].lower()], m.group(1)), "day"))
        elif m.group(4):
            out.append((_ts(m.group(6), MONTHS[m.group(4)[:3].lower()], m.group(5)), "day"))
        elif m.group(7):
            out.append((_ts(m.group(8), MONTHS[m.group(7)[:3].lower()]), "month"))
        else:
            out.append((_ts(m.group(9)), "year"))
    return [(t, p) for t, p in out if t]


def from_wikipedia_release(text):
    """Wikipedia's infobox 'Release' text ('PS4, PS5, Windows, Xbox One: February 25, 2022; Switch 2: October 2, 2025')
    as [(platform, unix time, precision)]."""
    out = []
    plats = []
    # walk through the text: platform names collect until a date, which they all share
    for part in re.split(r"(?<=\d{4})[\s;,]*", text or ""):
        part = part.strip(" ;,")
        if not part:
            continue
        dates = parse_dates(part)
        names = re.split(r"[,/;:]|\band\b", DATE_RX.sub(" ", part))
        plats = [short_platform(n) for n in names if short_platform(n) and len(n.strip()) > 1 and not re.fullmatch(r"\s*(ww|na|eu|jp|au|pal|release|original release)\s*", n, re.I)] or plats
        for t, prec in dates[:1]:
            for p in plats or ["?"]:
                out.append((p, t, prec))
    return out


def combine(entries, manual=None):
    """[(platform, time, precision)] -> {date, precision, platforms, ports}. The earliest date is the release; a
    platform whose own first date is more than a month later was a port."""
    if manual:
        return {"date": manual, "precision": "day", "platforms": [], "ports": [], "manual": True}
    first = {}
    for p, t, prec in entries:
        if p and t and (p not in first or t < first[p][0]):
            first[p] = (t, prec)
    if not first:
        return None
    start = min(t for t, _ in first.values())
    precision = next(prec for t, prec in sorted(first.values()) if t == start)
    orig = sorted(p for p, (t, _) in first.items() if t - start <= 31 * 86400 and p != "?")
    ports = sorted(({"platform": p, "date": t, "precision": prec} for p, (t, prec) in first.items() if t - start > 31 * 86400 and p != "?"),
                   key=lambda x: x["date"])
    return {"date": start, "precision": precision, "platforms": orig, "ports": ports}


def from_igdb(igdb, name, year=None):
    """IGDB's dates per platform, and its links to remakes and remasters. With a year, the version from that year
    (so 'Resident Evil 4' with 2023 is the remake)."""
    if not igdb or not igdb.configured():
        return None
    from art import _norm, similar
    safe = name.replace('"', "")
    rows = igdb._query("games", f'search "{safe}"; fields name,first_release_date,category,release_dates.date,release_dates.y,'
                                'release_dates.platform.name,remakes.name,remakes.first_release_date,remasters.name,'
                                'remasters.first_release_date,expanded_games.name,expanded_games.first_release_date; limit 10;') or []
    rows = [r for r in rows if similar(name, r.get("name", "")) >= 0.85 and r.get("first_release_date")]
    if not rows:
        return None
    def score(r):
        y = time.gmtime(r["first_release_date"]).tm_year
        return (_norm(r.get("name", "")) == _norm(name), year is not None and abs(y - year) <= 1, -(r.get("category") or 0) == 0, -r["first_release_date"])
    r = max(rows, key=score)
    entries = [(short_platform((d.get("platform") or {}).get("name")), d.get("date"), "day") for d in r.get("release_dates") or [] if d.get("date")]
    out = combine(entries) or {"date": r["first_release_date"], "precision": "day", "platforms": [], "ports": []}
    newer = []
    for kind, key in (("remake", "remakes"), ("remaster", "remasters"), ("enhanced edition", "expanded_games")):
        for x in r.get(key) or []:
            if x.get("first_release_date") and x["first_release_date"] > out["date"]:
                newer.append({"name": x.get("name"), "kind": kind, "date": x["first_release_date"]})
    out["newer"] = sorted(newer, key=lambda x: x["date"])
    out["source"] = "IGDB"
    return out
