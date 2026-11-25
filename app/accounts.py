"""Linked accounts: Steam, PlayStation, Heroic (Epic + GOG) and itch.io.

Every call here is read-only. Keys and tokens live in the encrypted vault and only ever travel to the
service they belong to, over HTTPS.
"""
import base64
import glob
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from art import similar, same_title, _norm
import saver

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Masterlog/1.0"
JUNK = re.compile(r"dedicated server|soundtrack|\bost\b|\bsdk\b|benchmark|playtest|\bdemo\b|test server|editor|mod tools|artbook|wallpaper", re.I)
MATCH = 0.86


def _http(url, data=None, headers=None, timeout=25, method=None):
    h = {"User-Agent": UA, "Accept": "application/json"}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8") or "{}")


# ---------------- Steam ----------------

class Steam:
    API = "https://api.steampowered.com"

    @staticmethod
    def resolve(key, who):
        who = who.strip().rstrip("/")
        m = re.search(r"/profiles/(\d{17})", who) or re.fullmatch(r"(\d{17})", who)
        if m:
            return m.group(1)
        vanity = re.search(r"/id/([^/]+)", who)
        vanity = vanity.group(1) if vanity else who
        out = _http(f"{Steam.API}/ISteamUser/ResolveVanityURL/v1/?key={urllib.parse.quote(key)}&vanityurl={urllib.parse.quote(vanity)}")
        sid = (out.get("response") or {}).get("steamid")
        if not sid:
            raise ValueError("Couldn't find that Steam profile. Paste your profile link or SteamID64.")
        return sid

    @staticmethod
    def profile(key, sid):
        out = _http(f"{Steam.API}/ISteamUser/GetPlayerSummaries/v2/?key={urllib.parse.quote(key)}&steamids={sid}")
        players = (out.get("response") or {}).get("players") or []
        return players[0] if players else {}

    @staticmethod
    def owned(key, sid):
        out = _http(f"{Steam.API}/IPlayerService/GetOwnedGames/v1/?key={urllib.parse.quote(key)}&steamid={sid}"
                    "&include_appinfo=1&include_played_free_games=1&format=json")
        games = (out.get("response") or {}).get("games")
        if games is None:
            raise PermissionError("Steam returned no games. In Steam, set Profile → Privacy → Game details to Public.")
        return games

    @staticmethod
    def wishlist(key, sid):
        """Your public Steam wishlist, with names. Needs the wishlist to be visible (same privacy as game details)."""
        out = _http(f"{Steam.API}/IWishlistService/GetWishlist/v1/?key={urllib.parse.quote(key)}&steamid={sid}")
        items = (out.get("response") or {}).get("items") or []
        ids = [int(i["appid"]) for i in items if i.get("appid")]
        names = {}
        for i in range(0, len(ids), 50):
            req = json.dumps({"ids": [{"appid": a} for a in ids[i:i + 50]], "context": {"language": "english", "country_code": "US"},
                              "data_request": {"include_basic_info": False}})
            try:
                r = _http(f"{Steam.API}/IStoreBrowseService/GetItems/v1/?input_json=" + urllib.parse.quote(req))
                for it in (r.get("response") or {}).get("store_items") or []:
                    if it.get("name"):
                        names[int(it.get("appid") or it.get("id") or 0)] = {"name": it["name"], "type": it.get("type")}
            except Exception:
                pass
        return [{"id": f"steamwish:{a}", "appid": a, "name": names.get(a, {}).get("name", ""), "platform": "Steam",
                 "dlc": names.get(a, {}).get("type") == 4, "added": next((i.get("date_added") for i in items if int(i.get("appid", 0)) == a), None)}
                for a in ids]

    @staticmethod
    def achievements(key, sid, appid):
        try:
            out = _http(f"{Steam.API}/ISteamUserStats/GetPlayerAchievements/v1/?key={urllib.parse.quote(key)}&steamid={sid}&appid={appid}")
        except urllib.error.HTTPError:
            return None  # game has no achievements
        ach = (out.get("playerstats") or {}).get("achievements") or []
        if not ach:
            return None
        done = sum(1 for a in ach if a.get("achieved"))
        return {"done": done, "total": len(ach)}


