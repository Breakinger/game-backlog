"""Official titles. A name in your sheet that the stores don't know ('Resident Evil 9 Requiem', 'Uncharted 4: Theif's End',
'Devil May Cry 3') is why a game ends up without a cover, a manual or ratings. This finds the official title on Steam,
Metacritic and IGDB, checks it against the developer in your sheet, and only accepts it when it's clearly the same game."""
import json
import re
import urllib.parse
import urllib.request

from art import _norm, numerals, same_title, similar, companies_agree

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
EDITION_TAIL = re.compile(r"^(?:special|legendary|hd|deluxe|digital deluxe|complete|ultimate|gold|goty|game of the year|standard|premium|definitive|enhanced|"
                          r"remastered|director'?s cut|anniversary|collector'?s|launch|pre-?order|soundtrack|season pass|dlc|demo|playtest|"
                          r"bundle|pack|upgrade)\b", re.I)


def _json(url, headers=None):
    h = {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", "Accept": "application/json"}
    h.update(headers or {})
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=15) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def _words(s):
    return [w for w in _norm(s).split() if w]


def _same_words_minus_numbers(mine, official):
    """'Resident Evil 9 Requiem' vs 'Resident Evil Requiem': identical once the number you added is ignored."""
    words = _words(mine)
    is_num = lambda w: (w.isdigit() and len(w) <= 2) or w in ("ii", "iii", "iv", "vi", "vii", "viii", "ix")
    if not words or is_num(words[-1]):
        return False   # 'Devil May Cry 3' is the third game, not 'Devil May Cry' with a stray number
    a = [w for w in words if not is_num(w)]
    b = _words(official)
    return len(b) >= 2 and a == b and words != b


def _extends(mine, official):
    """'Devil May Cry 3' -> 'Devil May Cry 3: Dante's Awakening' (same name and numbers plus a real subtitle)."""
    if numerals(mine) != numerals(official):
        return False
    nm, no = _norm(mine), _norm(official)
    if not no.startswith(nm + " "):
        return False
    raw = official.strip()
    tail = re.sub(r"^\s*[:\-–—]\s*", "", raw[len(mine.strip()):]).strip() if raw.lower().startswith(mine.strip().lower()) else no[len(nm):].strip()
    return bool(tail) and not EDITION_TAIL.match(tail)


ROMAN = {"ii": "2", "iii": "3", "iv": "4", "v": "5", "vi": "6", "vii": "7", "viii": "8", "ix": "9", "x": "10", "xi": "11", "xii": "12"}


def _canon(s):
    return " ".join(ROMAN.get(w, w) for w in _words(s))


def classify(mine, official):
    """How an official title relates to your name: 'typo', 'subtitle', 'number', or None (different game / no change)."""
    if not official or _canon(official) == _canon(mine):
        return None   # same title written differently (II vs 2, The, punctuation): nothing to fix
    if same_title(mine, official, 0.88):
        return "typo"
    if _extends(mine, official):
        return "subtitle"
    if _same_words_minus_numbers(mine, official):
        return "number"
    return None


def candidates(name, igdb=None, mc_search=None):
    """Official titles from Steam, Metacritic and IGDB, with whatever each says about the developer."""
    out = []
    try:
        items = _json("https://store.steampowered.com/api/storesearch/?l=english&cc=US&term=" + urllib.parse.quote(name)).get("items") or []
        out += [{"name": i.get("name", ""), "source": "Steam", "appid": i.get("id")} for i in items[:8]]
    except Exception:
        pass
    if mc_search:
        try:
            for i in mc_search(name, 10):
                out.append({"name": i.get("title", ""), "source": "Metacritic", "devs": [d.get("name") for d in i.get("developers") or [] if isinstance(d, dict)]})
        except Exception:
            pass
    if igdb and igdb.configured():
        try:
            for r in igdb._query("games", f'search "{name.replace(chr(34), "")}"; fields name,version_parent,involved_companies.company.name; limit 10;'):
                if not r.get("version_parent"):
                    out.append({"name": r.get("name", ""), "source": "IGDB",
                                "devs": [(c.get("company") or {}).get("name", "") for c in r.get("involved_companies") or []]})
        except Exception:
            pass
    return out


def official_title(name, meta=None, igdb=None, mc_search=None):
    """The official title for a name in your sheet, or None when it's already right or nothing is certain."""
    cands = candidates(name, igdb, mc_search)
    if not cands:
        return None
    if any(_canon(c["name"]) == _canon(name) for c in cands):
        return None   # a store already knows it under this name
    meta = meta or {}
    votes = {}
    for c in cands:
        kind = classify(name, c["name"])
        if not kind:
            continue
        if c.get("devs") and (meta.get("developer") or meta.get("publisher")) and not companies_agree(meta, c["devs"], []):
            continue   # same-sounding title by a different studio
        key = _norm(c["name"])
        v = votes.setdefault(key, {"name": c["name"], "kind": kind, "sources": set()})
        v["sources"].add(c["source"])
        # prefer the nicest spelling of the same title (not Steam's ALL CAPS)
        if v["name"].isupper() and not c["name"].isupper():
            v["name"] = c["name"]
    if not votes:
        return None
    best = max(votes.values(), key=lambda v: (len(v["sources"]), v["kind"] == "typo", -abs(len(v["name"]) - len(name))))
    # one clear answer is enough; when several titles qualify, two sources have to agree on the winner
    if len(votes) > 1 and len(best["sources"]) < 2:
        return None
    if best["kind"] == "typo" and similar(name, best["name"]) < 0.88:
        return None
    return {"name": best["name"], "source": " + ".join(sorted(best["sources"])), "kind": best["kind"]}
