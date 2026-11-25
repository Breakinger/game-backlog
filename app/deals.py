"""Prices, sales and deals for your wishlist (and DLC for games you own).

- Steam prices in your Steam region (Georgia uses Steam's U.S. dollar region), with the sale's end time.
- Every other PC store CheapShark tracks (GOG, Humble, Fanatical, Green Man Gaming, Epic, …) and the all-time low.
- PlayStation Store prices for PlayStation games (region you choose).
- Matching posts from r/GameDeals, r/PS4Deals, r/PS5Deals, r/NintendoSwitchDeals and r/FreeGameFindings,
  which is where Amazon, eBay, Humble and Fanatical deals usually show up first.
- Release countdowns, Steam's big seasonal sales, and the National Bank of Georgia's daily rates for GEL.
All read-only public data; nothing is bought or logged in."""
import concurrent.futures as cf
import html
import json
import re
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from art import _norm, numerals, same_title
import feeds
import saver

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
HOUR = 3600
DEAL_SUBS = [("GameDeals", "r/GameDeals", "pc"), ("FreeGameFindings", "r/FreeGameFindings", "pc"),
             ("PS5Deals", "r/PS5Deals", "ps"), ("PS4Deals", "r/PS4Deals", "ps"), ("NintendoSwitchDeals", "r/NintendoSwitchDeals", "switch")]
PC = {"Steam", "GOG", "Epic Games", "EA", "Ubisoft Connect", "PC (Other)", "itch.io", "Emulation"}
PS = {"PS5", "PS4", "PS2"}
SWITCH = {"Switch 2", "Switch"}
PHYSICAL_LABEL = {"PS5": "PS5", "PS4": "PS4", "Switch 2": "Nintendo Switch 2", "Switch": "Nintendo Switch", "PS2": "PS2"}

# Steam's big storewide sales, from Valve's Steamworks calendar. All start and end at 10:00 Pacific.
STEAM_SALES = [
    {"id": "winter-2026", "name": "Steam Winter Sale", "start": "2026-12-17T18:00:00Z", "end": "2027-01-04T18:00:00Z"},
    {"id": "summer-2027", "name": "Steam Summer Sale", "start": "2027-06-24T17:00:00Z", "end": "2027-07-08T17:00:00Z"},
]

CHEAPSHARK_STORES = {"1": "Steam", "2": "GamersGate", "3": "Green Man Gaming", "7": "GOG", "8": "EA", "11": "Humble Store",
                     "13": "Ubisoft Store", "15": "Fanatical", "21": "WinGameStore", "23": "GameBillet", "24": "Voidu",
                     "25": "Epic Games Store", "27": "Gamesplanet", "28": "Gamesload", "29": "2Game", "30": "IndieGala",
                     "31": "Blizzard", "33": "DLGamer", "34": "Noctre", "35": "DreamGame"}


def _get(url, headers=None, timeout=20):
    h = {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"}
    h.update(headers or {})
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def _json(url, headers=None, timeout=20):
    return json.loads(_get(url, headers, timeout))


def _ts(iso):
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())


def steam_sales(now=None):
    """The current or next big Steam sale."""
    now = now or time.time()
    for s in STEAM_SALES:
        start, end = _ts(s["start"]), _ts(s["end"])
        if now < end:
            return {**s, "start": start, "end": end, "live": start <= now}
    return None


# ---------------- money ----------------

def nbg_rates():
    """GEL per unit of each currency, from the National Bank of Georgia (official daily rates)."""
    data = _json("https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json/")
    block = data[0] if isinstance(data, list) and data else data
    out = {"GEL": 1.0}
    for c in block.get("currencies") or []:
        if c.get("code") and c.get("rate"):
            out[c["code"]] = float(c["rate"]) / float(c.get("quantity") or 1)
    return {"rates": out, "date": block.get("date"), "source": "National Bank of Georgia"}


def fallback_rates():
    data = _json("https://open.er-api.com/v6/latest/GEL")
    r = data.get("rates") or {}
    return {"rates": {k: 1 / v for k, v in r.items() if v}, "date": data.get("time_last_update_utc"), "source": "ExchangeRate-API"}


# ---------------- Steam ----------------

