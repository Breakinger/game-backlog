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
    get_settings: async () => ({ intro: !window.SKIP_INTRO, sound_on: true, ambient_volume: .35, fx_volume: .5, sheet_url: "https://script.google.com/macros/s/x/exec", refresh_minutes: 2, has_sgdb_key: false, connected: true, link_kind: "script", version: "1.0.4", view_mode: window.MOCK_MODE || "covers" }),
    save_settings: async s => s, set_pref: async () => true, cached: async () => window.MOCK, sync: async () => window.MOCK,
    cover: async name => (name.length % 5 === 0 ? null : art(name, i++)),
    book_cover: async (t) => art(t, i++, true),
    book_cover_options: async b => wait({ items: [0, 1, 2, 3, 4, 5].map(k => ({ url: "https://x/" + k, thumb: art(b.name + k, k, true), source: k < 4 ? "Open Library" : "Google Books", note: String(1990 + k) })) }),
    pick_book_cover: async (b) => ({ uri: art(b.name + "picked", 5, true) }), set_book_cover: async () => null, clear_book_cover: async b => art(b.name, 1, true),
    awards: async g => wait({ wins: [{ award: "The Game Awards", category: "Game of the Year", year: "2011" }, { award: "BAFTA Games Awards", category: "Best Game", year: "2012" }, { award: "D.I.C.E. Awards", category: "Game of the Year", year: "2012" }, { award: "Golden Joystick Awards", category: "RPG of the Year", year: "2011" }, { award: "Spike VGA", category: "Best RPG", year: "2011" }], goty: 2, nominations: 31, url: "https://en.wikipedia.org/wiki/X#Accolades" }, 600),
        refresh_book: async b => wait({ ok: true, uri: art(b.name, 2, true) }),
    links: async g => [{ label: g.status === "Wishlist" ? "Steam store page" : "Play on Steam", url: "steam://x", primary: true }, { label: "Open in Steam library", url: "x" }, { label: "HowLongToBeat", url: "x" }],
    ratings: async g => wait({ metacritic: { title: g.name, url: "https://www.metacritic.com/game/x/", critic: 88, critic_count: 104, user: 8.1, user_count: 5321 },
      platform_score: { name: "PlayStation 5", score: 90, count: 61 }, platform_name: "PlayStation 5",
      other_platforms: [{ name: "PC", score: 86 }, { name: "Xbox Series X", score: 87 }, { name: "Nintendo Switch 2", score: 79 }],
      steam: { label: "Very Positive", percent: 91, count: 48210, url: "x" }, playstation: { stars: 4.71, count: 132000, url: "x" } }),
    dlcs: async g => wait([{ name: g.name + ": The Lost Expansion", major: true, kind: "dlc", art: art("Lost Expansion", 4), metacritic: 91, steam: { label: "Overwhelmingly Positive", percent: 96, count: 12000 }, release: "Jun 21, 2024", price: "$39.99", url: "x", summary: "A whole new region to explore, with new bosses and gear." },
      { name: g.name + " – Season Pass", kind: "upgrade", steam: { label: "Mostly Positive", percent: 74, count: 820 }, release: "2023", url: "x", summary: "" }]),
    wiki: async g => wait({ wikipedia: { title: g.name, extract: `${g.name} is an action role-playing game. It received critical acclaim for its world design, combat and atmosphere, and sold millions of copies in its first year.`, url: "https://en.wikipedia.org/wiki/X" },
      fandom: { name: g.name + " Wiki", url: "https://x.fandom.com/wiki/Main_Page", article: { title: g.name, url: "https://x.fandom.com/wiki/G", abstract: "The game's own wiki: characters, quests, items and lore." } },
      mapgenie: { game: g.name, url: "https://mapgenie.io/x", maps: [{ name: "The Lands Between", url: "https://mapgenie.io/x/maps/a" }, { name: "Underground", url: "https://mapgenie.io/x/maps/b" }, { name: "Realm of Shadow", url: "https://mapgenie.io/x/maps/c" }] }, pcgamingwiki: "x" }),
    news: async g => wait([{ title: `${g.name}: Update 1.12 "Ember" is out`, url: "x", date: Date.now() / 1000 - 3 * 86400, source: "Steam", summary: "A new region, photo mode filters and fixes for rare crashes.", patch: true, kind: "major", thumb: art("Ember", 6) },
      { title: "Hotfix 1.12.1", url: "x", date: Date.now() / 1000 - 1 * 86400, source: "Steam", summary: "Fixed a crash when loading saves.", patch: true, kind: "minor" },
      { title: `What's next for ${g.name}`, url: "x", date: Date.now() / 1000 - 40 * 86400, source: "IGN", summary: "", patch: false }]),
    updated: async list => Object.fromEntries(list.filter(g => /Baldur|Valheim|Cyberpunk|Elden|Hades/.test(g.name)).map(g => [g.name, { date: Date.now() / 1000 - 2 * 86400, title: "Hotfix 3", url: "x" }])),
    book_info: async b => wait({ google: { rating: 4.2, count: 1832, pages: 412, description: `${b.name} by ${b.author} follows a stranger through a world that keeps changing under their feet.` }, openlibrary: { rating: 4.1, count: 320, year: 1984, url: "x" }, wikipedia: { url: "x", extract: "" }, goodreads: "x" }),
    edit: async () => wait({ ok: true }), add: async () => wait({ ok: true }),
    hero: async name => art(name + " hero", 3), about: async g => wait({ long: "A much longer description of the game, as written on its store page.", text: `${g.name} drops you into a world on the edge of collapse. Fight, explore and uncover the truth behind the fall — on your own terms. Every choice leaves a mark.`, source: "Steam", release: "Aug 12, 2023", developers: ["Studio"] }),
    milestones: async g => wait([{ title: "Tau: the next chapter", start: Date.now() / 1000 + 12 * 86400, date: Date.now() / 1000 - 2 * 86400, upcoming: true, kind: "major", url: "x", thumb: art("Tau", 2), summary: "A new world, a new frame and a new quest arrive in December." },
      { title: "Season 9 is live", date: Date.now() / 1000 - 40 * 86400, kind: "major", url: "x", thumb: art("Season 9", 5), summary: "New maps, weapons and a ranked overhaul." }]),
    media: async g => wait({ videos: [{ name: "Launch trailer", thumb: art(g.name + " trailer", 2), mp4: "" , page: "x" }], shots: [1,2,3,4,5].map(i => ({ thumb: art(g.name + " " + i, i), full: art(g.name + " " + i, i) })) }),
    set_igdb: async () => ({ ok: true }), toggle_big_picture: async () => true,
    set_cover: async () => null, clear_cover: async n => art(n, 1),
    accounts_status: async () => ({ steam: { linked: true, who: "Breakinger", games: 412, synced: Date.now() / 1000 - 300 }, psn: { linked: false }, heroic: { linked: false, found: true }, itch: { linked: false } }),
    account_data: async () => ({ facts: { "Assassin's Creed II": { sources: ["steam"], copies: [{ src: "steam", platform: "Steam", id: "steam:33230" }], minutes: 900 }, "Elden Ring": { sources: ["steam"], minutes: 10600, achievements: { done: 42, total: 42 }, complete: "100%" }, "Astro Bot": { sources: ["psn"], minutes: 1020, complete: "Platinum", trophies: { progress: 100, platinum: true } }, "Baldur's Gate 3": { sources: ["steam"], minutes: 5400, achievements: { done: 21, total: 54 } } },
      candidates: [{ id: "steam:1", name: "Hollow Knight", platform: "Steam", minutes: 1800, source: "steam" }, { id: "steam:2", name: "Celeste", platform: "Steam", minutes: 0, source: "steam" }],
      wishlist: [{ id: "steamwish:9", name: "Hollow Knight: Silksong", platform: "Steam", source: "steam", appid: 9 }], wish_appids: [9], new: [], unreviewed: window.MOCK_IMPORT ? ["steam"] : [] }),
    accounts_seen: async () => true, accounts_sync: async () => true, import_games: async l => wait({ added: l.map(x => x.name), failed: [] }),
    link_account: async () => wait({ who: "test", games: 10 }), unlink_account: async () => ({}),
    update_check: async () => ({ current: "1.0.4", latest: "1.0.5", available: true, can_install: true, page: "x" }),
    update_progress: async () => ({ state: "downloading", done: 5, total: 10 }), update_apply: async () => ({ ok: true }),
    news_section: async sec => wait({ errors: sec === "breaking" ? ["Bloomberg: URLError"] : [], pending: 0, items: Array.from({ length: 14 }, (_, k) => ({
      title: sec === "leaks" ? ["Insider: Next Assassin's Creed set in Japan's Edo period, reveal planned for spring", "Rumour: Hollow Knight Silksong DLC listed on retailer", "Ratings board lists unannounced remaster for PS5 and Switch 2"][k % 3]
        : sec === "marvel" ? ["Set photos tease a familiar face returning", "Runtime for the next DCU film reportedly confirmed"][k % 2]
        : sec === "yours" ? ["Update 1.12 \"Ember\" is out", "Hotfix 1.12.1", "Season 9 roadmap"][k % 3]
        : ["Valve announces Steam Winter Sale dates", "The year's best RPGs, ranked", "Studio behind a hit indie announces its next game", "Inside the making of a cult classic"][k % 4],
      url: "x", date: Date.now() / 1000 - k * 5400 - 600, source: sec === "breaking" ? ["IGN", "PC Gamer", "Kotaku", "Eurogamer", "Jason Schreier", "Steam"][k % 6] : sec === "marvel" ? (k % 2 ? "r/DCULeaks" : "r/MarvelStudiosSpoilers") : sec === "yours" ? "Steam" : "r/GamingLeaksAndRumours",
      summary: k % 2 ? "" : "A longer summary of the story, the way the outlet's feed describes it, cut to a few lines so the page stays calm.",
      thumb: k % 3 === 2 ? null : art("news " + sec + k, k), flair: sec === "leaks" ? ["Rumour", "Leak", "Confirmed"][k % 3] : "", spoiler: sec === "marvel" && k % 3 === 0,
      comments: sec === "leaks" || sec === "marvel" ? 40 + k * 7 : null, game: sec === "yours" ? ["Warframe", "Baldur's Gate 3", "Cyberpunk 2077"][k % 3] : undefined, kind: sec === "yours" ? ["major", "minor", "news"][k % 3] : undefined })) }),
    deals: async () => { const W = window.MOCK.games.filter(g => g.status === "Wishlist"); const games = {};
      W.forEach((g, k) => { games[g.name] = { appid: 100 + k, steam: k % 4 === 3 ? null : { currency: "USD", initial: 59.99, final: k % 3 === 0 ? 23.99 : 59.99, discount: k % 3 === 0 ? 60 : 0 }, steam_ends: k % 3 === 0 ? Date.now() / 1000 + 3 * 86400 + 4000 : null,
        stores: { deals: [{ store: "Fanatical", price: k % 3 === 0 ? 21.49 : 44.99, retail: 59.99, savings: k % 3 === 0 ? 64 : 25, url: "x" }, { store: "GOG", price: 59.99, retail: 59.99, savings: 0, url: "x" }], low: 17.99 },
        eshop: k === 2 ? { currency: "EUR", initial: 59.99, final: 41.99, discount: 30, ends: Date.now() / 1000 + 5 * 86400 } : undefined,
        release: k % 5 === 1 ? { coming: true, ts: Date.now() / 1000 + (k + 3) * 86400, text: "Dec 2026" } : { coming: false } }; });
      return wait({ games, subs: [{ game: W[0]?.name || "Game", owned: false, title: `[Amazon] ${W[0]?.name} (PS5) $29.99`, url: "x", date: Date.now() / 1000 - 7200, source: "r/PS5Deals", domain: "amazon.com", link: "x", thumb: null }],
        dlc: [{ game: "Elden Ring", name: "Shadow of the Erdtree", art: art("Erdtree", 3), url: "x", major: true, price: { currency: "USD", final: 23.99, discount: 40 }, alt: { store: "Fanatical", price: 21.5, url: "x" } }],
        bundles: [{ game: W[1]?.name || "Game", store: "Humble Bundle", name: "Indie Treasures Bundle", url: "x", ends: Date.now() / 1000 + 9 * 86400, count: 8, owned: false }],
        rates: { rates: { USD: 2.5922, EUR: 2.8343, GEL: 1 }, date: "2026-11-25T00:00:00Z", source: "National Bank of Georgia" },
        sale: window.MOCK_SALE ? { id: "winter-2026", name: "Steam Winter Sale", start: Date.now() / 1000 - 3600, end: Date.now() / 1000 + 18 * 86400, live: true } : { id: "winter-2026", name: "Steam Winter Sale", start: Date.now() / 1000 + 22 * 86400, end: Date.now() / 1000 + 40 * 86400, live: false },
        renames: { "The Elder Scrolls VI": { name: "The Elder Scrolls VI: Sentinel", source: "the news (3 outlets)", suggest: true } }, links: {}, running: false }); },
    renamed: async () => [], undo_rename: async () => ({}), apply_rename: async () => ({ ok: true }),
    cover_options: async (n) => wait({ items: [{ url: art(n + " steam", 1), thumb: art(n + " steam", 1), source: "Steam", note: "official library cover" }, { url: art(n + " ps", 2), thumb: art(n + " ps", 2), source: "PlayStation Store", note: "official" }, { url: art(n + " igdb", 3), thumb: art(n + " igdb", 3), source: "IGDB", note: "box art" }].concat([4,5,6,7,8].map(k => ({ url: art(n + k, k), thumb: art(n + k, k), source: "SteamGridDB", note: "fan" }))) }),
    pick_cover: async (n) => wait({ uri: art(n + " picked", 5) }), choose_ambience: async () => null, clear_ambience: async () => ({ ambience: null }), set_youtube_key: async () => ({ ok: true }),
    watch: async g => wait({ host: "localhost", twitch: { items: [1,2,3,4].map(k => ({ login: "streamer" + k, name: "Streamer" + k, title: `Blind run of ${g.name}, day ${k}`, viewers: 1200 / k | 0, thumb: art("stream" + k, k) })) },
      youtube: [1,2,3,4,5].map(k => ({ youtube: "abc" + k, name: `${g.name} gameplay part ${k}`, channel: "Channel " + k, published: k + " days ago", seconds: 600 + k * 37, thumb: art("yt" + k, k + 2) })) }),
    modpacks_scan: async () => wait({ items: [{ name: "Minecraft: Ascendra", manager: "CurseForge", game: "Minecraft", profile: "Ascendra", mods: 214, detail: "1.20.1 · forge", last: Date.now() / 1000 - 86400, added: false },
      { name: "The Elder Scrolls V: Skyrim Special Edition: Lorerim", manager: "Mod Organizer 2", mods: 1450, detail: "enabled mods", last: Date.now() / 1000 - 3 * 86400, added: true }] }),
    add_modpack: async () => wait({ ok: true }), candidate_cover: async n => art(n, 3), hide_games: async () => ({ hidden: [] }), hidden_games: async () => [],
    dlc_marks: async () => ({}), mark_dlc: async (g, d, o) => ({ [g]: { [d]: o } }), refresh_game: async () => true,
    save_ranking: async l => wait({ ok: true, where: "sheet" }), open_inside: async () => ({ ok: true }), browse_itch: async () => ({ ok: true }), itch_added: async () => [],
    connection_script: async () => "// script", clear_covers: async () => true, open: async () => true, open_sheet: async () => true,
  } };
})();
