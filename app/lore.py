"""What the Wiki tab and the awards show: Wikipedia, PCGamingWiki, Steam Deck and ProtonDB, and the real-world awards
a game won or was nominated for (The Game Awards first, then the Golden Joysticks, BAFTA and the Steam Awards).

Wikipedia and PCGamingWiki turn away apps that pretend to be a browser, so those requests say who they are."""
import html
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

from art import _norm, similar

try:
    from version import VERSION
except Exception:  # pragma: no cover
    VERSION = "dev"

WIKI_UA = f"Masterlog/{VERSION} (https://github.com/Breakinger/game-backlog; personal game library app)"
BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
WP_API = "https://en.wikipedia.org/w/api.php?format=json&formatversion=2&redirects=1&"
PCGW_API = "https://www.pcgamingwiki.com/w/api.php?format=json&formatversion=2&redirects=1&"


def _get(url, ua=WIKI_UA, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept-Language": "en-US,en;q=0.9", "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace"), r.geturl()


def _json(url, ua=WIKI_UA, timeout=15):
    return json.loads(_get(url, ua, timeout)[0])


def _q(s):
    return urllib.parse.quote(str(s).replace(" ", "_"), safe="_()'!,:")


# ---------------- Wikipedia ----------------

def wikipedia(query, hint="video game"):
    """The best-matching article's summary, or None when there's no good match. Network errors are raised,
    so a hiccup isn't remembered as 'no article'."""
    s = _json(WP_API + "action=query&list=search&srlimit=6&srsearch=" + urllib.parse.quote(f"{query} {hint}"))
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
    sm = _json("https://en.wikipedia.org/api/rest_v1/page/summary/" + _q(best["title"]))
    if sm.get("type") == "disambiguation":
        return None
    return {"title": sm.get("title"), "extract": sm.get("extract"), "description": sm.get("description"),
            "url": ((sm.get("content_urls") or {}).get("desktop") or {}).get("page"),
            "thumb": (sm.get("thumbnail") or {}).get("source"), "image": (sm.get("originalimage") or {}).get("source")}


SKIP_SECTIONS = re.compile(r"^(references|external links|see also|notes|further reading|citations|bibliography|sources|footnotes|works cited)$", re.I)
SPOILER_SECTIONS = re.compile(r"plot|synopsis|story|ending", re.I)
INFOBOX_KEEP = ("developer", "publisher", "director", "producer", "designer", "programmer", "artist", "writer", "composer",
                "series", "engine", "platform", "release", "genre", "mode")


def article(title):
    """The article split into readable sections (lead, gameplay, plot, development, reception…) plus the infobox facts."""
    d = _json(WP_API + "action=query&prop=extracts&explaintext=1&exsectionformat=wiki&titles=" + urllib.parse.quote(title))
    page = ((d.get("query") or {}).get("pages") or [{}])[0]
    text = page.get("extract") or ""
    parts = re.split(r"^(={2,6})\s*(.+?)\s*\1\s*$", text, flags=re.M)
    lead, sections = parts[0].strip(), []
    for i in range(1, len(parts) - 2, 3):
        level, head, body = len(parts[i]), parts[i + 1].strip(), parts[i + 2].strip()
        if level == 2:
            sections.append({"title": head, "text": body, "spoiler": bool(SPOILER_SECTIONS.search(head))})
        elif sections:
            sections[-1]["text"] += f"\n\n{head}\n{body}" if body else ""
    sections = [s for s in sections if not SKIP_SECTIONS.match(s["title"]) and s["text"].strip()]
    for s in sections:
        s["text"] = re.sub(r"\n{3,}", "\n\n", s["text"]).strip()[:7000]
    facts = []
    try:
        p = _json(WP_API + "action=parse&prop=text&section=0&page=" + urllib.parse.quote(title))
        tables = _Tables()
        tables.feed((p.get("parse") or {}).get("text") or "")
        for t in tables.tables:
            rows = [(r[0]["text"], r[1]["text"]) for r in t if len(r) == 2 and r[0]["th"] and not r[1]["th"]]
            hits = [(k, v) for k, v in rows if any(w in k.lower() for w in INFOBOX_KEEP)]
            if len(hits) >= 2:
                facts = [{"label": re.sub(r"\(s\)", "s", k), "value": v[:220]} for k, v in hits]
                break
    except Exception:
        pass
    return {"lead": lead[:4000], "sections": sections[:14], "facts": facts}


# ---------------- PCGamingWiki ----------------

def _balanced(text, start):
    """The text of the {{template}} that opens at start, braces and links balanced."""
    depth, i = 0, start
    while i < len(text):
        two = text[i:i + 2]
        if two == "{{":
            depth += 1
            i += 2
            continue
        if two == "}}":
            depth -= 1
            i += 2
            if depth == 0:
                return text[start + 2:i - 2]
            continue
        i += 1
    return text[start + 2:]


def _split_params(body):
    """Top-level | parameters of a template body."""
    out, depth, cur, i = [], 0, "", 0
    while i < len(body):
        two = body[i:i + 2]
        if two in ("{{", "[["):
            depth += 1
            cur += two
            i += 2
            continue
        if two in ("}}", "]]"):
            depth -= 1
            cur += two
            i += 2
            continue
        if body[i] == "|" and depth == 0:
            out.append(cur)
            cur = ""
        else:
            cur += body[i]
        i += 1
    out.append(cur)
    return out


def _template(wikitext, name):
    m = re.search(r"\{\{\s*" + re.escape(name) + r"\s*(?=[\n|}])", wikitext, re.I)
    if not m:
        return {}
    params = {}
    for p in _split_params(_balanced(wikitext, m.start()))[1:]:
        if "=" in p:
            k, v = p.split("=", 1)
            params[k.strip().lower()] = v.strip()
    return params


PATH_TOKENS = {"appdata": "%APPDATA%", "localappdata": "%LOCALAPPDATA%", "userprofile": "%USERPROFILE%",
               "userprofile\\documents": "%USERPROFILE%\\Documents", "userprofile\\appdata\\locallow": "%USERPROFILE%\\AppData\\LocalLow",
               "programdata": "%PROGRAMDATA%", "public": "%PUBLIC%", "windir": "%WINDIR%", "game": "<game folder>",
               "steam": "<Steam folder>", "uid": "<user id>", "username": "%USERNAME%", "osxhome": "~", "linuxhome": "~",
               "xdgdatahome": "~/.local/share", "xdgconfighome": "~/.config", "hkcu": "HKEY_CURRENT_USER", "hklm": "HKEY_LOCAL_MACHINE",
               "wow64": "WOW6432Node"}


def _wikiplain(s):
    s = re.sub(r"<ref[^>]*/>|<ref[^>]*>.*?</ref>", "", s or "", flags=re.S)
    s = re.sub(r"</?[a-z][^>]*>", " ", s)
    s = re.sub(r"\{\{\s*p\s*\|\s*([^}]+?)\s*\}\}", lambda m: PATH_TOKENS.get(m.group(1).lower(), "<" + m.group(1) + ">"), s, flags=re.I)
    s = re.sub(r"\{\{\s*(?:file|code|term|key|keys)\s*\|([^}]*)\}\}", lambda m: m.group(1).split("|")[0], s, flags=re.I)
    s = re.sub(r"\{\{[^{}]*\}\}", "", s)
    s = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]+)\]\]", r"\1", s)
    s = re.sub(r"\[https?://\S+\s+([^\]]+)\]", r"\1", s)
    s = re.sub(r"'{2,}", "", s)
    return html.unescape(re.sub(r"\s+", " ", s)).strip()


