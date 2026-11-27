"""Release dates: reading them, and telling a later port from the first release."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app"))
import releases as r


def test_parse_dates():
    assert r.parse_dates("March 24, 2005") == [(1111622400, "day")]
    assert r.parse_dates("26 September 2026") == [(1790380800, "day")]
    assert r.parse_dates("2019")[0][1] == "year"


def test_ports_from_wikipedia_infobox():
    e = r.from_wikipedia_release("GameCube: March 24, 2005\nPlayStation 2: October 24, 2005\nWindows: February 27, 2007")
    out = r.combine(e)
    assert out["date"] == 1111622400 and out["platforms"] == ["GameCube"]
    assert [p["platform"] for p in out["ports"]] == ["PS2", "PC"]


def test_same_month_is_not_a_port():
    e = [("PS4", 1540512000, "day"), ("Xbox One", 1540512000 + 86400 * 3, "day")]
    out = r.combine(e)
    assert out["ports"] == [] and set(out["platforms"]) == {"PS4", "Xbox One"}


def test_editions_keep_the_original_release():
    assert r.edition_of("The Elder Scrolls V: Skyrim Special Edition") == ("The Elder Scrolls V: Skyrim", "Special Edition")
    assert r.edition_of("Divinity: Original Sin 2 - Definitive Edition")[0] == "Divinity: Original Sin 2"
    assert r.edition_of("Death Stranding Director's Cut")[0] == "Death Stranding"
    assert r.edition_of("Batman: Arkham City - Game of the Year Edition")[0] == "Batman: Arkham City"
    # remasters and remakes sold as new games are new releases; ordinary names aren't editions
    for n in ("The Elder Scrolls IV: Oblivion Remastered", "Final Fantasy VII Remake", "The Witcher 3: Wild Hunt",
              "Persona 5 Royal", "Ultimate Chicken Horse", "Final Fantasy X", "Gold Rush"):
        assert r.edition_of(n) is None, n
