"""Card idling: reading the badges and licences pages, and the rules for what gets idled."""
import os, sys, time, calendar
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app"))
import cards
import shutil, subprocess
import pytest

ROW = '''<div class="badge_row is_link">
  <a class="badge_row_overlay" href="https://steamcommunity.com/id/me/gamecards/{appid}/{foil}"></a>
  <div class="badge_row_inner"><div class="badge_title_row">
    <div class="badge_title_stats"><div class="badge_title_stats_content">
      {play}
      <div class="badge_title_stats_drops"><span class="progress_info_bold">{drops}</span></div>
    </div></div>
    <div class="badge_title">
      {name}&nbsp;<span class="badge_view_details">View details</span>
    </div>
  </div></div>
</div>'''


def page(rows, me=True, pages=1):
    links = "".join(f'<a class="pagelink" href="?p={i}">{i}</a>' for i in range(2, pages + 1))
    sid = '"76561190000000000"' if me else "false"
    return f"<script>g_steamID = {sid};</script>" + "".join(rows) + f'<div class="pageLinks">{links}</div>'


def row(appid, name, drops, hours=None, foil=""):
    play = f'<div class="badge_title_stats_playtime">&nbsp;{hours} hrs on record</div>' if hours is not None else ""
    d = f"{drops} card drops remaining" if drops != 1 else "1 card drop remaining"
    if drops == 0:
        d = "No card drops remaining"
    return ROW.format(appid=appid, name=name, drops=d, play=play, foil=foil)


def test_parse_badges():
    p = page([row(1145360, "Hades", 3, "6.2"), row(1145360, "Hades", 0, "6.2", "?border=1"), row(620, "Portal 2", 0, "1,014.5"),
              row(413150, "Stardew Valley &amp; Friends", 1), '<div class="badge_row is_link"><a class="badge_row_overlay" href="https://steamcommunity.com/id/me/badges/2/"></a></div>'], pages=3)
    r = cards.parse_badges(p)
    g = {x["appid"]: x for x in r["games"]}
    assert r["signed_in"] and r["pages"] == 3 and set(g) == {1145360, 620, 413150}
    assert g[1145360] == {"appid": 1145360, "name": "Hades", "drops": 3, "hours": 6.2}
    assert g[620]["hours"] == 1014.5 and g[620]["drops"] == 0
    assert g[413150]["name"] == "Stardew Valley & Friends" and g[413150]["drops"] == 1 and g[413150]["hours"] == 0


def test_signed_out():
    assert not cards.parse_badges(page([], me=False))["signed_in"]


def test_parse_licenses():
    html = '''<table class="account_table"><tr><th>Date</th><th>Item</th></tr>
    <tr><td class="license_date_col">26 Nov, 2026</td><td><div class="free_license_remove_link"><a href="#">Remove</a></div>
      Hades</td><td class="license_acquisition_col">Steam Store</td></tr>
    <tr><td class="license_date_col">Mar 4, 2019</td><td>Portal 2</td><td class="license_acquisition_col">Retail</td></tr></table>'''
    lic = cards.parse_licenses(html)
    assert lic == [(calendar.timegm((2026, 11, 26, 0, 0, 0)), "Hades"), (calendar.timegm((2019, 3, 4, 0, 0, 0)), "Portal 2")]


def test_refund_guard():
    now = calendar.timegm((2026, 11, 27, 12, 0, 0))
    games = [{"appid": 1, "name": "Hades", "drops": 3, "hours": 0.5}, {"appid": 2, "name": "Elden Ring", "drops": 3, "hours": 0.4},
             {"appid": 3, "name": "Stardew Valley", "drops": 2, "hours": 5.0}]
    lic = [(now - 3 * 86400, "Hades II Deluxe Edition"), (now - 2 * 86400, "Hades"), (now - 90 * 86400, "Elden Ring")]
    held = cards.refund_guard(games, lic, now=now)
    assert set(held) == {1} and "3 days ago" not in held[1] and "2 days ago" in held[1]
    # a recent purchase that matches no game: everything under 2 hours waits; over 2 hours can't be refunded anyway
    held = cards.refund_guard(games, lic + [(now - 86400, "Some Bundle Of Things")], now=now)
    assert set(held) == {1, 2}
    # couldn't read the dates at all
    assert set(cards.refund_guard(games, [], now=now, known=False)) == {1, 2}


