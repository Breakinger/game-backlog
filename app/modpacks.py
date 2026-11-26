"""Modpacks and mod profiles from the mod managers on this PC: CurseForge, r2modman / Thunderstore Mod Manager,
Vortex (and the Nexus Mods collections it installed), Mod Organizer 2, and, with your free Nexus Mods API key,
the mods you track and endorse on Nexus Mods. Only reads; nothing is changed or downloaded."""
import glob
import json
import os
import re
import time
import urllib.parse
import urllib.request

VORTEX_GAMES = {
    "skyrimse": "The Elder Scrolls V: Skyrim Special Edition", "skyrim": "The Elder Scrolls V: Skyrim", "skyrimvr": "Skyrim VR",
    "fallout4": "Fallout 4", "fallout3": "Fallout 3", "falloutnv": "Fallout: New Vegas", "fallout76": "Fallout 76",
    "oblivion": "The Elder Scrolls IV: Oblivion", "oblivionremastered": "The Elder Scrolls IV: Oblivion Remastered",
    "morrowind": "The Elder Scrolls III: Morrowind", "starfield": "Starfield", "cyberpunk2077": "Cyberpunk 2077",
    "baldursgate3": "Baldur's Gate 3", "witcher3": "The Witcher 3: Wild Hunt", "stardewvalley": "Stardew Valley",
    "eldenring": "Elden Ring", "monsterhunterworld": "Monster Hunter: World", "monsterhunterwilds": "Monster Hunter Wilds",
    "bladeandsorcery": "Blade & Sorcery", "mountandblade2bannerlord": "Mount & Blade II: Bannerlord", "kingdomcomedeliverance2": "Kingdom Come: Deliverance II",
    "dragonage": "Dragon Age: Origins", "masseffectlegendaryedition": "Mass Effect Legendary Edition", "darksouls3": "Dark Souls III",
}


# Vortex calls a few games by a different id than Nexus Mods does
NEXUS_DOMAIN = {"skyrimse": "skyrimspecialedition", "falloutnv": "newvegas", "fallout4": "fallout4", "witcher3": "witcher3",
                "oblivionremastered": "oblivionremastered", "baldursgate3": "baldursgate3", "cyberpunk2077": "cyberpunk2077"}


def _home():
    return os.path.expanduser("~")


def _appdata():
    return os.environ.get("APPDATA") or os.path.join(_home(), "AppData", "Roaming")


def _localappdata():
    return os.environ.get("LOCALAPPDATA") or os.path.join(_home(), "AppData", "Local")


def _pretty(game):
    """'RiskOfRain2' -> 'Risk Of Rain 2'."""
    return re.sub(r"(?<=[a-z])(?=[A-Z0-9])|(?<=[0-9])(?=[A-Z])", " ", game).replace("_", " ").strip()


def _mtime(p):
    try:
        return int(os.path.getmtime(p))
    except OSError:
        return None


def curseforge():
    out = []
    roots = [os.path.join(_home(), "curseforge", "minecraft", "Instances"), os.path.join(_home(), "Documents", "Curse", "Minecraft", "Instances")]
    for root in roots:
        for f in glob.glob(os.path.join(root, "*", "minecraftinstance.json")):
            try:
                with open(f, encoding="utf-8") as fh:
                    d = json.load(fh)
            except Exception:
                continue
            loader = (d.get("baseModLoader") or {}).get("name") or ""
            out.append({"id": "curseforge:" + os.path.dirname(f), "manager": "CurseForge", "game": "Minecraft",
                        "profile": d.get("name") or os.path.basename(os.path.dirname(f)), "mods": len(d.get("installedAddons") or []),
                        "detail": " · ".join(x for x in (d.get("gameVersion"), loader) if x), "path": os.path.dirname(f), "last": _mtime(f)})
    return out


def thunderstore():
    out = []
    for base, label in ((os.path.join(_appdata(), "r2modmanPlus-local"), "r2modman"),
                        (os.path.join(_appdata(), "Thunderstore Mod Manager", "DataFolder"), "Thunderstore")):
        for prof in glob.glob(os.path.join(base, "*", "profiles", "*")):
            if not os.path.isdir(prof):
                continue
            game = os.path.basename(os.path.dirname(os.path.dirname(prof)))
            mods = 0
            try:
                with open(os.path.join(prof, "mods.yml"), encoding="utf-8") as fh:
                    mods = sum(1 for line in fh if re.match(r"^-\s+manifestVersion:", line))
            except OSError:
                pass
            out.append({"id": f"{label.lower()}:{prof}", "manager": label, "game": _pretty(game), "profile": os.path.basename(prof),
                        "mods": mods, "detail": "", "path": prof, "last": _mtime(prof)})
    return out


