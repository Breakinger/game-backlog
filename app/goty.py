"""Game of the Year, year by year: The Game Awards (the official one), the Golden Joystick Awards' Ultimate Game of the
Year, BAFTA's Best Game and the Steam Awards' Game of the Year.

The list below is checked by hand (against Wikipedia, BAFTA's and Steam's own pages) and is what Masterlog trusts.
Once a week it also reads the same Wikipedia pages to pick up winners announced since, like a December ceremony;
those only ever fill in years the list doesn't settle, so a misread page can never change a confirmed winner.

Years are the year the games came out, which is how The Game Awards, the Golden Joysticks and the Steam Awards
already count. BAFTA holds its ceremony the following spring, so its winners are filed under the year before."""
import json
import os
import re
import threading
import time
import urllib.parse
from html.parser import HTMLParser

TGA = {
    2014: ("Dragon Age: Inquisition", ["Bayonetta 2", "Dark Souls II", "Hearthstone", "Middle-earth: Shadow of Mordor"]),
    2015: ("The Witcher 3: Wild Hunt", ["Bloodborne", "Fallout 4", "Metal Gear Solid V: The Phantom Pain", "Super Mario Maker"]),
    2016: ("Overwatch", ["Doom", "Inside", "Titanfall 2", "Uncharted 4: A Thief's End"]),
    2017: ("The Legend of Zelda: Breath of the Wild", ["Horizon Zero Dawn", "Persona 5", "PlayerUnknown's Battlegrounds", "Super Mario Odyssey"]),
    2018: ("God of War", ["Assassin's Creed Odyssey", "Celeste", "Marvel's Spider-Man", "Monster Hunter: World", "Red Dead Redemption 2"]),
    2019: ("Sekiro: Shadows Die Twice", ["Control", "Death Stranding", "Resident Evil 2", "Super Smash Bros. Ultimate", "The Outer Worlds"]),
    2020: ("The Last of Us Part II", ["Animal Crossing: New Horizons", "Doom Eternal", "Final Fantasy VII Remake", "Ghost of Tsushima", "Hades"]),
    2021: ("It Takes Two", ["Deathloop", "Metroid Dread", "Psychonauts 2", "Ratchet & Clank: Rift Apart", "Resident Evil Village"]),
    2022: ("Elden Ring", ["A Plague Tale: Requiem", "God of War Ragnarök", "Horizon Forbidden West", "Stray", "Xenoblade Chronicles 3"]),
    2023: ("Baldur's Gate 3", ["Alan Wake 2", "The Legend of Zelda: Tears of the Kingdom", "Marvel's Spider-Man 2", "Resident Evil 4", "Super Mario Bros. Wonder"]),
    2024: ("Astro Bot", ["Balatro", "Black Myth: Wukong", "Elden Ring: Shadow of the Erdtree", "Final Fantasy VII Rebirth", "Metaphor: ReFantazio"]),
    2025: ("Clair Obscur: Expedition 33", ["Death Stranding 2: On the Beach", "Donkey Kong Bananza", "Hades II", "Hollow Knight: Silksong", "Kingdom Come: Deliverance II"]),
    2026: (None, ["007 First Light", "Control Resonant", "Grand Theft Auto VI", "The Legend of Zelda: Ocarina of Time", "Phantom Blade Zero", "Resident Evil Requiem"]),
}
# Golden Joystick Awards, Ultimate Game of the Year (some early years gave one per kind of machine)
GOLDEN_JOYSTICK = {
    1983: ["Jetpac"], 1984: ["Knight Lore"], 1985: ["The Way of the Exploding Fist"], 1986: ["Gauntlet"], 1987: ["Out Run"],
    1988: ["Operation Wolf", "Speedball", "Thunder Blade"], 1989: ["The Untouchables", "Kick Off"],
    1990: ["Rick Dangerous 2", "Kick Off 2", "Mega Man", "John Madden Football"], 1991: ["Sonic the Hedgehog"], 1992: ["Street Fighter II"],
    1994: ["Super Mario All-Stars", "The Legend of Zelda: Link's Awakening"], 1996: ["Super Mario 64"],
    2002: ["Grand Theft Auto III"], 2003: ["Grand Theft Auto: Vice City"], 2004: ["Doom 3"], 2005: ["Grand Theft Auto: San Andreas"],
    2006: ["The Elder Scrolls IV: Oblivion"], 2007: ["Gears of War"], 2008: ["Call of Duty 4: Modern Warfare"], 2009: ["Fallout 3"],
    2010: ["Mass Effect 2"], 2011: ["Portal 2"], 2012: ["The Elder Scrolls V: Skyrim"], 2013: ["Grand Theft Auto V"], 2014: ["Dark Souls II"],
    2015: ["The Witcher 3: Wild Hunt"], 2016: ["Dark Souls III"], 2017: ["The Legend of Zelda: Breath of the Wild"],
    2018: ["Fortnite Battle Royale"], 2019: ["Resident Evil 2"], 2020: ["The Last of Us Part II"], 2021: ["Resident Evil Village"],
    2022: ["Elden Ring"], 2023: ["Baldur's Gate 3"], 2024: ["Black Myth: Wukong"], 2025: ["Clair Obscur: Expedition 33"],
    2026: ["Resident Evil Requiem"],
}
# BAFTA Games Awards, Best Game (filed under the year the games came out; no award in the 2006 ceremony)
BAFTA = {
    2003: "Call of Duty", 2004: "Half-Life 2", 2006: "Tom Clancy's Ghost Recon Advanced Warfighter", 2007: "BioShock",
    2008: "Super Mario Galaxy", 2009: "Batman: Arkham Asylum", 2010: "Mass Effect 2", 2011: "Portal 2", 2012: "Dishonored",
    2013: "The Last of Us", 2014: "Destiny", 2015: "Fallout 4", 2016: "Uncharted 4: A Thief's End", 2017: "What Remains of Edith Finch",
    2018: "God of War", 2019: "Outer Wilds", 2020: "Hades", 2021: "Returnal", 2022: "Vampire Survivors", 2023: "Baldur's Gate 3",
    2024: "Astro Bot", 2025: "Clair Obscur: Expedition 33",
}
# The Steam Awards, Game of the Year (the category started in 2018)
STEAM = {
    2018: "PlayerUnknown's Battlegrounds", 2019: "Sekiro: Shadows Die Twice", 2020: "Red Dead Redemption 2", 2021: "Resident Evil Village",
    2022: "Elden Ring", 2023: "Baldur's Gate 3", 2024: "Black Myth: Wukong", 2025: "Hollow Knight: Silksong",
}

