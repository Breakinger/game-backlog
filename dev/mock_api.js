(function () {
  const art = (name, i, book) => {
    const hues = [210, 260, 15, 160, 330, 45, 190];
    const h = hues[i % hues.length];
    const w = 600, ht = book ? 900 : 850;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${ht}'><defs><linearGradient id='g' x1='0' y1='0' x2='0.6' y2='1'><stop offset='0' stop-color='hsl(${h},70%,55%)'/><stop offset='1' stop-color='hsl(${h + 40},60%,12%)'/></linearGradient></defs><rect width='${w}' height='${ht}' fill='url(#g)'/><circle cx='420' cy='300' r='190' fill='hsla(${h + 20},90%,80%,.35)'/><text x='40' y='${ht - 80}' font-family='${book ? "Georgia" : "Bahnschrift,Arial"}' font-size='54' font-weight='700' fill='white'>${name.slice(0, 16).replace(/[<&']/g, '')}</text></svg>`;
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  };
  let i = 0;
  const wait = (v, ms = 250) => new Promise(r => setTimeout(() => r(v), ms));
  window.pywebview = { api: {
    get_settings: async () => ({ sheet_url: "https://script.google.com/macros/s/x/exec", refresh_minutes: 2, has_sgdb_key: false, connected: true, link_kind: "script", version: "1.0.4", view_mode: window.MOCK_MODE || "covers" }),
    save_settings: async s => s, set_pref: async () => true, cached: async () => window.MOCK, sync: async () => window.MOCK,
    cover: async name => (name.length % 5 === 0 ? null : art(name, i++)),
    book_cover: async (t) => art(t, i++, true),
    links: async g => [{ label: g.status === "Wishlist" ? "Steam store page" : "Play on Steam", url: "steam://x", primary: true }, { label: "Open in Steam library", url: "x" }, { label: "HowLongToBeat", url: "x" }],
    ratings: async g => wait({ metacritic: { title: g.name, url: "https://www.metacritic.com/game/x/", critic: 88, critic_count: 104, user: 8.1, user_count: 5321 },
      platform_score: { name: "PlayStation 5", score: 90, count: 61 }, platform_name: "PlayStation 5",
      other_platforms: [{ name: "PC", score: 86 }, { name: "Xbox Series X", score: 87 }, { name: "Nintendo Switch 2", score: 79 }],
      steam: { label: "Very Positive", percent: 91, count: 48210, url: "x" }, playstation: { stars: 4.71, count: 132000, url: "x" } }),
    dlcs: async g => wait([{ name: g.name + ": The Lost Expansion", metacritic: 91, steam: { label: "Overwhelmingly Positive", percent: 96, count: 12000 }, release: "Jun 21, 2024", price: "$39.99", url: "x", summary: "A whole new region to explore, with new bosses and gear." },
      { name: g.name + " – Season Pass", steam: { label: "Mostly Positive", percent: 74, count: 820 }, release: "2023", url: "x", summary: "" }]),
    wiki: async g => wait({ wikipedia: { title: g.name, extract: `${g.name} is an action role-playing game. It received critical acclaim for its world design, combat and atmosphere, and sold millions of copies in its first year.`, url: "x" }, fandom: "x", pcgamingwiki: "x" }),
    news: async g => wait([{ title: `${g.name} patch 1.12 is out`, url: "x", date: Date.now() / 1000 - 3 * 86400, source: "Steam", summary: "Performance improvements, new photo mode filters and fixes for rare crashes.", patch: true },
      { title: `What's next for ${g.name}`, url: "x", date: Date.now() / 1000 - 40 * 86400, source: "IGN", summary: "", patch: false }]),
    updated: async list => Object.fromEntries(list.filter(g => /Baldur|Valheim|Cyberpunk|Elden|Hades/.test(g.name)).map(g => [g.name, { date: Date.now() / 1000 - 2 * 86400, title: "Hotfix 3", url: "x" }])),
    book_info: async b => wait({ google: { rating: 4.2, count: 1832, pages: 412, description: `${b.name} by ${b.author} follows a stranger through a world that keeps changing under their feet.` }, openlibrary: { rating: 4.1, count: 320, year: 1984, url: "x" }, wikipedia: { url: "x", extract: "" }, goodreads: "x" }),
    edit: async () => wait({ ok: true }), add: async () => wait({ ok: true }),
    update_check: async () => ({ current: "1.0.4", latest: "1.0.5", available: true, can_install: true, page: "x" }),
    update_progress: async () => ({ state: "downloading", done: 5, total: 10 }), update_apply: async () => ({ ok: true }),
    connection_script: async () => "// script", clear_covers: async () => true, open: async () => true, open_sheet: async () => true,
  } };
})();
