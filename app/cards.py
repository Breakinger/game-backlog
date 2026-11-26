"""Steam trading card idling.

How it works, and why it's safe:
- Masterlog never sees your Steam password. It reads two of your own Steam pages (your badges, to see which games
  still drop cards, and your licences, to see what you bought lately) through a Masterlog window you signed into on
  Steam's own sign-in page, the same way Steam Family works.
- To "play" a game it starts a small helper copy of itself that tells the Steam client already running on this PC
  that the game is open, using Valve's own Steam library (steam_api) taken from a game you have installed. On Windows
  that library must carry Valve's digital signature. The helper never connects to a game server, so anti-cheat (VAC)
  never sees it, and it stops on its own if Masterlog closes or Steam quits.
- When you start a real game, idling pauses until you're done.
- Time spent idling is counted here, per game, and taken off the hours Masterlog shows, so your played hours stay real.
- Optional: Steam goes invisible while idling and back to online when it stops (Steam's own steam:// status links).
- Optional (on by default): games you bought in the last 14 days are left alone while they're under 2 hours, so you
  can still refund them (Steam refunds need both: under 14 days and under 2 hours).
"""
import html as _html
import json
import os
import re
import subprocess
import sys
import threading
import time

BADGES = "https://steamcommunity.com/my/badges/?l=english&p={p}"
LICENSES = "https://store.steampowered.com/account/licenses/?l=english"
SIGNIN = "https://steamcommunity.com/login/home/?goto=my%2Fbadges%2F"
REFUND_DAYS = 14
REFUND_HOURS = 2.0
SCAN_EVERY = 10 * 60          # badges while idling, like other card farmers (cards drop roughly every 20-30 min)
LICENSES_EVERY = 6 * 3600
DEFAULTS = {"invisible": True, "refund_guard": True, "parallel": 8, "skip": [], "ignore": []}
WINDOWS = sys.platform == "win32"


# ---------------------------------------------------------------- reading Steam's pages

def _text(s):
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"\s+", " ", _html.unescape(s).replace("\xa0", " ")).strip()


def signed_in(page):
    """Steam's pages carry g_steamID = "7656…" when signed in and g_steamID = false when not."""
    m = re.search(r"g_steamID\s*=\s*(\"\d+\"|false)", page or "")
    return bool(m and m.group(1) != "false")


def parse_badges(page):
    """Games on one badges page: [{appid, name, drops, hours}] plus how many pages there are."""
    games = {}
    for chunk in re.split(r'<div class="badge_row[ "]', page or "")[1:]:
        m = re.search(r'href="[^"]*/gamecards/(\d+)/?', chunk)
        if not m:
            continue   # a community badge, not a game's
        appid = int(m.group(1))
        t = re.search(r'class="badge_title"[^>]*>(.*?)(?:<span class="badge_view_details"|</div>)', chunk, re.S)
        name = _text(t.group(1)) if t else ""
        d = re.search(r'class="progress_info_bold"[^>]*>\s*([\d,]+)\s+card drops? remaining', chunk)
        drops = int(d.group(1).replace(",", "")) if d else 0
        h = re.search(r'([\d,]+(?:\.\d+)?)\s+hrs? on record', _text(chunk))
        hours = float(h.group(1).replace(",", "")) if h else 0.0
        prev = games.get(appid)
        if prev:   # the foil badge of the same game
            prev["drops"] = max(prev["drops"], drops)
            prev["hours"] = max(prev["hours"], hours)
            prev["name"] = prev["name"] or name
        else:
            games[appid] = {"appid": appid, "name": name, "drops": drops, "hours": hours}
    pages = [int(p) for p in re.findall(r'class="pagelink"[^>]*>\s*(\d+)\s*<', page or "")]
    return {"games": list(games.values()), "pages": max(pages + [1]), "signed_in": signed_in(page)}


_MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def _date(s):
    import calendar
    s = _text(s).lower().replace(",", " ")
    m = re.search(r"(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})", s) or None
    if m:
        d, mon, y = int(m.group(1)), m.group(2), int(m.group(3))
    else:
        m = re.search(r"([a-z]{3})[a-z]*\.?\s+(\d{1,2})\s+(\d{4})", s)
        if not m:
            return None
        mon, d, y = m.group(1), int(m.group(2)), int(m.group(3))
    if mon not in _MONTHS:
        return None
    try:
        return calendar.timegm((y, _MONTHS[mon], d, 0, 0, 0))
    except Exception:
        return None