def _vortex_state():
    """Vortex keeps its state in a database; its JSON state backups carry the same thing."""
    for f in sorted(glob.glob(os.path.join(_appdata(), "Vortex", "temp", "state_backups*", "*.json")), key=_mtime, reverse=True)[:3]:
        try:
            with open(f, encoding="utf-8") as fh:
                d = json.load(fh)
        except Exception:
            continue
        if (d.get("persistent") or {}).get("profiles") or (d.get("persistent") or {}).get("mods"):
            return d, _mtime(f)
    return {}, None


def _vortex_names(state=None):
    names = {}
    for pid, p in (((state if state is not None else _vortex_state()[0]).get("persistent") or {}).get("profiles") or {}).items():
        if isinstance(p, dict) and p.get("name"):
            names.setdefault(pid, p["name"])
    return names


def _ts(v):
    try:
        if isinstance(v, (int, float)):
            return int(v / 1000 if v > 1e11 else v)
        return int(time.mktime(time.strptime(str(v)[:19], "%Y-%m-%dT%H:%M:%S")))
    except Exception:
        return None


def vortex_collections(state=None, when=None):
    """Nexus Mods collections installed through Vortex: each is a modpack of its own."""
    if state is None:
        state, when = _vortex_state()
    out = []
    for gid, mods in (((state.get("persistent") or {}).get("mods")) or {}).items():
        if not isinstance(mods, dict):
            continue
        for mid, m in mods.items():
            if not isinstance(m, dict) or m.get("type") != "collection":
                continue
            a = m.get("attributes") or {}
            name = a.get("customFileName") or a.get("modName") or a.get("name") or a.get("logicalFileName") or mid
            rules = [r for r in (m.get("rules") or []) if isinstance(r, dict) and r.get("type") in ("requires", "recommends")]
            slug, domain = a.get("collectionSlug"), NEXUS_DOMAIN.get(gid, gid)
            url = f"https://www.nexusmods.com/games/{domain}/collections/{slug}" if slug else ""
            rev = a.get("revisionNumber")
            out.append({"id": f"nexus-collection:{gid}:{mid}", "manager": "Nexus Mods collection", "game": VORTEX_GAMES.get(gid, _pretty(gid).title()),
                        "profile": str(name), "mods": len(rules), "detail": " · ".join(x for x in (f"revision {rev}" if rev else "", a.get("author") or "") if x),
                        "url": url, "path": "", "last": _ts(a.get("installTime")) or when})
    return out


# ---------- Nexus Mods account (free personal API key) ----------
NEXUS_API = "https://api.nexusmods.com/v1/"
_nexus_games = {"t": 0, "names": {}}


