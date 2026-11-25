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


# ---------------- Nintendo eShop (Europe) ----------------

ESHOP_COUNTRIES = {"DE": "EUR", "FR": "EUR", "IT": "EUR", "ES": "EUR", "NL": "EUR", "AT": "EUR", "PL": "PLN", "GB": "GBP", "CZ": "CZK"}


def eshop_find(name):
    """The game's European eShop ID (nsuid), from Nintendo's own store search."""
    data = _json("https://searching.nintendo-europe.com/en/select?fq=type:GAME&rows=8&wt=json&q=" + urllib.parse.quote(name))
    docs = (data.get("response") or {}).get("docs") or []
    docs = [d for d in docs if same_title(name, d.get("title", ""), 0.8) and d.get("nsuid_txt")]
    if not docs:
        return None
    exact = [d for d in docs if _norm(d.get("title", "")) == _norm(name)]
    d = (exact or docs)[0]
    return {"nsuid": d["nsuid_txt"][0], "title": d.get("title"), "url": "https://www.nintendo.com" + (d.get("url") or ""),
            "systems": d.get("system_names_txt") or []}


def eshop_prices(nsuids, country="DE"):
    """Live eShop prices, including how long a discount lasts."""
    out = {}
    ids = [str(i) for i in nsuids if i]
    for i in range(0, len(ids), 50):
        data = _json(f"https://api.ec.nintendo.com/v1/price?country={country}&lang=en&ids={','.join(ids[i:i + 50])}")
        for p in data.get("prices") or []:
            reg, disc = p.get("regular_price") or {}, p.get("discount_price") or {}
            if not reg:
                continue
            base = float(reg.get("raw_value") or 0)
            final = float(disc.get("raw_value") or base)
            end = disc.get("end_datetime")
            out[str(p.get("title_id"))] = {"currency": reg.get("currency"), "initial": base, "final": final,
                                           "discount": round(100 - final / base * 100) if base and disc else 0,
                                           "ends": int(datetime.fromisoformat(end.replace("Z", "+00:00")).timestamp()) if end else None}
    return out


# ---------------- bundles: Humble Bundle and Fanatical ----------------

def humble_bundles():
    """Every current Humble game bundle and what's in it."""
    page = _get("https://www.humblebundle.com/bundles", timeout=25)
    m = re.search(r'<script id="landingPage-json-data" type="application/json">\s*(\{.*?\})\s*</script>', page, re.S)
    if not m:
        return []
    data = json.loads(m.group(1))
    tiles = []
    for cat, block in (data.get("data") or {}).items():
        if cat not in ("games", "software"):
            continue
        for mosaic in block.get("mosaic") or []:
            tiles += mosaic.get("products") or []
    out = []
    for t in tiles[:14]:
        url = "https://www.humblebundle.com" + (t.get("product_url") or "")
        try:
            bp = _get(url, timeout=25)
            mm = re.search(r'<script id="webpack-bundle-page-data" type="application/json">\s*(\{.*?\})\s*</script>', bp, re.S)
            items = [v.get("human_name") for v in ((json.loads(mm.group(1)).get("bundleData") or {}).get("tier_item_data") or {}).values()] if mm else []
        except Exception:
            items = []
        end = t.get("end_date|datetime") or t.get("end_date_datetime")
        out.append({"store": "Humble Bundle", "name": t.get("tile_name") or t.get("tile_short_name"), "url": url,
                    "ends": int(datetime.fromisoformat(end.replace("Z", "+00:00")).timestamp()) if end else None,
                    "items": [i for i in items if i]})
        time.sleep(0.4)
    return out


def fanatical_bundles():
    """Current Fanatical bundles and their games (best effort: Fanatical has no documented public API)."""
    out = []
    data = _json("https://www.fanatical.com/api/algolia/bundles?altRank=false")
    for b in (data if isinstance(data, list) else data.get("results") or [])[:30]:
        slug = b.get("slug")
        if not slug:
            continue
        items = []
        try:
            pg = _json(f"https://www.fanatical.com/api/products-group/{slug}/en")
            for tier in pg.get("bundles") or []:
                items += [g.get("name") for g in tier.get("games") or [] if g.get("name")]
        except Exception:
            pass
        out.append({"store": "Fanatical", "name": b.get("name"), "url": f"https://www.fanatical.com/en/pick-and-mix/{slug}" if b.get("type") == "pick-and-mix" else f"https://www.fanatical.com/en/bundle/{slug}",
                    "ends": b.get("available_valid_until"), "items": items})
        time.sleep(0.3)
    return out


def bundle_hits(bundles, games):
    out = []
    for b in bundles:
        for g in games:
            if any(mentions(i, g["name"]) or _norm(i) == _norm(g["name"]) for i in b.get("items") or []):
                out.append({"game": g["name"], "owned": g.get("status") != "Wishlist", **{k: v for k, v in b.items() if k != "items"},
                            "count": len(b.get("items") or [])})
    return out


# ---------------- eBay (optional: your own free eBay developer keys) ----------------