def parse_licenses(page):
    """Every licence on the account: [(date, name)]."""
    out = []
    for date, cell in re.findall(r'<td class="license_date_col">(.*?)</td>\s*<td[^>]*>(.*?)</td>', page or "", re.S):
        cell = re.sub(r'<div class="free_license_remove_link">.*?</div>', " ", cell, flags=re.S)
        ts, name = _date(date), _text(cell)
        if ts and name:
            out.append((ts, name))
    return out


# ---------------------------------------------------------------- deciding what to idle

_NOISE = re.compile(r"\b(the|edition|deluxe|standard|digital|definitive|complete|ultimate|gold|game of the year|goty|"
                    r"bundle|pack|soundtrack|season pass|remastered|enhanced|director'?s cut)\b")


def _key(name):
    s = re.sub(r"[™®©]", "", (name or "").lower())
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", _NOISE.sub(" ", s)).strip()


def same_game(license_name, game_name):
    a, b = _key(license_name), _key(game_name)
    if len(a) < 3 or len(b) < 3:
        return a == b and bool(a)
    return a == b or (" " + b + " ") in (" " + a + " ") or (" " + a + " ") in (" " + b + " ")


def refund_guard(games, licenses, now=None, known=True):
    """Games to leave alone so they stay refundable: {appid: reason}. Only games under 2 hours can still be refunded,
    so only those are ever held back. When the purchase dates can't be read, every game under 2 hours waits."""
    now = now or time.time()
    recent = [(ts, n) for ts, n in (licenses or []) if now - ts <= (REFUND_DAYS + 1) * 86400]
    unmatched = [n for ts, n in recent if not any(same_game(n, g["name"]) for g in games)]
    out = {}
    for g in games:
        if g.get("hours", 0) >= REFUND_HOURS or not g.get("drops"):
            continue
        hits = sorted(((ts, n) for ts, n in recent if same_game(n, g["name"])), key=lambda x: (_key(x[1]) != _key(g["name"]), -x[0]))
        hit = hits[0] if hits else None
        if hit:
            days = max(0, int((now - hit[0]) // 86400))
            out[g["appid"]] = f"Bought {'today' if days == 0 else f'{days} day' + ('s' if days != 1 else '') + ' ago'}: left alone so you can still refund it"
        elif not known:
            out[g["appid"]] = "Couldn't read when you bought it, so it waits while it's under 2 hours"
        elif unmatched:
            out[g["appid"]] = f"Under 2 hours, and a recent purchase (“{unmatched[0][:60]}”) didn't match a game, so it waits"
    return out


def plan(games, held, parallel=8):
    """Which games to idle right now. Games under 2 hours go together first (up to `parallel` at once) until they pass
    2 hours, as cards often only start dropping after that; then one game at a time, which is when cards drop."""
    ready = [g for g in games if g.get("drops", 0) > 0 and g["appid"] not in held]
    if not ready:
        return []
    young = [g for g in ready if g.get("hours", 0) < REFUND_HOURS]
    if young and parallel > 1:
        return [g["appid"] for g in sorted(young, key=lambda g: -g.get("hours", 0))[:parallel]]
    pick = min(ready, key=lambda g: (g["drops"], -g.get("hours", 0), g["appid"]))
    return [pick["appid"]]


# ---------------------------------------------------------------- Valve's Steam library on this PC

def steam_roots():
    roots = []
    if WINDOWS:
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as k:
                roots.append(os.path.normpath(winreg.QueryValueEx(k, "SteamPath")[0]))
        except Exception:
            pass
        roots += [r"C:\Program Files (x86)\Steam", r"C:\Program Files\Steam"]
    else:
        h = os.path.expanduser("~")
        roots += [os.path.join(h, ".local/share/Steam"), os.path.join(h, ".steam/steam"),
                  os.path.join(h, ".var/app/com.valvesoftware.Steam/.local/share/Steam")]
    seen, out = set(), []
    for r in roots:
        try:
            rr = os.path.realpath(r)
        except Exception:
            continue
        if rr not in seen and os.path.isdir(os.path.join(rr, "steamapps")):
            seen.add(rr)
            out.append(rr)
    return out


def libraries():
    libs = []
    for root in steam_roots():
        libs.append(root)
        try:
            with open(os.path.join(root, "steamapps", "libraryfolders.vdf"), encoding="utf-8", errors="replace") as f:
                for p in re.findall(r'"path"\s+"([^"]+)"', f.read()):
                    libs.append(os.path.normpath(p.replace("\\\\", "\\")))
        except Exception:
            pass
    seen, out = set(), []
    for l in libs:
        rl = os.path.realpath(l)
        if rl not in seen and os.path.isdir(os.path.join(rl, "steamapps", "common")):
            seen.add(rl)
            out.append(rl)
    return out


LIBNAME = "steam_api64.dll" if WINDOWS else "libsteam_api.so"


def find_steam_api(limit_dirs=6000):
    """Copies of steam_api that came with your installed games, newest first."""
    found, visited = [], 0
    for lib in libraries():
        common = os.path.join(lib, "steamapps", "common")
        try:
            games = sorted(os.scandir(common), key=lambda e: e.name.lower())
        except Exception:
            continue
        for g in games:
            if not g.is_dir():
                continue
            for dirpath, dirnames, files in os.walk(g.path):
                visited += 1
                if dirpath[len(g.path):].count(os.sep) >= 6 or visited > limit_dirs:
                    dirnames[:] = []
                if LIBNAME in files:
                    found.append(os.path.join(dirpath, LIBNAME))
                    break
            if len(found) >= 12 or visited > limit_dirs:
                break
    return sorted(found, key=lambda p: os.path.getmtime(p), reverse=True)


def _elf64(path):
    try:
        with open(path, "rb") as f:
            h = f.read(20)
        return h[:4] == b"\x7fELF" and h[4] == 2 and int.from_bytes(h[18:20], "little") == 62
    except Exception:
        return False


def valve_signed(path):
    """Windows: the file carries a valid digital signature from Valve."""
    if not WINDOWS:
        return _elf64(path)
    try:
        env = dict(os.environ, ML_FILE=path)
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command",
                            "$s = Get-AuthenticodeSignature -LiteralPath $env:ML_FILE; \"$($s.Status)|$($s.SignerCertificate.Subject)\""],
                           capture_output=True, text=True, timeout=30, env=env, creationflags=0x08000000)
        status, _, subject = (r.stdout or "").strip().partition("|")
        return status == "Valid" and re.search(r"\bO=\"?Valve\b", subject) is not None
    except Exception:
        return False