# ---------------- PlayStation (unofficial mobile-app endpoints) ----------------

class PSN:
    AUTH = "https://ca.account.sony.com/api/authz/v3/oauth"
    CLIENT = "09515159-7237-4370-9b40-3806e67c0891"
    BASIC = "MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A="
    REDIRECT = "com.scee.psxandroid.scecompcall://redirect"
    SCOPE = "psn:mobile.v2.core psn:clientapp"

    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None

    @classmethod
    def from_npsso(cls, npsso):
        npsso = npsso.strip()
        m = re.search(r'"npsso"\s*:\s*"([^"]+)"', npsso)
        if m:
            npsso = m.group(1)
        q = urllib.parse.urlencode({"access_type": "offline", "client_id": cls.CLIENT, "redirect_uri": cls.REDIRECT,
                                    "response_type": "code", "scope": cls.SCOPE})
        opener = urllib.request.build_opener(cls._NoRedirect)
        req = urllib.request.Request(f"{cls.AUTH}/authorize?{q}", headers={"Cookie": f"npsso={npsso}", "User-Agent": UA})
        try:
            opener.open(req, timeout=25)
            raise ValueError("Sony didn't accept that code. Get a fresh one and try again.")
        except urllib.error.HTTPError as e:
            loc = e.headers.get("Location", "")
        code = urllib.parse.parse_qs(urllib.parse.urlparse(loc).query).get("code", [None])[0]
        if not code:
            raise ValueError("Sony didn't accept that code. Sign in at playstation.com, then get a fresh one.")
        return cls._token({"code": code, "redirect_uri": cls.REDIRECT, "grant_type": "authorization_code", "token_format": "jwt"})

    @classmethod
    def refresh(cls, refresh_token):
        return cls._token({"refresh_token": refresh_token, "grant_type": "refresh_token", "token_format": "jwt", "scope": cls.SCOPE})

    @classmethod
    def _token(cls, form):
        out = _http(f"{cls.AUTH}/token", data=urllib.parse.urlencode(form).encode(),
                    headers={"Authorization": f"Basic {cls.BASIC}", "Content-Type": "application/x-www-form-urlencoded"})
        if not out.get("access_token"):
            raise ValueError("Sony didn't return a token.")
        return {"access": out["access_token"], "access_until": time.time() + int(out.get("expires_in", 3600)) - 60,
                "refresh": out.get("refresh_token"), "refresh_until": time.time() + int(out.get("refresh_token_expires_in", 0))}

    @staticmethod
    def trophies(access):
        out, offset = [], 0
        while True:
            page = _http(f"https://m.np.playstation.com/api/trophy/v1/users/me/trophyTitles?limit=800&offset={offset}",
                         headers={"Authorization": f"Bearer {access}"})
            titles = page.get("trophyTitles") or []
            out += titles
            offset += len(titles)
            if not titles or offset >= page.get("totalItemCount", 0):
                return out

    @staticmethod
    def played(access):
        out, offset = [], 0
        while True:
            page = _http(f"https://m.np.playstation.com/api/gamelist/v2/users/me/titles?categories=ps4_game,ps5_native_game&limit=200&offset={offset}",
                         headers={"Authorization": f"Bearer {access}"})
            titles = page.get("titles") or []
            out += titles
            offset += len(titles)
            if not titles or offset >= page.get("totalItemCount", 0):
                return out


def _duration_minutes(iso):
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?", iso or "")
    if not m:
        return 0
    d, h, mi, _ = (float(x or 0) for x in m.groups())
    return int(d * 1440 + h * 60 + mi)


def _ps_art(title):
    """The portrait cover Sony shows for a game in your library, if it has one."""
    images = ((title.get("concept") or {}).get("media") or {}).get("images") or (title.get("media") or {}).get("images") or []
    for kind in ("PORTRAIT_BANNER", "GAMEHUB_COVER_ART"):
        for im in images:
            if im.get("type") == kind and im.get("url"):
                return im["url"]
    return None


