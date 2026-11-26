"""The parsers that read other sites, run against saved copies of those sites (tests/fixtures/).

Every build runs these offline. The daily canary runs them again against fresh copies (FIXTURES=<folder>), so a
site that changes its layout turns the canary red instead of quietly emptying part of the app."""
import json
import os
import sys
import time
from datetime import datetime, timezone

import pytest

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, "..", "app"))
import events  # noqa: E402
import goty  # noqa: E402
import lore  # noqa: E402

FIX = os.environ.get("FIXTURES") or os.path.join(ROOT, "fixtures")


def page(name):
    path = os.path.join(FIX, name)
    if not os.path.exists(path):
        pytest.skip(f"no copy of {name} yet")
    raw = open(path, "rb").read().decode("utf-8", "replace")
    if name.endswith(".json"):
        d = json.loads(raw)
        return (d.get("parse") or {}).get("text") if "parse" in d and isinstance(d["parse"].get("text"), str) else d
    return raw


# ---------------- Game of the Year lists ----------------

def test_tga_table_reads_every_winner():
    parsed = goty.parse_tga(page("wp_tga.json"))
    for year, (winner, _) in goty.TGA.items():
        if winner:
            assert parsed.get(year, (None,))[0] == winner, f"{year}: read {parsed.get(year)}"
    assert len(parsed[2023][1]) >= 4, "nominees missing"


def test_golden_joystick_list():
    parsed = goty.parse_winners(page("wp_gj.json"), all_win=True)
    assert "Elden Ring" in parsed.get(2022, []) and "Baldur's Gate 3" in parsed.get(2023, [])


def test_bafta_list_finds_winners():
    parsed = goty.parse_winners(page("wp_bafta.json"))
    hits = sum(1 for y, w in goty.BAFTA.items() if w in (parsed.get(y) or []))
    assert hits >= 15, f"only {hits} BAFTA winners recognised: {parsed}"


def test_steam_awards_game_of_the_year():
    p = lore._Ceremony()
    p.feed(page("wp_steam_awards.json"))
    found = {c["year"]: c["items"][0]["text"] for c in p.cells if (c["lead"] or c["header"] or "").strip().lower() == "game of the year" and c["items"]}
    assert any("Elden Ring" in v for v in found.values()), found


# ---------------- awards for one game ----------------

def test_elden_ring_accolades():
    rows = lore._accolade_rows(page("wp_elden_accolades.json"))
    assert any(r["ceremony"] == "tga" and r["won"] and "year" in r["category"].lower() for r in rows), rows[:10]
    assert any(r["ceremony"] == "gj" for r in rows)


def test_tga_ceremony_page_category_cells():
    hits = lore._ceremony_hits(page("wp_tga2022.json"), "Elden Ring", "tga")
    assert any(h["won"] and "Game of the Year" in h["category"] for h in hits), hits


# ---------------- Wiki tab ----------------

def test_wikipedia_search_and_summary_shapes():
    s = page("wp_elden_search.json")
    assert s["query"]["search"][0]["title"]
    sm = page("wp_elden_summary.json")
    assert sm.get("extract") and "game" in (sm.get("description") or "")


def test_wikipedia_sections_from_extract():
    d = page("wp_elden_extract.json")
    text = d["query"]["pages"][0]["extract"]
    import re
    parts = re.split(r"^(={2,6})\s*(.+?)\s*\1\s*$", text, flags=re.M)
    heads = [parts[i + 1].lower() for i in range(1, len(parts) - 2, 3)]
    assert any("gameplay" in h for h in heads) and any("reception" in h for h in heads), heads


def test_pcgamingwiki_page():
    d = page("pcgw_elden.json")
    p = d["parse"]
    assert lore._template(p["wikitext"], "Video"), "Video template missing"
    assert lore._data_paths(p["wikitext"], "saves"), "save paths missing"


# ---------------- Events ----------------

def test_steam_schedule_has_sales():
    found = events.parse_steam_schedule(page("steam_schedule.html"))
    assert any(e["series"] == "steam_sale" for e in found), found


@pytest.mark.parametrize("feed", ["psblog_feed.xml", "gematsu_feed.xml"])
def test_event_feeds_parse(feed):
    import feeds
    items = feeds.parse_feed(page(feed).encode(), "x")
    assert len(items) >= 5 and all(i.get("title") and i.get("date") for i in items[:5])
    events.sightings(items)   # must not crash on real headlines


PUB = int(datetime(2026, 6, 2, 15, 0, tzinfo=timezone.utc).timestamp())


@pytest.mark.parametrize("text,when,timed", [
    ("State of Play returns tomorrow at 2pm PT", "2026-06-03 21:00", True),
    ("Nintendo Direct announced for June 4 at 3pm BST", "2026-06-04 14:00", True),
    ("Xbox Games Showcase set for Sunday, June 7, 10am PT", "2026-06-07 17:00", True),
    ("Future Games Show returns on 6th June at 21:00 BST", "2026-06-06 20:00", True),
    ("Summer Game Fest 2026 airs this Friday", "2026-06-05", False),
])
def test_dates_in_announcements(text, when, timed):
    start, t = events.extract_when(text, PUB)
    got = datetime.fromtimestamp(start, timezone.utc).strftime("%Y-%m-%d %H:%M" if timed else "%Y-%m-%d")
    assert (got, t) == (when, timed)


def test_recaps_are_not_events():
    assert not events.sightings([{"title": "Everything announced at State of Play", "summary": "", "date": PUB, "url": "x"}])


# ---------------- names ----------------

@pytest.mark.parametrize("name,year", [("Legend of Zelda: Breath of the Wild", 2017), ("Red Dead Redemption II", 2018),
                                       ("Marvels Spider-Man", 2018), ("Elden Ring", 2022), ("Some Unknown Game", None)])
def test_goty_release_years(name, year):
    assert goty.Goty("/nonexistent", lambda u: {}).year_of(name) == year