VALUE = {"true": "yes", "false": "no", "hackable": "fixable", "limited": "limited", "always on": "always on", "complete": "yes",
         "partial": "limited"}
VIDEO = (("ultrawidescreen", "Ultrawide"), ("4k ultra hd", "4K"), ("hdr", "HDR"), ("120 fps", "High frame rate"),
         ("60 fps", "60 FPS"), ("fov", "Field of view slider"), ("borderless windowed", "Borderless window"),
         ("upscaling", "Upscaling (DLSS, FSR, XeSS)"), ("ray tracing", "Ray tracing"))
INPUT = (("controller support", "Controller"), ("full controller", "Full controller support"),
         ("playstation controllers", "PlayStation controllers"), ("key remapping", "Key remapping"))


def _facts(params, wanted):
    out = []
    for key, label in wanted:
        v = (params.get(key) or "").strip().lower()
        if v not in VALUE:
            continue
        note = _wikiplain(params.get(key + " notes") or "")
        out.append({"label": label, "value": VALUE[v], "note": note[:200]})
    return out


def _data_paths(wikitext, kind):
    out = {}
    for m in re.finditer(r"\{\{\s*Game data/" + kind + r"\s*\|", wikitext, re.I):
        parts = _split_params(_balanced(wikitext, m.start()))
        if len(parts) < 3:
            continue
        plat = _wikiplain(parts[1])
        paths = [_wikiplain(p) for p in parts[2:] if _wikiplain(p)]
        if plat and paths:
            out.setdefault(plat, [])
            out[plat] += [p for p in paths if p not in out[plat]]
    return out


