"""Downloads real copies of the pages Masterlog's parsers read, into tests/fixtures/.

Run by CI (which can reach these sites); the copies are committed so every build can test the parsers offline.
The same pages, read live, are what tests/canary.py checks once a day."""
import json
import os
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, "..", "app"))
import lore    # noqa: E402

OUT = os.path.join(ROOT, "fixtures")
WP = "https://en.wikipedia.org/w/api.php?format=json&formatversion=2&redirects=1&"
PAGES = {
    "wp_tga.json": WP + "action=parse&prop=text&page=" + urllib.parse.quote("The Game Award for Game of the Year"),
    "wp_gj.json": WP + "action=parse&prop=text&page=" + urllib.parse.quote("Golden Joystick Award for Game of the Year"),
    "wp_bafta.json": WP + "action=parse&prop=text&page=" + urllib.parse.quote("British Academy Games Award for Best Game"),
    "wp_steam_awards.json": WP + "action=parse&prop=text&page=" + urllib.parse.quote("Steam Awards"),
    "wp_tga2022.json": WP + "action=parse&prop=text&page=" + urllib.parse.quote("The Game Awards 2022"),
    "wp_elden_sections.json": WP + "action=parse&prop=sections&page=Elden_Ring",
    "wp_elden_search.json": WP + "action=query&list=search&srlimit=6&srsearch=" + urllib.parse.quote("Elden Ring video game"),
    "wp_elden_summary.json": "https://en.wikipedia.org/api/rest_v1/page/summary/Elden_Ring",
    "wp_elden_extract.json": WP + "action=query&prop=extracts&explaintext=1&exsectionformat=wiki&titles=Elden%20Ring",
    "pcgw_elden.json": "https://www.pcgamingwiki.com/w/api.php?format=json&formatversion=2&redirects=1&action=parse&prop=wikitext|sections&page=Elden_Ring",
    "steam_schedule.html": "https://partner.steamgames.com/doc/marketing/upcoming_events",
    "psblog_feed.xml": "https://blog.playstation.com/feed/",
    "gematsu_feed.xml": "https://www.gematsu.com/feed",
}


def main():
    os.makedirs(OUT, exist_ok=True)
    failed = []
    for name, url in PAGES.items():
        ua = lore.WIKI_UA if "wiki" in url else lore.BROWSER_UA
        try:
            req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept-Language": "en-US,en;q=0.9", "Accept-Encoding": "identity"})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            if name.endswith(".json"):
                json.loads(data)   # must be valid
            with open(os.path.join(OUT, name), "wb") as f:
                f.write(data)
            print("ok  ", name, len(data))
        except Exception as e:
            failed.append(name)
            print("FAIL", name, e)
    # the accolades section of Elden Ring's article, found through its sections list
    try:
        secs = json.load(open(os.path.join(OUT, "wp_elden_sections.json")))["parse"]["sections"]
        idx = next(s["index"] for s in secs if "ccolade" in s["line"] or "ward" in s["line"])
        req = urllib.request.Request(WP + f"action=parse&prop=text&section={idx}&page=Elden_Ring", headers={"User-Agent": lore.WIKI_UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            open(os.path.join(OUT, "wp_elden_accolades.json"), "wb").write(r.read())
        print("ok   wp_elden_accolades.json")
    except Exception as e:
        failed.append("wp_elden_accolades.json")
        print("FAIL wp_elden_accolades.json", e)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
