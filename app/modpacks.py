"""Modpacks and mod profiles from the mod managers on this PC: CurseForge, r2modman / Thunderstore Mod Manager,
Vortex and Mod Organizer 2. Only reads their folders; nothing is changed."""
import glob
import json
import os
import re
import time

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


def _vortex_names():
    """Vortex keeps profile names in its database; its JSON state backups carry them too."""
    names = {}
    for f in sorted(glob.glob(os.path.join(_appdata(), "Vortex", "temp", "state_backups*", "*.json")), key=_mtime, reverse=True)[:3]:
        try:
            with open(f, encoding="utf-8") as fh:
                d = json.load(fh)
        except Exception:
            continue
        for pid, p in ((d.get("persistent") or {}).get("profiles") or {}).items():
            if isinstance(p, dict) and p.get("name"):
                names.setdefault(pid, p["name"])
        if names:
            break
    return names


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


def scan():
    out = []
    for fn in (curseforge, thunderstore, vortex, mod_organizer):
        try:
            out += fn()
        except Exception:
            continue
    out.sort(key=lambda p: -(p.get("last") or 0))
    return {"items": out, "t": time.time()}