def pcgw(appid, name):
    """Fixes, settings support and where saves live, from the game's PCGamingWiki page."""
    title = None
    if appid:
        try:
            _, final = _get(f"https://www.pcgamingwiki.com/api/appid.php?appid={int(appid)}")
            if "/wiki/" in final:
                title = urllib.parse.unquote(final.split("/wiki/", 1)[1].split("#")[0]).replace("_", " ")
        except urllib.error.HTTPError:
            title = None
    if not title:
        s = _json(PCGW_API + "action=query&list=search&srlimit=5&srsearch=" + urllib.parse.quote(name))
        hits = (s.get("query") or {}).get("search") or []
        best = max(hits, key=lambda h: similar(name, h.get("title", "")), default=None)
        if not best or similar(name, best["title"]) < 0.8:
            return None
        title = best["title"]
    d = _json(PCGW_API + "action=parse&prop=wikitext|sections&page=" + urllib.parse.quote(title))
    if "error" in d:
        return None
    p = d.get("parse") or {}
    wt, secs = p.get("wikitext") or "", p.get("sections") or []
    url = "https://www.pcgamingwiki.com/wiki/" + _q(p.get("title") or title)

    def children(head):
        out, inside, lvl = [], False, None
        for s in secs:
            line = _wikiplain(s.get("line", ""))
            if not inside and line.lower() == head:
                inside, lvl = True, int(s.get("toclevel", 1))
                continue
            if inside:
                if int(s.get("toclevel", 1)) <= lvl:
                    break
                if int(s.get("toclevel", 1)) == lvl + 1:
                    out.append({"title": line, "url": url + "#" + s.get("anchor", "")})
        return out[:12]
    return {"title": p.get("title") or title, "url": url,
            "fixes": children("essential improvements"), "issues": children("issues fixed"), "unresolved": children("issues unresolved"),
            "video": _facts(_template(wt, "Video"), VIDEO), "input": _facts(_template(wt, "Input"), INPUT),
            "saves": _data_paths(wt, "saves"), "config": _data_paths(wt, "config")}


# ---------------- Steam Deck and Proton ----------------

DECK = {1: "Unsupported", 2: "Playable", 3: "Verified"}


def deck(appid):
    out = {}
    try:
        r = _json(f"https://store.steampowered.com/saleaction/ajaxgetdeckappcompatibilityreport?nAppID={int(appid)}&l=english", BROWSER_UA)
        cat = ((r or {}).get("results") or {}).get("resolved_category")
        if cat in DECK:
            out["deck"] = DECK[cat]
    except Exception:
        pass
    try:
        r = _json(f"https://www.protondb.com/api/v1/reports/summaries/{int(appid)}.json", BROWSER_UA)
        if r.get("tier") and r["tier"] != "pending":
            out["proton"] = r["tier"]
            out["proton_url"] = f"https://www.protondb.com/app/{int(appid)}"
    except Exception:
        pass
    return out or None