def steam_prices(appids, cc):
    """Prices for many apps at once (Steam allows this for price_overview only)."""
    out = {}
    ids = [str(a) for a in appids if a]
    for i in range(0, len(ids), 40):
        chunk = ids[i:i + 40]
        data = _json(f"https://store.steampowered.com/api/appdetails?appids={','.join(chunk)}&filters=price_overview&cc={cc}")
        for a in chunk:
            d = (data.get(a) or {})
            po = d.get("data") if isinstance(d.get("data"), dict) else {}
            p = po.get("price_overview") if po else None
            out[int(a)] = {"currency": p["currency"], "initial": p["initial"] / 100, "final": p["final"] / 100,
                           "discount": p.get("discount_percent", 0), "final_text": p.get("final_formatted"),
                           "initial_text": p.get("initial_formatted")} if p else None
        time.sleep(0.3)
    return out


def steam_release(appid, cc):
    data = _json(f"https://store.steampowered.com/api/appdetails?appids={appid}&cc={cc}&l=english")
    d = (data.get(str(appid)) or {}).get("data") or {}
    rd = d.get("release_date") or {}
    return {"coming": bool(rd.get("coming_soon")), "text": rd.get("date") or "", "ts": parse_release(rd.get("date")),
            "free": bool(d.get("is_free")), "name": d.get("name"), "type": d.get("type")}


def parse_release(text):
    """'4 Dec, 2026' or 'Dec 4, 2026' -> timestamp. Quarters, years and 'Coming soon' have no exact day."""
    if not text:
        return None
    for fmt in ("%d %b, %Y", "%b %d, %Y", "%d %B, %Y", "%B %d, %Y", "%d %b %Y", "%b %d %Y", "%Y-%m-%d"):
        try:
            return int(datetime.strptime(text.strip(), fmt).replace(tzinfo=timezone.utc).timestamp())
        except ValueError:
            continue
    return None


def steam_sale_end(appid, cc):
    """When the current discount ends, from the store page."""
    page = _get(f"https://store.steampowered.com/app/{appid}/?cc={cc}&l=english", {"Cookie": "birthtime=0; mature_content=1; wants_mature_content=1"})
    m = re.search(r"InitDailyDealTimer\(\s*\$DiscountCountdown,\s*(\d{9,})", page)
    if m:
        return int(m.group(1))
    m = re.search(r'game_purchase_discount_countdown">[^<]*?(?:ends|Ends)\s+([^<]+)<', page)
    if m:
        txt = html.unescape(m.group(1)).strip().rstrip(".")
        now = datetime.now(timezone.utc)
        for fmt in ("%d %B", "%B %d", "%d %b", "%b %d"):
            try:
                d = datetime.strptime(txt, fmt).replace(year=now.year, hour=17, tzinfo=timezone.utc)
                if d < now:
                    d = d.replace(year=now.year + 1)
                return int(d.timestamp())
            except ValueError:
                continue
    return None


# ---------------- other PC stores (CheapShark) ----------------

def cheapshark_id(name, appid=None):
    if appid:
        res = _json(f"https://www.cheapshark.com/api/1.0/games?steamAppID={appid}&limit=5")
        if res:
            return res[0].get("gameID")
    res = _json("https://www.cheapshark.com/api/1.0/games?limit=10&title=" + urllib.parse.quote(name))
    best = [r for r in res if same_title(name, r.get("external", ""))]
    return best[0].get("gameID") if best else None


def cheapshark_deals(ids):
    """Every store's current price for each game, plus the cheapest price ever. Prices in U.S. dollars."""
    out = {}
    ids = [str(i) for i in ids if i]
    for i in range(0, len(ids), 25):
        data = _json("https://www.cheapshark.com/api/1.0/games?ids=" + ",".join(ids[i:i + 25]))
        for gid, g in (data or {}).items():
            deals = []
            for d in g.get("deals") or []:
                store = CHEAPSHARK_STORES.get(str(d.get("storeID")), f"Store {d.get('storeID')}")
                price, retail = float(d.get("price") or 0), float(d.get("retailPrice") or 0)
                deals.append({"store": store, "price": price, "retail": retail, "savings": round(float(d.get("savings") or 0)),
                              "url": "https://www.cheapshark.com/redirect?dealID=" + urllib.parse.quote(d.get("dealID", ""))})
            deals.sort(key=lambda d: d["price"])
            low = g.get("cheapestPriceEver") or {}
            out[gid] = {"deals": deals[:8], "low": float(low["price"]) if low.get("price") else None, "low_date": low.get("date")}
        time.sleep(0.5)
    return out


# ---------------- PlayStation Store ----------------

