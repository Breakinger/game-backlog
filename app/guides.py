"""The game's own wikis and maps: its Fandom wiki (if it has one) and Map Genie's interactive maps."""
import html
import json
import re
import urllib.parse
import urllib.error
import urllib.request

from art import _norm, similar

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"


# Map Genie and some wikis sit behind a bot check that turns plain requests away; the app hands in a fetcher that
# reads those pages through a hidden window of its own browser engine instead (read-only, these hosts only).
BROWSER = None


def _get(url, timeout=12):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"}), timeout=timeout) as r:
            return r.read().decode("utf-8", "replace"), r.geturl()
    except urllib.error.HTTPError as e:
        if e.code in (403, 429, 503) and BROWSER:
            return BROWSER(url), url
        raise


def _base_words(name):
    base = re.split(r"\s*[:\-–—]\s+", name)[0]
    return [w for w in re.findall(r"[a-z0-9]+", base.lower().replace("&", "and").replace("'", "")) if w not in ("the",)]


def fandom_slugs(name):
    w = _base_words(name)
    plain = [x for x in w if not x.isdigit() and x not in ("ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x")]
    out = []
    for cand in ("".join(plain), "".join(w), "".join(plain[:2]), plain[0] if plain and len(plain[0]) >= 4 else ""):
        if cand and cand not in out:
            out.append(cand)
    return out


def fandom(name):
    """The game's Fandom wiki and its article about the game, with a short abstract."""
    for slug in fandom_slugs(name):
        try:
            body, final = _get(f"https://{slug}.fandom.com/api.php?action=query&meta=siteinfo&siprop=general&format=json")
            gen = (json.loads(body).get("query") or {}).get("general") or {}
        except Exception:
            continue
        if not gen.get("sitename") or "fandom.com" not in urllib.parse.urlparse(final).netloc:
            continue
        host = urllib.parse.urlparse(final).netloc
        wiki = {"name": gen.get("sitename"), "url": f"https://{host}/wiki/{urllib.parse.quote(gen.get('mainpage', 'Main_Page').replace(' ', '_'))}",
                "logo": gen.get("logo"), "article": None}
        try:
            body, _ = _get(f"https://{host}/api.php?action=query&list=search&srlimit=3&format=json&srsearch=" + urllib.parse.quote(name))
            hits = (json.loads(body).get("query") or {}).get("search") or []
            best = max(hits, key=lambda h: similar(name, h.get("title", "")), default=None)
            if best and similar(name, best["title"]) >= 0.6:
                title = best["title"]
                art = {"title": title, "url": f"https://{host}/wiki/{urllib.parse.quote(title.replace(' ', '_'))}"}
                try:
                    body, _ = _get(f"https://{host}/api/v1/Articles/Details?abstract=400&titles=" + urllib.parse.quote(title))
                    item = next(iter((json.loads(body).get("items") or {}).values()), {})
                    art["abstract"] = html.unescape(item.get("abstract") or "")
                    art["thumb"] = item.get("thumbnail")
                except Exception:
                    pass
                wiki["article"] = art
        except Exception:
            pass
        return wiki
    return None


def mapgenie_slugs(name):
    full = re.sub(r"[^a-z0-9]+", "-", name.lower().replace("'", "").replace("&", "and")).strip("-")
    base = re.sub(r"[^a-z0-9]+", "-", re.split(r"\s*:\s+", name)[0].lower().replace("'", "")).strip("-")
    no_the = re.sub(r"^the-", "", full)
    return [s for i, s in enumerate((full, no_the, base, re.sub(r"^the-", "", base))) if s and s not in (full, no_the, base, re.sub(r"^the-", "", base))[:i]]


def mapgenie(name):
    """Map Genie's interactive maps for the game, if it has any."""
    for slug in mapgenie_slugs(name):
        try:
            page, final = _get(f"https://mapgenie.io/{slug}")
        except Exception:
            continue
        if f"/{slug}" not in final:
            continue
        maps, seen = [], set()
        for m in re.finditer(rf'href="(?:https://mapgenie\.io)?/{re.escape(slug)}/maps/([a-z0-9-]+)"[^>]*>(.*?)</a>', page, re.S):
            key = m.group(1)
            if key in seen:
                continue
            seen.add(key)
            label = re.sub(r"<[^>]+>", " ", m.group(2))
            label = html.unescape(re.sub(r"\s+", " ", label)).strip() or key.replace("-", " ").title()
            maps.append({"name": label[:60], "url": f"https://mapgenie.io/{slug}/maps/{key}"})
        title = re.search(r"<title>([^<]+)</title>", page)
        if maps:
            return {"game": html.unescape(title.group(1)).split("|")[0].strip() if title else name, "url": f"https://mapgenie.io/{slug}", "maps": maps[:16]}
    return None


def fextralife(name):
    """Fextralife's wiki for the game (FromSoftware games, Baldur's Gate 3 and many RPGs have one)."""
    w = _base_words(name)
    full = "".join(w)
    for slug in dict.fromkeys([full, "".join(re.findall(r"[a-z0-9]+", name.lower().replace("'", "")))]):
        if not slug:
            continue
        try:
            page, final = _get(f"https://{slug}.wiki.fextralife.com/")
        except Exception:
            continue
        if "fextralife" not in urllib.parse.urlparse(final).netloc and "fextralife" not in page[:4000].lower():
            continue
        title = re.search(r"<title>([^<]+)</title>", page)
        label = html.unescape(title.group(1)).split("|")[0].strip() if title else f"{name} Wiki"
        if not similar(name, re.sub(r"\bwiki\b", "", label, flags=re.I)) >= 0.6 and _norm(name) not in _norm(label):
            continue
        return {"name": label, "url": f"https://{slug}.wiki.fextralife.com/"}
    return None