# ---------------------------------------------------------------- the helper that "plays" one game

def helper_main(argv):
    """Runs as `Masterlog --idle <appid> --parent <pid> --lib <steam_api> --status <file>` and does nothing else."""
    import ctypes

    def arg(name):
        i = argv.index(name)
        return argv[i + 1]
    appid, parent, lib, status = int(arg("--idle")), int(arg("--parent")), arg("--lib"), arg("--status")

    def say(s):
        try:
            with open(status, "w", encoding="utf-8") as f:
                f.write(s)
        except Exception:
            pass
    os.environ["SteamAppId"] = os.environ["SteamGameId"] = str(appid)
    try:
        dll = ctypes.CDLL(lib)
    except OSError as e:
        say(f"fail Couldn't load Steam's library: {e}")
        return 2
    ok, why = False, ""
    try:
        f = dll.SteamAPI_InitFlat
        f.restype, f.argtypes = ctypes.c_int, [ctypes.c_char_p]
        buf = ctypes.create_string_buffer(1024)
        ok = f(buf) == 0
        why = buf.value.decode("utf-8", "replace")
    except AttributeError:
        for name in ("SteamAPI_InitSafe", "SteamAPI_Init"):
            try:
                f = getattr(dll, name)
            except AttributeError:
                continue
            f.restype, f.argtypes = ctypes.c_bool, []
            ok = bool(f())
            break
    if not ok:
        say("fail " + (why or "Steam didn't start the game. Is Steam running, and do you own it?"))
        return 3
    say("ok")
    run = getattr(dll, "SteamAPI_RunCallbacks", None)
    running = getattr(dll, "SteamAPI_IsSteamRunning", None)
    if running:
        running.restype = ctypes.c_bool
    alive = _parent_watch(parent)
    try:
        while alive():
            if running and not running():
                break
            if run:
                run()
            time.sleep(5)
    finally:
        try:
            dll.SteamAPI_Shutdown()
        except Exception:
            pass
        say("stopped")
    return 0