class Ebay:
    def __init__(self, vault):
        self.vault = vault

    def configured(self):
        c = self.vault.get("ebay") or {}
        return bool(c.get("id") and c.get("secret"))

    def _token(self):
        tok = self.vault.get("ebay_token") or {}
        if tok.get("token") and time.time() < tok.get("until", 0):
            return tok["token"]
        import base64
        c = self.vault.get("ebay") or {}
        auth = base64.b64encode(f"{c['id']}:{c['secret']}".encode()).decode()
        req = urllib.request.Request("https://api.ebay.com/identity/v1/oauth2/token", method="POST",
                                     data=urllib.parse.urlencode({"grant_type": "client_credentials", "scope": "https://api.ebay.com/oauth/api_scope"}).encode(),
                                     headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"})
        with urllib.request.urlopen(req, timeout=20) as r:
            out = json.load(r)
        tok = {"token": out["access_token"], "until": time.time() + int(out.get("expires_in", 7200)) - 300}
        self.vault.set("ebay_token", tok)
        return tok["token"]

    def cheapest(self, name, platform_label, market="EBAY_US"):
        """The cheapest Buy It Now listing of the physical game (new or used)."""
        q = urllib.parse.quote(f"{name} {platform_label}")
        req = urllib.request.Request(f"https://api.ebay.com/buy/browse/v1/item_summary/search?q={q}&category_ids=139973&limit=25&sort=price"
                                     "&filter=buyingOptions:%7BFIXED_PRICE%7D",
                                     headers={"Authorization": f"Bearer {self._token()}", "X-EBAY-C-MARKETPLACE-ID": market})
        with urllib.request.urlopen(req, timeout=20) as r:
            items = json.load(r).get("itemSummaries") or []
        plat = platform_label.lower().replace("nintendo ", "")
        for it in items:
            t = it.get("title", "")
            if mentions(t, name) and plat.split()[0] in t.lower() and not re.search(r"\b(case only|no game|empty|steelbook only|manual only|art ?book|guide)\b", t, re.I):
                p = it.get("price") or {}
                ship = ((it.get("shippingOptions") or [{}])[0].get("shippingCost") or {}).get("value")
                return {"store": "eBay", "title": t, "price": float(p.get("value") or 0), "currency": p.get("currency") or "USD",
                        "shipping": float(ship) if ship else None, "condition": it.get("condition"), "url": it.get("itemWebUrl")}
        return None


# ---------------- official titles spotted in the news ----------------

def news_title_hint(name, headlines):
    """'The Elder Scrolls VI: Sentinel' showing up in headlines from two or more outlets."""
    pat = re.compile(re.escape(name) + r"\s*[:\-–—]\s*([A-Z0-9][\w'’]*(?:\s+(?:of|the|and|in|a|[A-Z0-9][\w'’]*)){0,5})")
    seen = {}
    for h in headlines:
        for m in pat.finditer(h.get("title", "")):
            full = f"{name}: {m.group(1).strip()}"
            if EDITION_TAIL.match(m.group(1)) or re.search(r"\b(trailer|review|preview|update|patch|release|leak|rumou?r|interview|hands-on|everything|how|why|what|when)\b", m.group(1), re.I):
                continue
            seen.setdefault(full, set()).add(h.get("source") or "")
    best = max(seen.items(), key=lambda kv: len(kv[1]), default=None)
    if best and len(best[1]) >= 2:
        return {"name": best[0], "source": f"the news ({len(best[1])} outlets)", "suggest": True}
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
        self.ebay = None
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

    def _dlc_sales(self, owned, cc, extra):
        """Discounted DLC for your Steam games (and DLC you wishlisted on Steam), cheapest store first."""
        now = time.time()
        lists = self.state.setdefault("dlc_ids", {})     # base appid -> {"t", "ids"}
        info = self.state.setdefault("dlc_info", {})     # dlc appid -> {"name", "art"}
        fetched = 0
        base = {}
        for g in owned:
            a = extra.get("appids", {}).get(g["name"]) or self.art.steam_appid(g["name"]) if g.get("platform") == "Steam" else None
            if not a:
                continue
            base[g["name"]] = a
            e = lists.get(str(a))
            if (not e or now - e["t"] > 7 * 24 * HOUR) and fetched < 40:
                try:
                    d = (_json(f"https://store.steampowered.com/api/appdetails?appids={a}&filters=basic&l=english").get(str(a)) or {}).get("data") or {}
                    lists[str(a)] = {"t": now, "ids": (d.get("dlc") or [])[:60]}
                except Exception:
                    pass
                fetched += 1
                time.sleep(0.35)
        owner = {}
        for n, a in base.items():
            for dlc in (lists.get(str(a)) or {}).get("ids") or []:
                owner[int(dlc)] = n
        for dlc in extra.get("wish_dlc") or []:
            owner.setdefault(int(dlc), "")
        prices = steam_prices(list(owner), cc) if owner else {}
        marks = extra.get("owned_marks") or {}
        out = []
        for a, p in prices.items():
            if not p or not p["discount"]:
                continue
            if str(a) not in info:
                try:
                    d = (_json(f"https://store.steampowered.com/api/appdetails?appids={a}&l=english").get(str(a)) or {}).get("data") or {}
                    info[str(a)] = {"name": d.get("name"), "art": d.get("header_image"), "game": (d.get("fullgame") or {}).get("name")}
                except Exception:
                    info[str(a)] = {}
                time.sleep(0.3)
            i = info[str(a)]
            game = owner.get(a) or i.get("game") or ""
            if not i.get("name") or marks.get(game, {}).get(i["name"]) or JUNK_DLC.search(i["name"]):
                continue
            out.append({"game": game, "name": i["name"], "art": i.get("art"), "url": f"https://store.steampowered.com/app/{a}", "appid": a,
                        "price": p, "wishlisted": a in set(extra.get("wish_dlc") or [])})
        # a cheaper key store for the bigger ones
        for d in sorted(out, key=lambda d: -d["price"]["initial"])[:20]:
            try:
                gid = cheapshark_id(d["name"], d["appid"])
                deals = (cheapshark_deals([gid]).get(str(gid)) or {}).get("deals") if gid else None
                best = next((x for x in deals or [] if x["store"] != "Steam"), None)
                if best and best["price"] < d["price"]["final"]:
                    d["alt"] = best
            except Exception:
                pass
        out.sort(key=lambda d: (not d["wishlisted"], -d["price"]["discount"]))
        return out[:60]

    def refresh(self, wishlist, owned, cc="GE", ps_locale="en-us", dlc_lookup=None, extra=None, eshop_country="DE", news_lookup=None):
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
            # DLC on sale: for every Steam game you own, and DLC on your Steam wishlist
            try:
                st["dlc"] = self._dlc_sales(owned, cc, extra or {})
            except Exception:
                pass
            self._remember()
            # Nintendo eShop
            for g in wishlist:
                if g.get("platform") in SWITCH:
                    e = games[g["name"]]
                    if e.get("eshop_id") is None or now - e.get("eshop_t", 0) > 7 * 24 * HOUR:
                        try:
                            hit = eshop_find(g["name"])
                            e["eshop_id"], e["eshop_url"], e["eshop_t"] = (hit or {}).get("nsuid") or "", (hit or {}).get("url"), now
                        except Exception:
                            pass
                        time.sleep(0.3)
            ids = {games[g["name"]]["eshop_id"]: g["name"] for g in wishlist if games.get(g["name"], {}).get("eshop_id")}
            if ids:
                try:
                    for nid, p in eshop_prices(list(ids), eshop_country).items():
                        games[ids[nid]]["eshop"] = p
                except Exception:
                    pass
            self._remember()
            # bundles
            bundles = []
            for fn in (humble_bundles, fanatical_bundles):
                try:
                    bundles += fn()
                except Exception:
                    continue
            if bundles:
                st["bundles"] = bundle_hits(bundles, list(wishlist) + list(owned_dlc_games(owned)))
            self._remember()
            # eBay, if you added keys
            if self.ebay and self.ebay.configured():
                for g in wishlist:
                    if g.get("platform") in PHYSICAL_LABEL and (g.get("format") == "Physical" or g.get("platform") in PS | SWITCH):
                        e = games[g["name"]]
                        if not e.get("ebay") or now - e["ebay"].get("t", 0) > 12 * HOUR:
                            try:
                                hit = self.ebay.cheapest(g["name"], PHYSICAL_LABEL[g["platform"]])
                                e["ebay"] = dict(hit or {}, t=now)
                            except Exception:
                                pass
                            time.sleep(0.5)
            # titles spotted in the news (suggestions only: you confirm them)
            if news_lookup:
                for g in wishlist:
                    e = games[g["name"]]
                    if g["name"] in props or now - e.get("news_t", 0) < 24 * HOUR:
                        continue
                    e["news_t"] = now
                    try:
                        hint = news_title_hint(g["name"], news_lookup(g["name"]))
                    except Exception:
                        hint = None
                    if hint:
                        props[g["name"]] = hint
            st["t"] = time.time()
            self._remember()
        finally:
            self.running = False

    def snapshot(self, wishlist_names):
        st = self.state
        sale = steam_sales()
        return {"games": {n: st["games"].get(n) for n in wishlist_names if st["games"].get(n)},
                "subs": st.get("subs") or [], "dlc": st.get("dlc") or [], "rates": st.get("rates"), "bundles": st.get("bundles") or [],
                "renames": {k: v for k, v in (st.get("renames") or {}).items() if k in wishlist_names and not v.get("done") and not v.get("undone")},
                "sale": sale, "t": st.get("t", 0), "running": self.running}


JUNK_DLC = re.compile(r"soundtrack|\bost\b|art ?book|wallpaper|avatar|\bskin|costume|outfit|cosmetic|digital extras|pre-?order", re.I)


def owned_dlc_games(owned):
    return [g for g in owned if g.get("status") != "Wishlist"]


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