WP = "https://en.wikipedia.org/w/api.php?format=json&formatversion=2&redirects=1&action=parse&prop=text&page="
PAGES = {"tga": "The Game Award for Game of the Year", "gj": "Golden Joystick Award for Ultimate Game of the Year",
         "bafta": "British Academy Games Award for Best Game", "steam": "Steam Awards"}
WEEK = 7 * 86400


class _Rows(HTMLParser):
    """Every table row of a page: its cells' text, and whether the row or a cell is marked as the winner
    (Wikipedia's gold background, bold game title, or a double dagger)."""
    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell, self.depth, self.skip, self.bold = [], None, None, 0, 0, 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        style = (a.get("style") or "").lower()
        if tag == "table":
            self.depth += 1
        elif tag == "tr" and self.depth == 1:
            self.row = {"cells": [], "win": "background" in style and "faeb86" in style}
        elif tag in ("td", "th") and self.row is not None and self.depth == 1:
            rs = re.sub(r"\D", "", a.get("rowspan") or "1") or "1"
            self.cell = {"text": "", "th": tag == "th", "rs": int(rs), "win": "faeb86" in style, "bold": ""}
        elif tag in ("sup", "style", "script"):
            self.skip += 1
        elif tag in ("b", "strong"):
            self.bold += 1
        elif tag == "br" and self.cell is not None:
            self.cell["text"] += "\n"

    def handle_endtag(self, tag):
        if tag == "table":
            self.depth -= 1
        elif tag in ("sup", "style", "script") and self.skip:
            self.skip -= 1
        elif tag in ("b", "strong") and self.bold:
            self.bold -= 1
        elif tag in ("td", "th") and self.cell is not None and self.row is not None:
            self.cell["text"] = self.cell["text"].strip()
            self.row["cells"].append(self.cell)
            self.cell = None
        elif tag == "tr" and self.row is not None:
            if self.row["cells"]:
                self.rows.append(self.row)
            self.row = None

    def handle_data(self, data):
        if self.cell is None or self.skip:
            return
        self.cell["text"] += data
        if self.bold:
            self.cell["bold"] += data