def _nexus(path, key):
    from version import VERSION
    req = urllib.request.Request(NEXUS_API + path, headers={"apikey": key, "Accept": "application/json", "Application-Name": "Masterlog",
                                                            "Application-Version": str(VERSION), "User-Agent": f"Masterlog/{VERSION}"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def nexus_validate(key):
    d = _nexus("users/validate.json", key)
    return {"name": d.get("name"), "premium": bool(d.get("is_premium"))}


def nexus_game_names(key):
    if time.time() - _nexus_games["t"] > 86400 or not _nexus_games["names"]:
        try:
            _nexus_games["names"] = {g["domain_name"]: g["name"] for g in _nexus("games.json", key) if g.get("domain_name")}
            _nexus_games["t"] = time.time()
        except Exception:
            pass
    return _nexus_games["names"]


def nexus_account(key):
    """Your tracked and endorsed mods on Nexus Mods, one entry per game."""
    if not key:
        return []
    names = nexus_game_names(key)
    groups = {}
    for kind, path in (("Tracked mods", "user/tracked_mods.json"), ("Endorsed mods", "user/endorsements.json")):
        try:
            rows = _nexus(path, key)
        except Exception:
            continue
        for r in rows if isinstance(rows, list) else []:
            if kind == "Endorsed mods" and str(r.get("status", "")).lower() not in ("endorsed", ""):
                continue
            dom = r.get("domain_name")
            if dom:
                groups.setdefault((dom, kind), 0)
                groups[(dom, kind)] += 1
    out = []
    for (dom, kind), n in sorted(groups.items(), key=lambda x: -x[1]):
        out.append({"id": f"nexus:{dom}:{kind}", "manager": "Nexus Mods", "game": names.get(dom) or VORTEX_GAMES.get(dom) or _pretty(dom).title(),
                    "profile": kind, "mods": n, "detail": "on your Nexus Mods account", "url": f"https://www.nexusmods.com/games/{dom}/mods", "path": "", "last": None})
    return out


def nexus_app():
    """The new Nexus Mods app keeps its loadouts in a database Masterlog can't read yet; just say it's there."""
    return os.path.isdir(os.path.join(_localappdata(), "NexusMods.App"))


def nexus_link(name, key=None):
    """A Nexus Mods page for a game: its mods page when the game is known, otherwise a search."""
    want = re.sub(r"[^a-z0-9]+", "", (name or "").lower())
    pool = dict((v, k) for k, v in VORTEX_GAMES.items())
    if key:
        pool.update({v: k for k, v in nexus_game_names(key).items()})
    for title, dom in pool.items():
        if re.sub(r"[^a-z0-9]+", "", title.lower()) == want:
            return f"https://www.nexusmods.com/games/{NEXUS_DOMAIN.get(dom, dom)}/mods"
    return "https://www.nexusmods.com/search?keyword=" + urllib.parse.quote(name or "")


def vortex():
    out = []
    names = _vortex_names()
    for prof in glob.glob(os.path.join(_appdata(), "Vortex", "*", "profiles", "*")):
        if not os.path.isdir(prof):
            continue
        gid = os.path.basename(os.path.dirname(os.path.dirname(prof)))
        pid = os.path.basename(prof)
        mods = 0
        try:
            with open(os.path.join(prof, "plugins.txt"), encoding="utf-8", errors="ignore") as fh:
                mods = sum(1 for line in fh if line.startswith("*"))
        except OSError:
            pass
        out.append({"id": f"vortex:{gid}:{pid}", "manager": "Vortex", "game": VORTEX_GAMES.get(gid, _pretty(gid).title()),
                    "profile": names.get(pid) or f"Profile {pid[:6]}", "mods": mods, "detail": "active plugins" if mods else "",
                    "path": prof, "last": _mtime(prof)})
    return out


def mod_organizer():
    out = []
    for inst in glob.glob(os.path.join(_localappdata(), "ModOrganizer", "*")):
        ini = os.path.join(inst, "ModOrganizer.ini")
        if not os.path.isfile(ini):
            continue
        game = os.path.basename(inst)
        try:
            with open(ini, encoding="utf-8", errors="ignore") as fh:
                m = re.search(r"^gameName=(.+)$", fh.read(), re.M)
                if m:
                    game = m.group(1).strip()
        except OSError:
            pass
        for prof in glob.glob(os.path.join(inst, "profiles", "*")):
            mods = 0
            try:
                with open(os.path.join(prof, "modlist.txt"), encoding="utf-8", errors="ignore") as fh:
                    mods = sum(1 for line in fh if line.startswith("+"))
            except OSError:
                pass
            out.append({"id": f"mo2:{prof}", "manager": "Mod Organizer 2", "game": game,
                        "profile": os.path.basename(prof) if os.path.basename(prof) in (os.path.basename(inst), "Default") and os.path.basename(inst) != game
                        else f"{os.path.basename(inst)} · {os.path.basename(prof)}" if os.path.basename(inst) != game else os.path.basename(prof),
                        "mods": mods, "detail": "enabled mods" if mods else "", "path": prof, "last": _mtime(prof)})
    return out


def scan(nexus_key=None):
    out = []
    for fn in (curseforge, thunderstore, vortex, vortex_collections, mod_organizer):
        try:
            out += fn()
        except Exception:
            continue
    try:
        out += nexus_account(nexus_key)
    except Exception:
        pass
    out.sort(key=lambda p: -(p.get("last") or 0))
    return {"items": out, "t": time.time(), "nexus_app": nexus_app(), "nexus": bool(nexus_key)}
