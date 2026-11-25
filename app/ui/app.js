/* Game Backlog — front end. Talks to Python through window.pywebview.api. */
"use strict";

const PLAT = {
  "Steam":           { band: "#171A21", text: "#66C0F4", disc: "#66C0F4", chip: "#1B2838", chipText: "#66C0F4" },
  "PS5":             { band: "#003791", text: "#FFFFFF", disc: "#1F6FE0", chip: "#003791", chipText: "#FFFFFF" },
  "PS4":             { band: "#0070D1", text: "#FFFFFF", disc: "#3D8BFF", chip: "#0070D1", chipText: "#FFFFFF" },
  "PS2":             { band: "#000000", text: "#FFFFFF", disc: "#3B4CCA", chip: "#000000", chipText: "#FFFFFF" },
  "Switch 2":        { band: "#E60012", text: "#FFFFFF", disc: "#E60012", chip: "#E60012", chipText: "#FFFFFF" },
  "GOG":             { band: "#86328A", text: "#FFFFFF", disc: "#A93BB0", chip: "#86328A", chipText: "#FFFFFF" },
  "Epic Games":      { band: "#121212", text: "#FFFFFF", disc: "#9AA0A6", chip: "#2A2A2A", chipText: "#FFFFFF" },
  "Ubisoft Connect": { band: "#0058C4", text: "#FFFFFF", disc: "#3D8BFF", chip: "#0058C4", chipText: "#FFFFFF" },
  "EA App":          { band: "#FF4747", text: "#FFFFFF", disc: "#FF4747", chip: "#FF4747", chipText: "#FFFFFF" },
  "Emulation":       { band: "#2B2F36", text: "#B8F2D8", disc: "#20C997", chip: "#20C997", chipText: "#06231A" },
  "PC (Other)":      { band: "#343A40", text: "#DEE2E6", disc: "#ADB5BD", chip: "#495057", chipText: "#FFFFFF" },
};
const PLAT_FALLBACK = { band: "#2B2F36", text: "#FFFFFF", disc: "#4A8CFF", chip: "#495057", chipText: "#FFFFFF" };
const PRIO_ORDER = { Extreme: 0, High: 1, Medium: 2, Low: 3 };
const PRIO_COLOR = { Extreme: "#FF5C93", High: "#FF8A3D", Medium: "#FFC94D", Low: "#8B97B3" };
const STATUS_COLOR = { Library: "#8F9BB3", Playing: "#4DABF7", Paused: "#FFB547", Wishlist: "#9775FA", Completed: "#5BD38A", Dropped: "#FF6B6B", "Second chance": "#FF922B" };
const CONSOLES = new Set(["PS5", "PS4", "PS2", "Switch 2"]);

const state = {
  games: [], plays: [], syncedAt: null, error: null, settings: {},
  view: "home", focusId: null,
  filter: { q: "", status: "All", plats: new Set(), playOn: "All", prio: "All", sort: "priority" },
  openYears: new Set([new Date().getFullYear()]),
};
const covers = new Map();      // name -> dataURI | null
const coverWaiters = new Map(); // name -> Promise
let api = null;
let refreshTimer = null;

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plat = p => PLAT[p] || PLAT_FALLBACK;
const statusOf = g => (g.status === "Dropped" && g.second_chance ? "Second chance" : g.status);
const owned = g => ["Library", "Playing", "Paused", "Completed", "Dropped"].includes(g.status);
const parseDate = s => (s ? new Date(s + "T12:00:00") : null);
const fmtDate = s => { const d = parseDate(s); return d ? d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : ""; };
const hoursText = g => (g.hours_text ? `${g.hours_text} h` : "");
const scoreText = v => (v == null ? "" : `${(+v).toFixed(v % 1 ? 1 : 0)}/10`);