def _clean(name):
    return re.sub(r"\s+", " ", re.sub(r"[‡†*§]|\(.*?\)", "", name or "")).strip(" ;,")


def _year(text):
    m = re.search(r"\b(19[89]\d|20\d\d)\b", text or "")
    return int(m.group(1)) if m else None


def parse_tga(html):
    """{year: (winner or None, [nominees])} from the Game of the Year page: a year cell spanning that year's rows,
    the winner first and highlighted."""
    p = _Rows()
    p.feed(html)
    out, year, left = {}, None, 0
    for r in p.rows:
        cells = r["cells"]
        if not cells or all(c["th"] for c in cells):
            continue
        first = cells[0]
        y = _year(first["text"]) if left <= 0 else None
        if y and len(cells) >= 2:
            year, left = y, first["rs"]
            cells = cells[1:]
        if year is None:
            continue
        left -= 1
        game_cell = cells[0]
        name = _clean(game_cell["text"].split("\n")[0])
        if not name:
            continue
        won = r["win"] or game_cell["win"] or "‡" in game_cell["text"]
        w, noms = out.get(year, (None, []))
        if won and not w:
            w = name
        elif name != w:
            noms = noms + [name]
        out[year] = (w, noms)
    return out


def parse_winners(html, all_win=False):
    """{year: [winners]} from a list page (Golden Joystick: every row is a winner; BAFTA: only the highlighted ones)."""
    p = _Rows()
    p.feed(html)
    out, year, left = {}, None, 0
    for r in p.rows:
        cells = r["cells"]
        if not cells or all(c["th"] for c in cells):
            continue
        y = _year(cells[0]["text"]) if left <= 0 else None
        if y and len(cells) >= 2:
            year, left = y, cells[0]["rs"]
            cells = cells[1:]
        if year is None:
            continue
        left -= 1
        name = _clean(cells[0]["text"].split("\n")[0])
        won = all_win or r["win"] or cells[0]["win"] or "‡" in cells[0]["text"]
        if name and won:
            out.setdefault(year, [])
            if name not in out[year]:
                out[year].append(name)
    return out


ROMAN = {"ii": "2", "iii": "3", "iv": "4", "v": "5", "vi": "6", "vii": "7", "viii": "8", "ix": "9", "x": "10"}


def _key(name):
    """'The Legend of Zelda: Breath of the Wild' and 'Legend of Zelda - Breath of the Wild' are the same key."""
    n = re.sub(r"[™®©]", "", (name or "").lower()).replace("&", " and ")
    n = re.sub(r"^(tom clancy'?s|marvel'?s|sid meier'?s)\s+", "", n)
    words = [ROMAN.get(w, w) for w in re.sub(r"[^a-z0-9]+", " ", n).split() if w != "the"]
    return " ".join(words)