def ps_price(name, locale="en-us"):
    page = _get(f"https://store.playstation.com/{locale}/search/{urllib.parse.quote(name)}", timeout=20)
    for cid in list(dict.fromkeys(re.findall(rf"/{locale}/concept/(\d+)", page)))[:3]:
        p = _get(f"https://store.playstation.com/{locale}/concept/{cid}", timeout=20)
        title = re.search(r"<title>([^<|]+)", p)
        t = html.unescape(title.group(1)).strip() if title else ""
        if not t or not same_title(name, re.sub(r"\s*(PS4|PS5|PS4 & PS5|PS5 & PS4)\s*$", "", t), 0.8):
            continue
        m = re.search(r'"basePrice"\s*:\s*"([^"]+)"\s*,\s*"discountedPrice"\s*:\s*"([^"]+)"\s*,\s*"discountText"\s*:\s*(null|"[^"]*")', p)
        if not m:
            continue
        end = re.search(r'"endTime"\s*:\s*"(\d{10,13})"', p)
        endts = int(end.group(1)) // (1000 if len(end.group(1)) > 10 else 1) if end else None
        disc = m.group(3).strip('"') if m.group(3) != "null" else ""
        return {"base": m.group(1), "final": m.group(2), "discount": disc, "ends": endts if disc else None,
                "url": f"https://store.playstation.com/{locale}/concept/{cid}"}
    return None


# ---------------- deal subreddits ----------------

SEQUEL = re.compile(r"^(?:\d{1,2}|ii|iii|iv|vi|vii|viii|ix|xi|xii)$", re.I)
ALLOW_AFTER = {"ps4", "ps5", "ps", "switch", "nintendo", "xbox", "pc", "steam", "gog", "epic", "deluxe", "edition", "complete",
               "ultimate", "goty", "gold", "standard", "digital", "physical", "bundle", "is", "at", "for", "on", "now", "free",
               "remastered", "remake", "definitive", "enhanced", "directors", "director's", "launch", "pre", "preorder", "pre-order",
               "collector's", "collectors", "steelbook", "key", "code", "via", "with", "and", "dlc", "season", "expansion", "upgrade"}


def mentions(title, game):
    """True when a post title is about this exact game, not a sequel or spin-off ('Elden Ring' vs 'Elden Ring Nightreign')."""
    words = re.findall(r"[a-z0-9]+", game.lower().replace("&", "and"))
    words = [w for w in words if w != "the"] or words
    if not words or sum(len(w) for w in words) < 3:
        return False
    pat = r"(?<![a-z0-9])" + r"[\W_]+".join(re.escape(w) for w in words) + r"(?![a-z0-9])"
    t = title.lower().replace("&", "and")
    for m in re.finditer(pat, t):
        rest = t[m.end():]
        sub = re.match(r"\s*[:：]\s*([a-z0-9'’]+)", rest)
        if sub:
            if sub.group(1) in ALLOW_AFTER:
                return True
            continue  # 'Hollow Knight: Silksong' is a different game
        nxt = re.match(r"\s+([a-z0-9'’]+)", rest)
        if nxt:
            w = nxt.group(1)
            if SEQUEL.match(w) and not re.match(r"\s+\d+\s*%", rest):
                continue  # 'Red Dead Redemption 2' when you want the first one
            if w.isalpha() and w not in ALLOW_AFTER and len(w) > 2:
                continue  # 'Elden Ring Nightreign'
        return True
    return False


def sub_hits(posts, games):
    out = {}
    for p in posts:
        for g in games:
            if mentions(p["title"], g["name"]):
                out.setdefault(g["name"], []).append(p)
    return out


