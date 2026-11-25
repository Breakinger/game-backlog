/* Masterlog — front end. Talks to Python through window.pywebview.api. */
"use strict";

/* ---------- platforms: how each one's case looks ---------- */
const PLAT = {
  "Steam":           { label: "STEAM", band: "#171A21", text: "#C7D5E0", shell: "#1B2838", accent: "#66C0F4", media: "disc", chip: "#1B2838", chipText: "#66C0F4" },
  "PS5":             { label: "PS5", band: "#F5F6F8", text: "#0B0B0B", shell: "#1446A8", accent: "#0070D1", media: "disc", chip: "#003791", chipText: "#FFFFFF" },
  "PS4":             { label: "PS4", band: "linear-gradient(180deg,#1C74D9,#0A4FA8)", text: "#FFFFFF", shell: "#0B3F8C", accent: "#3D8BFF", media: "disc", chip: "#0070D1", chipText: "#FFFFFF" },
  "PS2":             { label: "PlayStation 2", band: "#050505", text: "#FFFFFF", shell: "#0B0B0B", accent: "#2B3A9E", media: "disc", disc: "ps2", chip: "#000000", chipText: "#FFFFFF" },
  "Switch 2":        { label: "Nintendo Switch 2", band: "#E60012", text: "#FFFFFF", shell: "#C4000F", accent: "#E60012", media: "card", chip: "#E60012", chipText: "#FFFFFF" },
  "Switch":          { label: "Nintendo Switch", band: "#E60012", text: "#FFFFFF", shell: "#C4000F", accent: "#E60012", media: "card", chip: "#B0000E", chipText: "#FFFFFF" },
  "GOG":             { label: "HEROIC", tag: "GOG", band: "linear-gradient(90deg,#1A1033,#2B1858)", text: "#D9C8FF", shell: "#1A1033", accent: "#9F7AEA", media: "disc", chip: "#86328A", chipText: "#FFFFFF" },
  "Epic Games":      { label: "HEROIC", tag: "EPIC", band: "linear-gradient(90deg,#1A1033,#2B1858)", text: "#D9C8FF", shell: "#1A1033", accent: "#9F7AEA", media: "disc", chip: "#2A2A2A", chipText: "#FFFFFF" },
  "Ubisoft Connect": { label: "UBISOFT CONNECT", band: "#0058C4", text: "#FFFFFF", shell: "#063A7E", accent: "#3D8BFF", media: "disc", chip: "#0058C4", chipText: "#FFFFFF" },
  "EA":              { label: "EA", band: "#FF4747", text: "#FFFFFF", shell: "#7A1D1D", accent: "#FF4747", media: "disc", chip: "#FF4747", chipText: "#FFFFFF" },
  "itch.io":         { label: "itch.io", band: "#FA5C5C", text: "#FFFFFF", shell: "#3A1515", accent: "#FA5C5C", media: "disc", chip: "#FA5C5C", chipText: "#FFFFFF" },
  "Emulation":       { label: "EMULATION", band: "#22262D", text: "#B8F2D8", shell: "#1B1F25", accent: "#20C997", media: "disc", chip: "#20C997", chipText: "#06231A" },
  "PC (Other)":      { label: "PC", band: "#343A40", text: "#DEE2E6", shell: "#24292E", accent: "#ADB5BD", media: "disc", chip: "#495057", chipText: "#FFFFFF" },
};
const PLAT_FALLBACK = { label: "GAME", band: "#2B2F36", text: "#FFFFFF", shell: "#1B1F25", accent: "#4A8CFF", media: "disc", chip: "#495057", chipText: "#FFFFFF" };
// in the library Epic and GOG sit together as Heroic, the launcher that runs both
const ALIAS = { "EA App": "EA" };
// Epic + GOG run through Heroic; EA + Ubisoft are the launchers you're leaving behind
const GROUPS = { "GOG": "Heroic", "Epic Games": "Heroic", "EA": "Exiled", "EA App": "Exiled", "Ubisoft Connect": "Exiled" };
const GROUP_STYLE = { "Heroic": { chip: "#6B46C1", chipText: "#FFFFFF" }, "Exiled": { chip: "#5A2A2A", chipText: "#FFB4B4" } };
const GROUP_LABEL = { "Heroic": "Heroic (Epic + GOG)", "Exiled": "Exiled (EA + Ubisoft)", "Switch": "Switch 1" };
const groupOf = p => GROUPS[p] || p;
const PRIO_ORDER = { Extreme: 0, High: 1, Medium: 2, Low: 3 };
const PRIO_COLOR = { Extreme: "#FF5C93", High: "#FF8A3D", Medium: "#FFC94D", Low: "#8B97B3" };
const STATUS_COLOR = { Library: "#8F9BB3", Playing: "#4DABF7", Paused: "#FFB547", Wishlist: "#9775FA", Completed: "#5BD38A", Dropped: "#FF6B6B", "Second chance": "#FF922B",
  "To read": "#8F9BB3", Reading: "#4DABF7", Read: "#5BD38A" };
const CONSOLES = new Set(["PS5", "PS4", "PS2", "Switch 2", "Switch"]);
const UPGRADE_TO = { PS4: "PS5", Switch: "Switch 2" };
const FALLBACK_OPTIONS = {
  games: { status: ["Library", "Playing", "Paused", "Wishlist", "Completed", "Dropped"], priority: ["Extreme", "High", "Medium", "Low"],
    platform: Object.keys(PLAT), play_on: ["PC", "Steam Deck"], format: ["Digital", "Physical"], upgrade: ["Free upgrade", "Paid upgrade", "No upgrade"],
    type: ["Live service", "Modded"], migrate_to: ["Steam", "GOG", "PS5", "Switch 2", "Undecided"] },
  books: { status: ["To read", "Reading", "Read", "Dropped", "Wishlist"], priority: ["Extreme", "High", "Medium", "Low"], format: ["Physical", "eBook", "Audiobook"] },
};
const TABS = {
  games: [["home", "Home"], ["library", "Library"], ["wishlist", "Wishlist"], ["played", "Completed"], ["stats", "Your years"]],
  books: [["shelf", "Shelf"], ["books", "All books"], ["bookyears", "Read"]],
};

const state = {
  catalog: "games",
  games: [], plays: [], books: [], options: { games: {}, plays: {}, books: {} }, canEdit: false,
  syncedAt: null, error: null, settings: {}, updated: {}, facts: {}, candidates: [],
  view: "home", focusId: null, mode: "covers",
  filter: { q: "", status: "All", plats: new Set(), playOn: "All", prio: "All", sort: "priority" },
  bfilter: { q: "", status: "All", sort: "series" },
  openYears: new Set([new Date().getFullYear()]),
};
const covers = new Map();       // key -> dataURI | null
const coverWaiters = new Map();
let api = null, refreshTimer = null, updateInfo = null;

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plat = p => PLAT[p] || PLAT[ALIAS[p]] || PLAT_FALLBACK;
const statusOf = g => (g.status === "Dropped" && g.second_chance ? "Second chance" : g.status);
const owned = g => ["Library", "Playing", "Paused", "Completed", "Dropped"].includes(g.status);
const parseDate = s => (s ? new Date(s + "T12:00:00") : null);
const fmtDate = s => { const d = parseDate(s); return d ? d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : ""; };
const scoreText = v => (v == null ? "" : `${(+v).toFixed(v % 1 ? 1 : 0)}/10`);
const opts = (cat, field) => { const o = state.options[cat]?.[field]; return Array.isArray(o) && o.length ? o : FALLBACK_OPTIONS[cat]?.[field] || []; };
const isBooks = () => state.catalog === "books";
const coverKey = item => (item.author !== undefined ? `book:${item.name}|${item.author}` : item.name);

function ago(date) {
  if (!date) return "";
  const d = date instanceof Date ? date : typeof date === "number" ? new Date(date * 1000) : parseDate(date);
  const sec = (Date.now() - d.getTime()) / 1000;
  if (sec < 45) return "just now";
  const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [u, s] of units) {
    const n = Math.floor(Math.abs(sec) / s);
    if (n >= 1) return sec > 0 ? `${n} ${u}${n > 1 ? "s" : ""} ago` : `in ${n} ${u}${n > 1 ? "s" : ""}`;
  }
  return "just now";
}
function daysAgoLabel(iso) {
  const d = parseDate(iso);
  if (!d) return "";
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const days = Math.round((today - d) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return ago(d);
}
function toast(text, kind = "") {
  if (kind === "err") { try { FX.play.error(); } catch {} }
  const t = $("#toast");
  t.textContent = text; t.className = `toast ${kind}`; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3200);
}

/* ---------- covers ---------- */
function loadCover(item) {
  const key = coverKey(item);
  if (covers.has(key)) return Promise.resolve(covers.get(key));
  if (coverWaiters.has(key)) return coverWaiters.get(key);
  const p = queueCover(item).then(uri => { covers.set(key, uri || null); coverWaiters.delete(key); return uri; });
  coverWaiters.set(key, p);
  return p;
}
const coverQueue = []; let coverActive = 0;
function queueCover(item) { return new Promise(res => { coverQueue.push({ item, res }); pumpCovers(); }); }
function pumpCovers() {
  while (coverActive < 4 && coverQueue.length) {
    const { item, res } = coverQueue.shift();
    coverActive++;
    const call = !api ? null : item.author !== undefined ? api.book_cover(item.name, item.author) : api.cover(item.name);
    Promise.resolve(call).catch(() => null).then(uri => { coverActive--; res(uri); pumpCovers(); });
  }
}
const coverObserver = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    coverObserver.unobserve(e.target);
    const el = e.target, item = findItem(el.dataset.kind, el.dataset.id);
    if (item) loadCover(item).then(uri => { if (uri && el.isConnected) el.innerHTML = `<img alt="" decoding="async" src="${uri}">`; });
  }
}, { rootMargin: "300px" });
function activateArt(root) { root.querySelectorAll(".art").forEach(el => { if (!el.querySelector("img")) coverObserver.observe(el); }); }
function findItem(kind, id) { return (kind === "book" ? state.books : state.games).find(x => x.id === +id); }

/* ---------- the game case ---------- */
function upgradeLabel(g) {
  const to = UPGRADE_TO[g.platform];
  if (!to || !g.upgrade || g.upgrade === "No upgrade") return "";
  return `${g.upgrade.startsWith("Free") ? "Free" : "Paid"} upgrade to ${to}`;
}
function caseHTML(g, o = {}) {
  const p = plat(g.platform), st = statusOf(g);
  let badge = "";
  if (g.status === "Completed") badge = `<span class="badge done">${g.runs > 1 ? `✓ ×${g.runs}` : "✓"}</span>`;
  else if (st === "Second chance") badge = `<span class="badge chance">↺</span>`;
  else if (g.status === "Dropped") badge = `<span class="badge drop">✗</span>`;
  else if (g.priority === "Extreme" || g.priority === "High") badge = `<span class="badge" style="color:${PRIO_COLOR[g.priority]}">${g.priority}</span>`;
  const fresh = state.updated[g.name] ? `<span class="fresh">Newly updated!</span>` : "";
  const up = g.upgrade && UPGRADE_TO[g.platform] && g.upgrade !== "No upgrade" ? `<span class="tag up ${g.upgrade.startsWith("Free") ? "free" : "paid"}" title="${esc(upgradeLabel(g))}">${g.upgrade.startsWith("Free") ? "FREE" : "PAID"} ↑</span>` : "";
  const cached = covers.get(coverKey(g));
  const art = cached ? `<img alt="" decoding="async" src="${cached}">` : `<div class="fallback"><div class="t">${esc(g.name)}</div><div class="d">${esc(g.developer || g.genre || "")}</div></div>`;
  const deck = g.platform === "Steam" && g.play_on === "Steam Deck" ? `<span class="tag deck">DECK</span>` : p.tag ? `<span class="tag">${p.tag}</span>` : "";
  const typeTag = g.type === "Live service" ? `<span class="typetag live"><i></i>LIVE</span>` : g.type === "Modded" ? `<span class="typetag mod">MODDED</span>` : "";
  const ach = achBadge(g);
  const quick = !o.noLabel ? quickBtn(g) : "";
  const media = p.media === "card"
    ? `<div class="media card"><div class="card-face"><span>${esc(p.label.replace("Nintendo ", ""))}</span></div></div>`
    : `<div class="media disc ${p.disc || ""}"><div class="disc-face"></div></div>`;
  return `<button class="case p-${(g.platform || "x").replace(/\W+/g, "")} ${g.status === "Wishlist" ? "unowned" : ""}" data-id="${g.id}" data-kind="game"
    style="--band:${p.band};--band-text:${p.text};--shell:${p.shell};--accent:${p.accent};--plat:${p.chip}" aria-label="${esc(g.name)}">
    <div class="stage">${media}
      <div class="box"><div class="shell"></div>
        <div class="band"><span class="wm">${esc(p.label)}</span>${deck}${up}</div>
        <div class="art" data-kind="game" data-id="${g.id}">${art}</div>
        <div class="hinge"></div><div class="sheen"></div>${badge}${fresh}${typeTag}${ach}${quick}
      </div>
    </div>
    ${o.noLabel ? "" : `<div class="label"><div class="name">${esc(g.name)}</div><div class="sub">${esc(o.sub ?? subline(g))}</div></div>`}
  </button>`;
}
function factsOf(g) { return state.facts[g.name] || {}; }
function achBadge(g) {
  const f = factsOf(g);
  if (f.complete === "Platinum" || (g.platinum && CONSOLES.has(g.platform))) return `<span class="ach plat" title="Platinum trophy">◆ PLATINUM</span>`;
  if (f.complete || g.platinum) return `<span class="ach full" title="Every achievement">★ 100%</span>`;
  return "";
}
function quickBtn(item) {
  if (!state.canEdit) return "";
  const kind = item.author !== undefined ? "book" : "game";
  if (item.status === "Wishlist") return `<span class="qc own" role="button" tabindex="-1" data-qown="${item.id}" data-qkind="${kind}" title="${kind === "book" ? "I have it now" : "I own it now"}">＋</span>`;
  if (kind === "game" && (item.status === "Completed" || item.type === "Live service")) return "";
  if (kind === "book" && item.status === "Read") return "";
  return `<span class="qc" role="button" tabindex="-1" data-qc="${item.id}" data-qkind="${kind}" title="${kind === "book" ? "Mark as read" : "Mark as completed"}">✓</span>`;
}
function hoursFromAccounts(g) { const m = factsOf(g).minutes; return m ? Math.round(m / 6) / 10 : null; }
function subline(g) {
  if (g.status === "Completed") return g.completed ? `Finished ${daysAgoLabel(g.completed)}` : "Finished";
  if (g.status === "Wishlist") return [g.platform, g.priority].filter(Boolean).join("  ·  ");
  if (g.type === "Live service") return [g.platform, "Live service", factsOf(g).minutes ? `${Math.round(factsOf(g).minutes / 60)} h` : ""].filter(Boolean).join("  ·  ");
  const where = g.play_on && !CONSOLES.has(g.platform) ? `${g.platform} on ${g.play_on}` : g.platform;
  return [where, g.status !== "Library" ? g.status : ""].filter(Boolean).join("  ·  ");
}