# ---------------- tables in Wikipedia pages ----------------

class _Tables(HTMLParser):
    """Rows of every top-level table: [(text, rowspan, colspan, is_header), ...]."""
    def __init__(self):
        super().__init__()
        self.tables, self.depth, self.cell, self.row, self.skip = [], 0, None, None, 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table":
            self.depth += 1
            if self.depth == 1:
                self.tables.append([])
        elif self.depth == 1 and tag == "tr":
            self.row = []
        elif self.depth == 1 and tag in ("td", "th") and self.row is not None:
            def num(k):
                try:
                    return max(1, int(re.sub(r"\D", "", a.get(k) or "1") or 1))
                except ValueError:
                    return 1
            self.cell = {"text": "", "rs": num("rowspan"), "cs": num("colspan"), "th": tag == "th"}
        elif tag in ("sup", "style", "script"):
            self.skip += 1
        elif tag in ("br", "li") and self.cell is not None:
            self.cell["text"] += ", " if tag == "li" and self.cell["text"].strip() else " "

    def handle_endtag(self, tag):
        if tag == "table":
            self.depth -= 1
        elif tag in ("sup", "style", "script") and self.skip:
            self.skip -= 1
        elif self.depth == 1 and tag in ("td", "th") and self.cell is not None and self.row is not None:
            self.cell["text"] = re.sub(r"\s+", " ", self.cell["text"]).strip(" ,")
            self.row.append(self.cell)
            self.cell = None
        elif self.depth == 1 and tag == "tr" and self.row is not None:
            if self.row:
                self.tables[-1].append(self.row)
            self.row = None

    def handle_data(self, data):
        if self.cell is not None and not self.skip:
            self.cell["text"] += data


def _grid(rows):
    """Expand rowspan/colspan so every row has its full set of columns."""
    out, carry = [], {}
    for row in rows:
        cells, col = [], 0
        pending = list(row)
        while pending or col in carry:
            if col in carry:
                text, left = carry[col]
                cells.append(text)
                if left <= 1:
                    del carry[col]
                else:
                    carry[col] = (text, left - 1)
                col += 1
                continue
            c = pending.pop(0)
            for _ in range(c["cs"]):
                cells.append(c["text"])
                if c["rs"] > 1:
                    carry[col] = (c["text"], c["rs"] - 1)
                col += 1
        out.append(cells)
    return out