function ago(date) {
  if (!date) return "";
  const d = date instanceof Date ? date : parseDate(date);
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

/* ---------- covers ---------- */
function loadCover(name) {
  if (covers.has(name)) return Promise.resolve(covers.get(name));
  if (coverWaiters.has(name)) return coverWaiters.get(name);
  const p = queueCover(name).then(uri => { covers.set(name, uri || null); coverWaiters.delete(name); return uri; });
  coverWaiters.set(name, p);
  return p;
}
const coverQueue = []; let coverActive = 0;
function queueCover(name) {
  return new Promise(res => { coverQueue.push({ name, res }); pumpCovers(); });
}
function pumpCovers() {
  while (coverActive < 4 && coverQueue.length) {
    const { name, res } = coverQueue.shift();
    coverActive++;
    Promise.resolve(api ? api.cover(name) : null).catch(() => null).then(uri => { coverActive--; res(uri); pumpCovers(); });
  }
}
const coverObserver = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    coverObserver.unobserve(e.target);
    hydrateArt(e.target);
  }
}, { rootMargin: "300px" });
function hydrateArt(el) {
  const name = el.dataset.name;
  loadCover(name).then(uri => {
    if (!uri || !el.isConnected) return;
    el.innerHTML = `<img alt="" src="${uri}">`;
  });
}

/* ---------- the case ---------- */
function caseHTML(g, opts = {}) {
  const p = plat(g.platform);
  const st = statusOf(g);
  let badge = "";
  if (g.status === "Completed") badge = `<span class="badge done">${g.runs > 1 ? `✓ ×${g.runs}` : "✓"}</span>`;
  else if (st === "Second chance") badge = `<span class="badge chance">↺</span>`;
  else if (g.status === "Dropped") badge = `<span class="badge drop">✗</span>`;
  else if (g.priority === "Extreme" || g.priority === "High") badge = `<span class="badge" style="color:${PRIO_COLOR[g.priority]}">${g.priority}</span>`;
  const sub = opts.sub ?? subline(g);
  const cached = covers.get(g.name);
  const art = cached
    ? `<img alt="" src="${cached}">`
    : `<div class="fallback"><div class="t">${esc(g.name)}</div><div class="d">${esc(g.developer || g.genre || "")}</div></div>`;
  return `<button class="case" data-id="${g.id}" style="--band:${p.band};--band-text:${p.text};--plat:${p.chip};--plat-disc:${p.disc}" aria-label="${esc(g.name)}">
    <div class="stage">
      <div class="disc"><div class="disc-face"></div></div>
      <div class="box">
        <div class="band">${esc(g.platform || "Game")}</div>
        <div class="art" data-name="${esc(g.name)}">${art}</div>
        <div class="spine"></div><div class="sheen"></div>${badge}
      </div>
    </div>
    ${opts.noLabel ? "" : `<div class="label"><div class="name">${esc(g.name)}</div><div class="sub">${esc(sub)}</div></div>`}
  </button>`;
}
function subline(g) {
  if (g.status === "Completed") return g.completed ? `Finished ${daysAgoLabel(g.completed)}` : "Finished";
  if (g.status === "Wishlist") return [g.platform, g.priority].filter(Boolean).join("  ·  ");
  const where = g.play_on && !CONSOLES.has(g.platform) ? `${g.platform} on ${g.play_on}` : g.platform;
  return [where, g.status !== "Library" ? g.status : ""].filter(Boolean).join("  ·  ");
}
function activateArt(root) {
  root.querySelectorAll(".art").forEach(el => { if (!el.querySelector("img")) coverObserver.observe(el); });
}