/* ---------- the book ---------- */
function bookHTML(b, o = {}) {
  const cached = covers.get(coverKey(b));
  const art = cached ? `<img alt="" decoding="async" src="${cached}">` : `<div class="fallback book-fallback"><div class="t">${esc(b.name)}</div><div class="d">${esc(b.author)}</div></div>`;
  const badge = b.status === "Read" ? `<span class="badge done">✓</span>` : b.status === "Reading" ? `<span class="badge reading">Reading</span>` : b.priority === "Extreme" || b.priority === "High" ? `<span class="badge" style="color:${PRIO_COLOR[b.priority]}">${b.priority}</span>` : "";
  return `<button class="case book ${b.status === "Wishlist" ? "unowned" : ""}" data-id="${b.id}" data-kind="book" aria-label="${esc(b.name)}">
    <div class="stage"><div class="pages"></div>
      <div class="box"><div class="art" data-kind="book" data-id="${b.id}">${art}</div><div class="bspine"></div><div class="sheen"></div>${badge}${o.noLabel ? "" : quickBtn(b)}</div>
    </div>
    ${o.noLabel ? "" : `<div class="label"><div class="name">${esc(b.name)}</div><div class="sub">${esc(o.sub ?? [b.author, b.series && b.number ? `${b.series} #${b.number}` : b.series].filter(Boolean).join("  ·  "))}</div></div>`}
  </button>`;
}

/* ---------- selections ---------- */
const byPrio = (a, b) => (PRIO_ORDER[a.priority] ?? 9) - (PRIO_ORDER[b.priority] ?? 9) || a.name.localeCompare(b.name);
const byDone = (a, b) => (b.completed || "").localeCompare(a.completed || "");
function shelves() {
  const G = state.games, year = new Date().getFullYear();
  const fresh = G.filter(g => state.updated[g.name] && owned(g) && g.status !== "Completed");
  return [
    { title: "Continue playing", items: G.filter(g => g.status === "Playing" && g.type !== "Live service").concat(G.filter(g => g.status === "Paused").sort(byPrio)), view: "library", preset: { status: "Playing" } },
    { title: "Your live games", items: G.filter(g => g.type === "Live service" && g.status !== "Dropped"), view: "library", preset: { status: "Live service" } },
    { title: "Modded playthroughs", items: G.filter(g => g.type === "Modded"), view: "library", preset: { status: "Modded" } },
    { title: "Newly updated", items: fresh, view: "library" },
    { title: "Up next", items: G.filter(g => g.status === "Library").sort(byPrio).slice(0, 24), view: "library", preset: { status: "Library" } },
    { title: "On the Steam Deck", items: G.filter(g => g.play_on === "Steam Deck" && ["Library", "Playing", "Paused"].includes(g.status)).sort(byPrio), view: "library", preset: { playOn: "Steam Deck" } },
    { title: "Upgrade these to PS5 or Switch 2", items: G.filter(g => g.upgrade && g.upgrade !== "No upgrade" && UPGRADE_TO[g.platform] && g.status !== "Completed"), view: "library" },
    { title: "Wishlist, top priority", items: G.filter(g => g.status === "Wishlist").sort(byPrio).slice(0, 24), view: "wishlist" },
    { title: "Plan to migrate", items: G.filter(migrating), view: "library", preset: { status: "Plan to migrate" } },
    { title: `Finished in ${year}`, items: G.filter(g => g.status === "Completed" && (g.completed || "").startsWith(String(year))).sort(byDone), view: "stats" },
    { title: "Second chances", items: G.filter(g => statusOf(g) === "Second chance"), view: "played" },
  ];
}
function migrating(g) { return !!g.migrate_to && g.migrate_to !== g.platform && owned(g); }
function heroGame() {
  const G = state.games;
  return G.find(g => g.id === state.focusId) || G.find(g => g.status === "Playing")
    || G.filter(g => g.status === "Paused").sort(byPrio)[0] || G.filter(g => g.status === "Library").sort(byPrio)[0] || G[0];
}

/* ---------- views ---------- */
function renderTabs() {
  document.body.dataset.catalog = state.catalog;
  document.querySelectorAll(".catalog").forEach(c => c.setAttribute("aria-selected", String(c.dataset.catalog === state.catalog)));
  $("#tabs").innerHTML = TABS[state.catalog].map(([v, l]) => `<button class="tab" data-view="${v}" role="tab" aria-selected="${state.view === v}">${l}</button>`).join("");
}
function render() {
  renderTabs();
  const v = $("#view");
  hidePeek();
  const empty = isBooks() ? !state.books.length && !state.games.length : !state.games.length;
  if (empty) { v.innerHTML = welcomeHTML(); bindWelcome(); return; }
  if (state.view === "home") v.innerHTML = homeHTML();
  else if (state.view === "stats") v.innerHTML = yearsHTML();
  else if (state.view === "shelf") v.innerHTML = bookShelfHTML();
  else if (state.view === "books") v.innerHTML = bookLibraryHTML();
  else if (state.view === "bookyears") v.innerHTML = bookYearsHTML();
  else v.innerHTML = libraryHTML();
  activateArt(v);
  if (state.view === "home") updateHero(heroGame(), true);
  if (state.view === "shelf") updateBookHero(bookHero(), true);
}

function welcomeHTML() {
  if (state.error) {
    return `<div class="welcome"><h1>Connect your sheet</h1>
      <p>The app couldn't read your sheet: ${esc(state.error)}</p>
      <p class="intro">Open Settings and follow "How to connect your sheet". It takes about two minutes, and your sheet stays private.</p>
      <div class="actions"><button class="primary" id="wSettings">Open settings</button></div></div>`;
  }
  if (!state.settings.sheet_url && api) {
    return `<div class="welcome"><h1>Welcome</h1><p class="intro">Connect your Google Sheet to load your backlog. Your sheet stays private.</p>
      <div class="actions"><button class="primary" id="wSettings">Connect the sheet</button></div></div>`;
  }
  return `<div class="welcome"><h1>Loading your backlog</h1><p class="intro">Reading the sheet…</p></div>`;
}
function bindWelcome() { $("#wSettings")?.addEventListener("click", () => openSettings(true)); }

function homeHTML() {
  const rows = shelves().filter(s => s.items.length).map((s, i) => `
    <section class="shelf">
      <div class="shelf-head"><h2>${esc(s.title)}</h2><span class="count">${s.items.length}</span>
        <button class="more" data-go="${s.view}" data-shelf="${i}">See all</button></div>
      <div class="shelf-row">${s.items.map(g => caseHTML(g)).join("")}</div>
    </section>`).join("");
  return `<section class="hero"><div class="hero-bg" id="heroBg"></div><div id="heroCase"></div><div id="heroText"></div></section>${rows}`;
}

function updateHero(g, force) {
  if (!g || state.view !== "home") return;
  if (!force && $("#heroText")?.dataset.id === String(g.id)) return;
  const st = statusOf(g);
  const kicker = g.status === "Playing" ? "Now playing" : st === "Paused" ? "Paused" : g.status === "Wishlist" ? "On your wishlist" : g.status === "Completed" ? "Finished" : st === "Second chance" ? "Waiting for a second chance" : "In your library";
  const facts = [];
  if (g.completed) facts.push(`Finished <b>${fmtDate(g.completed)}</b> (${daysAgoLabel(g.completed)})`);
  if (g.hours_text) facts.push(`<b>${esc(g.hours_text)}</b> hours`);
  if (g.score != null) facts.push(`Your score <b>${scoreText(g.score)}</b>`);
  if (g.runs > 1) facts.push(`<b>${g.runs}</b> runs`);
  if (g.genre) facts.push(esc(g.genre));
  $("#heroCase").innerHTML = caseHTML(g, { noLabel: true });
  activateArt($("#heroCase"));
  const t = $("#heroText");
  t.dataset.id = g.id;
  t.innerHTML = `<div class="hero-kicker">${kicker}</div><h1>${esc(g.name)}</h1>
    <div class="pills">${pillsHTML(g)}</div>
    <div class="facts">${facts.map(f => `<span>${f}</span>`).join("")}</div>
    <div class="scores" id="heroScores"></div>
    <div class="actions" id="heroActions"><button class="primary" data-open="${g.id}" data-kind="game">Details</button></div>`;
  loadCover(g).then(uri => { const bg = $("#heroBg"); if (bg && $("#heroText")?.dataset.id === String(g.id)) bg.style.backgroundImage = uri ? `url("${uri}")` : `linear-gradient(120deg, ${plat(g.platform).chip}, transparent)`; });
  Promise.resolve(api?.links(g)).then(links => {
    const box = $("#heroActions");
    if (!links || !box || $("#heroText")?.dataset.id !== String(g.id)) return;
    links.filter(l => l.primary).slice(0, 1).forEach(l => box.insertAdjacentHTML("afterbegin", `<button class="primary" data-url="${esc(l.url)}">${esc(l.label)}</button>`));
    box.querySelector("[data-open]").className = "ghost";
  }).catch(() => {});
  clearTimeout(updateHero.t);
  updateHero.t = setTimeout(() => getRatings(g).then(r => { const box = $("#heroScores"); if (box && $("#heroText")?.dataset.id === String(g.id)) box.innerHTML = miniScoresHTML(r); }), 350);
}

function pillsHTML(g) {
  const p = plat(g.platform), st = statusOf(g), out = [];
  out.push(`<span class="pill" style="background:${STATUS_COLOR[st] || "#8F9BB3"}22;color:${STATUS_COLOR[st] || "#C9D1DC"}">${esc(st)}</span>`);
  if (g.platform) out.push(`<span class="pill" style="background:${p.chip};color:${p.chipText}">${esc(groupOf(g.platform) === "Heroic" ? `Heroic · ${g.platform}` : g.platform)}</span>`);
  if (g.play_on && !CONSOLES.has(g.platform)) out.push(`<span class="pill">${g.play_on === "Steam Deck" ? "Steam Deck" : "PC"}</span>`);
  if (g.priority && !["Completed", "Dropped"].includes(g.status)) out.push(`<span class="pill" style="color:${PRIO_COLOR[g.priority]}">${esc(g.priority)} priority</span>`);
  if (g.format) out.push(`<span class="pill">${esc(g.format)}</span>`);
  const up = upgradeLabel(g);
  if (up) out.push(`<span class="pill ${up.startsWith("Free") ? "pill-free" : "pill-paid"}">${esc(up)}</span>`);
  if (state.updated[g.name]) out.push(`<span class="pill pill-fresh">Newly updated!</span>`);
  if (g.type === "Live service") out.push(`<span class="pill pill-live">● Live service</span>`);
  if (g.type === "Modded") out.push(`<span class="pill pill-mod">Modded</span>`);
  const f = factsOf(g);
  if (f.complete === "Platinum" || (g.platinum && CONSOLES.has(g.platform))) out.push(`<span class="pill pill-plat">◆ Platinum</span>`);
  else if (f.complete || g.platinum) out.push(`<span class="pill pill-ach">★ 100%</span>`);
  if (migrating(g)) out.push(`<span class="pill">Migrating to ${esc(g.migrate_to)}</span>`);
  return out.join("");
}

/* ----- ratings (shared by hero, panel, list) ----- */
const ratingsCache = new Map();
function getRatings(g) {
  const k = `${g.name}|${g.platform}`;
  if (!ratingsCache.has(k)) ratingsCache.set(k, Promise.resolve(api?.ratings(g)).catch(() => null));
  return ratingsCache.get(k);
}
const mcClass = s => (s == null ? "" : s >= 75 ? "good" : s >= 50 ? "mixed" : "bad");
const userClass = s => (s == null ? "" : s >= 7.5 ? "good" : s >= 5 ? "mixed" : "bad");
function miniScoresHTML(r) {
  if (!r) return "";
  const out = [];
  const mc = r.metacritic;
  if (mc?.critic != null) out.push(`<span class="mini"><b class="mc ${mcClass(mc.critic)}">${mc.critic}</b>Metacritic</span>`);
  if (r.platform_score && r.platform_score.score !== mc?.critic) out.push(`<span class="mini"><b class="mc ${mcClass(r.platform_score.score)}">${r.platform_score.score}</b>on ${esc(r.platform_score.name)}</span>`);
  if (mc?.user != null) out.push(`<span class="mini"><b class="mc user ${userClass(mc.user)}">${(+mc.user).toFixed(1)}</b>Players</span>`);
  if (r.steam) out.push(`<span class="mini"><b class="steamr">${r.steam.percent}%</b>${esc(r.steam.label)}</span>`);
  return out.join("");
}