class _Ceremony(HTMLParser):
    """Award pages ('The Game Awards 2022', 'Steam Awards'): every category cell with its winner and nominees.
    The winner is the bold (or ‡-marked) entry; on pages that put the category in a header row, it's the bold lead."""
    def __init__(self):
        super().__init__()
        self.depth, self.heading, self.in_head, self.year = 0, "", False, ""
        self.headers, self.col, self.cell, self.li, self.bold, self.skip = [], 0, None, [], 0, 0
        self.cells = []

    def handle_starttag(self, tag, attrs):
        if tag in ("h2", "h3", "h4"):
            self.in_head, self.heading = True, ""
        elif tag == "table":
            self.depth += 1
            if self.depth == 1:
                y = re.search(r"(19|20)\d\d", self.heading)
                self.year, self.headers = (y.group(0) if y else ""), []
        elif self.depth == 1 and tag == "tr":
            self.col, self.row_th = 0, []
        elif self.depth == 1 and tag in ("td", "th"):
            self.cell = {"th": tag == "th", "lead": "", "lead_bold": "", "items": [], "col": self.col}
        elif tag in ("sup", "style", "script"):
            self.skip += 1
        elif tag in ("b", "strong"):
            self.bold += 1
        elif tag == "li" and self.cell is not None:
            # the winner's entry holds the nominees in a list of its own: keep them in page order, winner first
            item = {"text": "", "bold": False}
            self.cell["items"].append(item)
            self.li.append(item)

    def handle_endtag(self, tag):
        if tag in ("h2", "h3", "h4"):
            self.in_head = False
        elif tag == "table":
            self.depth -= 1
        elif tag in ("sup", "style", "script") and self.skip:
            self.skip -= 1
        elif tag in ("b", "strong") and self.bold:
            self.bold -= 1
        elif tag == "li" and self.li and self.cell is not None:
            item = self.li.pop()
            item["text"] = re.sub(r"\s+", " ", item["text"]).strip()
        elif self.depth == 1 and tag in ("td", "th") and self.cell is not None:
            c = self.cell
            c["lead"] = re.sub(r"\s+", " ", c["lead"]).strip()
            c["items"] = [i for i in c["items"] if i["text"]]
            if c["th"]:
                # 'The "Game of the Year" Award' is the Game of the Year category
                self.row_th.append(re.sub(r'^the\s+["“]?|["”]?\s+award$', "", c["lead"], flags=re.I).strip('"“” '))
            else:
                c["year"] = self.year
                c["header"] = self.headers[c["col"]] if c["col"] < len(self.headers) else ""
                self.cells.append(c)
            self.col += 1
            self.cell = None
        elif self.depth == 1 and tag == "tr":
            if getattr(self, "row_th", None):
                self.headers = self.row_th

    def handle_data(self, data):
        if self.in_head:
            self.heading += data
        if self.skip or self.cell is None:
            return
        if self.li:
            self.li[-1]["text"] += data
            if self.bold and data.strip():
                self.li[-1]["bold"] = True
        else:
            self.cell["lead"] += data
            if self.bold:
                self.cell["lead_bold"] += data


def _entry_name(text):
    t = re.sub(r"[‡†*]", "", text)
    return re.split(r"\s+[–—-]\s+", t)[0].strip(" ;,")


def _same_game(a, b):
    return _norm(a) == _norm(b) or similar(a, b) >= 0.9


def _ceremony_hits(text, name, ceremony):
    p = _Ceremony()
    p.feed(text)
    out = []
    for c in p.cells:
        items = c["items"]
        if not items:
            continue
        if c["header"] and c["lead"]:
            # category in a header row, winner as the cell's lead, nominees listed under it
            category, winner = c["header"], c["lead"]
            entries = [(winner, True)] + [(i["text"], False) for i in items]
        else:
            category = c["lead"] or c["header"]
            entries = [(i["text"], i["bold"] or "‡" in i["text"]) for i in items]
        if not category:
            continue
        for text, won in entries:
            if _same_game(_entry_name(text), name):
                out.append({"ceremony": ceremony, "category": category.strip(" :"), "year": c["year"], "won": won})
                break
    return out


CEREMONIES = (("tga", "The Game Awards", re.compile(r"^\s*(the\s+)?game awards(\s+\d{4})?\s*$|\bthe game awards\b", re.I)),
              ("gj", "Golden Joystick Awards", re.compile(r"golden joystick", re.I)),
              ("bafta", "BAFTA Games Awards", re.compile(r"british academy|bafta", re.I)),
              ("steam", "The Steam Awards", re.compile(r"steam awards?", re.I)))


def _which(award):
    for key, _, rx in CEREMONIES:
        if rx.search(award or ""):
            return key
    return None


def _accolade_rows(text):
    """Rows of an accolades table: (ceremony, category, year, won)."""
    p = _Tables()
    p.feed(text)
    out = []
    for t in p.tables:
        if len(t) < 2:
            continue
        head = [c["text"].lower() for c in t[0]]

        def idx(*words):
            for i, h in enumerate(head):
                if any(w in h for w in words):
                    return i
            return None
        ri, ai, ci, yi = idx("result"), idx("award", "ceremony", "event", "organization"), idx("category"), idx("year", "date")
        if ri is None or ai is None:
            continue
        for r in _grid(t[1:]):
            if len(r) <= ri:
                continue
            res = r[ri]
            won = bool(re.search(r"\bwon\b", res, re.I))
            if not won and not re.search(r"nominat", res, re.I):
                continue
            get = lambda i: r[i] if i is not None and i < len(r) else ""
            key = _which(get(ai))
            if not key:
                continue
            y = re.search(r"(19|20)\d\d", get(yi) + " " + get(ai))
            out.append({"ceremony": key, "category": get(ci) or "", "year": y.group(0) if y else "", "won": won})
    return out