/* ---------- selections ---------- */
const byPrio = (a, b) => (PRIO_ORDER[a.priority] ?? 9) - (PRIO_ORDER[b.priority] ?? 9) || a.name.localeCompare(b.name);
const byDone = (a, b) => (b.completed || "").localeCompare(a.completed || "");
function shelves() {
  const G = state.games;
  const year = new Date().getFullYear();
  return [
    { title: "Continue playing", items: G.filter(g => g.status === "Playing").concat(G.filter(g => g.status === "Paused").sort(byPrio)), view: "library", preset: { status: "Playing" } },
    { title: "Up next", items: G.filter(g => g.status === "Library").sort(byPrio).slice(0, 24), view: "library", preset: { status: "Library" } },
    { title: "On the Steam Deck", items: G.filter(g => g.play_on === "Steam Deck" && ["Library", "Playing", "Paused"].includes(g.status)).sort(byPrio), view: "library", preset: { playOn: "Steam Deck" } },
    { title: "Wishlist, top priority", items: G.filter(g => g.status === "Wishlist").sort(byPrio).slice(0, 24), view: "wishlist" },
    { title: `Finished in ${year}`, items: G.filter(g => g.status === "Completed" && (g.completed || "").startsWith(String(year))).sort(byDone), view: "stats" },
    { title: "Second chances", items: G.filter(g => statusOf(g) === "Second chance"), view: "played" },
  ];
}
function heroGame() {
  const G = state.games;
  return G.find(g => g.id === state.focusId)
    || G.find(g => g.status === "Playing")
    || G.filter(g => g.status === "Paused").sort(byPrio)[0]
    || G.filter(g => g.status === "Library").sort(byPrio)[0]
    || G[0];
}

/* ---------- views ---------- */
function render() {
  document.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-selected", String(t.dataset.view === state.view)));
  const v = $("#view");
  if (!state.games.length) { v.innerHTML = welcomeHTML(); bindWelcome(); return; }
  if (state.view === "home") v.innerHTML = homeHTML();
  else if (state.view === "stats") v.innerHTML = yearsHTML();
  else v.innerHTML = libraryHTML();
  activateArt(v);
  if (state.view === "home") updateHero(heroGame(), true);
}

function welcomeHTML() {
  if (state.error) {
    return `<div class="welcome"><h1>Connect your sheet</h1>
      <p>The app couldn't read your Game Backlog sheet: ${esc(state.error)}</p>
      <ol>
        <li>Open the sheet and choose <b>File → Share → Publish to web</b>.</li>
        <li>Pick <b>Entire document</b> and <b>Comma-separated values (.csv)</b>, then <b>Publish</b>.</li>
        <li>Copy the link and paste it in Settings.</li>
      </ol>
      <div class="actions"><button class="primary" id="wSettings">Open settings</button>${state.settings?.sheet_url ? '<button class="ghost" id="wSheet">Open the sheet</button>' : ""}</div></div>`;
  }
  return `<div class="welcome"><h1>Loading your backlog</h1><p class="intro">Reading the sheet…</p></div>`;
}
function bindWelcome() {
  $("#wSettings")?.addEventListener("click", openSettings);
  $("#wSheet")?.addEventListener("click", () => api?.open_sheet());
}

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
  if (g.score != null) facts.push(`Score <b>${scoreText(g.score)}</b>`);
  if (g.runs > 1) facts.push(`<b>${g.runs}</b> runs`);
  if (g.genre) facts.push(esc(g.genre));
  if (g.developer) facts.push(esc(g.developer));
  $("#heroCase").innerHTML = caseHTML(g, { noLabel: true });
  activateArt($("#heroCase"));
  const t = $("#heroText");
  t.dataset.id = g.id;
  t.innerHTML = `<div class="hero-kicker">${kicker}</div><h1>${esc(g.name)}</h1>
    <div class="pills">${pillsHTML(g)}</div>
    <div class="facts">${facts.map(f => `<span>${f}</span>`).join("")}</div>
    <div class="actions" id="heroActions"><button class="primary" data-open="${g.id}">Details</button></div>`;
  loadCover(g.name).then(uri => { const bg = $("#heroBg"); if (bg && $("#heroText")?.dataset.id === String(g.id)) bg.style.backgroundImage = uri ? `url("${uri}")` : `linear-gradient(120deg, ${plat(g.platform).chip}, transparent)`; });
  Promise.resolve(api?.links(g)).then(links => {
    const box = $("#heroActions");
    if (!links || !box || $("#heroText")?.dataset.id !== String(g.id)) return;
    links.filter(l => l.primary).slice(0, 1).forEach(l => box.insertAdjacentHTML("afterbegin", `<button class="primary" data-url="${esc(l.url)}">${esc(l.label)}</button>`));
    box.querySelector('[data-open]').className = "ghost";
  }).catch(() => {});
}