def test_same_game():
    assert cards.same_game("ELDEN RING Deluxe Edition", "Elden Ring")
    assert cards.same_game("The Witcher® 3: Wild Hunt - Game of the Year Edition", "The Witcher 3: Wild Hunt")
    assert not cards.same_game("Celeste", "Hades")
    # a near name errs on the side of holding a game back (a refund matters more than a few hours of idling)
    assert cards.same_game("Portal 2", "Portal")


def test_plan():
    games = [{"appid": 1, "drops": 2, "hours": 0.5}, {"appid": 2, "drops": 1, "hours": 1.0}, {"appid": 3, "drops": 4, "hours": 10},
             {"appid": 4, "drops": 1, "hours": 30}, {"appid": 5, "drops": 0, "hours": 0.1}]
    assert cards.plan(games, {}, 8) == [2, 1]          # under 2 hours: together first
    assert cards.plan(games, {1: "x", 2: "y"}, 8) == [4]  # then one at a time, fewest drops first
    assert cards.plan(games, {}, 1) == [4]
    assert cards.plan([{"appid": 5, "drops": 0, "hours": 1}], {}, 8) == []


def test_elf_check(tmp_path):
    p = tmp_path / "libsteam_api.so"
    p.write_bytes(b"\x7fELF\x02\x01\x01" + b"\0" * 11 + (62).to_bytes(2, "little") + b"\0" * 40)
    assert cards._elf64(str(p))
    p.write_bytes(b"\x7fELF\x01\x01\x01" + b"\0" * 11 + (3).to_bytes(2, "little"))
    assert not cards._elf64(str(p))


FAKE = r'''
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
int SteamAPI_InitFlat(char *err) { const char *a = getenv("SteamAppId"); if (!a || atoi(a) == 999) { strcpy(err, "No license"); return 2; } return 0; }
bool SteamAPI_IsSteamRunning(void) { return true; }
void SteamAPI_RunCallbacks(void) {}
void SteamAPI_Shutdown(void) {}
'''


@pytest.mark.skipif(sys.platform == "win32" or not shutil.which("gcc"), reason="needs gcc on Linux")
def test_idling_end_to_end(tmp_path, monkeypatch):
    """A stand-in Steam library: the helper starts, idle time is counted, Steam goes invisible and back online,
    and a game Steam refuses is held back with Steam's reason."""
    src = tmp_path / "fake.c"
    src.write_text(FAKE)
    lib = tmp_path / "libsteam_api.so"
    subprocess.run(["gcc", "-shared", "-fPIC", "-o", str(lib), str(src)], check=True)
    calls = []
    monkeypatch.setattr(cards, "set_status", lambda w: calls.append(w) or True)
    monkeypatch.setattr(cards, "real_game_running", lambda ignore=(): "")
    rows = "".join(f'<div class="badge_row is_link"><a class="badge_row_overlay" href="/id/me/gamecards/{a}/"></a>'
                   f'<div class="badge_title_stats_playtime">{h} hrs on record</div><span class="progress_info_bold">{d} card drops remaining</span>'
                   f'<div class="badge_title">{n}&nbsp;<span class="badge_view_details">x</span></div></div>'
                   for a, n, d, h in [(20, "Beta", 1, 0.5), (999, "Unowned", 3, 0.2)])
    me = '<script>g_steamID = "76561190000000000";</script>'
    c = cards.Cards(str(tmp_path / "data"), lambda url: me + ("" if "licenses" in url else rows))
    monkeypatch.setattr(c, "library", lambda refresh=False: str(lib))
    assert c.start() == {"ok": True}
    end = time.time() + 40
    while time.time() < end:
        v = {g["appid"]: g for g in c.view()["games"]}
        if v.get(20, {}).get("state") == "idling" and v.get(999, {}).get("state") == "held":
            break
        time.sleep(0.5)
    assert v[20]["state"] == "idling" and "No license" in v[999]["why"]
    time.sleep(6)
    c.stop()
    assert calls == ["invisible", "online"] and not c.procs
    assert c.idle_minutes() == {"20": 0} and c.data["idle"]["20"] > 3
