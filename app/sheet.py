"""Reads the Game Backlog Google Sheet as CSV and turns it into plain dicts."""
import csv
import io
import re
import urllib.request

DEFAULT_SHEET = "https://docs.google.com/spreadsheets/d/1duThbwmKNdye3u0N0Nf869_A08H8keGpKvcgr_qLBEo/edit"
GAMES_GID = "0"
PLAYTHROUGHS_GID = "200"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) GameBacklog/1.0"
DATE_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")


def csv_url(link, gid):
    """Accepts a normal sheet link or a 'Publish to web' link and returns a CSV export URL for one tab."""
    link = (link or DEFAULT_SHEET).strip()
    m = re.search(r"/spreadsheets/d/e/([\w-]+)", link)
    if m:
        return f"https://docs.google.com/spreadsheets/d/e/{m.group(1)}/pub?output=csv&single=true&gid={gid}"
    m = re.search(r"/spreadsheets/d/([\w-]+)", link)
    if m:
        return f"https://docs.google.com/spreadsheets/d/{m.group(1)}/export?format=csv&gid={gid}"
    raise ValueError("That doesn't look like a Google Sheets link.")


def fetch_csv(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        ctype = r.headers.get("Content-Type", "")
        body = r.read().decode("utf-8-sig", errors="replace")
    if "text/html" in ctype or body.lstrip().startswith("<"):
        raise PermissionError("Google returned a sign-in page instead of data. The sheet isn't published or shared yet.")
    return list(csv.reader(io.StringIO(body)))


def _date(v):
    m = DATE_RE.search(v or "")
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None


def _bool(v):
    return str(v).strip().upper() == "TRUE"


def _num(v):
    m = re.search(r"-?\d+(?:[.,]\d+)?", v or "")
    return float(m.group(0).replace(",", ".")) if m else None


def _header_index(rows, first="Game"):
    for i, r in enumerate(rows[:10]):
        if r and r[0].strip() == first:
            return i
    raise ValueError("Couldn't find the header row (a row starting with 'Game').")


def _col(header):
    idx = {}
    for i, h in enumerate(header):
        key = re.sub(r"[^a-z0-9%]+", " ", h.lower()).strip()
        idx[key] = i
    def get(row, *names):
        for n in names:
            i = idx.get(n)
            if i is not None and i < len(row):
                return row[i].strip()
        return ""
    return get


def parse_games(rows):
    h = _header_index(rows)
    get = _col(rows[h])
    games = []
    for r in rows[h + 1:]:
        name = r[0].strip() if r else ""
        if not name:
            continue
        hours_text = get(r, "hours")
        completed_raw = get(r, "completed")
        dropped_raw = get(r, "dropped")
        games.append({
            "id": len(games),
            "name": name,
            "status": get(r, "status") or "Library",
            "priority": get(r, "priority"),
            "completed": _date(completed_raw),
            "completed_known": bool(completed_raw) and "unknown" not in completed_raw.lower(),
            "completed_raw": completed_raw,
            "dropped": _date(dropped_raw),
            "second_chance": _bool(get(r, "2nd chance")),
            "platform": get(r, "platform"),
            "play_on": get(r, "play on"),
            "format": get(r, "format"),
            "dlc_owned": _bool(get(r, "dlc owned")),
            "dlc_done": _bool(get(r, "dlc done")),
            "platinum": _bool(get(r, "100 % plat", "100% plat")),
            "modded": _bool(get(r, "modded")),
            "runs": int(_num(get(r, "runs")) or 0),
            "beaten_on": [p.strip() for p in get(r, "beaten on").split(",") if p.strip()],
            "hours": _num(hours_text),
            "hours_text": hours_text,
            "score": _num(get(r, "score")),
            "genre": get(r, "genre"),
            "developer": get(r, "developer"),
            "publisher": get(r, "publisher"),
            "migrate_to": get(r, "migrate to"),
            "notes": get(r, "notes"),
            "store_link": get(r, "store link"),
        })
    return games


def parse_playthroughs(rows):
    if not rows:
        return []
    h = _header_index(rows)
    get = _col(rows[h])
    out = []
    for r in rows[h + 1:]:
        name = r[0].strip() if r else ""
        if not name:
            continue
        out.append({
            "game": name,
            "run": int(_num(get(r, "run")) or 0),
            "platform": get(r, "platform"),
            "play_on": get(r, "play on"),
            "modded": _bool(get(r, "modded")),
            "dlc": _bool(get(r, "with dlc")),
            "platinum": _bool(get(r, "100 % plat", "100% plat")),
            "finished": _bool(get(r, "finished")),
            "finished_on": _date(get(r, "finished on")),
            "hours": _num(get(r, "hours")),
            "notes": get(r, "notes"),
        })
    return out


def load(link):
    games = parse_games(fetch_csv(csv_url(link, GAMES_GID)))
    try:
        plays = parse_playthroughs(fetch_csv(csv_url(link, PLAYTHROUGHS_GID)))
    except Exception:
        plays = []
    return games, plays
