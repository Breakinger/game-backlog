"""Reads (and, through the sheet's connection script, edits) the Game Backlog Google Sheet."""
import csv
import io
import json
import re
import urllib.parse
import urllib.request

DEFAULT_SHEET = ""  # set your link in the app's Settings
GAMES_GID = "0"
PLAYTHROUGHS_GID = "200"
BOOKS_GID = "500"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) GameBacklog/1.0"
DATE_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")

# app field -> normalised header name in the sheet
GAME_FIELDS = {
    "name": "game", "status": "status", "priority": "priority", "second_chance": "2nd chance",
    "platform": "platform", "play_on": "play on", "format": "format", "upgrade": "upgrade",
    "dlc_owned": "dlc owned", "dlc_done": "dlc done", "platinum": "100% plat", "modded": "modded",
    "hours": "hours", "score": "score", "genre": "genre", "developer": "developer",
    "publisher": "publisher", "migrate_to": "migrate to", "notes": "notes", "store_link": "store link", "type": "type",
    "upgrade_owned": "upgrade owned",
}
PLAY_FIELDS = {
    "game": "game", "platform": "platform", "play_on": "play on", "modded": "modded", "dlc": "with dlc",
    "platinum": "100% plat", "finished": "finished", "hours": "hours", "notes": "notes",
}
BOOK_FIELDS = {
    "name": "book", "author": "author", "series": "series", "number": "number", "status": "status",
    "priority": "priority", "format": "format", "score": "score", "notes": "notes", "store_link": "store link",
}
TABS = {"games": GAME_FIELDS, "plays": PLAY_FIELDS, "books": BOOK_FIELDS}


def norm_header(h):
    if h.strip() == "#":
        return "number"
    return re.sub(r"[^a-z0-9%]+", " ", h.lower()).strip()


def is_script_link(link):
    return "script.google.com/macros/s/" in (link or "")


# ---------------- CSV (published sheet, read only) ----------------

def csv_url(link, gid):
    """Accepts a normal sheet link or a 'Publish to web' link and returns a CSV export URL for one tab."""
    link = (link or DEFAULT_SHEET).strip()
    if not link:
        raise ValueError("no sheet link yet. Paste it in Settings to get started.")
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


# ---------------- parsing ----------------

def _date(v):
    m = DATE_RE.search(v or "")
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None


def _bool(v):
    return str(v).strip().upper() == "TRUE"


def _num(v):
    m = re.search(r"-?\d+(?:[.,]\d+)?", v or "")
    return float(m.group(0).replace(",", ".")) if m else None


def _header_index(rows, first=("Game", "Book")):
    for i, r in enumerate(rows[:10]):
        if r and r[0].strip() in first:
            return i
    raise ValueError("Couldn't find the header row (a row starting with 'Game').")


def _col(header):
    idx = {}
    for i, h in enumerate(header):
        idx.setdefault(norm_header(h), i)
    def get(row, *names):
        for n in names:
            i = idx.get(n)
            if i is not None and i < len(row):
                return str(row[i]).strip()
        return ""
    return get


def _table(rows):
    """CSV rows -> (header, [(sheet_row, values)])"""
    h = _header_index(rows)
    out = [(h + 2 + i, r) for i, r in enumerate(rows[h + 1:]) if r and str(r[0]).strip()]
    return rows[h], out


def parse_games(header, rows):
    get = _col(header)
    games = []
    for row_no, r in rows:
        hours_text = get(r, "hours")
        completed_raw = get(r, "completed")
        dropped_raw = get(r, "dropped")
        games.append({
            "id": len(games),
            "row": row_no,
            "name": str(r[0]).strip(),
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
            "upgrade": get(r, "upgrade"),
            "upgrade_owned": _bool(get(r, "upgrade owned")),
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
            "type": get(r, "type"),
        })
    return games


