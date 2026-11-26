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