/* ----- list view (sheet style) ----- */
function cellBool(v) { return `<span class="tick ${v ? "on" : ""}">${v ? "✓" : ""}</span>`; }
function selectCell(cat, field, item) {
  const v = item[field] || "";
  const color = field === "status" ? STATUS_COLOR[v] : field === "priority" ? PRIO_COLOR[v] : null;
  if (!state.canEdit) return `<span class="cellpill" style="${color ? `--c:${color}` : ""}">${esc(v || "–")}</span>`;
  return `<select class="cellsel" data-field="${field}" style="${color ? `--c:${color}` : ""}"><option value=""></option>${opts(cat, field).map(o => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
}
function gameListHTML(list) {
  const head = ["Game", "Status", "Priority", "Finished", "Platform", "Play on", "Format", "Upgrade", "DLC", "100%", "Modded", "Runs", "Hours", "Score", "Genre"];
  return `<div class="sheet-wrap"><table class="sheet"><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>
    ${list.map(g => {
      const p = plat(g.platform);
      const canCheck = state.canEdit && owned(g) && g.status !== "Completed" && g.type !== "Live service";
      return `<tr data-id="${g.id}" data-kind="game" tabindex="0" class="${g.status === "Wishlist" ? "unowned" : ""}">
        <td class="name ${g.status === "Completed" ? "done" : ""}">${esc(g.name)}${state.updated[g.name] ? ` <span class="fresh-dot" title="Newly updated">NEW</span>` : ""}${canCheck ? `<button class="rowcheck" data-qc="${g.id}" data-qkind="game" title="Mark as completed">✓</button>` : ""}</td>
        <td>${selectCell("games", "status", g)}</td><td>${selectCell("games", "priority", g)}</td>
        <td class="date">${g.completed ? "✓ " + g.completed : g.status === "Completed" ? "unknown" : g.dropped ? "✗ " + g.dropped : ""}</td>
        <td><span class="platpill" style="background:${p.chip};color:${p.chipText}">${esc(g.platform)}</span></td>
        <td class="muted">${CONSOLES.has(g.platform) ? "" : esc(g.play_on)}</td><td class="muted">${esc(g.format)}</td>
        <td>${g.upgrade && g.upgrade !== "No upgrade" ? `<span class="upgcell ${g.upgrade.startsWith("Free") ? "free" : "paid"}">${esc(g.upgrade)}</span>` : `<span class="muted">${esc(g.upgrade)}</span>`}</td>
        <td>${cellBool(g.dlc_owned)}${g.dlc_done ? `<span class="tick on small">done</span>` : ""}</td><td>${cellBool(g.platinum)}</td><td>${cellBool(g.modded)}</td>
        <td class="num">${g.runs || ""}</td><td class="num">${esc(g.hours_text)}</td>
        <td class="num">${g.score != null ? `<span class="scorecell" style="--s:${g.score / 10}">${scoreText(g.score)}</span>` : ""}</td>
        <td class="muted clip">${esc(g.genre)}</td></tr>`;
    }).join("")}</tbody></table></div>`;
}
function bookListHTML(list) {
  const head = ["Book", "Author", "Series", "#", "Status", "Priority", "Finished", "Format", "Score"];
  return `<div class="sheet-wrap"><table class="sheet"><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>
    ${list.map(b => `<tr data-id="${b.id}" data-kind="book" tabindex="0">
      <td class="name ${b.status === "Read" ? "done" : ""}">${esc(b.name)}</td><td>${esc(b.author)}</td><td class="muted">${esc(b.series)}</td>
      <td class="num">${b.number || ""}</td><td>${selectCell("books", "status", b)}</td><td>${selectCell("books", "priority", b)}</td>
      <td class="date">${b.finished ? "✓ " + b.finished : ""}</td><td class="muted">${esc(b.format)}</td>
      <td class="num">${b.score != null ? scoreText(b.score) : ""}</td></tr>`).join("")}</tbody></table></div>`;
}

/* cover that fades in beside the pointer while you hover a list row */
function showPeek(item, x, y) {
  const peek = $("#peek");
  peek.dataset.key = coverKey(item);
  peek.classList.toggle("bookpeek", item.author !== undefined);
  movePeek(x, y);
  loadCover(item).then(uri => {
    if (peek.dataset.key !== coverKey(item)) return;
    const img = peek.querySelector("img");
    if (!uri) { peek.classList.remove("show"); return; }
    if (img.src !== uri) { img.src = uri; }
    requestAnimationFrame(() => peek.classList.add("show"));
  });
}
function movePeek(x, y) {
  const peek = $("#peek"), w = 210, h = 300;
  const left = x + 28 + w > innerWidth ? x - w - 28 : x + 28;
  const top = Math.min(Math.max(80, y - h / 2), innerHeight - h - 16);
  peek.style.transform = `translate(${left}px, ${top}px)`;
}
function hidePeek() { const p = $("#peek"); if (p) { p.classList.remove("show"); p.dataset.key = ""; } }

/* ----- library / wishlist / played ----- */
function filtered() {
  const f = state.filter, q = f.q.trim().toLowerCase();
  const list = state.games.filter(g => {
    if (state.view === "wishlist" && g.status !== "Wishlist") return false;
    if (state.view === "played" && !["Completed", "Dropped"].includes(g.status)) return false;
    if (state.view === "library" && g.status === "Wishlist" && f.status !== "Wishlist") return false;
    if (f.status === "Live service" || f.status === "Modded") { if (g.type !== f.status) return false; }
    else if (f.status === "Plan to migrate") { if (!migrating(g) && !(groupOf(g.platform) === "Exiled" && owned(g)) && !(g.platform === "Epic Games" && owned(g))) return false; }
    else if (f.status !== "All" && statusOf(g) !== f.status && !(f.status === "Dropped" && g.status === "Dropped")) return false;
    if (f.plats.size && !f.plats.has(groupOf(g.platform))) return false;
    if (f.playOn === "Console" && !CONSOLES.has(g.platform)) return false;
    if (["PC", "Steam Deck"].includes(f.playOn) && (g.play_on !== f.playOn || CONSOLES.has(g.platform))) return false;
    if (f.prio !== "All" && g.priority !== f.prio) return false;
    if (q && !`${g.name} ${g.genre} ${g.developer} ${g.publisher} ${g.platform}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const order = Object.keys(PLAT);
  const sorts = {
    priority: byPrio, name: (a, b) => a.name.localeCompare(b.name),
    score: (a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name),
    recent: (a, b) => byDone(a, b) || a.name.localeCompare(b.name),
    hours: (a, b) => (b.hours ?? -1) - (a.hours ?? -1),
    platform: (a, b) => order.indexOf(a.platform) - order.indexOf(b.platform) || byPrio(a, b),
  };
  return list.sort(sorts[f.sort] || byPrio);
}
const seg = (obj, name, options) => `<div class="seg" data-seg="${name}">${options.map(o => `<button aria-pressed="${obj[name] === o}" data-v="${esc(o)}">${esc(o)}</button>`).join("")}</div>`;
const modeSwitch = () => `<div class="seg mode" data-mode><button aria-pressed="${state.mode === "covers"}" data-v="covers" title="Covers">▦ Covers</button><button aria-pressed="${state.mode === "list"}" data-v="list" title="List">☰ List</button></div>`;
function libraryHTML() {
  const f = state.filter;
  const statuses = state.view === "wishlist" ? [] : state.view === "played" ? ["All", "Completed", "Dropped", "Second chance"] : ["All", "Library", "Playing", "Paused", "Completed", "Dropped", "Second chance", "Wishlist", "Live service", "Modded", "Plan to migrate"];
  const present = new Set(state.games.map(g => groupOf(g.platform)));
  const groups = [...new Set(Object.keys(PLAT).map(groupOf))].filter(p => present.has(p));
  const chips = groups.map(p => {
    const c = GROUP_STYLE[p] || PLAT[p] || PLAT_FALLBACK;
    const label = GROUP_LABEL[p] || p;
    return `<button class="chip" data-plat="${esc(p)}" aria-pressed="${f.plats.has(p)}" style="--c:${c.chip};--t:${c.chipText}"><i></i>${esc(label)}</button>`;
  }).join("");
  const list = filtered();
  return `<div class="toolbar">
      <div class="line">
        <input class="search" id="search" type="search" placeholder="Search games, genres, studios" value="${esc(f.q)}">
        ${seg(f, "playOn", ["All", "PC", "Steam Deck", "Console"])}
        <select class="pick" id="prio"><option value="All">Any priority</option>${Object.keys(PRIO_ORDER).map(p => `<option ${f.prio === p ? "selected" : ""}>${p}</option>`).join("")}</select>
        <select class="pick" id="sort">${[["priority", "Sort by priority"], ["name", "Sort by name"], ["score", "Sort by score"], ["recent", "Recently finished"], ["hours", "Most hours"], ["platform", "Sort by platform"]].map(([v, l]) => `<option value="${v}" ${f.sort === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        ${modeSwitch()}
        <span class="total">${list.length} ${list.length === 1 ? "game" : "games"}</span>
        ${state.canEdit ? `<button class="ghost small" data-add="games">+ Add game</button>` : ""}
      </div>
      ${statuses.length ? `<div class="line">${seg(f, "status", statuses)}</div>` : ""}
      <div class="line">${chips}</div>
    </div>
    ${!list.length ? `<p class="empty">No games match these filters. Clear the search or pick another platform.</p>`
      : state.mode === "list" ? gameListHTML(list) : `<div class="grid">${list.map(g => caseHTML(g)).join("")}</div>`}`;
}

/* ----- your years ----- */
function yearStats() {
  const map = new Map();
  const get = y => { if (!map.has(y)) map.set(y, { year: y, games: [], replays: [], hours: 0, scores: [] }); return map.get(y); };
  for (const g of state.games) {
    if (!g.completed) continue;
    const s = get(+g.completed.slice(0, 4));
    s.games.push(g);
    if (g.hours) s.hours += g.hours;
    if (g.score != null) s.scores.push(g.score);
  }
  for (const p of state.plays) {
    if (!p.finished || !p.finished_on) continue;
    const s = get(+p.finished_on.slice(0, 4));
    s.replays.push(p);
    if (p.hours) s.hours += p.hours;
  }
  const now = new Date().getFullYear();
  if (!map.has(now)) get(now);
  return [...map.values()].sort((a, b) => b.year - a.year);
}
const split = (label, n, max, color) => `<div class="split"><span>${esc(label)}</span><span class="track"><span style="width:${n / max * 100}%;background:${color}"></span></span><span class="n">${n}</span></div>`;
function yearsHTML() {
  const ys = yearStats();
  const max = Math.max(1, ...ys.map(y => y.games.length + y.replays.length));
  const now = new Date().getFullYear();
  const rows = ys.map(y => {
    const avg = y.scores.length ? (y.scores.reduce((a, b) => a + b, 0) / y.scores.length).toFixed(1) : "–";
    const top = [...y.games].filter(g => g.score != null).sort((a, b) => b.score - a.score || byDone(a, b))[0];
    const plats = {}; y.games.forEach(g => plats[g.platform] = (plats[g.platform] || 0) + 1);
    const main = Object.entries(plats).sort((a, b) => b[1] - a[1])[0];
    const list = [...y.games].sort((a, b) => (a.completed || "").localeCompare(b.completed || ""));
    return `<div class="year ${y.year === now ? "current" : ""} ${state.openYears.has(y.year) ? "open" : ""}" data-year="${y.year}">
      <button aria-expanded="${state.openYears.has(y.year)}">
        <span class="y">${y.year}</span>
        <span class="bars" title="${y.games.length} games, ${y.replays.length} replays"><span class="g" style="width:${y.games.length / max * 100}%"></span><span class="r" style="width:${y.replays.length / max * 100}%"></span></span>
        <span class="num"><b>${y.games.length}</b><small>games</small></span>
        <span class="num"><b>${Math.round(y.hours) || "–"}</b><small>hours</small></span>
        <span class="num"><b>${avg}</b><small>avg score</small></span>
      </button>
      <div class="detail">
        <div class="best">${top ? `Best of the year: <b>${esc(top.name)}</b>, ${scoreText(top.score)}` : "Nothing rated yet."}${main ? `  ·  Mostly on ${esc(main[0])}` : ""}${y.replays.length ? `  ·  ${y.replays.length} replay${y.replays.length > 1 ? "s" : ""}` : ""}</div>
        ${list.length ? `<div class="shelf-row">${list.map(g => caseHTML(g, { sub: fmtDate(g.completed) })).join("")}</div>` : `<p class="intro">No games finished yet this year. Set a game to Completed and it shows up here.</p>`}
      </div></div>`;
  }).join("");
  const total = state.games.length || 1;
  const own = state.games.filter(owned);
  const platCounts = Object.keys(PLAT).map(p => [p, own.filter(g => g.platform === p).length]).filter(x => x[1]);
  const pmax = Math.max(1, ...platCounts.map(x => x[1]));
  const sts = ["Library", "Playing", "Paused", "Wishlist", "Completed", "Dropped", "Second chance"].map(s => [s, state.games.filter(g => statusOf(g) === s).length]);
  const smax = Math.max(1, ...sts.map(x => x[1]));
  const rest = state.games.filter(g => ["Library", "Playing", "Paused"].includes(g.status));
  const dev = [
    ["PC", "#C7D5E0", g => !CONSOLES.has(g.platform) && g.play_on !== "Steam Deck"],
    ["Steam Deck", "#1A9FFF", g => !CONSOLES.has(g.platform) && g.play_on === "Steam Deck"],
    ["PlayStation 5", "#2E7BFF", g => g.platform === "PS5" || g.platform === "PS4"],
    ["Nintendo Switch 2", "#E60012", g => g.platform === "Switch 2" || g.platform === "Switch"],
    ["PlayStation 2", "#B8B8B8", g => g.platform === "PS2"],
  ].map(([d, c, fn]) => [d, c, rest.filter(fn).length]);
  const dmax = Math.max(1, ...dev.map(x => x[2]));
  return `<div class="years">
    <div>
      <h2>Your years</h2>
      <p class="intro">Every game you finished, year by year. Click a year to see the games. Replays come from the Playthroughs tab.</p>
      <div class="legend"><span><i style="background:#66C0F4"></i>First finishes</span><span><i style="background:#5BD38A"></i>Replays</span></div>
      ${rows}
    </div>
    <aside class="side">
      <section><h3>Owned by platform</h3>${platCounts.map(([p, n]) => split(p, n, pmax, PLAT[p].accent)).join("")}</section>
      <section><h3>By status</h3>${sts.map(([s, n]) => split(s, n, smax, STATUS_COLOR[s])).join("")}</section>
      <section><h3>Where you'll play the rest</h3>${dev.map(([d, c, n]) => split(d, n, dmax, c)).join("")}<p class="fine">PS4 discs count toward PlayStation 5 and Switch 1 games toward Switch 2, since that's where you play them.</p></section>
      <section><h3>All time</h3><div class="kv">
        <div><small>Games tracked</small><span>${total}</span></div>
        <div><small>Total runs</small><span>${state.games.reduce((a, g) => a + (g.runs || 0), 0)}</span></div>
        <div><small>Hours logged</small><span>${Math.round(state.games.reduce((a, g) => a + (g.hours || 0), 0) + state.plays.reduce((a, p) => a + (p.hours || 0), 0)).toLocaleString()}</span></div>
        <div><small>Average score</small><span>${(() => { const s = state.games.filter(g => g.score != null); return s.length ? (s.reduce((a, g) => a + g.score, 0) / s.length).toFixed(1) : "–"; })()}</span></div>
      </div></section>
    </aside></div>`;
}

/* ---------- books ---------- */
const bySeries = (a, b) => (a.series || "~").localeCompare(b.series || "~") || (a.number || 0) - (b.number || 0) || a.name.localeCompare(b.name);
function bookHero() { const B = state.books; return B.find(b => b.id === state.focusId) || B.find(b => b.status === "Reading") || B.filter(b => b.status === "To read").sort(byPrio)[0] || B[0]; }
function bookShelfHTML() {
  if (!state.books.length) return `<div class="welcome"><h1>No books yet</h1><p class="intro">Add a Books tab to the sheet, or add your first book here.</p>${state.canEdit ? `<div class="actions"><button class="primary" data-add="books">Add a book</button></div>` : ""}</div>`;
  const B = state.books, year = new Date().getFullYear();
  const series = [...new Set(B.map(b => b.series).filter(Boolean))].map(s => ({ title: s, items: B.filter(b => b.series === s).sort(bySeries) }));
  const rows = [
    { title: "Reading now", items: B.filter(b => b.status === "Reading") },
    { title: "Up next", items: B.filter(b => b.status === "To read").sort(byPrio).slice(0, 30) },
    ...series,
    { title: "Standalone", items: B.filter(b => !b.series && b.status !== "Wishlist") },
    { title: `Read in ${year}`, items: B.filter(b => (b.finished || "").startsWith(String(year))) },
    { title: "Wishlist", items: B.filter(b => b.status === "Wishlist").sort(byPrio) },
  ].filter(s => s.items.length).map(s => `
    <section class="shelf"><div class="shelf-head"><h2>${esc(s.title)}</h2><span class="count">${s.items.length}</span></div>
      <div class="shelf-row books-row">${s.items.map(b => bookHTML(b)).join("")}</div></section>`).join("");
  return `<section class="hero book-hero"><div class="hero-bg" id="heroBg"></div><div id="heroCase"></div><div id="heroText"></div></section>${rows}`;
}
function updateBookHero(b, force) {
  if (!b || state.view !== "shelf") return;
  if (!force && $("#heroText")?.dataset.id === String(b.id)) return;
  $("#heroCase").innerHTML = bookHTML(b, { noLabel: true });
  activateArt($("#heroCase"));
  const t = $("#heroText"); t.dataset.id = b.id;
  const kicker = b.status === "Reading" ? "Reading now" : b.status === "Read" ? "Read" : b.status === "Wishlist" ? "On your wishlist" : "On your shelf";
  t.innerHTML = `<div class="hero-kicker">${kicker}</div><h1>${esc(b.name)}</h1>
    <div class="facts"><span>by <b>${esc(b.author)}</b></span>${b.series ? `<span>${esc(b.series)}${b.number ? ` · book ${b.number}` : ""}</span>` : ""}${b.finished ? `<span>Finished <b>${fmtDate(b.finished)}</b></span>` : ""}</div>
    <div class="scores" id="heroScores"></div>
    <div class="actions"><button class="primary" data-open="${b.id}" data-kind="book">Details</button></div>`;
  loadCover(b).then(uri => { const bg = $("#heroBg"); if (bg && $("#heroText")?.dataset.id === String(b.id)) bg.style.backgroundImage = uri ? `url("${uri}")` : "none"; });
  Promise.resolve(api?.book_info(b)).then(info => { const box = $("#heroScores"); if (box && info && $("#heroText")?.dataset.id === String(b.id)) box.innerHTML = bookMiniScores(info); }).catch(() => {});
}
function bookMiniScores(info) {
  const out = [];
  if (info.google?.rating) out.push(`<span class="mini"><b class="mc user good">${info.google.rating.toFixed(1)}</b>Google Books</span>`);
  if (info.openlibrary?.rating) out.push(`<span class="mini"><b class="mc user good">${info.openlibrary.rating.toFixed(1)}</b>Open Library</span>`);
  const pages = info.google?.pages || info.openlibrary?.pages;
  if (pages) out.push(`<span class="mini"><b class="plain">${pages}</b>pages</span>`);
  return out.join("");
}
function bookFiltered() {
  const f = state.bfilter, q = f.q.trim().toLowerCase();
  const list = state.books.filter(b => (f.status === "All" || b.status === f.status) && (!q || `${b.name} ${b.author} ${b.series}`.toLowerCase().includes(q)));
  const sorts = { series: bySeries, name: (a, b) => a.name.localeCompare(b.name), author: (a, b) => a.author.localeCompare(b.author) || bySeries(a, b), priority: byPrio };
  return list.sort(sorts[f.sort] || bySeries);
}
function bookLibraryHTML() {
  const f = state.bfilter, list = bookFiltered();
  return `<div class="toolbar"><div class="line">
      <input class="search" id="bsearch" type="search" placeholder="Search books, authors, series" value="${esc(f.q)}">
      ${seg(f, "status", ["All", "To read", "Reading", "Read", "Dropped", "Wishlist"]).replace('data-seg="status"', 'data-bseg="status"')}
      <select class="pick" id="bsort">${[["series", "By series"], ["author", "By author"], ["name", "By title"], ["priority", "By priority"]].map(([v, l]) => `<option value="${v}" ${f.sort === v ? "selected" : ""}>${l}</option>`).join("")}</select>
      ${modeSwitch()}
      <span class="total">${list.length} ${list.length === 1 ? "book" : "books"}</span>
      ${state.canEdit ? `<button class="ghost small" data-add="books">+ Add book</button>` : ""}
    </div></div>
    ${!list.length ? `<p class="empty">No books match.</p>` : state.mode === "list" ? bookListHTML(list) : `<div class="grid books-grid">${list.map(b => bookHTML(b)).join("")}</div>`}`;
}
function bookYearsHTML() {
  const read = state.books.filter(b => b.status === "Read");
  const years = {};
  read.forEach(b => { const y = b.finished ? b.finished.slice(0, 4) : "Earlier"; (years[y] = years[y] || []).push(b); });
  const keys = Object.keys(years).sort((a, b) => (b === "Earlier" ? -1 : a === "Earlier" ? 1 : b.localeCompare(a)));
  if (!keys.length) return `<div class="welcome"><h1>Nothing read yet</h1><p class="intro">Set a book to Read and it lands here with the date you finished it.</p></div>`;
  return `<div class="years one">${keys.map(y => `<div class="year open"><button><span class="y">${y}</span><span></span><span class="num"><b>${years[y].length}</b><small>books</small></span></button>
    <div class="detail"><div class="shelf-row books-row">${years[y].map(b => bookHTML(b, { sub: b.finished ? fmtDate(b.finished) : b.author })).join("")}</div></div></div>`).join("")}</div>`;
}

/* ---------- detail panel ---------- */
let panelItem = null;
/* the case opens like the real thing: front cover swings over to show the manual, the disc sits in the tray */
function openCaseHTML(kind, item) {
  if (kind === "book") {
    const cached = covers.get(coverKey(item));
    return `<div class="opencase book">
      <div class="leaf back"><div class="page"><div class="manual-body" id="pageRight">${bookPageHTML(item)}</div></div></div>
      <div class="leaf front"><div class="face outside"><div class="art" data-kind="book" data-id="${item.id}">${cached ? `<img alt="" decoding="async" src="${cached}">` : ""}</div><div class="bspine"></div></div>
        <div class="face inside"><div class="manual paper"><div class="manual-body" id="manual"><p class="muted">Opening…</p></div></div></div></div></div>`;
  }
  const p = plat(item.platform), cached = covers.get(coverKey(item));
  const art = cached ? `<img alt="" decoding="async" src="${cached}">` : `<div class="fallback"><div class="t">${esc(item.name)}</div></div>`;
  const tray = p.media === "card"
    ? `<div class="cardslot"><div class="cart"><div class="cart-label">${cached ? `<img alt="" decoding="async" src="${cached}">` : ""}</div><span>${esc(p.label.replace("Nintendo ", ""))}</span></div></div><div class="clips"></div>`
    : `<div class="bigdisc ${p.disc || ""}"><div class="label">${cached ? `<img alt="" decoding="async" src="${cached}">` : ""}</div><div class="hub"></div></div>`;
  return `<div class="opencase p-${(item.platform || "x").replace(/\W+/g, "")}" style="--band:${p.band};--band-text:${p.text};--shell:${p.shell};--accent:${p.accent};--plat:${p.chip}">
    <div class="leaf back"><div class="tray">${tray}</div></div>
    <div class="leaf front">
      <div class="face outside"><div class="band"><span class="wm">${esc(p.label)}</span></div><div class="art" data-kind="game" data-id="${item.id}">${art}</div><div class="hinge"></div><div class="sheen"></div></div>
      <div class="face inside"><div class="manual"><div class="manual-body" id="manual"><p class="muted">Opening the manual…</p></div></div></div>
    </div></div>`;
}
function bookPageHTML(b) {
  return `<h4>${esc(b.name)}</h4><p class="by">${esc(b.author)}</p>${b.series ? `<p>${esc(b.series)}${b.number ? `, book ${b.number}` : ""}</p>` : ""}
    ${b.finished ? `<p>Finished ${fmtDate(b.finished)}</p>` : ""}${b.score != null ? `<p>Your score ${scoreText(b.score)}</p>` : ""}`;
}
function shortDlc(g, n) {
  const t = String(n || "").trim();
  return t.toLowerCase().startsWith(g.name.toLowerCase()) ? (t.slice(g.name.length).replace(/^\s*[:\-–]\s*/, "") || t) : t;
}
function manualHTML(g, about, dlcs) {
  const text = about?.text ? `<p class="syn">${esc(about.text)}</p>` : `<p class="muted">No description found yet.</p>`;
  const list = (dlcs || []).filter(d => d.kind !== "upgrade").slice(0, 5);
  const dl = list.length
    ? `<h5>${g.dlc_owned ? "DLC included" : "DLC available"}</h5><ul>${list.map(d => `<li class="${g.dlc_owned ? "have" : ""}">${g.dlc_owned ? "✓" : "–"} ${esc(shortDlc(g, d.name))}${d.major ? ` <b>Major</b>` : ""}</li>`).join("")}</ul>`
    : `<h5>DLC</h5><p class="muted">None found.</p>`;
  const facts = [about?.release && `Released ${about.release}`, about?.developers?.length && about.developers.join(", ")].filter(Boolean);
  return `<div class="mhead">${esc(g.name)}</div>${text}${dl}${facts.length ? `<p class="mfoot">${esc(facts.join(" · "))}</p>` : ""}${about?.source ? `<p class="msrc">Text from ${esc(about.source)}</p>` : ""}`;
}
function openPanel(kind, id, tab = "overview") {
  const item = findItem(kind, id);
  if (!item) return;
  const same = panelItem && panelItem.kind === kind && panelItem.id === item.id;
  panelItem = { kind, id: item.id };
  hidePeek();
  const panel = $("#panel");
  const tabs = kind === "game" ? [["overview", "Overview"], ["ratings", "Ratings"], ["dlc", "DLC"], ...(item.type === "Live service" ? [["milestones", "Milestones"]] : []), ["wiki", "Wiki"], ["news", "News"], ["edit", "Edit"]]
    : [["overview", "Overview"], ["wiki", "About"], ["edit", "Edit"]];
  if (!same) {
    try { FX.play.open(); } catch {}
    panel.innerHTML = `<div class="cv-bg"><div class="cv-art" id="cvArt"></div></div>
      <button class="icon close" aria-label="Close">✕</button>
      <div class="cv-stage">${openCaseHTML(kind, item)}</div>
      <div class="cv-info"><div class="cv-head"><h2>${esc(item.name)}</h2><div class="pills">${kind === "game" ? pillsHTML(item) : bookPills(item)}</div></div>
        <div class="ptabs" role="tablist">${tabs.map(([k, l]) => `<button data-ptab="${k}" aria-selected="${k === tab}">${l}</button>`).join("")}</div>
        <div class="pbody" id="pbody"></div></div>`;
    activateArt(panel);
    panel.classList.remove("opened");
    panel.classList.add("open"); panel.setAttribute("aria-hidden", "false");
    setTimeout(() => panel.classList.add("opened"), 90);
    panel.focus();
    const still = () => panelItem && panelItem.id === item.id && panelItem.kind === kind;
    const setArt = uri => { const a = $("#cvArt"); if (a && still() && uri) { a.style.backgroundImage = `url("${uri}")`; a.classList.add("on"); } };
    if (kind === "game") {
      Promise.resolve(api?.hero(item.name)).then(uri => uri ? setArt(uri) : loadCover(item).then(setArt)).catch(() => {});
      Promise.all([Promise.resolve(api?.about(item)).catch(() => null), Promise.resolve(api?.dlcs(item)).catch(() => [])])
        .then(([about, dlcs]) => { const m = $("#manual"); if (m && still()) m.innerHTML = manualHTML(item, about, dlcs); });
    } else {
      loadCover(item).then(setArt);
      Promise.resolve(api?.book_info(item)).then(i => { const m = $("#manual"); if (m && still()) m.innerHTML = `<div class="mhead">${esc(item.name)}</div><p class="syn">${esc(i?.google?.description || i?.wikipedia?.extract || "No description found yet.")}</p>`; }).catch(() => {});
    }
  }
  showPanelTab(tab);
}
function bookPills(b) {
  const out = [`<span class="pill" style="background:${STATUS_COLOR[b.status] || "#8F9BB3"}22;color:${STATUS_COLOR[b.status] || "#C9D1DC"}">${esc(b.status)}</span>`];
  if (b.author) out.push(`<span class="pill">${esc(b.author)}</span>`);
  if (b.series) out.push(`<span class="pill">${esc(b.series)}${b.number ? ` #${b.number}` : ""}</span>`);
  if (b.priority && b.status !== "Read") out.push(`<span class="pill" style="color:${PRIO_COLOR[b.priority]}">${esc(b.priority)} priority</span>`);
  if (b.format) out.push(`<span class="pill">${esc(b.format)}</span>`);
  return out.join("");
}
function showPanelTab(tab) {
  if (!panelItem) return;
  const item = findItem(panelItem.kind, panelItem.id);
  if (!item) return closePanel();
  document.querySelectorAll("[data-ptab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.ptab === tab)));
  $("#panel").querySelectorAll("video").forEach(v => v.pause()); try { FX.duck(false); } catch {}
  const body = $("#pbody");
  body.dataset.tab = tab;
  const still = () => body.isConnected && body.dataset.tab === tab && panelItem && findItem(panelItem.kind, panelItem.id) === item;
  const loading = text => `<p class="loading"><span class="spinner"></span>${text}</p>`;
  if (panelItem.kind === "book") {
    if (tab === "overview") body.innerHTML = bookOverviewHTML(item);
    if (tab === "wiki") { body.innerHTML = loading("Looking the book up…"); Promise.resolve(api?.book_info(item)).then(i => { if (still()) body.innerHTML = bookAboutHTML(item, i); }); }
    if (tab === "edit") body.innerHTML = editHTML("books", item);
    return;
  }
  if (tab === "overview") {
    body.innerHTML = gameOverviewHTML(item);
    Promise.resolve(api?.links(item)).then(links => { const box = $("#links"); if (box && still()) box.innerHTML = (links || []).map(l => `<button class="${l.primary ? "primary" : "ghost"}" data-url="${esc(l.url)}">${esc(l.label)}</button>`).join(""); }).catch(() => {});
    Promise.resolve(api?.media(item)).then(m => { if (still()) renderGallery(m || { shots: [], videos: [] }); }).catch(() => renderGallery({ shots: [], videos: [] }));
    Promise.resolve(api?.about(item)).then(a => { const box = $("#aboutLong"); if (box && still() && a?.long) { box.hidden = false; box.querySelector("div").textContent = a.long; } }).catch(() => {});
    getRatings(item).then(r => { const box = $("#ovScores"); if (box && still()) box.innerHTML = r && (r.metacritic || r.steam || r.playstation) ? `${miniScoresHTML(r)}<button class="linkish" data-ptab="ratings">View more</button>` : `<span class="muted">No ratings found.</span>`; });
  }
  if (tab === "ratings") { body.innerHTML = loading("Fetching scores…"); getRatings(item).then(r => { if (still()) body.innerHTML = ratingsHTML(item, r); }); }
  if (tab === "dlc") { body.innerHTML = loading("Looking for DLC…"); Promise.resolve(api?.dlcs(item)).then(d => { if (still()) body.innerHTML = dlcHTML(item, d || []); }); }
  if (tab === "wiki") { body.innerHTML = loading("Opening the wiki…"); Promise.resolve(api?.wiki(item)).then(w => { if (still()) body.innerHTML = wikiHTML(item, w); }); }
  if (tab === "milestones") { body.innerHTML = loading("Gathering milestones…"); Promise.resolve(api?.milestones(item)).then(m => { if (still()) body.innerHTML = milestonesHTML(item, m || []); }); }
  if (tab === "news") { body.innerHTML = loading("Fetching news…"); Promise.resolve(api?.news(item)).then(n => { if (still()) body.innerHTML = newsHTML(item, n || []); }); }
  if (tab === "edit") body.innerHTML = editHTML("games", item);
}
function gameOverviewHTML(g) {
  const runs = state.plays.filter(p => p.game === g.name);
  const kv = [];
  if (g.completed || g.status === "Completed") kv.push(["Finished", g.completed ? `${fmtDate(g.completed)} · ${daysAgoLabel(g.completed)}` : "Date unknown"]);
  if (g.dropped) kv.push(["Dropped", `${fmtDate(g.dropped)} · ${daysAgoLabel(g.dropped)}`]);
  if (g.hours_text) kv.push(["Hours", g.hours_text]);
  if (g.score != null) kv.push(["Your score", scoreText(g.score)]);
  if (g.runs) kv.push(["Runs", g.runs]);
  if (g.beaten_on.length) kv.push(["Beaten on", g.beaten_on.join(", ")]);
  if (g.genre) kv.push(["Genre", g.genre]);
  if (g.developer) kv.push(["Developer", g.developer]);
  if (g.publisher) kv.push(["Publisher", g.publisher]);
  if (upgradeLabel(g)) kv.push(["Upgrade", upgradeLabel(g)]);
  const fa = factsOf(g);
  if (fa.minutes) kv.push([`Played (${(fa.sources || []).map(s => ({ steam: "Steam", psn: "PlayStation", heroic: "Heroic", itch: "itch.io" }[s])).join(", ")})`, `${Math.round(fa.minutes / 6) / 10} h${fa.last_played ? ` · last ${typeof fa.last_played === "number" ? ago(fa.last_played) : ago(String(fa.last_played).slice(0, 10))}` : ""}`]);
  if (fa.achievements) kv.push(["Achievements", `${fa.achievements.done} / ${fa.achievements.total}`]);
  if (fa.trophies) kv.push(["Trophies", `${fa.trophies.progress}%${fa.trophies.platinum ? " · Platinum earned" : ""}`]);
  if (g.migrate_to) kv.push(["Migrate to", g.migrate_to]);
  const flags = [["DLC owned", g.dlc_owned], ["DLC done", g.dlc_done], ["100% / Platinum", g.platinum], ["Modded", g.modded]];
  if (g.status === "Dropped") flags.push(["Second chance", g.second_chance]);
  const quick = state.canEdit ? `<div class="quick">${opts("games", "status").map(s => `<button class="qs ${g.status === s ? "on" : ""}" data-quick="${esc(s)}" style="--c:${STATUS_COLOR[s] || "#8F9BB3"}">${esc(s)}</button>`).join("")}</div>` : "";
  const fresh = state.updated[g.name];
  return `${fresh ? `<div class="freshbar" data-url="${esc(fresh.url || "")}"><b>Newly updated!</b> ${esc(fresh.title)} · ${ago(fresh.date)}</div>` : ""}
    <div class="gallery" id="gallery"><div class="g-main" id="gMain"><div class="g-empty"><span class="spinner"></span></div></div><div class="g-strip" id="gStrip"></div></div>
    <div class="links" id="links"><button class="ghost" disabled>Finding links…</button></div>
    <div class="scores" id="ovScores"><span class="muted">Fetching scores…</span></div>
    ${quick}
    <div class="kv">${kv.map(([k, v]) => `<div><small>${esc(k)}</small><span>${esc(v)}</span></div>`).join("")}</div>
    <div class="flags">${flags.map(([k, on]) => `<span class="flag ${on ? "on" : ""}">${on ? "✓ " : ""}${esc(k)}</span>`).join("")}</div>
    ${g.notes ? `<h3>Notes</h3><p class="notes">${esc(g.notes)}</p>` : ""}
    <details class="more about-long" id="aboutLong" hidden><summary>About this game</summary><div></div></details>
    <h3>Runs</h3>
    ${runs.length ? `<ul class="runs">${runs.map(r => `<li><span>Run ${r.run || "?"}${r.platform ? ` on ${esc(r.platform)}` : ""}${r.modded ? " · modded" : ""}${r.dlc ? " · with DLC" : ""}${r.platinum ? " · 100%" : ""}</span><span>${r.finished_on ? fmtDate(r.finished_on) : r.finished ? "Finished" : "In progress"}</span></li>`).join("")}</ul>` : `<p class="muted">${g.status === "Completed" ? "One run so far." : "No runs yet."}</p>`}
    ${state.canEdit && g.status === "Completed" ? `<button class="ghost small" id="logRun">Log a replay</button><div id="runForm"></div>` : ""}`;
}
let galleryItems = [];
function renderGallery(m) {
  const main = $("#gMain"), strip = $("#gStrip");
  if (!main) return;
  galleryItems = [...(m.videos || []).map(v => ({ ...v, video: true })), ...(m.shots || [])];
  if (!galleryItems.length) { $("#gallery").hidden = true; return; }
  strip.innerHTML = galleryItems.map((it, i) => `<button class="g-thumb ${i === 0 ? "on" : ""} ${it.video ? "vid" : ""}" data-g="${i}"><img alt="" loading="lazy" decoding="async" src="${esc(it.thumb)}">${it.video ? "<i>▶</i>" : ""}</button>`).join("");
  showGallery(0, false);
}
function showGallery(i, play) {
  const it = galleryItems[i], main = $("#gMain");
  if (!it || !main) return;
  document.querySelectorAll(".g-thumb").forEach(b => b.classList.toggle("on", +b.dataset.g === i));
  try { FX.duck(false); } catch {}
  if (it.video && play) {
    try { FX.duck(true); } catch {}
    if (it.youtube) { main.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(it.youtube)}?autoplay=1&rel=0" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>`; return; }
    const src = it.webm || it.mp4 || it.hls;
    main.innerHTML = `<video controls autoplay playsinline poster="${esc(it.thumb)}">${it.webm ? `<source src="${esc(it.webm)}" type="video/webm">` : ""}${it.mp4 ? `<source src="${esc(it.mp4)}" type="video/mp4">` : ""}${!it.webm && !it.mp4 && it.hls ? `<source src="${esc(it.hls)}" type="application/x-mpegURL">` : ""}</video>`;
    const v = main.querySelector("video");
    v.addEventListener("ended", () => { try { FX.duck(false); } catch {} });
    v.addEventListener("error", () => { main.innerHTML = `<div class="g-empty">This trailer only plays on Steam. <button class="ghost small" data-url="${esc(it.page || "")}">Watch on Steam</button></div>`; try { FX.duck(false); } catch {} }, true);
    if (!src) v.dispatchEvent(new Event("error"));
    return;
  }
  main.innerHTML = it.video
    ? `<button class="g-play" data-gplay="${i}"><img alt="" src="${esc(it.thumb)}"><span>▶</span><small>${esc(it.name || "Trailer")}</small></button>`
    : `<img alt="" decoding="async" src="${esc(it.full || it.thumb)}">`;
}
function ratingsHTML(g, r) {
  if (!r || (!r.metacritic && !r.steam && !r.playstation)) return `<p class="muted">No ratings found for this game. Metacritic and the stores may list it under a different name.</p>`;
  const mc = r.metacritic || {};
  const big = (label, val, cls, sub, url) => `<a class="scorebox ${cls}" ${url ? `data-url="${esc(url)}"` : ""}><b>${val ?? "–"}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ""}</a>`;
  const top = [];
  top.push(big("Metascore", mc.critic, `mc ${mcClass(mc.critic)}`, mc.critic_count ? `${mc.critic_count} critics` : "", mc.url));
  if (r.platform_score) top.push(big(`on ${r.platform_score.name}`, r.platform_score.score, `mc ${mcClass(r.platform_score.score)}`, r.platform_score.count ? `${r.platform_score.count} critics` : "", mc.url));
  else if (r.platform_name && r.platform_name !== "PC") top.push(big(`on ${r.platform_name}`, "–", "", "not rated there", null));
  const more = [];
  if (mc.user != null) more.push(big("Metacritic users", (+mc.user).toFixed(1), `mc user ${userClass(mc.user)}`, mc.user_count ? `${mc.user_count.toLocaleString()} ratings` : "", mc.url ? mc.url + "user-reviews/" : null));
  if (r.steam) more.push(big("Steam reviews", `${r.steam.percent}%`, "steamr", `${esc(r.steam.label)} · ${r.steam.count.toLocaleString()}`, r.steam.url));
  if (r.playstation) more.push(big("PlayStation Store", `${r.playstation.stars.toFixed(2)}★`, "psr", r.playstation.count ? `${r.playstation.count.toLocaleString()} ratings` : "", r.playstation.url));
  const others = r.other_platforms || [];
  return `<div class="scorerow">${top.join("")}</div>
    ${more.length ? `<details class="more" open><summary>View more</summary><div class="scorerow">${more.join("")}</div></details>` : ""}
    ${others.length ? `<details class="more"><summary>Other platform scores</summary><ul class="plist">${others.map(p => `<li><span>${esc(p.name)}</span><b class="mc ${mcClass(p.score)}">${p.score}</b></li>`).join("")}</ul></details>` : ""}
    <p class="fine">Scores from ${[mc.url && "Metacritic", r.steam && "Steam", r.playstation && "the PlayStation Store"].filter(Boolean).join(", ")}. Nintendo's eShop doesn't publish player ratings, so Switch games show Metacritic's Switch score instead.</p>`;
}
function dlcHTML(g, list) {
  if (!list.length) return `<p class="muted">No DLC found for this game.</p>`;
  const row = d => `<li class="${d.major ? "major" : ""} ${d.kind === "upgrade" ? "upg" : ""}">
      <div class="dl-art">${d.art ? `<img alt="" loading="lazy" decoding="async" src="${esc(d.art)}">` : `<span>${esc(shortDlc(g, d.name).slice(0, 2).toUpperCase())}</span>`}</div>
      <div class="dl-main"><div class="dl-title"><b>${esc(shortDlc(g, d.name))}</b>${d.major ? `<span class="majortag">Major expansion</span>` : d.kind === "upgrade" ? `<span class="minortag">Upgrade / pass</span>` : ""}${d.coming ? `<span class="minortag soon">Coming</span>` : ""}</div>
        <small>${[d.release, d.price].filter(Boolean).map(esc).join(" · ")}</small>${d.summary ? `<p>${esc(d.summary)}</p>` : ""}</div>
      <div class="dl-scores">${d.metacritic != null ? `<span class="mc ${mcClass(d.metacritic)}" data-url="${esc(d.metacritic_url || "")}" title="Metascore">${d.metacritic}</span>` : ""}
        ${d.steam ? `<span class="steamr" title="${esc(d.steam.label)}">${d.steam.percent}%</span>` : ""}
        ${d.url ? `<button class="linkish" data-url="${esc(d.url)}">Store</button>` : ""}</div></li>`;
  return `<p class="fine">${g.dlc_owned ? `You own DLC for this game${g.dlc_done ? " and you've finished it" : ""}.` : "You haven't marked any DLC as owned."}</p>
    <ul class="dlcs">${list.map(row).join("")}</ul>`;
}
function milestonesHTML(g, items) {
  if (!items.length) return `<p class="muted">No major updates found yet. Milestones come from the game's official update posts.</p>`;
  return `<ol class="milestones">${items.map(m => `<li class="${m.upcoming ? "soon" : ""}" data-url="${esc(m.url)}">
      <div class="ms-art">${m.thumb ? `<img alt="" loading="lazy" decoding="async" src="${esc(m.thumb)}">` : ""}</div>
      <div class="ms-text"><div class="meta">${m.upcoming ? `<span class="ntag soon">Coming ${new Date(m.start * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>` : `<span class="ntag major">${m.kind === "release" ? "Launch" : "Major update"}</span>`}<span>${m.date ? ago(m.date) : ""}</span></div>
        <b>${esc(m.title)}</b>${m.summary ? `<p>${esc(m.summary)}</p>` : ""}</div></li>`).join("")}</ol>`;
}
function wikiHTML(g, w) {
  const wp = w?.wikipedia;
  const pc = !CONSOLES.has(g.platform);
  return `${wp ? `<div class="wiki">${wp.thumb ? `<img alt="" src="${esc(wp.thumb)}">` : ""}<h3>${esc(wp.title)}</h3><p>${esc(wp.extract)}</p></div>` : `<p class="muted">No Wikipedia article found.</p>`}
    <div class="links">${wp?.url ? `<button class="primary" data-url="${esc(wp.url)}">Read on Wikipedia</button>` : ""}
      ${w?.fandom ? `<button class="ghost" data-url="${esc(w.fandom)}">Search Fandom wikis</button>` : ""}
      ${pc && w?.pcgamingwiki ? `<button class="ghost" data-url="${esc(w.pcgamingwiki)}">PCGamingWiki</button>` : ""}</div>`;
}
function newsHTML(g, items) {
  if (!items.length) return `<p class="muted">No recent news found.</p>`;
  const cutoff = Date.now() / 1000 - 14 * 86400;
  const fallback = covers.get(coverKey(g));
  const tag = n => n.upcoming ? `<span class="ntag soon">Coming</span>` : n.kind === "major" ? `<span class="ntag major">${n.date >= cutoff ? "Newly updated! · " : ""}Milestone</span>`
    : n.kind === "update" ? `<span class="ntag">${n.date >= cutoff ? "Newly updated!" : "Update"}</span>` : n.kind === "minor" ? `<span class="ntag minor">Hotfix</span>` : "";
  return `<ul class="news">${items.map(n => `<li class="${n.patch && n.date >= cutoff ? "fresh" : ""} ${n.kind === "major" ? "big" : ""}" data-url="${esc(n.url)}">
      <div class="n-thumb">${n.thumb ? `<img alt="" loading="lazy" decoding="async" src="${esc(n.thumb)}">` : fallback ? `<img alt="" class="dim" src="${fallback}">` : ""}</div>
      <div class="n-text"><div class="meta">${tag(n)}<span>${esc(n.source)}</span><span>${n.date ? ago(n.date) : ""}</span></div>
      <b>${esc(n.title)}</b>${n.summary ? `<p>${esc(n.summary)}</p>` : ""}</div></li>`).join("")}</ul>`;
}
function bookOverviewHTML(b) {
  const kv = [["Author", b.author], b.series && ["Series", `${b.series}${b.number ? `, book ${b.number}` : ""}`], b.finished && ["Finished", `${fmtDate(b.finished)} · ${daysAgoLabel(b.finished)}`], b.score != null && ["Your score", scoreText(b.score)], b.format && ["Format", b.format]].filter(Boolean);
  const quick = state.canEdit ? `<div class="quick">${opts("books", "status").map(s => `<button class="qs ${b.status === s ? "on" : ""}" data-quick="${esc(s)}" style="--c:${STATUS_COLOR[s] || "#8F9BB3"}">${esc(s)}</button>`).join("")}</div>` : "";
  const next = b.series ? state.books.filter(x => x.series === b.series).sort(bySeries) : [];
  return `${quick}<div class="kv">${kv.map(([k, v]) => `<div><small>${esc(k)}</small><span>${esc(v)}</span></div>`).join("")}</div>
    ${b.notes ? `<h3>Notes</h3><p class="notes">${esc(b.notes)}</p>` : ""}
    ${next.length > 1 ? `<h3>${esc(b.series)} in order</h3><ol class="series">${next.map(x => `<li class="${x.id === b.id ? "here" : ""} ${x.status === "Read" ? "read" : ""}" data-open="${x.id}" data-kind="book">${esc(x.name)}<span>${esc(x.status)}</span></li>`).join("")}</ol>` : ""}
    ${b.store_link ? `<div class="links"><button class="primary" data-url="${esc(b.store_link)}">Open your saved link</button></div>` : ""}`;
}
function bookAboutHTML(b, i) {
  if (!i) return `<p class="muted">Couldn't look this book up right now.</p>`;
  const wp = i.wikipedia, g = i.google, ol = i.openlibrary;
  const desc = g?.description || wp?.extract;
  return `<div class="scorerow">
      ${g?.rating ? `<a class="scorebox mc user good" data-url="${esc(g.url || "")}"><b>${g.rating.toFixed(1)}</b><span>Google Books</span><small>${g.count ? `${g.count} ratings` : ""}</small></a>` : ""}
      ${ol?.rating ? `<a class="scorebox mc user good" data-url="${esc(ol.url)}"><b>${ol.rating.toFixed(1)}</b><span>Open Library</span><small>${ol.count ? `${ol.count} ratings` : ""}</small></a>` : ""}
      ${g?.pages || ol?.pages ? `<div class="scorebox"><b>${g?.pages || ol?.pages}</b><span>pages</span><small>${ol?.year ? `first published ${ol.year}` : esc(g?.published || "")}</small></div>` : ""}
    </div>
    ${desc ? `<p class="about">${esc(desc)}</p>` : ""}
    <div class="links">${wp?.url ? `<button class="primary" data-url="${esc(wp.url)}">Read on Wikipedia</button>` : ""}
      <button class="ghost" data-url="${esc(i.goodreads)}">Goodreads</button>
      ${ol?.url ? `<button class="ghost" data-url="${esc(ol.url)}">Open Library</button>` : ""}</div>`;
}

/* ----- editing ----- */
const GAME_FORM = [["name", "Name", "text"], ["status", "Status", "select"], ["priority", "Priority", "select"], ["platform", "Platform", "select"], ["play_on", "Play on", "select"],
  ["format", "Format", "select"], ["upgrade", "Upgrade", "select"], ["hours", "Hours", "number"], ["score", "Score (0–10)", "number"],
  ["type", "Category", "select"], ["migrate_to", "Migrate to", "select"],
  ["genre", "Genre", "text"], ["store_link", "Store link", "text"], ["notes", "Notes", "textarea"],
  ["second_chance", "Second chance", "check"], ["dlc_owned", "DLC owned", "check"], ["dlc_done", "DLC done", "check"], ["platinum", "100% / Platinum", "check"], ["modded", "Modded", "check"]];
const BOOK_FORM = [["name", "Title", "text"], ["author", "Author", "text"], ["series", "Series", "text"], ["number", "Number in series", "number"],
  ["status", "Status", "select"], ["priority", "Priority", "select"], ["format", "Format", "select"], ["score", "Score (0–10)", "number"],
  ["store_link", "Store link", "text"], ["notes", "Notes", "textarea"]];
function fieldHTML(cat, [k, label, type], item) {
  const v = item?.[k];
  if (type === "select") return `<label>${label}<select name="${k}"><option value=""></option>${opts(cat, k).map(o => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
  if (type === "number") return `<label>${label}<input name="${k}" type="number" step="0.1" min="0" ${k === "score" ? 'max="10"' : ""} value="${v ?? ""}"></label>`;
  if (type === "textarea") return `<label class="wide">${label}<textarea name="${k}" rows="3">${esc(v || "")}</textarea></label>`;
  if (type === "check") return `<label class="check"><input name="${k}" type="checkbox" ${v ? "checked" : ""}>${label}</label>`;
  return `<label class="${["notes", "store_link", "name"].includes(k) ? "wide" : ""}">${label}<input name="${k}" type="text" value="${esc(v ?? "")}"></label>`;
}
function editHTML(cat, item) {
  if (!state.canEdit) return `<p class="muted">To edit here, connect the app to your sheet: open Settings and follow "How to connect your sheet". Until then, edit the sheet itself and the app picks up the changes on the next sync.</p>`;
  const form = cat === "games" ? GAME_FORM : BOOK_FORM;
  return `<form class="editform" id="editForm" data-cat="${cat}">
    <div class="fields">${form.filter(f => f[2] !== "check").map(f => fieldHTML(cat, f, item)).join("")}</div>
    ${cat === "games" ? `<div class="checks">${form.filter(f => f[2] === "check").map(f => fieldHTML(cat, f, item)).join("")}</div>` : ""}
    <p class="fine">Finish and drop dates, runs and "Beaten on" are filled in by the sheet itself. Renaming a game also renames its replays and fetches the cover for the new name.</p>
    ${cat === "games" ? `<div class="row"><button type="button" class="ghost small" id="customCover">Use my own cover…</button><button type="button" class="ghost small" id="resetCover">Back to the official cover</button></div>` : ""}
    <div class="row"><span class="spacer"></span><button type="submit" class="primary">Save changes</button></div></form>`;
}
function readForm(form, cat, item) {
  const fields = cat === "games" ? GAME_FORM : BOOK_FORM;
  const changes = {};
  for (const [k, , type] of fields) {
    const el = form.elements[k];
    if (!el) continue;
    let v = type === "check" ? el.checked : el.value.trim();
    if (type === "number") v = v === "" ? "" : +v;
    const old = item?.[k] ?? (type === "check" ? false : "");
    if (type === "number" ? String(v) !== String(old ?? "") : v !== old) changes[k] = v;
  }
  return changes;
}
async function saveEdit(cat, item, changes, quiet) {
  if (!Object.keys(changes).length) { if (!quiet) toast("Nothing changed."); return; }
  const tab = cat === "books" ? "books" : "games";
  const before = { ...item };
  Object.assign(item, changes);
  if (changes.status === "Completed" && !item.completed && tab === "games") item.completed = new Date().toISOString().slice(0, 10);
  if (changes.status === "Read" && !item.finished && tab === "books") item.finished = new Date().toISOString().slice(0, 10);
  render(); if (panelItem) refreshPanelHead();
  const res = await Promise.resolve(api?.edit(tab, before.row, before.name, changes)).catch(e => ({ error: String(e) }));
  if (!res || res.error) {
    Object.assign(item, before); render(); if (panelItem) refreshPanelHead();
    toast(`Couldn't save: ${res?.error || "no connection"}`, "err");
    return;
  }
  try { FX.play.save(); } catch {}
  if (changes.name) { covers.delete(coverKey(before)); }
  toast(`Saved to the sheet${res.skipped?.length ? ` (the sheet fills in ${res.skipped.join(", ")} itself)` : ""}.`, "ok");
  setTimeout(() => sync(false), 1500);
}
function refreshPanelHead() {
  const item = findItem(panelItem.kind, panelItem.id);
  if (!item) return;
  const head = $("#panel .cv-head");
  if (head) head.innerHTML = `<h2>${esc(item.name)}</h2><div class="pills">${panelItem.kind === "game" ? pillsHTML(item) : bookPills(item)}</div>`;
  if ($("#pbody")?.dataset.tab === "overview") showPanelTab("overview");
}
function closePanel() {
  const panel = $("#panel");
  if (!panel.classList.contains("open")) return;
  panel.querySelectorAll("video").forEach(v => v.pause());
  try { FX.duck(false); } catch {}
  try { FX.play.back(); } catch {}
  panel.classList.remove("opened");
  setTimeout(() => { panel.classList.remove("open"); panel.setAttribute("aria-hidden", "true"); }, 260);
  $("#scrim").hidden = true;
  panelItem = null;
}

/* ----- add dialog ----- */
function openAdd(cat) {
  if (!state.canEdit) { openSettings(true); return; }
  const f = $("#addForm");
  const fields = cat === "games"
    ? [["name", "Game", "text"], ["status", "Status", "select"], ["platform", "Platform", "select"], ["play_on", "Play on", "select"], ["priority", "Priority", "select"], ["format", "Format", "select"]]
    : BOOK_FORM.slice(0, 7);
  const defaults = cat === "games" ? { status: state.view === "wishlist" ? "Wishlist" : "Library", platform: "Steam", play_on: "PC", format: "Digital" } : { status: "To read", format: "Physical" };
  f.dataset.cat = cat;
  f.innerHTML = `<h2>${cat === "games" ? "Add a game" : "Add a book"}</h2>
    <div class="fields">${fields.map(x => fieldHTML(cat, x, defaults)).join("")}</div>
    <div class="row"><span class="spacer"></span><button value="cancel" class="ghost">Cancel</button><button value="add" class="primary">Add to the sheet</button></div>`;
  $("#addDialog").showModal();
  f.elements.name.focus();
}
async function submitAdd(form) {
  const cat = form.dataset.cat, tab = cat === "games" ? "games" : "books";
  const values = {};
  [...form.elements].forEach(el => { if (el.name && el.value !== "") values[el.name] = el.type === "number" ? +el.value : el.value.trim(); });
  if (!values.name) return toast("Give it a name first.", "err");
  if (tab === "games" && CONSOLES.has(values.platform)) delete values.play_on;
  const res = await Promise.resolve(api?.add(tab, values)).catch(e => ({ error: String(e) }));
  if (!res || res.error) return toast(`Couldn't add: ${res?.error || "no connection"}`, "err");
  toast(`Added ${values.name}.`, "ok");
  sync(true);
}

/* ---------- sync ---------- */
function setSync(kind, text) { const b = $("#syncBtn"); b.className = `sync ${kind}`; $("#syncText").textContent = text; }
function syncLabel() {
  if (state.error && state.syncedAt) return setSync("err", `Offline · last synced ${ago(new Date(state.syncedAt * 1000))}`);
  if (state.error) return setSync("err", "Can't reach the sheet");
  if (state.syncedAt) setSync("ok", `Synced ${ago(new Date(state.syncedAt * 1000))}`);
}
function applyData(res) {
  state.games = res.games || []; state.plays = res.playthroughs || []; state.books = res.books || [];
  state.options = { games: res.games_options || {}, plays: res.playthroughs_options || {}, books: res.books_options || {} };
  state.canEdit = !!res.can_edit; state.syncedAt = res.synced_at;
}
async function sync(manual) {
  if (!api) return;
  setSync("busy", "Syncing…");
  const res = await api.sync().catch(e => ({ error: String(e) }));
  if (res && !res.error) {
    const before = JSON.stringify([state.games, state.books, state.canEdit]);
    applyData(res); state.error = null;
    $("#banner").hidden = true;
    const editing = document.activeElement?.closest?.("#editForm, #runForm");
    if ((before !== JSON.stringify([state.games, state.books, state.canEdit]) || manual) && !editing) {
      render();
      if (panelItem) refreshPanelHead();
    }
    refreshUpdated();
  } else {
    state.error = res?.error || "Unknown error";
    if (state.games.length) {
      const b = $("#banner");
      b.hidden = false;
      b.innerHTML = `Couldn't read the sheet: ${esc(state.error)} Showing your last synced list. <button class="ghost" id="bSettings">Settings</button>`;
      $("#bSettings").addEventListener("click", () => openSettings(true));
    } else render();
  }
  syncLabel();
}
function scheduleRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => sync(false), (+state.settings.refresh_minutes || 2) * 60000);
}
async function refreshUpdated() {
  if (!api) return;
  const list = state.games.filter(g => owned(g) || g.status === "Wishlist").map(g => ({ name: g.name, platform: g.platform }));
  const res = await Promise.resolve(api.updated(list)).catch(() => null);
  if (!res) return;
  const changed = JSON.stringify(Object.keys(res).sort()) !== JSON.stringify(Object.keys(state.updated).sort());
  state.updated = res;
  if (changed && !document.activeElement?.closest?.("#editForm")) render();
}