def _clean_ps_name(n):
    return re.sub(r"\s*(\(PS[45]\)|PS[45]( & PS[45])?|Trophies|™|®)\s*", " ", n or "").strip()


# ---------------- Heroic (reads local files only) ----------------

class Heroic:
    @staticmethod
    def folder():
        base = os.environ.get("APPDATA") or os.path.expanduser("~/.config")
        for p in (os.path.join(base, "heroic"), os.path.expanduser("~/.var/app/com.heroicgameslauncher.hgl/config/heroic")):
            if os.path.isdir(p):
                return p
        return None

    @staticmethod
    def library(folder):
        games = {}
        def walk(node, runner):
            if isinstance(node, dict):
                title = node.get("title")
                app = node.get("app_name") or node.get("appName")
                if title and app and isinstance(title, str):
                    r = node.get("runner") or runner
                    games[(r, app)] = {"name": title, "app": app, "runner": r, "installed": bool(node.get("is_installed"))}
                for v in node.values():
                    walk(v, runner)
            elif isinstance(node, list):
                for v in node:
                    walk(v, runner)
        for path in glob.glob(os.path.join(folder, "store_cache", "*.json")) + glob.glob(os.path.join(folder, "gog_store", "*.json")):
            low = os.path.basename(path).lower()
            runner = "legendary" if "legendary" in low or "epic" in low else "gog" if "gog" in path.lower() else ("nile" if "nile" in low else None)
            if not runner:
                continue
            try:
                with open(path, encoding="utf-8") as f:
                    walk(json.load(f), runner)
            except Exception:
                continue
        played = {}
        for path in (os.path.join(folder, "store", "timestamp.json"), os.path.join(folder, "timestamp.json")):
            try:
                with open(path, encoding="utf-8") as f:
                    played.update(json.load(f) or {})
            except Exception:
                pass
        out = []
        for g in games.values():
            t = played.get(g["app"]) or {}
            g["minutes"] = int(t.get("totalPlayed") or 0)
            g["last_played"] = t.get("lastPlayed")
            out.append(g)
        return out


# ---------------- itch.io ----------------

class Itch:
    @staticmethod
    def me(key):
        out = _http(f"https://itch.io/api/1/{urllib.parse.quote(key)}/me")
        if out.get("errors"):
            raise ValueError("itch.io didn't accept that API key.")
        return out.get("user") or {}

    @staticmethod
    def owned(key):
        out, page = [], 1
        while page < 40:
            data = _http(f"https://itch.io/api/1/{urllib.parse.quote(key)}/my-owned-keys?page={page}")
            keys = data.get("owned_keys") or []
            out += [k.get("game") or {} for k in keys]
            if len(keys) < int(data.get("per_page") or 50):
                break
            page += 1
        return [g for g in out if g.get("title")]


# ---------------- the service the app calls ----------------