class Deals:
    def __init__(self, art, data_dir):
        import os
        self.art = art
        self.path = os.path.join(data_dir, "deals.json")
        self.lock = threading.Lock()
        self.running = False
        self.state = {"games": {}, "subs": [], "rates": None, "t": 0}
        try:
            with open(self.path, encoding="utf-8") as f:
                st = json.load(f)
            if isinstance(st, dict) and "games" in st:
                self.state = st
        except Exception:
            pass

    def _remember(self):
        saver.save_later(self.path, lambda: self.state, lock=self.lock)

    def rates(self):
        r = self.state.get("rates")
        if r and time.time() - r.get("t", 0) < 6 * HOUR:
            return r
        for fn in (nbg_rates, fallback_rates):
            try:
                r = dict(fn(), t=time.time())
                self.state["rates"] = r
                return r
            except Exception:
                continue
        return r

    def refresh(self, wishlist, owned, cc="GE", ps_locale="en-us", dlc_lookup=None):
        """Slow: runs in the background and fills self.state; the page polls snapshot()."""
        if self.running:
            return
        self.running = True
        try:
            self.rates()
            st = self.state
            games = st.setdefault("games", {})
            now = time.time()
            # Steam IDs for everything that might be on Steam
            ids = {}
            for g in wishlist:
                try:
                    a = self.art.steam_appid(g["name"])
                except Exception:
                    a = None
                if a:
                    ids[g["name"]] = a
            # Steam prices, all in one go
            try:
                prices = steam_prices(list(ids.values()), cc)
            except Exception:
                prices = {}
            for g in wishlist:
                e = games.setdefault(g["name"], {})
                e["platform"] = g.get("platform")
                e["format"] = g.get("format")
                a = ids.get(g["name"])
                e["appid"] = a
                if a and a in prices:
                    e["steam"] = prices[a]
                    if prices[a] and prices[a]["discount"]:
                        if not e.get("steam_ends") or e["steam_ends"] < now:
                            try:
                                e["steam_ends"] = steam_sale_end(a, cc)
                            except Exception:
                                e["steam_ends"] = None
                            time.sleep(0.4)
                    else:
                        e["steam_ends"] = None
                if a and (not e.get("release") or now - e["release"].get("t", 0) > 12 * HOUR):
                    try:
                        e["release"] = dict(steam_release(a, cc), t=now)
                    except Exception:
                        pass
                    time.sleep(0.3)
                if not a and self.art.igdb and self.art.igdb.configured() and (not e.get("release") or now - e["release"].get("t", 0) > 24 * HOUR):
                    try:
                        ig = self.art.igdb.game(g["name"]) or {}
                        ts = ig.get("first_release_date")
                        e["release"] = {"coming": bool(ts and ts > now), "ts": ts, "text": "", "t": now}
                    except Exception:
                        pass
                self._remember()
            # official titles (once a day per game)
            props = st.setdefault("renames", {})
            for g in wishlist:
                e = games[g["name"]]
                if now - e.get("name_t", 0) > 24 * HOUR:
                    e["name_t"] = now
                    try:
                        hit = official_name(g["name"], self.art.igdb)
                    except Exception:
                        hit = None
                    if hit:
                        props[g["name"]] = hit
                    time.sleep(0.4)
            # other PC stores
            pc = [g for g in wishlist if (g.get("platform") or "Steam") in PC]
            cs_ids = {}
            for g in pc:
                e = games[g["name"]]
                if e.get("cs_id") is None or now - e.get("cs_t", 0) > 7 * 24 * HOUR:
                    try:
                        e["cs_id"] = cheapshark_id(g["name"], e.get("appid")) or ""
                        e["cs_t"] = now
                    except Exception:
                        pass
                    time.sleep(0.4)
                if e.get("cs_id"):
                    cs_ids[e["cs_id"]] = g["name"]
            try:
                for gid, d in cheapshark_deals(list(cs_ids)).items():
                    games[cs_ids[gid]]["stores"] = d
            except Exception:
                pass
            self._remember()
            # PlayStation Store
            for g in wishlist:
                if g.get("platform") in ("PS5", "PS4"):
                    e = games[g["name"]]
                    if not e.get("ps") or now - e["ps"].get("t", 0) > 6 * HOUR:
                        try:
                            p = ps_price(g["name"], ps_locale)
                            e["ps"] = dict(p or {}, t=now)
                        except Exception:
                            pass
                        time.sleep(0.6)
            self._remember()
            # deal subreddits: wishlist games, and DLC or editions for games you own
            posts = []
            for sub, label, kind in DEAL_SUBS:
                try:
                    for p in feeds.reddit(sub, label):
                        p["kind"] = kind
                        posts.append(p)
                except Exception:
                    continue
            recent = [p for p in posts if p.get("date", 0) > now - 10 * 24 * HOUR]
            hits = sub_hits(recent, wishlist)
            dlc_words = re.compile(r"\b(dlc|expansion|season pass|deluxe|complete|ultimate|gold|goty|game of the year|bundle|edition)\b", re.I)
            own_hits = {k: [p for p in v if dlc_words.search(p["title"])] for k, v in sub_hits(recent, owned).items()}
            st["subs"] = [{"game": k, "owned": False, **p} for k, v in hits.items() for p in v] + \
                         [{"game": k, "owned": True, **p} for k, v in own_hits.items() for p in v]
            st["subs"].sort(key=lambda p: -p.get("date", 0))
            # DLC on sale for games you own (Steam)
            if dlc_lookup:
                dl = []
                for g in owned:
                    for d in (dlc_lookup(g) or []):
                        m = re.search(r"/app/(\d+)", d.get("url") or "")
                        if m and d.get("kind") != "upgrade":
                            dl.append((g["name"], int(m.group(1)), d))
                try:
                    dp = steam_prices([x[1] for x in dl], cc)
                except Exception:
                    dp = {}
                st["dlc"] = [{"game": n, "name": d.get("name"), "art": d.get("art"), "url": d.get("url"), "major": d.get("major"),
                              "price": dp.get(a)} for n, a, d in dl if dp.get(a) and dp[a]["discount"]]
            st["t"] = time.time()
            self._remember()
        finally:
            self.running = False

    def snapshot(self, wishlist_names):
        st = self.state
        sale = steam_sales()
        return {"games": {n: st["games"].get(n) for n in wishlist_names if st["games"].get(n)},
                "subs": st.get("subs") or [], "dlc": st.get("dlc") or [], "rates": st.get("rates"),
                "renames": {k: v for k, v in (st.get("renames") or {}).items() if k in wishlist_names and not v.get("done") and not v.get("undone")},
                "sale": sale, "t": st.get("t", 0), "running": self.running}


