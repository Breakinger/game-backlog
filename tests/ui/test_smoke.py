"""Opens the real app (dev/preview.html, on the stand-in library) in Chromium and walks through it: every view,
the game panel and its tabs, Modify, every settings tab, controller navigation, multi-select, the Game of the
Year chooser, the events banner. Fails on any script error, or when a part that should appear doesn't."""
import os
import pathlib

import pytest
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
URL = (ROOT / "dev" / "preview.html").as_uri()
PAD = """
window.__pad = { connected: true, id: 'test', index: 0, mapping: 'standard', axes: [0,0,0,0], buttons: Array.from({length:17}, () => ({pressed:false, value:0})) };
navigator.getGamepads = () => [window.__pad];
window.tap = async (i) => { __pad.buttons[i].pressed = true; await new Promise(r => setTimeout(r, 80)); __pad.buttons[i].pressed = false; await new Promise(r => setTimeout(r, 80)); };
"""


@pytest.fixture(scope="module")
def page():
    with sync_playwright() as p:
        exe = os.environ.get("CHROME")
        b = p.chromium.launch(executable_path=exe, args=["--no-sandbox"]) if exe else p.chromium.launch(args=["--no-sandbox"])
        pg = b.new_page(viewport={"width": 1600, "height": 1000})
        pg.errors = []
        pg.on("pageerror", lambda e: pg.errors.append(str(e)))
        pg.add_init_script(PAD)
        pg.goto(URL)
        pg.wait_for_timeout(2500)
        yield pg
        b.close()


def ok(pg):
    assert not pg.errors, pg.errors
    pg.errors.clear()


def test_home(page):
    assert page.locator(".hero, .shelf").count()
    assert page.evaluate("!!document.querySelector('#eventsHome')")
    ok(page)


@pytest.mark.parametrize("view", ["backlog", "played", "library", "wishlist", "deals", "soon", "ranking", "stats", "home"])
def test_every_view(page, view):
    page.evaluate(f"go('{view}'); 1")
    page.wait_for_timeout(700)
    assert page.locator("#view").inner_html().strip()
    ok(page)


def test_list_mode(page):
    page.evaluate("state.mode = 'list'; go('library'); 1")
    page.wait_for_timeout(600)
    assert page.locator("table.sheet").count()
    page.evaluate("state.mode = 'covers'; go('home'); 1")
    ok(page)


def test_panel_and_tabs(page):
    gid = page.evaluate("state.games.find(g => g.name === 'Elden Ring').id")
    page.evaluate(f"openPanel('game', {gid}); 1")
    page.wait_for_timeout(900)
    for tab in ["overview", "ratings", "dlc", "watch", "wiki", "news", "edit"]:
        page.evaluate(f"showPanelTab('{tab}'); 1")
        page.wait_for_timeout(500)
    assert page.locator("#panel [name=status]").count()
    page.evaluate("closePanel(); 1")
    ok(page)


def test_settings_tabs(page):
    tabs = page.evaluate("[...document.querySelectorAll('#settings [data-stab]')].map(b => b.dataset.stab)")
    for t in tabs:
        page.evaluate(f"openSettings(false, '{t}'); 1")
        page.wait_for_timeout(300)
    page.evaluate("$('#settings').close(); 1")
    ok(page)


def test_controller(page):
    page.evaluate("go('home'); dispatchEvent(new Event('gamepadconnected')); 1")
    page.wait_for_timeout(300)
    page.evaluate("tap(15)"); page.wait_for_timeout(300)
    assert page.evaluate("document.activeElement !== document.body")
    page.evaluate("go('library'); 1"); page.wait_for_timeout(600)
    page.evaluate("tap(15)"); page.wait_for_timeout(300)
    assert page.evaluate("document.activeElement.classList.contains('case')")
    page.evaluate("tap(2)"); page.wait_for_timeout(300)
    assert page.evaluate("!!document.getElementById('ctx')")
    page.evaluate("tap(1)"); page.wait_for_timeout(300)
    page.evaluate("tap(0)"); page.wait_for_timeout(700)
    assert page.evaluate("$('#panel').classList.contains('open')")
    page.evaluate("tap(1)"); page.wait_for_timeout(500)
    ok(page)


def test_multi_select(page):
    page.evaluate("go('library'); 1")
    page.wait_for_timeout(800)
    cases = page.locator("#view .grid .case")
    cases.nth(0).click(modifiers=["Shift"])
    cases.nth(2).click(modifiers=["Shift"])
    assert page.locator("#view .case.sel").count() >= 2
    page.keyboard.press("Escape")
    ok(page)


def test_game_of_the_year(page):
    page.evaluate("go('stats'); 1")
    page.wait_for_timeout(1200)
    assert page.locator("#gotyHistory .gyear").count()
    page.evaluate("openGotyPick(2022); 1")
    page.wait_for_timeout(900)
    assert page.locator("#gotyDialog[open]").count()
    page.evaluate("$('#gotyDialog').close(); 1")
    ok(page)


def test_books(page):
    page.evaluate("switchCatalog('books'); 1")
    page.wait_for_timeout(800)
    page.evaluate("switchCatalog('games'); 1")
    ok(page)


def test_card_idling(page):
    page.keyboard.press("Escape")
    page.evaluate("document.querySelectorAll('dialog[open]').forEach(d => d.close())")
    page.click("#cardsBtn")
    page.wait_for_selector("#cardsDialog[open] .crow")
    assert page.locator("#cardsDialog .crow").count() >= 2
    assert page.locator("#cardsBar [data-cards]").count() >= 1
    page.check("#cardsDialog [data-cskip]") if page.locator("#cardsDialog [data-cskip]:not(:checked)").count() else None
    page.evaluate("document.querySelector('#cardsDialog').close()")
    ok(page)


def test_diagnostics(page):
    page.evaluate("document.querySelectorAll('dialog[open]').forEach(d => d.close())")
    page.click("#settingsBtn")
    page.click("[data-stab=health]")
    page.click("[data-diag=show]")
    page.wait_for_function("document.querySelector('#diagText').value.length > 20")
    page.evaluate("document.querySelectorAll('dialog[open]').forEach(d => d.close())")
    ok(page)