function pillsHTML(g) {
  const p = plat(g.platform), st = statusOf(g), out = [];
  out.push(`<span class="pill" style="background:${STATUS_COLOR[st] || "#8F9BB3"}22;color:${STATUS_COLOR[st] || "#C9D1DC"}">${esc(st)}</span>`);
  if (g.platform) out.push(`<span class="pill" style="background:${p.chip};color:${p.chipText}">${esc(g.platform)}</span>`);
  if (g.play_on && !CONSOLES.has(g.platform)) out.push(`<span class="pill">${g.play_on === "Steam Deck" ? "Steam Deck" : "PC"}</span>`);
  if (g.priority && !["Completed", "Dropped"].includes(g.status)) out.push(`<span class="pill" style="color:${PRIO_COLOR[g.priority]}">${esc(g.priority)} priority</span>`);
  if (g.format) out.push(`<span class="pill">${esc(g.format)}</span>`);
  return out.join("");
}

/* ----- library / wishlist / played ----- */
function filtered() {
  const f = state.filter, q = f.q.trim().toLowerCase();
  let list = state.games.filter(g => {
    if (state.view === "wishlist" && g.status !== "Wishlist") return false;
    if (state.view === "played" && !["Completed", "Dropped"].includes(g.status)) return false;
    if (state.view === "library" && g.status === "Wishlist" && f.status !== "Wishlist") return false;
    if (f.status !== "All" && statusOf(g) !== f.status && !(f.status === "Dropped" && g.status === "Dropped")) return false;
    if (f.plats.size && !f.plats.has(g.platform)) return false;
    if (f.playOn === "Console" && !CONSOLES.has(g.platform)) return false;
    if (["PC", "Steam Deck"].includes(f.playOn) && (g.play_on !== f.playOn || CONSOLES.has(g.platform))) return false;
    if (f.prio !== "All" && g.priority !== f.prio) return false;
    if (q && !`${g.name} ${g.genre} ${g.developer} ${g.publisher}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const sorts = {
    priority: byPrio,
    name: (a, b) => a.name.localeCompare(b.name),
    score: (a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name),
    recent: (a, b) => byDone(a, b) || a.name.localeCompare(b.name),
    hours: (a, b) => (b.hours ?? -1) - (a.hours ?? -1),
    platform: (a, b) => Object.keys(PLAT).indexOf(a.platform) - Object.keys(PLAT).indexOf(b.platform) || byPrio(a, b),
  };
  return list.sort(sorts[f.sort] || byPrio);
}
function libraryHTML() {
  const f = state.filter;
  const statuses = state.view === "wishlist" ? [] : state.view === "played" ? ["All", "Completed", "Dropped", "Second chance"] : ["All", "Library", "Playing", "Paused", "Completed", "Dropped", "Second chance", "Wishlist"];
  const present = new Set(state.games.map(g => g.platform));
  const chips = Object.keys(PLAT).filter(p => present.has(p)).map(p => {
    const c = PLAT[p];
    return `<button class="chip" data-plat="${esc(p)}" aria-pressed="${f.plats.has(p)}" style="--c:${c.chip};--t:${c.chipText}"><i></i>${esc(p)}</button>`;
  }).join("");
  const list = filtered();
  const seg = (name, opts) => `<div class="seg" data-seg="${name}">${opts.map(o => `<button aria-pressed="${f[name] === o}" data-v="${esc(o)}">${esc(o)}</button>`).join("")}</div>`;
  return `<div class="toolbar">
      <div class="line">
        <input class="search" id="search" type="search" placeholder="Search games, genres, studios" value="${esc(f.q)}">
        ${seg("playOn", ["All", "PC", "Steam Deck", "Console"])}
        <select class="pick" id="prio"><option value="All">Any priority</option>${Object.keys(PRIO_ORDER).map(p => `<option ${f.prio === p ? "selected" : ""}>${p}</option>`).join("")}</select>
        <select class="pick" id="sort">${[["priority", "Sort by priority"], ["name", "Sort by name"], ["score", "Sort by score"], ["recent", "Recently finished"], ["hours", "Most hours"], ["platform", "Sort by platform"]].map(([v, l]) => `<option value="${v}" ${f.sort === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        <span class="total">${list.length} ${list.length === 1 ? "game" : "games"}</span>
      </div>
      ${statuses.length ? `<div class="line">${seg("status", statuses)}</div>` : ""}
      <div class="line">${chips}</div>
    </div>
    ${list.length ? `<div class="grid">${list.map(g => caseHTML(g)).join("")}</div>` : `<p class="empty">No games match these filters. Clear the search or pick another platform.</p>`}`;
}

/* ----- your years ----- */
function yearStats() {
  const map = new Map();
  const get = y => { if (!map.has(y)) map.set(y, { year: y, games: [], replays: [], hours: 0, scores: [] }); return map.get(y); };
  for (const g of state.games) {
    if (!g.completed) continue;
    const y = +g.completed.slice(0, 4), s = get(y);
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
        ${list.length ? `<div class="shelf-row">${list.map(g => caseHTML(g, { sub: fmtDate(g.completed) })).join("")}</div>` : `<p class="intro">No games finished yet this year. Set a game to Completed in the sheet and it shows up here.</p>`}
      </div></div>`;
  }).join("");

  const total = state.games.length || 1;
  const owned_ = state.games.filter(owned);
  const platCounts = Object.keys(PLAT).map(p => [p, owned_.filter(g => g.platform === p).length]).filter(x => x[1]);
  const pmax = Math.max(1, ...platCounts.map(x => x[1]));
  const sts = ["Library", "Playing", "Paused", "Wishlist", "Completed", "Dropped", "Second chance"].map(s => [s, state.games.filter(g => statusOf(g) === s).length]);
  const smax = Math.max(1, ...sts.map(x => x[1]));
  const dev = [["PC", "#C7D5E0"], ["Steam Deck", "#1A9FFF"], ["Console", "#E60012"]].map(([d, c]) => [d, c, state.games.filter(g => ["Library", "Playing", "Paused"].includes(g.status) && (d === "Console" ? CONSOLES.has(g.platform) : g.play_on === d && !CONSOLES.has(g.platform))).length]);
  const dmax = Math.max(1, ...dev.map(x => x[2]));
  const split = (label, n, max, color) => `<div class="split"><span>${esc(label)}</span><span class="track"><span style="width:${n / max * 100}%;background:${color}"></span></span><span class="n">${n}</span></div>`;
  return `<div class="years">
    <div>
      <h2>Your years</h2>
      <p class="intro">Every game you finished, year by year. Click a year to see the games. Replays come from the Playthroughs tab.</p>
      <div class="legend"><span><i style="background:#66C0F4"></i>First finishes</span><span><i style="background:#5BD38A"></i>Replays</span></div>
      ${rows}
    </div>
    <aside class="side">
      <section><h3>Owned by platform</h3>${platCounts.map(([p, n]) => split(p, n, pmax, PLAT[p].disc)).join("")}</section>
      <section><h3>By status</h3>${sts.map(([s, n]) => split(s, n, smax, STATUS_COLOR[s])).join("")}</section>
      <section><h3>Where you'll play the rest</h3>${dev.map(([d, c, n]) => split(d, n, dmax, c)).join("")}</section>
      <section><h3>All time</h3><div class="kv">
        <div><small>Games tracked</small><span>${total}</span></div>
        <div><small>Total runs</small><span>${state.games.reduce((a, g) => a + (g.runs || 0), 0)}</span></div>
        <div><small>Hours logged</small><span>${Math.round(state.games.reduce((a, g) => a + (g.hours || 0), 0) + state.plays.reduce((a, p) => a + (p.hours || 0), 0)).toLocaleString()}</span></div>
        <div><small>Average score</small><span>${(() => { const s = state.games.filter(g => g.score != null); return s.length ? (s.reduce((a, g) => a + g.score, 0) / s.length).toFixed(1) : "–"; })()}</span></div>
      </div></section>
    </aside></div>`;
}

/* ---------- detail panel ---------- */
function openPanel(id) {
  const g = state.games.find(x => x.id === +id);
  if (!g) return;
  const runs = state.plays.filter(p => p.game === g.name);
  const kv = [];
  if (g.completed || g.status === "Completed") kv.push(["Finished", g.completed ? `${fmtDate(g.completed)} · ${daysAgoLabel(g.completed)}` : "Date unknown"]);
  if (g.dropped) kv.push(["Dropped", `${fmtDate(g.dropped)} · ${daysAgoLabel(g.dropped)}`]);
  if (g.hours_text) kv.push(["Hours", g.hours_text]);
  if (g.score != null) kv.push(["Score", scoreText(g.score)]);
  if (g.runs) kv.push(["Runs", g.runs]);
  if (g.beaten_on.length) kv.push(["Beaten on", g.beaten_on.join(", ")]);
  if (g.genre) kv.push(["Genre", g.genre]);
  if (g.developer) kv.push(["Developer", g.developer]);
  if (g.publisher) kv.push(["Publisher", g.publisher]);
  if (g.migrate_to) kv.push(["Migrate to", g.migrate_to]);
  const flags = [["DLC owned", g.dlc_owned], ["DLC done", g.dlc_done], ["100% / Platinum", g.platinum], ["Modded", g.modded]];
  if (g.status === "Dropped") flags.push(["Second chance", g.second_chance]);
  const panel = $("#panel");
  panel.innerHTML = `<button class="icon close" aria-label="Close">✕</button>
    <div class="top">${caseHTML(g, { noLabel: true })}<div><h2>${esc(g.name)}</h2><div class="pills">${pillsHTML(g)}</div></div></div>
    <div class="links" id="links"><button class="ghost" disabled>Finding links…</button></div>
    <div class="kv">${kv.map(([k, v]) => `<div><small>${esc(k)}</small><span>${esc(v)}</span></div>`).join("")}</div>
    <div class="flags">${flags.map(([k, on]) => `<span class="flag ${on ? "on" : ""}">${on ? "✓ " : ""}${esc(k)}</span>`).join("")}</div>
    ${g.notes ? `<h3>Notes</h3><p class="notes">${esc(g.notes)}</p>` : ""}
    ${runs.length ? `<h3>Extra runs</h3><ul class="runs">${runs.map(r => `<li><span>Run ${r.run || "?"}${r.platform ? ` on ${esc(r.platform)}` : ""}${r.modded ? " · modded" : ""}${r.dlc ? " · with DLC" : ""}${r.platinum ? " · 100%" : ""}</span><span>${r.finished_on ? fmtDate(r.finished_on) : r.finished ? "Finished" : "In progress"}</span></li>`).join("")}</ul>` : ""}
    <h3>Edit</h3><button class="ghost" id="editSheet">Change this game in the sheet</button>`;
  activateArt(panel);
  panel.classList.add("open"); panel.setAttribute("aria-hidden", "false");
  $("#scrim").hidden = false;
  panel.focus();
  panel.querySelector(".close").addEventListener("click", closePanel);
  $("#editSheet").addEventListener("click", () => api?.open_sheet());
  Promise.resolve(api?.links(g)).then(links => {
    const box = $("#links");
    if (!box) return;
    box.innerHTML = (links || []).map(l => `<button class="${l.primary ? "primary" : "ghost"}" data-url="${esc(l.url)}">${esc(l.label)}</button>`).join("") || "";
  }).catch(() => { const box = $("#links"); if (box) box.innerHTML = ""; });
}
function closePanel() {
  const panel = $("#panel");
  panel.classList.remove("open"); panel.setAttribute("aria-hidden", "true");
  $("#scrim").hidden = true;
}

/* ---------- sync ---------- */
function setSync(kind, text) {
  const b = $("#syncBtn");
  b.className = `sync ${kind}`;
  $("#syncText").textContent = text;
}
function syncLabel() {
  if (state.error && state.syncedAt) return setSync("err", `Offline · last synced ${ago(new Date(state.syncedAt * 1000))}`);
  if (state.error) return setSync("err", "Can't reach the sheet");
  if (state.syncedAt) setSync("ok", `Synced ${ago(new Date(state.syncedAt * 1000))}`);
}
async function sync(manual) {
  if (!api) return;
  setSync("busy", "Syncing…");
  const res = await api.sync().catch(e => ({ error: String(e) }));
  if (res && !res.error) {
    const before = JSON.stringify(state.games);
    state.games = res.games; state.plays = res.playthroughs || []; state.syncedAt = res.synced_at; state.error = null;
    $("#banner").hidden = true;
    if (before !== JSON.stringify(state.games) || manual) render();
  } else {
    state.error = res?.error || "Unknown error";
    if (state.games.length) {
      const b = $("#banner");
      b.hidden = false;
      b.innerHTML = `Couldn't read the sheet: ${esc(state.error)} Showing your last synced list. <button class="ghost" id="bSettings">Settings</button>`;
      $("#bSettings").addEventListener("click", openSettings);
    } else render();
  }
  syncLabel();
}
function scheduleRefresh() {
  clearInterval(refreshTimer);
  const mins = +state.settings.refresh_minutes || 2;
  refreshTimer = setInterval(() => sync(false), mins * 60000);
}

/* ---------- settings ---------- */
function openSettings() {
  const d = $("#settings"), f = $("#settingsForm");
  f.sheet_url.value = state.settings.sheet_url || "";
  f.sgdb_key.value = "";
  f.refresh_minutes.value = String(state.settings.refresh_minutes || 2);
  $("#keyState").textContent = state.settings.has_sgdb_key
    ? "A key is saved. Paste a new one to replace it."
    : "Covers for every platform, including PS5 and Switch. Without a key, covers come from Steam only.";
  d.showModal();
}
async function saveSettings() {
  const f = $("#settingsForm");
  const hadKey = state.settings.has_sgdb_key;
  state.settings = await api.save_settings({ sheet_url: f.sheet_url.value.trim(), sgdb_key: f.sgdb_key.value.trim(), refresh_minutes: +f.refresh_minutes.value });
  if (!hadKey && state.settings.has_sgdb_key) { await api.clear_covers(); covers.clear(); }
  scheduleRefresh();
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
    for (const col of cols) {
      const hh = h * (col.base + 0.12 * Math.sin(t * col.speed + col.phase));
      const y = h - hh;
      const g = ctx.createLinearGradient(0, y, 0, h);
      g.addColorStop(0, `rgba(150,180,255,${0.10 * col.depth})`);
      g.addColorStop(0.6, `rgba(90,120,220,${0.05 * col.depth})`);
      g.addColorStop(1, "rgba(40,60,140,0)");
      ctx.fillStyle = g;
      ctx.fillRect(col.x, y, col.width * col.depth, hh);
      ctx.fillStyle = `rgba(210,225,255,${0.22 * col.depth})`;
      ctx.fillRect(col.x, y, col.width * col.depth, 2 * devicePixelRatio);
    }
  };
  resize(); addEventListener("resize", resize);
  if (reduce) { draw(0); return; }
  let last = 0;
  const loop = t => { if (t - last > 50) { draw(t); last = t; } requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}

/* ---------- navigation: mouse, keyboard, controller ---------- */
function bindGlobal() {
  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => go(t.dataset.view)));
  $("#syncBtn").addEventListener("click", () => sync(true));
  $("#settingsBtn").addEventListener("click", openSettings);
  $("#scrim").addEventListener("click", closePanel);
  $("#settingsForm").addEventListener("submit", e => { if (e.submitter?.value === "save") saveSettings(); });
  $("#openSheet").addEventListener("click", () => api?.open_sheet());
  $("#clearCovers").addEventListener("click", async () => { await api?.clear_covers(); covers.clear(); render(); });

  const view = $("#view");
  view.addEventListener("click", e => {
    const c = e.target.closest(".case"); if (c && !c.closest(".hero")) return openPanel(c.dataset.id);
    const more = e.target.closest("[data-go]");
    if (more) {
      const s = shelves()[+more.dataset.shelf];
      state.filter = { q: "", status: "All", plats: new Set(), playOn: "All", prio: "All", sort: s?.title.startsWith("Finished") ? "recent" : "priority", ...(s?.preset || {}) };
      return go(more.dataset.go);
    }
    const yr = e.target.closest(".year > button");
    if (yr) { const y = +yr.parentElement.dataset.year; state.openYears.has(y) ? state.openYears.delete(y) : state.openYears.add(y); yr.parentElement.classList.toggle("open"); yr.setAttribute("aria-expanded", String(state.openYears.has(y))); activateArt(yr.parentElement); return; }
    const chip = e.target.closest("[data-plat]");
    if (chip) { const p = chip.dataset.plat; state.filter.plats.has(p) ? state.filter.plats.delete(p) : state.filter.plats.add(p); return render(); }
    const segB = e.target.closest("[data-seg] button");
    if (segB) { state.filter[segB.parentElement.dataset.seg] = segB.dataset.v; return render(); }
    const open = e.target.closest("[data-open]"); if (open) return openPanel(open.dataset.open);
  });
  document.addEventListener("click", e => { const u = e.target.closest("[data-url]"); if (u) api?.open(u.dataset.url); });
  view.addEventListener("change", e => {
    if (e.target.id === "prio") { state.filter.prio = e.target.value; render(); }
    if (e.target.id === "sort") { state.filter.sort = e.target.value; render(); }
  });
  let searchT;
  view.addEventListener("input", e => {
    if (e.target.id !== "search") return;
    clearTimeout(searchT);
    searchT = setTimeout(() => { state.filter.q = e.target.value; const pos = e.target.selectionStart; render(); const s = $("#search"); s.focus(); s.setSelectionRange(pos, pos); }, 160);
  });
  const hover = e => { const c = e.target.closest?.(".shelf .case"); if (c && state.view === "home") { state.focusId = +c.dataset.id; updateHero(state.games.find(g => g.id === state.focusId)); } };
  view.addEventListener("mouseover", hover);
  view.addEventListener("focusin", hover);

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { if ($("#panel").classList.contains("open")) closePanel(); return; }
    if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    const dir = { ArrowLeft: "l", ArrowRight: "r", ArrowUp: "u", ArrowDown: "d" }[e.key];
    if (dir) { e.preventDefault(); move(dir); }
    if (e.key === "q" || e.key === "e") cycleTab(e.key === "e" ? 1 : -1);
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) sync(false); });
  pollPad();
}
function go(v) { state.view = v; closePanel(); if (v !== "library" && v !== "wishlist" && v !== "played") state.focusId = null; render(); $("#view").scrollTop = 0; }
function cycleTab(d) {
  const tabs = [...document.querySelectorAll(".tab")].map(t => t.dataset.view);
  go(tabs[(tabs.indexOf(state.view) + d + tabs.length) % tabs.length]);
}
function move(dir) {
  const root = $("#panel").classList.contains("open") ? $("#panel") : document;
  const items = [...root.querySelectorAll(".case, .primary, .ghost, .chip, .tab, .year > button")].filter(el => el.offsetParent && !el.closest(".hero"));
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
  if (best) { best.focus(); best.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }); }
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
  bindGlobal(); towers(); tick(); setInterval(tick, 15000);
  if (!api) { render(); return; }
  state.settings = await api.get_settings();
  const cached = await api.cached();
  if (cached?.games?.length) { state.games = cached.games; state.plays = cached.playthroughs || []; state.syncedAt = cached.synced_at; }
  render(); syncLabel(); scheduleRefresh();
  sync(false);
}
if (window.pywebview?.api) start();
else window.addEventListener("pywebviewready", start, { once: true });