# ---------------- official titles for wishlist games ----------------

EDITION_TAIL = re.compile(r"^(?:deluxe|digital deluxe|complete|ultimate|gold|goty|game of the year|standard|premium|definitive|"
                          r"enhanced|remastered|director'?s cut|anniversary|collector'?s|launch|pre-?order)\b.*(?:edition|bundle|pack|cut)?$", re.I)


def _extends(old, new):
    """'The Elder Scrolls VI' -> 'The Elder Scrolls VI: Sentinel': same name, same numbers, plus an official subtitle."""
    o, n = old.strip(), new.strip()
    if len(n) <= len(o) or not n.lower().startswith(o.lower()):
        return False
    rest = n[len(o):]
    m = re.match(r"\s*[:\-–—]\s*(.+)$", rest)
    if not m:
        return False
    tail = m.group(1).strip()
    if not tail or EDITION_TAIL.match(tail) or re.search(r"\b(soundtrack|dlc|season pass|expansion pass|demo|playtest|artbook)\b", tail, re.I):
        return False
    return numerals(o) == numerals(n)


def official_name(name, igdb=None):
    """The full official title if the stores now list one, e.g. after a reveal. None if the name is already right."""
    found = []
    try:
        res = _json("https://store.steampowered.com/api/storesearch/?l=english&cc=US&term=" + urllib.parse.quote(name))
        items = res.get("items") or []
        if any(_norm(i.get("name", "")) == _norm(name) for i in items):
            return None   # the store already lists it under this name
        for i in items:
            if _extends(name, i.get("name", "")):
                try:
                    d = (_json(f"https://store.steampowered.com/api/appdetails?appids={i['id']}&l=english").get(str(i["id"])) or {}).get("data") or {}
                except Exception:
                    d = {}
                if d.get("type", "game") == "game":
                    found.append(("Steam", d.get("name") or i["name"]))
    except Exception:
        pass
    if not found and igdb and igdb.configured():
        try:
            rows = igdb.search(name)
            if any(_norm(r.get("name", "")) == _norm(name) and not r.get("version_parent") for r in rows):
                return None
            for r in rows:
                if not r.get("version_parent") and _extends(name, r.get("name", "")):
                    found.append(("IGDB", r["name"]))
        except Exception:
            pass
    if not found:
        return None
    src, new = min(found, key=lambda f: len(f[1]))  # the plainest full title, not a special edition
    return {"name": new, "source": src}


def physical_links(name, platform):
    label = PHYSICAL_LABEL.get(platform)
    if not label:
        return []
    q = urllib.parse.quote_plus(f"{name} {label}")
    return [{"store": "Amazon", "url": f"https://www.amazon.com/s?k={q}"},
            {"store": "eBay", "url": f"https://www.ebay.com/sch/i.html?_nkw={q}&LH_BIN=1&_sop=15"}]