/* ---------- updates ---------- */
async function checkForUpdate(manual) {
  if (!api) return;
  const r = await Promise.resolve(api.update_check()).catch(() => null);
  updateInfo = r;
  const btn = $("#updateBtn");
  if (r?.available) { btn.hidden = false; btn.textContent = `Update to ${r.latest}`; }
  else btn.hidden = true;
  $("#versionText").textContent = `Version ${state.settings.version || "dev"}${r?.latest && !r.available ? " · you're up to date" : r?.available ? ` · ${r.latest} is available` : ""}`;
  if (manual) toast(r?.error ? `Couldn't check: ${r.error}` : r?.available ? `Version ${r.latest} is ready to install.` : "You're on the latest version.", r?.error ? "err" : "ok");
}
async function installUpdate() {
  if (!updateInfo?.available) return;
  if (!updateInfo.can_install) { api.open(updateInfo.page); return; }
  const btn = $("#updateBtn");
  btn.disabled = true; btn.textContent = "Downloading…";
  const poll = setInterval(async () => {
    const p = await api.update_progress();
    if (p.state === "downloading" && p.total) btn.textContent = `Downloading ${Math.round(p.done / p.total * 100)}%`;
    if (p.state === "installing") btn.textContent = "Installing…";
    if (p.state === "restarting") btn.textContent = "Restarting…";
  }, 300);
  const res = await api.update_apply();
  if (res?.error) { clearInterval(poll); btn.disabled = false; btn.textContent = `Update to ${updateInfo.latest}`; toast(res.error, "err"); }
}