def _parent_watch(pid):
    if WINDOWS:
        import ctypes
        k = ctypes.windll.kernel32
        h = k.OpenProcess(0x00100000, False, pid)   # SYNCHRONIZE
        if not h:
            return lambda: False
        return lambda: k.WaitForSingleObject(h, 0) != 0   # 0 = the parent has exited
    return lambda: os.getppid() == pid


# ---------------------------------------------------------------- is a real game running?

# Steam apps that run in the background all day; they aren't games you're playing
BACKGROUND = {"wallpaper_engine", "steamworks shared", "steamvr", "steam controller configs", "lossless scaling",
              "soundpad", "fpsvr", "ovr advanced settings", "voicemeeter"}


def _appname(appid):
    for lib in libraries():
        try:
            with open(os.path.join(lib, "steamapps", f"appmanifest_{appid}.acf"), encoding="utf-8", errors="replace") as f:
                m = re.search(r'"name"\s+"([^"]+)"', f.read())
                if m:
                    return m.group(1)
        except Exception:
            continue
    return ""


def _win_game():
    """Windows: the folder name of a program running from a Steam library's steamapps\\common, or ''."""
    import ctypes
    from ctypes import wintypes as w
    commons = [os.path.normcase(os.path.join(l, "steamapps", "common")) + os.sep for l in libraries()]
    if not commons:
        return ""
    psapi, k = ctypes.WinDLL("psapi"), ctypes.WinDLL("kernel32")
    arr, needed = (w.DWORD * 4096)(), w.DWORD()
    if not psapi.EnumProcesses(arr, ctypes.sizeof(arr), ctypes.byref(needed)):
        return ""
    buf = ctypes.create_unicode_buffer(1024)
    me = os.getpid()
    for pid in arr[:needed.value // ctypes.sizeof(w.DWORD)]:
        if not pid or pid == me:
            continue
        h = k.OpenProcess(0x1000, False, pid)   # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            continue
        try:
            size = w.DWORD(1024)
            if k.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
                path = os.path.normcase(buf.value)
                for c in commons:
                    if path.startswith(c):
                        return buf.value[len(c):].split("\\")[0]
        finally:
            k.CloseHandle(h)
    return ""


def _ancestors():
    out, pid = set(), os.getpid()
    for _ in range(32):
        out.add(pid)
        try:
            with open(f"/proc/{pid}/stat", encoding="utf-8") as f:
                pid = int(f.read().rsplit(")", 1)[1].split()[1])
        except Exception:
            break
        if pid <= 1:
            break
    return out


def _linux_game():
    """Linux and the Steam Deck: the app id Steam launched a game with (its 'reaper SteamLaunch AppId=…'), or 0.
    Masterlog itself is skipped when Steam launched it (a non-Steam shortcut in Gaming Mode)."""
    mine = _ancestors()
    try:
        pids = [p for p in os.listdir("/proc") if p.isdigit()]
    except Exception:
        return 0
    for pid in pids:
        if int(pid) in mine:
            continue
        try:
            with open(f"/proc/{pid}/cmdline", "rb") as f:
                cmd = f.read()
        except Exception:
            continue
        if b"SteamLaunch" in cmd:
            m = re.search(rb"AppId=(\d+)", cmd)
            if m and 0 < int(m.group(1)) < 0x80000000:   # non-Steam shortcuts have the top bit set
                return int(m.group(1))
    return 0


def real_game_running(ignore=()):
    """What you're really playing: a name to show, or '' when nothing is running."""
    ign = {str(x).lower() for x in ignore} | BACKGROUND
    try:
        if WINDOWS:
            name = _win_game()
            return name if name and name.lower() not in ign else ""
        appid = _linux_game()
        if not appid or str(appid) in ign:
            return ""
        name = _appname(appid) or f"app {appid}"
        return name if name.lower() not in ign else ""
    except Exception:
        return ""


def set_status(which):
    """Steam's own friends status link: steam://friends/status/invisible or /online."""
    url = f"steam://friends/status/{which}"
    try:
        if WINDOWS:
            os.startfile(url)   # noqa: the steam:// link, nothing else
        else:
            import shutil
            exe = shutil.which("steam")
            subprocess.Popen([exe, url] if exe else ["xdg-open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             start_new_session=True)
        return True
    except Exception:
        return False


# ---------------------------------------------------------------- the whole thing

class Cards:
    def __init__(self, data_dir, fetch):
        self.dir = data_dir
        self.fetch = fetch            # reads a Steam page through Masterlog's signed-in browser window
        self.path = os.path.join(data_dir, "cards.json")
        self.lock = threading.RLock()
        self.procs = {}               # appid -> {"p": Popen, "status": path, "t": started, "ok": bool}
        self.failed = {}              # appid -> reason, for this run
        self.active = False
        self.paused_for = ""
        self.note = ""
        self.scanning = False
        self.thread = None
        try:
            with open(self.path, encoding="utf-8") as f:
                self.data = json.load(f)
        except Exception:
            self.data = {}
        self.data.setdefault("games", [])
        self.data.setdefault("idle", {})
        self.data["settings"] = {**DEFAULTS, **(self.data.get("settings") or {})}
        # Masterlog stopped without putting Steam back online last time
        if self.data.get("went_invisible"):
            set_status("online")
            self.data["went_invisible"] = False
            self._save()

    # ----- saved state
    def _save(self):
        tmp = self.path + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.data, f)
            os.replace(tmp, self.path)
        except Exception:
            pass

    def idle_minutes(self):
        return {k: int(v / 60) for k, v in (self.data.get("idle") or {}).items()}

    def settings(self, new=None):
        with self.lock:
            s = self.data["settings"]
            if new:
                if "invisible" in new:
                    s["invisible"] = bool(new["invisible"])
                    if self.active and not self.paused_for:
                        if s["invisible"] and not self.data.get("went_invisible"):
                            self._go_invisible()
                        elif not s["invisible"] and self.data.get("went_invisible"):
                            self._go_online()
                if "refund_guard" in new:
                    s["refund_guard"] = bool(new["refund_guard"])
                if "parallel" in new:
                    s["parallel"] = max(1, min(32, int(new["parallel"] or 1)))
                self._save()
                if self.active:
                    self._apply()
            return dict(s)

    def skip(self, appid, on):
        with self.lock:
            sk = set(self.data["settings"].get("skip") or [])
            (sk.add if on else sk.discard)(int(appid))
            self.data["settings"]["skip"] = sorted(sk)
            self._save()
            if self.active:
                self._apply()

    def ignore(self, name):
        """Don't pause for this program any more (something that runs in the background, not a game)."""
        with self.lock:
            ig = [x for x in self.data["settings"].get("ignore") or [] if x.lower() != str(name).lower()] + [str(name)[:120]]
            self.data["settings"]["ignore"] = ig[-30:]
            self._save()
            if self.paused_for and str(self.paused_for).lower() == str(name).lower():
                self.paused_for = ""

    # ----- Steam's library
    def library(self, refresh=False):
        lib = self.data.get("lib") or {}
        p = lib.get("path")
        try:
            same = p and os.path.isfile(p) and os.path.getsize(p) == lib.get("size") and os.path.getmtime(p) == lib.get("mtime")
        except Exception:
            same = False
        if same and lib.get("ok") and not refresh:
            return p
        for c in find_steam_api():
            if valve_signed(c):
                self.data["lib"] = {"path": c, "size": os.path.getsize(c), "mtime": os.path.getmtime(c), "ok": True}
                self._save()
                return c
        self.data["lib"] = {"ok": False, "t": time.time()}
        self._save()
        return None

    # ----- reading Steam
    def scan(self):
        if self.scanning:
            return
        self.scanning = True
        try:
            first = parse_badges(self.fetch(BADGES.format(p=1)))
            if not first["signed_in"]:
                self.data["signed_in"] = False
                self.note = "Sign in to Steam so Masterlog can see which games still drop cards."
                self._save()
                return
            games = {g["appid"]: g for g in first["games"]}
            for p in range(2, min(first["pages"], 40) + 1):
                time.sleep(1.2)
                for g in parse_badges(self.fetch(BADGES.format(p=p)))["games"]:
                    games.setdefault(g["appid"], g)
            self.data.update(games=sorted(games.values(), key=lambda g: (-g["drops"], g["name"].lower())), t=time.time(), signed_in=True)
            if self.note.startswith("Sign in") or self.note.startswith("Couldn't read"):
                self.note = ""
            if time.time() - (self.data.get("lic_t") or 0) > LICENSES_EVERY or not self.data.get("lic_ok"):
                try:
                    page = self.fetch(LICENSES)
                    lic = parse_licenses(page) if signed_in(page) else None
                except Exception:
                    lic = None
                cut = time.time() - 40 * 86400
                self.data["licenses"] = [[ts, n] for ts, n in (lic or []) if ts >= cut]
                self.data["lic_ok"] = lic is not None
                self.data["lic_t"] = time.time()
            self._save()
        except Exception as e:
            self.note = f"Couldn't read your Steam badges: {str(e)[:120]}"
        finally:
            self.scanning = False

    # ----- what's held back, and why
    def held(self):
        s = self.data["settings"]
        games = self.data["games"]
        out = {a: "You chose not to idle it" for a in (s.get("skip") or [])}
        if s.get("refund_guard"):
            for a, why in refund_guard(games, [tuple(x) for x in self.data.get("licenses") or []],
                                       known=bool(self.data.get("lic_ok"))).items():
                out.setdefault(a, why)
        for a, why in self.failed.items():
            out.setdefault(a, why)
        return out

    # ----- start and stop
    def start(self):
        with self.lock:
            if self.active:
                return {"ok": True}
            if not self.library():
                return {"error": "Masterlog couldn't find Valve's Steam library (steam_api) in any game you have installed. "
                                 + ("Install any Steam game (a free one is fine) and try again." if WINDOWS else
                                    "Install a game that runs natively on Linux (Counter-Strike 2 or Portal 2, say) and try again.")}
            self.active, self.paused_for, self.failed, self.note = True, "", {}, ""
            self.thread = threading.Thread(target=self._loop, daemon=True, name="card idling")
            self.thread.start()
            return {"ok": True}

    def stop(self, note=""):
        with self.lock:
            self.active = False
            self._stop_all()
            self._go_online()
            self.note = note
            self.paused_for = ""

    def shutdown(self):
        """Masterlog is closing."""
        try:
            self.stop()
        except Exception:
            pass

    def _go_invisible(self):
        if self.data["settings"].get("invisible") and set_status("invisible"):
            self.data["went_invisible"] = True
            self._save()

    def _go_online(self):
        if self.data.get("went_invisible"):
            set_status("online")
            self.data["went_invisible"] = False
            self._save()

    def _spawn(self, appid, lib):
        # each helper runs in a folder of its own whose steam_appid.txt names its game, so a steam_appid.txt
        # lying next to the library in a game's folder can never point Steam at the wrong game
        sdir = os.path.join(self.dir, "idle", str(int(appid)))
        os.makedirs(sdir, exist_ok=True)
        with open(os.path.join(sdir, "steam_appid.txt"), "w", encoding="ascii") as f:
            f.write(str(int(appid)))
        status = os.path.join(sdir, "status")
        try:
            os.remove(status)
        except Exception:
            pass
        me = [sys.executable] if getattr(sys, "frozen", False) else [sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "main.py")]
        cmd = me + ["--idle", str(appid), "--parent", str(os.getpid()), "--lib", lib, "--status", status]
        env = dict(os.environ, SteamAppId=str(appid), SteamGameId=str(appid))
        kw = {"creationflags": 0x08000000} if WINDOWS else {"start_new_session": False}
        p = subprocess.Popen(cmd, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             cwd=sdir, **kw)
        self.procs[appid] = {"p": p, "status": status, "t": time.time(), "last": time.time(), "ok": False}

    def _stop(self, appid):
        e = self.procs.pop(appid, None)
        if not e:
            return
        try:
            e["p"].terminate()
            e["p"].wait(timeout=5)
        except Exception:
            try:
                e["p"].kill()
            except Exception:
                pass

    def _stop_all(self):
        for a in list(self.procs):
            self._stop(a)

    def _apply(self):
        """Start and stop helpers so the games idling match the plan."""
        want = set(plan(self.data["games"], self.held(), self.data["settings"].get("parallel", 8)))
        for a in [a for a in self.procs if a not in want]:
            self._stop(a)
        lib = self.library() if want - set(self.procs) else None
        for a in want - set(self.procs):
            if lib:
                self._spawn(a, lib)
        if want and not self.data.get("went_invisible"):
            self._go_invisible()
        return want

    def _tick_procs(self):
        now = time.time()
        idle = self.data["idle"]
        for a, e in list(self.procs.items()):
            st = ""
            try:
                with open(e["status"], encoding="utf-8") as f:
                    st = f.read().strip()
            except Exception:
                pass
            if st == "ok":
                e["ok"] = True
            if e["ok"]:
                idle[str(a)] = idle.get(str(a), 0) + (now - e["last"])
            e["last"] = now
            if st.startswith("fail") or e["p"].poll() is not None:
                why = st[5:] if st.startswith("fail") else "The helper stopped"
                self.failed[a] = f"Steam wouldn't start it: {why}"[:200]
                self._stop(a)
            elif not e["ok"] and now - e["t"] > 60:
                self.failed[a] = "Steam didn't answer when Masterlog tried to start it"
                self._stop(a)
        self._save()

    def _loop(self):
        last_scan = 0
        real_gone = 0
        while self.active:
            try:
                with self.lock:
                    real = real_game_running(self.data["settings"].get("ignore") or [])
                    if real:
                        real_gone = 0
                        if not self.paused_for:
                            self._stop_all()
                            self._go_online()
                        self.paused_for = real
                    elif self.paused_for:
                        real_gone = real_gone or time.time()
                        if time.time() - real_gone >= 60:   # a minute after the game closed
                            self.paused_for = ""
                            last_scan = 0
                    if not self.paused_for:
                        self._tick_procs()
                if not self.paused_for and time.time() - last_scan > SCAN_EVERY:
                    self.scan()
                    last_scan = time.time()
                    if self.data.get("signed_in") is False:
                        self.stop("Sign in to Steam so Masterlog can see which games still drop cards.")
                        break
                with self.lock:
                    if self.active and not self.paused_for:
                        if not self._apply() and not self.procs:
                            left = [g for g in self.data["games"] if g["drops"] > 0]
                            self.stop("All done: no card drops left." if not left else
                                      "Nothing left to idle: the games that still drop cards are held back (see the list).")
                            break
            except Exception as e:
                self.note = f"Card idling hit a problem: {str(e)[:120]}"
            for _ in range(5):         # about 5 seconds between checks
                if not self.active:
                    break
                time.sleep(1)

    # ----- what the page shows
    def view(self):
        with self.lock:
            held = self.held()
            idle = self.data.get("idle") or {}
            games = []
            for g in self.data.get("games") or []:
                a = g["appid"]
                if g["drops"] <= 0 and str(a) not in idle:
                    continue
                e = self.procs.get(a)
                state = "idling" if e and e["ok"] else "starting" if e else "held" if a in held else "done" if g["drops"] <= 0 else "waiting"
                games.append({**g, "state": state, "why": held.get(a, ""), "idle_min": int(idle.get(str(a), 0) / 60),
                              "skipped": a in set(self.data["settings"].get("skip") or [])})
            lib = self.data.get("lib") or {}
            return {"active": self.active, "paused_for": self.paused_for, "note": self.note, "scanning": self.scanning,
                    "signed_in": self.data.get("signed_in"), "t": self.data.get("t") or 0, "lic_ok": self.data.get("lic_ok"),
                    "settings": dict(self.data["settings"]), "games": games, "lib_missing": lib.get("ok") is False,
                    "drops": sum(g["drops"] for g in self.data.get("games") or [] if g["appid"] not in held),
                    "windows": WINDOWS}