class Accounts:
    def __init__(self, data_dir, vault, settings):
        self.vault = vault
        self.settings = settings  # dict shared with main (heroic flag)
        self.path = os.path.join(data_dir, "accounts.json")
        self.lock = threading.Lock()
        self.running = False
        try:
            with open(self.path, encoding="utf-8") as f:
                self.state = json.load(f)
        except Exception:
            self.state = {}
        self.state.setdefault("sources", {})   # source -> {"games": [...], "synced": t, "error": str, "who": str}
        self.state.setdefault("seen", {})      # source -> [ids seen before]
        self.state.setdefault("ach", {})       # steam appid -> {"done", "total", "t"}
        self.state.setdefault("blacklist", [])  # ids and names you never want suggested
        self._match_cache = None

    def _save(self):
        self._match_cache = None
        saver.save_later(self.path, lambda: self.state, delay=1.0, lock=self.lock)

    # ----- linking -----
    def status(self):
        out = {}
        for src in ("steam", "psn", "heroic", "itch"):
            s = self.state["sources"].get(src) or {}
            out[src] = {"linked": self.linked(src), "who": s.get("who"), "games": len(s.get("games") or []),
                        "synced": s.get("synced"), "error": s.get("error")}
        out["heroic"]["found"] = bool(Heroic.folder())
        out["running"] = self.running
        return out

    def linked(self, src):
        if src == "heroic":
            return bool(self.settings.get("heroic_linked"))
        return self.vault.has(src)

    def link_steam(self, key, who):
        key = key.strip()
        sid = Steam.resolve(key, who)
        games = Steam.owned(key, sid)
        name = Steam.profile(key, sid).get("personaname") or sid
        self.vault.set("steam", {"key": key, "sid": sid})
        self.state["sources"]["steam"] = {"who": name, "games": [], "synced": None}
        self._save()
        return {"who": name, "games": len(games)}

    def link_psn(self, npsso):
        tok = PSN.from_npsso(npsso)
        titles = PSN.trophies(tok["access"])
        self.vault.set("psn", tok)
        self.state["sources"]["psn"] = {"who": "PlayStation Network", "games": [], "synced": None}
        self._save()
        return {"who": "PlayStation Network", "games": len(titles)}

    def link_heroic(self):
        folder = Heroic.folder()
        if not folder:
            raise FileNotFoundError("Heroic isn't installed for this Windows user, or hasn't been opened yet.")
        games = Heroic.library(folder)
        self.settings["heroic_linked"] = True
        self.state["sources"]["heroic"] = {"who": folder, "games": [], "synced": None}
        self._save()
        return {"who": "Heroic", "games": len(games)}

    def link_itch(self, key):
        user = Itch.me(key.strip())
        self.vault.set("itch", {"key": key.strip()})
        self.state["sources"]["itch"] = {"who": user.get("username") or "itch.io", "games": [], "synced": None}
        self._save()
        return {"who": user.get("username"), "games": None}

    def unlink(self, src):
        if src == "heroic":
            self.settings["heroic_linked"] = False
        else:
            self.vault.set(src, None)
        self.state["sources"].pop(src, None)
        self.state["seen"].pop(src, None)
        self._save()

    # ----- fetching -----
    def _psn_access(self):
        tok = self.vault.get("psn") or {}
        if tok.get("access") and time.time() < tok.get("access_until", 0):
            return tok["access"]
        if not tok.get("refresh"):
            raise PermissionError("PlayStation sign-in expired. Link it again with a fresh code.")
        try:
            new = PSN.refresh(tok["refresh"])
        except Exception:
            raise PermissionError("PlayStation sign-in expired. Link it again with a fresh code.")
        new["refresh"] = new.get("refresh") or tok["refresh"]
        self.vault.set("psn", new)
        return new["access"]

    def _fetch(self, src):
        if src == "steam":
            c = self.vault.get("steam")
            out = []
            for g in Steam.owned(c["key"], c["sid"]):
                if JUNK.search(g.get("name", "")):
                    continue
                appid = g["appid"]
                ach = self.state["ach"].get(str(appid))
                recent = g.get("rtime_last_played", 0) > time.time() - 14 * 86400
                if g.get("playtime_forever", 0) > 0 and g.get("has_community_visible_stats") and (not ach or recent or time.time() - ach.get("t", 0) > 3 * 86400):
                    try:
                        a = Steam.achievements(c["key"], c["sid"], appid)
                        self.state["ach"][str(appid)] = {**(a or {"done": 0, "total": 0}), "t": time.time()}
                        ach = self.state["ach"][str(appid)]
                        time.sleep(0.25)
                    except Exception:
                        pass
                out.append({"id": f"steam:{appid}", "name": g.get("name", ""), "platform": "Steam", "minutes": g.get("playtime_forever", 0),
                            "last_played": g.get("rtime_last_played") or None, "appid": appid,
                            "achievements": ach and ach.get("total") and {"done": ach["done"], "total": ach["total"]},
                            "complete": bool(ach and ach.get("total") and ach["done"] == ach["total"])})
            return out
        if src == "psn":
            access = self._psn_access()
            played = {}
            try:
                for t in PSN.played(access):
                    played[_norm(_clean_ps_name(t.get("name")))] = t
            except Exception:
                pass
            out = []
            for t in PSN.trophies(access):
                name = _clean_ps_name(t.get("trophyTitleName"))
                plat = "PS5" if "PS5" in (t.get("trophyTitlePlatform") or "") else "PS4"
                earned, defined = t.get("earnedTrophies") or {}, t.get("definedTrophies") or {}
                p = played.pop(_norm(name), {})
                out.append({"id": f"psn:{t.get('npCommunicationId')}", "name": name, "platform": plat, "art": _ps_art(p),
                            "minutes": _duration_minutes(p.get("playDuration")), "last_played": p.get("lastPlayedDateTime") or t.get("lastUpdatedDateTime"),
                            "trophies": {"progress": t.get("progress", 0), "platinum": bool(earned.get("platinum")), "has_platinum": bool(defined.get("platinum"))},
                            "complete": bool(earned.get("platinum")) or t.get("progress") == 100})
            for t in played.values():  # played but no trophy list
                name = _clean_ps_name(t.get("name"))
                out.append({"id": f"psn:{t.get('titleId')}", "name": name, "platform": "PS5" if "ps5" in (t.get("category") or "") else "PS4", "art": _ps_art(t),
                            "minutes": _duration_minutes(t.get("playDuration")), "last_played": t.get("lastPlayedDateTime"), "complete": False})
            return out
        if src == "heroic":
            return [{"id": f"heroic:{g['runner']}:{g['app']}", "name": g["name"], "platform": "GOG" if g["runner"] == "gog" else "Epic Games",
                     "minutes": g["minutes"], "last_played": g["last_played"], "runner": g["runner"], "app": g["app"], "complete": False}
                    for g in Heroic.library(Heroic.folder() or "")]
        if src == "itch":
            c = self.vault.get("itch")
            return [{"id": f"itch:{g.get('id')}", "name": g.get("title"), "platform": "itch.io", "minutes": 0, "url": g.get("url"),
                     "cover": g.get("cover_url"), "complete": False} for g in Itch.owned(c["key"])]
        return []

    def sync(self):
        if self.running:
            return
        self.running = True
        try:
            for src in ("steam", "psn", "heroic", "itch"):
                if not self.linked(src):
                    continue
                entry = self.state["sources"].setdefault(src, {})
                try:
                    entry["games"] = self._fetch(src)
                    entry["synced"] = time.time()
                    entry["error"] = None
                except Exception as e:
                    entry["error"] = str(e) or e.__class__.__name__
                if src == "steam":
                    try:
                        c = self.vault.get("steam")
                        entry["wishlist"] = Steam.wishlist(c["key"], c["sid"])
                        entry["wishlist_error"] = None
                    except Exception as e:
                        entry["wishlist_error"] = str(e) or e.__class__.__name__
                self._save()
        finally:
            self.running = False

    # ----- matching against the sheet -----
    def match(self, sheet_games):
        """Per sheet game: account facts. Plus candidates the sheet doesn't have yet. Exact names match instantly;
        only the rest are compared, and only against names that share a word. Results are reused until something changes."""
        sig = (tuple((g["name"], g.get("platform")) for g in sheet_games), self.running,
               tuple((k, v.get("synced"), len(v.get("wishlist") or [])) for k, v in self.state["sources"].items()),
               tuple((k, len(v)) for k, v in self.state["seen"].items()), len(self.state["blacklist"]),
               tuple(s for s in ("steam", "psn", "heroic", "itch") if self.linked(s)))
        if self._match_cache and self._match_cache[0] == sig:
            return self._match_cache[1]
        exact, words = {}, {}
        for g in sheet_games:
            k = _norm(g["name"])
            exact.setdefault(k, []).append(g)
            for w in set(k.split()):
                if len(w) > 2:
                    words.setdefault(w, []).append(g)
        black = set(self.state["blacklist"])
        PLATS = {"steam": ("Steam",), "psn": ("PS5", "PS4", "PS2"), "heroic": ("GOG", "Epic Games"), "itch": ("itch.io",)}

        def find(a, src):
            k = _norm(a["name"])
            pool = exact.get(k)
            if not pool:
                cands = {id(g): g for w in set(k.split()) if len(w) > 2 for g in words.get(w, [])}.values()
                best, score = None, 0
                for g in cands:
                    if same_title(a["name"], g["name"], MATCH):
                        sc = similar(a["name"], g["name"])
                        if sc > score:
                            best, score = g, sc
                pool = [best] if best else []
            if not pool:
                return None
            # the same game on several platforms: the row for this account's platform
            return next((g for g in pool if g.get("platform") in PLATS.get(src, ())), pool[0])

        facts, candidates, new_ids, unreviewed, wish = {}, [], [], [], []
        wish_appids = []
        for src, entry in self.state["sources"].items():
            if not self.linked(src):
                continue
            seen = set(self.state["seen"].get(src) or [])
            first_time = not seen
            if first_time and entry.get("games"):
                unreviewed.append(src)
            for a in entry.get("games") or []:
                best = find(a, src)
                if best:
                    f = facts.setdefault(best["name"], {})
                    f.setdefault("sources", []).append(src)
                    f.setdefault("copies", []).append({"src": src, "platform": a.get("platform") or {"steam": "Steam", "itch": "itch.io"}.get(src), "id": a["id"]})
                    f["minutes"] = max(f.get("minutes") or 0, a.get("minutes") or 0)
                    if a.get("last_played"):
                        f["last_played"] = a["last_played"]
                    if a.get("achievements"):
                        f["achievements"] = a["achievements"]
                    if a.get("trophies"):
                        f["trophies"] = a["trophies"]
                    if a.get("complete"):
                        f["complete"] = "Platinum" if src == "psn" and (a.get("trophies") or {}).get("platinum") else "100%"
                    if src == "heroic":
                        f["heroic"] = {"runner": a["runner"], "app": a["app"]}
                    if src == "steam":
                        f["appid"] = a.get("appid")
                    if a.get("art"):
                        f["ps_art"] = a["art"]
                    if src == "psn" and a.get("platform") == "PS5" and best.get("platform") == "PS4":
                        f["ps5_version"] = True   # you have the PS5 version of a PS4 disc: the upgrade is yours
                elif a["id"] not in black and _norm(a["name"]) not in black:
                    c = dict(a, source=src)
                    candidates.append(c)
                    if not first_time and a["id"] not in seen:
                        new_ids.append(c)
            for w in entry.get("wishlist") or []:
                wish_appids.append(w["appid"])
                if w.get("dlc") or not w.get("name"):
                    continue
                best = find(w, "steam")
                if best:
                    facts.setdefault(best["name"], {})["steam_wishlist"] = True
                elif w["id"] not in black and _norm(w["name"]) not in black:
                    wish.append(dict(w, source="steam", wishlist=True))
                    if not first_time and w["id"] not in seen:
                        new_ids.append(dict(w, source="steam", wishlist=True))
        out = {"facts": facts, "candidates": candidates, "wishlist": wish, "wish_appids": wish_appids, "new": new_ids,
               "unreviewed": unreviewed, "running": self.running}
        self._match_cache = (sig, out)
        return out

    def blacklist(self, ids_and_names, remove=False):
        bl = set(self.state["blacklist"])
        for x in ids_and_names:
            x = x if ":" in x else _norm(x)
            (bl.discard if remove else bl.add)(x)
        self.state["blacklist"] = sorted(bl)
        self._save()
        return self.state["blacklist"]

    def mark_seen(self, ids_by_source=None):
        """Remember everything currently owned, so only genuinely new purchases count as new later."""
        for src, entry in self.state["sources"].items():
            ids = [a["id"] for a in (entry.get("games") or []) + (entry.get("wishlist") or [])]
            self.state["seen"][src] = sorted(set(self.state["seen"].get(src) or []) | set(ids))
        self._save()