/* ---------- settings ---------- */
function showSettingsTab(t) {
  document.querySelectorAll("[data-stab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.stab === t)));
  document.querySelectorAll("[data-spane]").forEach(p => { p.hidden = p.dataset.spane !== t; });
  if (t === "accounts") renderAccounts();
}
function openSettings(showHowTo, tab = "sheet") {
  const f = $("#settingsForm"), st = state.settings;
  f.sheet_url.value = st.sheet_url || "";
  f.sgdb_key.value = "";
  f.refresh_minutes.value = String(st.refresh_minutes || 2);
  f.sound_on.checked = st.sound_on !== false;
  f.ambient_volume.value = st.ambient_volume ?? 0.35;
  f.fx_volume.value = st.fx_volume ?? 0.5;
  f.intro.checked = st.intro !== false;
  f.big_picture.checked = !!st.big_picture;
  $("#igdbState").textContent = st.has_igdb ? "IGDB is connected. Paste new values to replace them." : "Not connected.";
  $("#igdbState").className = st.has_igdb ? "ok" : "";
  $("#keyState").textContent = st.has_sgdb_key ? "A key is saved. Paste a new one to replace it." : "Covers for every platform, including PS5 and Switch. Without a key, covers come from Steam only.";
  $("#connState").textContent = st.connected ? "Connected. You can edit and add from the app." : st.link_kind === "csv" ? "Read-only: this is a published sheet link. Use the connection script below to edit from the app." : "Paste the Web app link from the connection script.";
  $("#connState").className = st.connected ? "ok" : "";
  $("#settingsForm .howto").open = !!showHowTo && !st.connected;
  $("#versionText").textContent = `Masterlog ${st.version || "dev"}`;
  showSettingsTab(tab);
  $("#settings").showModal();
}
function soundSettings() {
  const f = $("#settingsForm");
  return { sound_on: f.sound_on.checked, ambient_volume: +f.ambient_volume.value, fx_volume: +f.fx_volume.value, intro: f.intro.checked, big_picture: f.big_picture.checked };
}
function applySound(st = state.settings) {
  try { FX.configure({ on: st.sound_on !== false, ambient: st.ambient_volume ?? 0.35, fx: st.fx_volume ?? 0.5 }); } catch {}
  const on = st.sound_on !== false;
  $("#soundBtn").innerHTML = on
    ? `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>`
    : `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4zm12.6 3 2.7-2.7-1.3-1.3-2.7 2.7-2.7-2.7-1.3 1.3 2.7 2.7-2.7 2.7 1.3 1.3 2.7-2.7 2.7 2.7 1.3-1.3z"/></svg>`;
  $("#soundBtn").title = on ? "Sound on" : "Sound off";
}
async function saveSettings() {
  const f = $("#settingsForm");
  const hadKey = state.settings.has_sgdb_key;
  const res = await api.save_settings({ sheet_url: f.sheet_url.value.trim(), sgdb_key: f.sgdb_key.value.trim(), refresh_minutes: +f.refresh_minutes.value, ...soundSettings() });
  state.settings = res;
  applySound();
  if (res.pair_error) toast(`Couldn't connect: ${res.pair_error}`, "err");
  else if (res.paired) toast(`Connected to ${typeof res.paired === "string" ? res.paired : "your sheet"}.`, "ok");
  if (!hadKey && state.settings.has_sgdb_key) { await api.clear_covers(); covers.clear(); }
  const iid = f.igdb_id.value.trim(), isec = f.igdb_secret.value.trim();
  if (iid && isec) {
    const r = await api.set_igdb(iid, isec);
    if (r.error) toast(r.error, "err");
    else { toast("IGDB connected. Missing covers will fill in as you browse.", "ok"); covers.forEach((v, k) => { if (!v) covers.delete(k); }); state.settings.has_igdb = true; render(); }
    f.igdb_id.value = ""; f.igdb_secret.value = "";
  }
  scheduleRefresh();
  sync(true);
}
async function copyScript() {
  const text = await api?.connection_script();
  if (!text) return;
  try { await navigator.clipboard.writeText(text); }
  catch { const t = document.createElement("textarea"); t.value = text; document.body.append(t); t.select(); document.execCommand("copy"); t.remove(); }
  toast("Script copied. Paste it into Apps Script.", "ok");
}

/* ---------- linked accounts ---------- */
const ACCOUNTS = {
  steam: { name: "Steam", color: "#66C0F4", fields: [["a", "Steam Web API key", "password"], ["b", "Your profile link or SteamID64", "text"]],
    help: `<ol><li>Get a free key at <button type="button" class="linkish" data-url="https://steamcommunity.com/dev/apikey">steamcommunity.com/dev/apikey</button> (any domain name works, e.g. <i>localhost</i>).</li><li>In Steam, set <b>Profile → Edit Profile → Privacy → Game details</b> to <b>Public</b>.</li><li>Paste the key and your profile link.</li></ol>` },
  psn: { name: "PlayStation", color: "#2E7BFF", fields: [["a", "NPSSO code", "password"]],
    help: `<ol><li>Sign in at <button type="button" class="linkish" data-url="https://www.playstation.com/">playstation.com</button> in your browser.</li><li>In the same browser, open <button type="button" class="linkish" data-url="https://ca.account.sony.com/api/v1/ssocookie">ca.account.sony.com/api/v1/ssocookie</button>.</li><li>Copy the 64-character code after <b>"npsso"</b> and paste it here. It's like a password: don't share it.</li></ol><p class="fine">This uses Sony's unofficial mobile-app access. It can stop working if Sony changes it; your account is only read.</p>` },
  heroic: { name: "Heroic (Epic + GOG)", color: "#9F7AEA", fields: [],
    help: `<p class="fine">Reads Heroic's library files on this PC. No password, nothing leaves your computer. Open Heroic at least once first.</p>` },
  itch: { name: "itch.io", color: "#FA5C5C", fields: [["a", "itch.io API key", "password"]],
    help: `<ol><li>Create a key at <button type="button" class="linkish" data-url="https://itch.io/user/settings/api-keys">itch.io/user/settings/api-keys</button>.</li><li>Paste it here.</li></ol>` },
  nintendo: { name: "Nintendo", color: "#E60012", soon: true },
};
async function renderAccounts() {
  const box = $("#accountsBox");
  const st = await Promise.resolve(api?.accounts_status()).catch(() => null) || {};
  box.innerHTML = Object.entries(ACCOUNTS).map(([k, a]) => {
    const s = st[k] || {};
    if (a.soon) return `<div class="acct"><div class="acct-head"><span class="sw" style="background:${a.color}"></span><b>${a.name}</b><span class="st">Experimental, coming in a later update. Nintendo doesn't share libraries, so this will use the Parental Controls app's play time.</span></div></div>`;
    const state_ = s.error ? `<span class="st err">${esc(s.error)}</span>` : s.linked ? `<span class="st ok">Linked${s.who ? ` as ${esc(s.who)}` : ""}${s.games ? ` · ${s.games} games` : ""}${s.synced ? ` · synced ${ago(s.synced)}` : ""}</span>` : `<span class="st">${k === "heroic" && !s.found ? "Heroic not found on this PC" : "Not linked"}</span>`;
    return `<div class="acct" data-acct="${k}"><div class="acct-head"><span class="sw" style="background:${a.color}"></span><b>${a.name}</b>${state_}<span class="spacer"></span>
      ${s.linked ? `<button type="button" class="ghost small" data-unlink="${k}">Unlink</button>` : `<button type="button" class="primary small" data-linkopen="${k}">Link</button>`}</div>
      <div class="form" data-linkform="${k}" hidden>${a.help}${a.fields.map(([n, l, t]) => `<label>${l}<input name="acct_${k}_${n}" type="${t}" autocomplete="off"></label>`).join("")}
        <div class="row"><span class="spacer"></span><button type="button" class="primary small" data-link="${k}">${k === "heroic" ? "Link Heroic" : `Link ${a.name}`}</button></div></div></div>`;
  }).join("") + `<div class="row"><button type="button" class="ghost small" id="syncAccounts">Check accounts now</button><button type="button" class="ghost small" id="reviewImports">Review games not in Masterlog</button></div>`;
}
async function linkAccount(k) {
  const v = n => $(`[name="acct_${k}_${n}"]`)?.value.trim() || "";
  const btn = $(`[data-link="${k}"]`); btn.disabled = true; btn.textContent = "Linking…";
  const res = await Promise.resolve(api?.link_account(k, v("a"), v("b"))).catch(e => ({ error: String(e) }));
  btn.disabled = false;
  if (!res || res.error) { toast(res?.error || "Couldn't link.", "err"); btn.textContent = "Try again"; return; }
  try { FX.play.notify(); } catch {}
  toast(`${ACCOUNTS[k].name} linked${res.who ? ` as ${res.who}` : ""}${res.games ? `. Found ${res.games} games` : ""}. Matching them to your list…`, "ok");
  renderAccounts();
  pollAccounts(true);
}
let accountsPoll = null, importOffered = false, platSynced = new Set();
function pollAccounts(fast) {
  clearTimeout(accountsPoll);
  const run = async () => {
    const d = await Promise.resolve(api?.account_data()).catch(() => null);
    if (d) {
      const before = JSON.stringify(state.facts);
      state.facts = d.facts || {}; state.candidates = d.candidates || [];
      if (before !== JSON.stringify(state.facts) && !document.activeElement?.closest?.("#editForm")) { render(); if (panelItem) refreshPanelHead(); }
      if (d.unreviewed?.length && state.candidates.length && !importOffered && state.canEdit) { importOffered = true; openImport(d.unreviewed); }
      if (d.new?.length && state.canEdit) autoAdd(d.new);
      syncTrophies();
    }
    accountsPoll = setTimeout(run, d?.running || fast ? 4000 : 120000);
  };
  accountsPoll = setTimeout(run, fast ? 2500 : 0);
}
async function autoAdd(items) {
  const res = await Promise.resolve(api?.import_games(items.map(c => ({ name: c.name, platform: c.platform, store_link: c.url })))).catch(() => null);
  if (!res?.added?.length) return;
  const srcs = [...new Set(items.map(c => ({ steam: "Steam", psn: "PlayStation", heroic: "Heroic", itch: "itch.io" }[c.source])))];
  const n = res.added.length;
  try { FX.play.notify(); } catch {}
  toast(n === 1 ? `New arrival! ${res.added[0]} just landed in your library from ${srcs.join(" and ")}.`
    : `New arrivals! ${n} games from ${srcs.join(" and ")} just landed in your library: ${res.added.slice(0, 3).join(", ")}${n > 3 ? ` and ${n - 3} more` : ""}.`, "party");
  sync(true);
}
async function syncTrophies() {
  // tick the sheet's 100% / Plat box when Steam or PlayStation says you've done it all
  if (!state.canEdit) return;
  const todo = state.games.filter(g => factsOf(g).complete && !g.platinum && !platSynced.has(g.name)).slice(0, 8);
  for (const g of todo) {
    platSynced.add(g.name);
    await Promise.resolve(api?.edit("games", g.row, g.name, { platinum: true })).catch(() => null);
    g.platinum = true;
  }
  if (todo.length) { render(); toast(todo.length === 1 ? `${todo[0].name}: every achievement unlocked. Badge earned!` : `${todo.length} games just earned their 100% badge.`, "party"); }
}
function openImport(sources) {
  const list = state.candidates.filter(c => !sources || sources.includes(c.source));
  if (!list.length) return toast("Everything on your accounts is already in Masterlog.", "ok");
  const label = { steam: "Steam", psn: "PlayStation", heroic: "Heroic", itch: "itch.io" };
  list.sort((a, b) => (b.minutes || 0) - (a.minutes || 0) || a.name.localeCompare(b.name));
  $("#importForm").innerHTML = `<h2>Found ${list.length} game${list.length === 1 ? "" : "s"} that aren't in Masterlog yet</h2>
    <p class="fine">Ticked ones are games you've actually played. Untick anything you don't want (free giveaways, tools). Skipped games won't be offered again, but you can review them any time in Settings → Accounts.</p>
    <div class="row"><button type="button" class="linkish" id="impAll">Select all</button><button type="button" class="linkish" id="impNone">Select none</button></div>
    <div class="importlist">${list.map((c, i) => `<label><input type="checkbox" name="imp" value="${i}" ${c.minutes > 0 || c.source === "psn" ? "checked" : ""}>
      <span>${esc(c.name)}</span><small>${esc(c.platform)} · ${label[c.source]}</small><small>${c.minutes ? `${Math.round(c.minutes / 6) / 10} h` : "not played"}</small></label>`).join("")}</div>
    <div class="row"><span class="spacer"></span><button value="skip" class="ghost">Skip these</button><button value="add" class="primary">Add selected</button></div>`;
  $("#importForm")._list = list;
  $("#importDialog").showModal();
}
async function submitImport(form, action) {
  if (action === "skip") { await api?.accounts_seen(); return toast("Got it. They won't be offered again.", "ok"); }
  const chosen = [...form.querySelectorAll("[name=imp]:checked")].map(x => form._list[+x.value]);
  if (!chosen.length) { await api?.accounts_seen(); return; }
  toast(`Adding ${chosen.length} game${chosen.length === 1 ? "" : "s"}…`);
  const res = await Promise.resolve(api?.import_games(chosen.map(c => ({ name: c.name, platform: c.platform, store_link: c.url })))).catch(e => ({ error: String(e) }));
  if (!res || res.error) return toast(res?.error || "Couldn't add them.", "err");
  try { FX.play.notify(); } catch {}
  toast(`Welcome aboard: ${res.added.length} game${res.added.length === 1 ? "" : "s"} added to your library.${res.failed.length ? ` ${res.failed.length} couldn't be added.` : ""}`, "party");
  sync(true);
}

/* ---------- clock ---------- */
function tick() {
  const now = new Date();
  $("#time").textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("#date").textContent = now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  syncLabel();
}

/* ---------- PS2 boot towers ---------- */
function towers() {
  const c = $("#towers"), ctx = c.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w, h, cols = [];
  const resize = () => {
    w = c.width = innerWidth * devicePixelRatio; h = c.height = innerHeight * devicePixelRatio;
    cols = Array.from({ length: 26 }, (_, i) => ({
      x: (i / 26) * w + Math.random() * w / 30, base: 0.25 + Math.random() * 0.55, phase: Math.random() * Math.PI * 2,
      speed: 0.00012 + Math.random() * 0.00018, width: (8 + Math.random() * 22) * devicePixelRatio, depth: 0.35 + Math.random() * 0.65,
    }));
  };
  const draw = t => {
    ctx.clearRect(0, 0, w, h);
    const tint = isBooks() ? [255, 214, 150] : [150, 180, 255];
    for (const col of cols) {
      const hh = h * (col.base + 0.12 * Math.sin(t * col.speed + col.phase));
      const y = h - hh;
      const g = ctx.createLinearGradient(0, y, 0, h);
      g.addColorStop(0, `rgba(${tint},${0.10 * col.depth})`);
      g.addColorStop(0.6, `rgba(${tint},${0.04 * col.depth})`);
      g.addColorStop(1, "rgba(40,60,140,0)");
      ctx.fillStyle = g;
      ctx.fillRect(col.x, y, col.width * col.depth, hh);
      ctx.fillStyle = `rgba(${tint},${0.22 * col.depth})`;
      ctx.fillRect(col.x, y, col.width * col.depth, 2 * devicePixelRatio);
    }
  };
  resize(); addEventListener("resize", resize);
  if (reduce) { draw(0); return; }
  let last = 0;
  const loop = t => {
    if (t - last > 50 && !document.hidden && !$("#panel").classList.contains("open")) { draw(t); last = t; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/* ---------- navigation: mouse, keyboard, controller ---------- */
function bindGlobal() {
  $("#tabs").addEventListener("click", e => { const t = e.target.closest(".tab"); if (t) go(t.dataset.view); });
  document.querySelectorAll(".catalog").forEach(c => c.addEventListener("click", () => switchCatalog(c.dataset.catalog)));
  $("#syncBtn").addEventListener("click", () => sync(true));
  $("#settingsBtn").addEventListener("click", () => openSettings(false));
  $("#addBtn").addEventListener("click", () => openAdd(isBooks() ? "books" : "games"));
  $("#updateBtn").addEventListener("click", installUpdate);
  $("#checkUpdates").addEventListener("click", () => checkForUpdate(true));
  $("#copyScript").addEventListener("click", copyScript);
  document.querySelectorAll("[data-stab]").forEach(b => b.addEventListener("click", () => showSettingsTab(b.dataset.stab)));
  $("#settingsForm").addEventListener("input", e => { if (["sound_on", "ambient_volume", "fx_volume"].includes(e.target.name)) applySound({ ...state.settings, ...soundSettings() }); });
  $("#accountsBox").addEventListener("click", e => {
    const o = e.target.closest("[data-linkopen]"); if (o) { const f = $(`[data-linkform="${o.dataset.linkopen}"]`); f.hidden = !f.hidden; return; }
    const l = e.target.closest("[data-link]"); if (l) return linkAccount(l.dataset.link);
    const u = e.target.closest("[data-unlink]"); if (u) return Promise.resolve(api?.unlink_account(u.dataset.unlink)).then(() => { renderAccounts(); toast("Unlinked. Its saved key was deleted from this PC.", "ok"); });
    if (e.target.closest("#syncAccounts")) { api?.accounts_sync(); pollAccounts(true); return toast("Checking your accounts…"); }
    if (e.target.closest("#reviewImports")) { $("#settings").close(); return openImport(null); }
  });
  $("#importForm").addEventListener("submit", e => submitImport(e.target, e.submitter?.value));
  $("#importForm").addEventListener("click", e => {
    if (e.target.id === "impAll") e.target.form.querySelectorAll("[name=imp]").forEach(x => { x.checked = true; });
    if (e.target.id === "impNone") e.target.form.querySelectorAll("[name=imp]").forEach(x => { x.checked = false; });
  });
  $("#bigBtn").addEventListener("click", toggleBigPicture);
  $("#soundBtn").addEventListener("click", () => {
    const on = state.settings.sound_on === false;
    state.settings.sound_on = on; api?.set_pref("sound_on", on); applySound();
    toast(on ? "Sound on." : "Sound off.");
  });
  $("#scrim").addEventListener("click", closePanel);
  $("#settingsForm").addEventListener("submit", e => { if (e.submitter?.value === "save") saveSettings(); });
  $("#addForm").addEventListener("submit", e => { if (e.submitter?.value === "add") submitAdd(e.target); });
  $("#clearCovers").addEventListener("click", async () => { await api?.clear_covers(); covers.clear(); render(); });

  const view = $("#view"), panel = $("#panel");
  view.addEventListener("click", e => {
    const qc = e.target.closest("[data-qc], [data-qown]");
    if (qc) { e.stopPropagation(); return quickMark(qc); }
    if (e.target.closest("select, input, option")) return;
    const c = e.target.closest(".case"); if (c && !c.closest(".hero")) return openPanel(c.dataset.kind, c.dataset.id);
    const tr = e.target.closest("tr[data-id]"); if (tr) return openPanel(tr.dataset.kind, tr.dataset.id);
    const more = e.target.closest("[data-go]");
    if (more) {
      const s = shelves()[+more.dataset.shelf];
      state.filter = { q: "", status: "All", plats: new Set(), playOn: "All", prio: "All", sort: s?.title.startsWith("Finished") ? "recent" : "priority", ...(s?.preset || {}) };
      return go(more.dataset.go);
    }
    const yr = e.target.closest(".year > button");
    if (yr) { const y = +yr.parentElement.dataset.year; state.openYears.has(y) ? state.openYears.delete(y) : state.openYears.add(y); yr.parentElement.classList.toggle("open"); activateArt(yr.parentElement); return; }
    const chip = e.target.closest("[data-plat]");
    if (chip) { const p = chip.dataset.plat; state.filter.plats.has(p) ? state.filter.plats.delete(p) : state.filter.plats.add(p); return render(); }
    const m = e.target.closest("[data-mode] button");
    if (m) { state.mode = m.dataset.v; api?.set_pref("view_mode", state.mode); return render(); }
    const segB = e.target.closest("[data-seg] button");
    if (segB) { state.filter[segB.parentElement.dataset.seg] = segB.dataset.v; return render(); }
    const bseg = e.target.closest("[data-bseg] button");
    if (bseg) { state.bfilter[bseg.parentElement.dataset.bseg] = bseg.dataset.v; return render(); }
    const add = e.target.closest("[data-add]"); if (add) return openAdd(add.dataset.add);
    const open = e.target.closest("[data-open]"); if (open) return openPanel(open.dataset.kind || "game", open.dataset.open);
  });
  document.addEventListener("click", e => { const u = e.target.closest("[data-url]"); if (u && u.dataset.url) api?.open(u.dataset.url); });
  view.addEventListener("change", e => {
    if (e.target.id === "prio") { state.filter.prio = e.target.value; render(); }
    if (e.target.id === "sort") { state.filter.sort = e.target.value; render(); }
    if (e.target.id === "bsort") { state.bfilter.sort = e.target.value; render(); }
    if (e.target.classList.contains("cellsel")) {
      const tr = e.target.closest("tr"), item = findItem(tr.dataset.kind, tr.dataset.id);
      if (item) saveEdit(tr.dataset.kind === "book" ? "books" : "games", item, { [e.target.dataset.field]: e.target.value }, true);
    }
  });
  let searchT;
  view.addEventListener("input", e => {
    if (e.target.id !== "search" && e.target.id !== "bsearch") return;
    clearTimeout(searchT);
    const id = e.target.id;
    searchT = setTimeout(() => {
      (id === "search" ? state.filter : state.bfilter).q = e.target.value;
      const pos = e.target.selectionStart; render(); const s = $("#" + id); s.focus(); s.setSelectionRange(pos, pos);
    }, 160);
  });
  const hover = e => {
    const c = e.target.closest?.(".shelf .case");
    if (!c) return;
    if (state.view === "home" && c.dataset.kind === "game") { state.focusId = +c.dataset.id; updateHero(findItem("game", c.dataset.id)); }
    if (state.view === "shelf" && c.dataset.kind === "book") { state.focusId = +c.dataset.id; updateBookHero(findItem("book", c.dataset.id)); }
  };
  view.addEventListener("mouseover", hover);
  view.addEventListener("focusin", hover);
  document.addEventListener("mouseover", e => {
    const t = e.target.closest?.(".case, .tab, .catalog, .chip, .primary, .ghost, .seg button, .ptabs button, .qs");
    if (t && t !== document.lastHoverTarget) { document.lastHoverTarget = t; try { FX.play.hover(); } catch {} }
  });
  document.addEventListener("click", e => {
    if (e.target.closest(".case, [data-qc], [data-qown], .close")) return;
    if (e.target.closest(".tab, .catalog, .ptabs button, .stabs button")) { try { FX.play.tab(); } catch {} return; }
    if (e.target.closest("button, .chip, a, [data-url]")) { try { FX.play.click(); } catch {} }
  }, true);
  view.addEventListener("mouseover", e => {
    const tr = e.target.closest?.("tr[data-id]");
    if (!tr) return;
    if (tr.dataset.key === "1") return;
    view.querySelectorAll("tr[data-key='1']").forEach(x => { x.dataset.key = ""; });
    tr.dataset.key = "1";
    const item = findItem(tr.dataset.kind, tr.dataset.id);
    if (item) showPeek(item, e.clientX, e.clientY);
  });
  view.addEventListener("mousemove", e => { if (e.target.closest?.("tr[data-id]")) movePeek(e.clientX, e.clientY); });
  view.addEventListener("mouseout", e => {
    const tr = e.target.closest?.("tr[data-id]");
    if (tr && !tr.contains(e.relatedTarget)) { tr.dataset.key = ""; hidePeek(); }
  });
  view.addEventListener("scroll", hidePeek, { passive: true });

  panel.addEventListener("click", e => {
    if (e.target.closest(".close")) return closePanel();
    const t = e.target.closest("[data-ptab]"); if (t) return showPanelTab(t.dataset.ptab);
    const q = e.target.closest("[data-quick]");
    if (q) { const item = findItem(panelItem.kind, panelItem.id); if (item && item.status !== q.dataset.quick) saveEdit(panelItem.kind === "book" ? "books" : "games", item, { status: q.dataset.quick }); return; }
    const o = e.target.closest("[data-open]"); if (o) return openPanel(o.dataset.kind || "game", o.dataset.open);
    if (e.target.closest("#logRun")) return runForm();
    const gt = e.target.closest("[data-g]"); if (gt) return showGallery(+gt.dataset.g, galleryItems[+gt.dataset.g]?.video);
    const gp = e.target.closest("[data-gplay]"); if (gp) return showGallery(+gp.dataset.gplay, true);
    if (e.target.closest("#customCover")) return customCover(true);
    if (e.target.closest("#resetCover")) return customCover(false);
  });
  panel.addEventListener("submit", e => {
    e.preventDefault();
    const item = findItem(panelItem.kind, panelItem.id);
    if (e.target.id === "editForm") saveEdit(e.target.dataset.cat, item, readForm(e.target, e.target.dataset.cat, item));
    if (e.target.id === "runFormEl") submitRun(e.target, item);
  });

  document.addEventListener("keydown", e => {
    if (e.key === "F11") { e.preventDefault(); toggleBigPicture(); return; }
    if (e.key === "Escape") { if ($("#panel").classList.contains("open")) closePanel(); return; }
    if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName) || document.querySelector("dialog[open]")) return;
    const dir = { ArrowLeft: "l", ArrowRight: "r", ArrowUp: "u", ArrowDown: "d" }[e.key];
    if (dir) { e.preventDefault(); move(dir); }
    if (e.key === "q" || e.key === "e") cycleTab(e.key === "e" ? 1 : -1);
    if (e.key === "Tab" && e.shiftKey && e.ctrlKey) switchCatalog(isBooks() ? "games" : "books");
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) sync(false); });
  pollPad();
}
async function quickMark(btn) {
  const kind = btn.dataset.qkind, item = findItem(kind, btn.dataset.qc || btn.dataset.qown);
  if (!item) return;
  const caseEl = btn.closest(".case");
  if (btn.dataset.qown) {
    try { FX.play.click(); } catch {}
    return saveEdit(kind === "book" ? "books" : "games", item, { status: kind === "book" ? "To read" : "Library" });
  }
  try { FX.play.check(); } catch {}
  caseEl?.classList.add("popped");
  const changes = kind === "book" ? { status: "Read" } : { status: "Completed" };
  if (kind === "game" && item.hours == null) { const h = hoursFromAccounts(item); if (h) changes.hours = h; }
  await saveEdit(kind === "book" ? "books" : "games", item, changes, true);
  toast(kind === "book" ? `Finished ${item.name}. Nice read!` : `${item.name} completed${changes.hours ? ` in ${changes.hours} h` : ""}. GG!`, "ok");
}
async function customCover(set) {
  const g = findItem(panelItem.kind, panelItem.id);
  if (!g) return;
  const res = await Promise.resolve(set ? api?.set_cover(g.name) : api?.clear_cover(g.name)).catch(e => ({ error: String(e) }));
  if (res && res.error) return toast(res.error, "err");
  if (set && !res) return;
  covers.set(coverKey(g), res || null);
  render(); openPanel(panelItem.kind, panelItem.id, "edit");
  toast(set ? "Cover updated." : "Back to the official cover.", "ok");
}
function runForm() {
  const box = $("#runForm"), g = findItem("game", panelItem.id);
  box.innerHTML = `<form class="editform" id="runFormEl"><div class="fields">
    <label>Platform<select name="platform">${opts("games", "platform").map(o => `<option ${o === g.platform ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>
    <label>Play on<select name="play_on"><option value=""></option>${["PC", "Steam Deck"].map(o => `<option>${o}</option>`).join("")}</select></label>
    <label>Hours<input name="hours" type="number" step="0.1" min="0"></label>
    <label class="wide">Notes<input name="notes" type="text"></label></div>
    <div class="checks"><label class="check"><input type="checkbox" name="finished" checked>Finished</label><label class="check"><input type="checkbox" name="modded">Modded</label><label class="check"><input type="checkbox" name="dlc">With DLC</label><label class="check"><input type="checkbox" name="platinum">100% / Platinum</label></div>
    <div class="row"><span class="spacer"></span><button class="primary" type="submit">Add run</button></div></form>`;
  $("#logRun").hidden = true;
}
async function submitRun(form, g) {
  const v = { game: g.name, platform: form.platform.value, finished: form.finished.checked, modded: form.modded.checked, dlc: form.dlc.checked, platinum: form.platinum.checked };
  if (form.play_on.value) v.play_on = form.play_on.value;
  if (form.hours.value) v.hours = +form.hours.value;
  if (form.notes.value.trim()) v.notes = form.notes.value.trim();
  const res = await Promise.resolve(api?.add("plays", v)).catch(e => ({ error: String(e) }));
  if (!res || res.error) return toast(`Couldn't add the run: ${res?.error || "no connection"}`, "err");
  toast("Run added. The sheet stamps the date.", "ok");
  sync(true);
}
async function toggleBigPicture() {
  const on = await Promise.resolve(api?.toggle_big_picture()).catch(() => null);
  document.body.classList.toggle("bigpic", !!on);
  try { FX.play.tab(); } catch {}
}
function switchCatalog(cat) {
  if (cat === state.catalog) return;
  state.catalog = cat;
  state.view = cat === "books" ? "shelf" : "home";
  state.focusId = null;
  closePanel(); render(); $("#view").scrollTop = 0;
}
function go(v) { state.view = v; closePanel(); state.focusId = null; render(); $("#view").scrollTop = 0; }
function cycleTab(d) {
  const tabs = TABS[state.catalog].map(t => t[0]);
  go(tabs[(tabs.indexOf(state.view) + d + tabs.length) % tabs.length]);
}
function move(dir) {
  const root = $("#panel").classList.contains("open") ? $("#panel") : document;
  const items = [...root.querySelectorAll(".case, .primary, .ghost, .chip, .tab, .catalog, .year > button, tr[data-id]")].filter(el => el.offsetParent && !el.closest(".hero"));
  const cur = document.activeElement && items.includes(document.activeElement) ? document.activeElement : null;
  if (!cur) { (items.find(el => el.classList.contains("case")) || items[0])?.focus(); return; }
  const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bestScore = Infinity;
  for (const el of items) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2;
    const dx = bx - ax, dy = by - ay;
    const ok = dir === "l" ? dx < -5 : dir === "r" ? dx > 5 : dir === "u" ? dy < -5 : dy > 5;
    if (!ok) continue;
    const main = dir === "l" || dir === "r" ? Math.abs(dx) : Math.abs(dy);
    const cross = dir === "l" || dir === "r" ? Math.abs(dy) : Math.abs(dx);
    const score = main + cross * 2.5;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) { best.focus(); best.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }); try { FX.play.move(); } catch {} }
}
function pollPad() {
  const held = {};
  const step = () => {
    const pad = navigator.getGamepads?.()[0];
    if (pad) {
      const press = (i, fn) => { const on = pad.buttons[i]?.pressed; if (on && !held[i]) fn(); held[i] = on; };
      press(12, () => move("u")); press(13, () => move("d")); press(14, () => move("l")); press(15, () => move("r"));
      press(0, () => document.activeElement?.click());
      press(1, () => closePanel());
      press(4, () => cycleTab(-1)); press(5, () => cycleTab(1));
      press(8, () => switchCatalog(isBooks() ? "games" : "books"));
      press(9, toggleBigPicture);
      const [x, y] = pad.axes;
      const stick = Math.abs(x) > 0.6 ? (x > 0 ? "r" : "l") : Math.abs(y) > 0.6 ? (y > 0 ? "d" : "u") : null;
      if (stick && !held.stick) move(stick);
      held.stick = stick;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- start ---------- */
async function start() {
  api = window.pywebview?.api || null;
  bindGlobal(); tick(); setInterval(tick, 15000);
  if (!api) { $("#intro")?.remove(); towers(); render(); return; }
  state.settings = await api.get_settings();
  applySound();
  document.body.classList.toggle("bigpic", !!state.settings.big_picture);
  if (state.settings.intro !== false && !window.SKIP_INTRO) await new Promise(r => playIntro(r));
  else $("#intro")?.remove();
  towers();
  state.mode = state.settings.view_mode === "list" ? "list" : "covers";
  const cached = await api.cached();
  if (cached?.games?.length) applyData(cached);
  render(); syncLabel(); scheduleRefresh();
  sync(false);
  setTimeout(() => checkForUpdate(false), 4000);
  setInterval(() => checkForUpdate(false), 6 * 3600 * 1000);
  setInterval(refreshUpdated, 5 * 60 * 1000);
  pollAccounts(false);
}
if (window.pywebview?.api) start();
else window.addEventListener("pywebviewready", start, { once: true });