def _accolades_page(title, url):
    """The accolades rows from 'List of accolades received by …' or the article's own Accolades section."""
    d = _json(WP_API + "action=parse&prop=text&page=" + urllib.parse.quote("List of accolades received by " + title))
    if "error" not in d:
        rows = _accolade_rows((d.get("parse") or {}).get("text") or "")
        if rows:
            return rows, "https://en.wikipedia.org/wiki/" + _q("List of accolades received by " + title)
    secs = (_json(WP_API + "action=parse&prop=sections&page=" + urllib.parse.quote(title)).get("parse") or {}).get("sections") or []
    rows, where = [], url
    for sec in secs:
        if re.search(r"accolades|awards", sec.get("line", ""), re.I):
            text = (_json(WP_API + f"action=parse&prop=text&section={sec['index']}&page=" + urllib.parse.quote(title)).get("parse") or {}).get("text") or ""
            rows += _accolade_rows(text)
            where = (url or "") + "#" + sec.get("anchor", "Accolades")
    return rows, where


def awards(name, year=None):
    """Wins and nominations at The Game Awards, the Golden Joysticks, BAFTA and the Steam Awards."""
    w = wikipedia(name)
    if not w or not w.get("title"):
        return {"ceremonies": [], "wins": 0, "noms": 0, "goty": 0, "url": None}
    rows, url = _accolades_page(w["title"], w.get("url"))
    years = {int(r["year"]) for r in rows if r["year"]}
    if year:
        years.add(int(year))
    if not years:
        y = re.search(r"\b(19[89]\d|20\d\d)\b", w.get("extract") or "")
        if y:
            years.add(int(y.group(1)))
    first = min(years) if years else None
    # The Game Awards pages, the year it came out and the year after (late releases are judged the following December)
    if first and first >= 2014:
        for y in (first, first + 1):
            try:
                d = _json(WP_API + "action=parse&prop=text&page=" + urllib.parse.quote(f"The Game Awards {y}"))
                if "error" not in d:
                    for h in _ceremony_hits((d.get("parse") or {}).get("text") or "", name, "tga"):
                        h["year"] = str(y)
                        rows.append(h)
            except Exception:
                pass
    if first and first >= 2015:
        try:
            d = _json(WP_API + "action=parse&prop=text&page=" + urllib.parse.quote("Steam Awards"))
            if "error" not in d:
                rows += [h for h in _ceremony_hits((d.get("parse") or {}).get("text") or "", name, "steam")
                         if not h["year"] or abs(int(h["year"]) - first) <= 2]
        except Exception:
            pass
    merged = {}
    for r in rows:
        k = (r["ceremony"], _norm(r["category"]), r["year"])
        if k not in merged or (r["won"] and not merged[k]["won"]):
            merged[k] = r
    out = []
    for key, label, _ in CEREMONIES:
        mine = [r for r in merged.values() if r["ceremony"] == key]
        if not mine:
            continue
        order = lambda r: (not re.search(r"game of the year", r["category"], re.I), r["year"], r["category"])
        out.append({"key": key, "name": label,
                    "wins": [{"category": r["category"], "year": r["year"]} for r in sorted(mine, key=order) if r["won"]],
                    "noms": [{"category": r["category"], "year": r["year"]} for r in sorted(mine, key=order) if not r["won"]]})
    wins = sum(len(c["wins"]) for c in out)
    goty = sum(1 for c in out for x in c["wins"] if re.search(r"game of the year", x["category"], re.I))
    return {"ceremonies": out, "wins": wins, "noms": sum(len(c["noms"]) for c in out), "goty": goty, "url": url, "source": "Wikipedia"}