def parse_playthroughs(header, rows):
    get = _col(header)
    out = []
    for row_no, r in rows:
        out.append({
            "row": row_no,
            "game": str(r[0]).strip(),
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


def parse_books(header, rows):
    get = _col(header)
    out = []
    for row_no, r in rows:
        finished_raw = get(r, "finished")
        out.append({
            "id": len(out),
            "row": row_no,
            "name": str(r[0]).strip(),
            "author": get(r, "author"),
            "series": get(r, "series"),
            "number": int(_num(get(r, "number")) or 0) or None,
            "status": get(r, "status") or "To read",
            "priority": get(r, "priority"),
            "finished": _date(finished_raw),
            "format": get(r, "format"),
            "score": _num(get(r, "score")),
            "notes": get(r, "notes"),
            "store_link": get(r, "store link"),
        })
    return out


def options_for(tab, options):
    """Sheet dropdown options keyed by header -> keyed by app field."""
    fields = {v: k for k, v in TABS[tab].items()}
    out = {}
    for header, opts in (options or {}).items():
        f = fields.get(norm_header(header))
        if f:
            out[f] = opts
    return out


# ---------------- connection script (read + write) ----------------

class ScriptClient:
    def __init__(self, url, key=""):
        self.url = url.strip()
        self.key = key
        self.headers = {}  # tab -> raw header list

    def _call(self, params=None, body=None, timeout=45):
        url = self.url
        if params:
            url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Content-Type": "text/plain;charset=utf-8"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            text = r.read().decode("utf-8", errors="replace")
        if text.lstrip().startswith("<"):
            raise PermissionError("Google asked for a sign-in. In the script's deployment, set 'Who has access' to 'Anyone'.")
        out = json.loads(text)
        if out.get("error"):
            err = RuntimeError(out["error"])
            err.code = out.get("code")
            raise err
        return out

    def pair(self, name="", pub=""):
        """The first PC gets its key at once; any other PC gets a code to allow in the sheet's Masterlog PCs tab."""
        out = self._call(body={"action": "pair", "name": name, "pub": pub})
        if out.get("key"):
            self.key = out["key"]
        return out

    def device_poll(self, rid):
        out = self._call(body={"action": "device_poll", "id": rid})
        if out.get("key"):
            self.key = out["key"]
        return out

    def device_wrap(self, rid, blob):
        return self._call(body={"action": "device_wrap", "key": self.key, "id": rid, "blob": blob})

    def file_put(self, name, data_b64, mime):
        return self._call(body={"action": "file_put", "key": self.key, "name": name, "data": data_b64, "mime": mime}, timeout=180)

    def file_get(self, name):
        return self._call(body={"action": "file_get", "key": self.key, "name": name}, timeout=180)

    def read(self):
        out = self._call({"action": "read", "key": self.key})
        result = {"title": out.get("title", "")}
        for tab, parse in (("games", parse_games), ("plays", parse_playthroughs), ("books", parse_books)):
            t = out.get(tab)
            if not t:
                result[tab], result[tab + "_options"] = [], {}
                continue
            self.headers[tab] = t["headers"]
            rows = [(r["row"], r["values"]) for r in t["rows"]]
            result[tab] = parse(t["headers"], rows)
            result[tab + "_options"] = options_for(tab, t.get("options"))
        result["ranking"] = out.get("ranking")          # None when the script is older than the Ranking tab
        result["script_version"] = out.get("script") or 1
        return result

    def self_update(self, code, version):
        return self._call(body={"action": "self_update", "key": self.key, "code": code, "version": version}, timeout=120)

    def delete(self, tab, row, name):
        return self._call(body={"action": "delete", "key": self.key, "tab": tab, "row": row, "name": name})

    def restore(self, deleted):
        return self._call(body={"action": "restore", "key": self.key, "deleted": deleted})

    def state_get(self):
        return self._call(body={"action": "state_get", "key": self.key})

    def state_put(self, sections):
        return self._call(body={"action": "state_put", "key": self.key, "sections": sections})

    def rank(self, names):
        return self._call(body={"action": "rank", "key": self.key, "list": [{"game": n} for n in names]})

    def _to_headers(self, tab, changes):
        fields = TABS[tab]
        raw = {norm_header(h): h for h in self.headers.get(tab, [])}
        out = {}
        for field, value in changes.items():
            header = raw.get(fields.get(field, ""))
            if header is None:
                raise ValueError(f"The sheet has no column for {field.replace('_', ' ')}.")
            out[header] = value
        return out

    def update(self, tab, row, name, changes):
        return self._call(body={"action": "update", "key": self.key, "tab": tab, "row": row, "name": name,
                                "changes": self._to_headers(tab, changes)})

    def add(self, tab, values, finished_unknown=False):
        body = {"action": "add", "key": self.key, "tab": tab, "values": self._to_headers(tab, values)}
        if finished_unknown:
            body["finished_unknown"] = True   # script 7: keep "unknown date" instead of today's date
        return self._call(body=body)


def load_csv(link):
    """Read-only path for a published or link-shared sheet."""
    header, rows = _table(fetch_csv(csv_url(link, GAMES_GID)))
    result = {"games": parse_games(header, rows), "games_options": {}, "plays": [], "plays_options": {},
              "books": [], "books_options": {}, "title": ""}
    for tab, gid, parse in (("plays", PLAYTHROUGHS_GID, parse_playthroughs), ("books", BOOKS_GID, parse_books)):
        try:
            h, r = _table(fetch_csv(csv_url(link, gid)))
            result[tab] = parse(h, r)
        except Exception:
            pass
    return result