class Goty:
    def __init__(self, data_dir, fetch_json):
        self.path = os.path.join(data_dir, "goty.json")
        self.fetch = fetch_json          # fetch_json(url) -> dict, with Masterlog's Wikipedia user agent
        self.lock = threading.Lock()
        self.busy = False
        try:
            with open(self.path, encoding="utf-8") as f:
                self.live = json.load(f)
        except (OSError, ValueError):
            self.live = {"t": 0, "tga": {}, "gj": {}, "bafta": {}, "steam": {}}

    def _page(self, key):
        d = self.fetch(WP + urllib.parse.quote(PAGES[key]))
        return ((d or {}).get("parse") or {}).get("text") or ""

    def refresh(self):
        if self.busy:
            return
        self.busy = True
        try:
            live = {"t": time.time(), "tga": {}, "gj": {}, "bafta": {}, "steam": {}}
            try:
                live["tga"] = {str(y): [w, n] for y, (w, n) in parse_tga(self._page("tga")).items()}
            except Exception:
                live["tga"] = self.live.get("tga", {})
            for key, all_win in (("gj", True), ("bafta", False)):
                try:
                    live[key] = {str(y): v for y, v in parse_winners(self._page(key), all_win).items()}
                except Exception:
                    live[key] = self.live.get(key, {})
            live["steam"] = self.live.get("steam", {})
            try:
                import lore   # the Steam Awards page lists every category; the Game of the Year winner comes first
                p = lore._Ceremony()
                p.feed(self._page("steam"))
                for c in p.cells:
                    cat = (c["lead"] or c["header"] or "")
                    if re.fullmatch(r"\s*game of the year\s*", cat, re.I) and c["items"] and c["year"]:
                        live["steam"][str(c["year"])] = _clean(c["items"][0]["text"])
            except Exception:
                pass
            with self.lock:
                self.live = live
                tmp = self.path + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(live, f)
                os.replace(tmp, self.path)
        finally:
            self.busy = False

    def year_of(self, name):
        """The year a game came out, when it was up for The Game Awards' Game of the Year (those line-ups are by
        release year, so they settle ports and re-releases: Red Dead Redemption 2 is 2018, not its 2019 PC port)."""
        k = _key(name)
        for y, (w, noms) in TGA.items():
            if k in {_key(w)} | {_key(n) for n in noms}:
                return y
        for y, v in (self.live.get("tga") or {}).items():
            if v and k in {_key(v[0])} | {_key(n) for n in (v[1] or [])}:
                return int(y)
        return None

    def table(self):
        """Every year, newest first: {year, tga: {winner, nominees}, gj: [...], bafta, steam}. Refreshes weekly."""
        if time.time() - (self.live.get("t") or 0) > WEEK and not self.busy:
            threading.Thread(target=self.refresh, daemon=True).start()
        live = self.live
        years = set(TGA) | set(GOLDEN_JOYSTICK) | set(BAFTA) | set(STEAM)
        for k in ("tga", "gj", "bafta", "steam"):
            years |= {int(y) for y in (live.get(k) or {}) if str(y).isdigit() and 1980 < int(y) < 2100}
        out = []
        for y in sorted(years, reverse=True):
            w, noms = TGA.get(y, (None, []))
            lt = (live.get("tga") or {}).get(str(y))
            if lt and not w and lt[0]:
                w = lt[0]                                    # announced since this list was made
            if lt and not noms and lt[1]:
                noms = lt[1]
            gj = GOLDEN_JOYSTICK.get(y) or (live.get("gj") or {}).get(str(y)) or []
            bafta = BAFTA.get(y)
            if not bafta:
                lb = (live.get("bafta") or {}).get(str(y))   # Wikipedia files BAFTA's winners under the games' year too
                bafta = lb[0] if lb else None
            steam = STEAM.get(y) or (live.get("steam") or {}).get(str(y))
            if not (w or noms or gj or bafta or steam):
                continue
            out.append({"year": y, "tga": {"winner": w, "nominees": [n for n in noms if n != w]} if (w or noms) else None,
                        "gj": gj, "bafta": bafta, "steam": steam})
        return {"years": out, "checked": live.get("t") or 0}
