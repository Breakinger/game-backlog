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
  games: [["home", "Home"], ["library", "Library"], ["wishlist", "Wishlist"], ["deals", "Deals"], ["played", "Completed"], ["ranking", "Top 100"], ["stats", "Your years"]],
  books: [["shelf", "Shelf"], ["books", "All books"], ["bookyears", "Read"]],
  news: [["leaks", "Leaks & rumours"], ["breaking", "Breaking news"], ["yours", "Your games"], ["marvel", "Marvel & DC"]],
};

const state = {
  catalog: "games",
  games: [], plays: [], books: [], options: { games: {}, plays: {}, books: {} }, canEdit: false,
  syncedAt: null, error: null, settings: {}, updated: {}, facts: {}, candidates: [],
  view: "home", focusId: null, mode: "covers",
  filter: { q: "", status: new Set(), plats: new Set(), playOn: "All", prio: new Set(), formats: new Set(), sort: "priority" },
  bfilter: { q: "", status: new Set(), prio: new Set(), formats: new Set(), author: null, series: null, sort: "series" },
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
function toast(text, kind = "", action = null) {
  if (kind === "err") { try { FX.play.error(); } catch {} }
  const t = $("#toast");
  t.textContent = text; t.className = `toast ${kind}`; t.hidden = false;
  if (action) {
    const b = document.createElement("button"); b.type = "button"; b.className = "toast-act"; b.textContent = action.label;
    b.addEventListener("click", () => { t.hidden = true; action.run(); }, { once: true });
    t.append(" ", b);
  }
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, action ? 12000 : 3200);
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
    const call = !api ? null : item.author !== undefined ? api.book_cover(item.name, item.author) : api.cover(item.name, item.platform || "");
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
function findItem(kind, id) { return kind === "book" ? state.books.find(x => x.id === +id) : (state.games.find(x => x.id === +id) || accountCopies().find(x => x.id === +id)); }

/* ---------- the game case ---------- */
function upgradeLabel(g) {
  const to = UPGRADE_TO[g.platform];
  if (!to || !g.upgrade || g.upgrade === "No upgrade") return "";
  return `${g.upgrade.startsWith("Free") ? "Free" : "Paid"} upgrade to ${to}`;
}
/* small square emblems in the spirit of the real boxes (original marks, not the companies' logos) */
function emblem(kind) {
  if (kind === "Switch" || kind === "Switch 2") return `<span class="emblem sw" aria-hidden="true">${kind === "Switch 2" ? "<b>2</b>" : "<i></i>"}</span>`;
  if (kind === "deck") return `<span class="emblem deck" title="Plays on Steam Deck" aria-label="Steam Deck"><i></i></span>`;
  return "";
}
function bandLabel(platform, p) { return platform === "Switch" || platform === "Switch 2" ? platform.toUpperCase() : p.label; }
function caseHTML(g, o = {}) {
  const p = plat(g.platform), st = statusOf(g);
  let badge = "";
  if (g.status === "Completed") badge = `<span class="badge done">${g.runs > 1 ? `✓ ×${g.runs}` : "✓"}</span>`;
  else if (st === "Second chance") badge = `<span class="badge chance">↺</span>`;
  else if (g.status === "Dropped") badge = `<span class="badge drop">✗</span>`;
  else if (g.priority === "Extreme" || g.priority === "High") badge = `<span class="badge" style="color:${PRIO_COLOR[g.priority]}">${g.priority}</span>`;
  const rkn = rankOf(g);
  const rankChip = rkn && rkn > 10 ? `<span class="rankchip t-${rankTier(rkn)}" title="${TIER_NAME[rankTier(rkn)]} · #${rkn} in your Top 100">#${rkn}</span>` : "";
  const fresh = state.updated[g.name] ? `<span class="freshline" title="${esc(state.updated[g.name].title || "")}"><i></i>Newly updated!</span>` : "";
  const upOwned = g.upgrade_owned || factsOf(g).ps5_version;
  const up = g.upgrade && UPGRADE_TO[g.platform] && g.upgrade !== "No upgrade" ? `<span class="tag up ${upOwned ? "owned" : g.upgrade.startsWith("Free") ? "free" : "paid"}" title="${esc(upgradeLabel(g))}${upOwned ? " · you own the upgrade" : ""}">${upOwned ? `${esc(UPGRADE_TO[g.platform].replace("PlayStation ", "PS").replace("Nintendo ", ""))} ✓` : `${g.upgrade.startsWith("Free") ? "FREE" : "PAID"} ↑`}</span>` : "";
  const cached = covers.get(coverKey(g));
  const art = cached ? `<img alt="" decoding="async" src="${cached}">` : `<div class="fallback"><div class="t">${esc(g.name)}</div><div class="d">${esc(g.developer || g.genre || "")}</div></div>`;
  const deck = g.platform === "Steam" && g.play_on === "Steam Deck" ? emblem("deck") : p.tag ? `<span class="tag">${p.tag}</span>` : "";
  const typeTag = g.type === "Live service" ? `<span class="typetag live"><i></i>LIVE</span>` : g.type === "Modded" ? `<span class="typetag mod">MODDED</span>` : "";
  const ach = achBadge(g);
  const quick = !o.noLabel ? quickBtn(g) : "";
  const media = p.media === "card"
    ? `<div class="media card"><div class="card-face"><span>${esc(p.label.replace("Nintendo ", ""))}</span></div></div>`
    : `<div class="media disc ${p.disc || ""}"><div class="disc-face"></div></div>`;
  const dups = (dupsOf.get(g) || []).slice(0, 3);
  const stack = dups.length ? `<div class="fancards" aria-hidden="true">${dups.map((d, i) => { const dp = plat(d.platform), c = covers.get(coverKey(d)) || covers.get(coverKey(g)); return `<i style="--i:${i + 1};--n:${dups.length};--dc:${dp.band};--dt:${dp.text || "#fff"};--ds:${dp.shell || "#10162A"}"><em>${esc(dp.label)}</em>${c ? `<img alt="" src="${c}">` : ""}</i>`; }).join("")}</div><span class="copies" title="${esc(dups.map(d => `${d.name} (${plat(d.platform).label}, ${d.status})`).join(" · "))}">×${dups.length + 1}</span>` : "";
  return `<button class="case p-${(g.platform || "x").replace(/\W+/g, "")} ${g.status === "Wishlist" ? "unowned" : ""} ${dups.length ? "stacked" : ""} ${effectClass(g)} ${ach ? "honored" : ""}" data-id="${g.id}" data-kind="game"
    style="--band:${p.band};--band-text:${p.text};--shell:${p.shell};--accent:${p.accent};--plat:${p.chip}" aria-label="${esc(g.name)}">
    <div class="stage">${stack}${media}${effectLayer(g)}
      <div class="box"><div class="shell"></div>
        <div class="band">${emblem(g.platform)}<span class="wm">${esc(bandLabel(g.platform, p))}</span>${deck}${up}</div>
        <div class="art" data-kind="game" data-id="${g.id}">${art}</div>
        <div class="hinge"></div><div class="sheen"></div>${typeTag}${quick}
      </div>${ach}
    </div>
    ${o.noLabel ? "" : `<div class="label">${fresh}<div class="name">${esc(g.name)}</div><div class="sub">${badge}${rankChip}${esc(o.sub ?? subline(g))}</div>${g.status === "Wishlist" ? priceTag(g) : ""}</div>`}
  </button>`;
}
function factsOf(g) { return state.facts[g.name] || {}; }
function achBadge(g) {
  const f = factsOf(g);
  // a badge of honour: bigger than the cover's edge, like a perfect-game badge
  if (f.complete === "Platinum" || (g.platinum && CONSOLES.has(g.platform))) return `<span class="honor plat" title="Platinum trophy"><svg viewBox="0 0 40 40"><path d="M20 3 33 11v18L20 37 7 29V11z"/><path class="in" d="M20 10l3 6.2 6.8 1-4.9 4.8 1.2 6.8L20 25.6l-6.1 3.2 1.2-6.8-4.9-4.8 6.8-1z"/></svg><b>PLATINUM</b></span>`;
  if (f.complete || g.platinum) return `<span class="honor full" title="Every achievement"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17"/><path class="in" d="M20 9l3.2 6.6 7.2 1-5.2 5.1 1.2 7.2L20 25.5l-6.4 3.4 1.2-7.2-5.2-5.1 7.2-1z"/></svg><b>100%</b></span>`;
  return "";
}
/* status you can see at a glance: flames for Extreme, a gold pulse for High, a green glow when completed,
   cobwebs on paused games, dropped games tossed aside, an extra life for second chances */
function effectClass(g) {
  const st = statusOf(g), out = [];
  if (isClassic(g)) return "fx-classic";   // the classic outshines every other effect
  if (st === "Second chance") out.push("fx-chance");
  else if (g.status === "Dropped") out.push("fx-dropped");
  else if (g.status === "Completed") out.push("fx-done");
  else if (st === "Paused" || g.status === "Paused") out.push("fx-paused");
  if (g.status !== "Completed" && g.status !== "Dropped") {
    if (g.priority === "Extreme") out.push("fx-extreme");
    else if (g.priority === "High") out.push("fx-high");
  }
  return out.join(" ");
}
function effectLayer(g) {
  const st = statusOf(g);
  let out = "";
  const rk = rankOf(g);
  if (isClassic(g)) out += `<div class="cosmos aura" aria-hidden="true"><i></i><i></i></div><span class="classic-award oncover" title="All Time Classic${rk ? ` · #${rk} in your Top 100` : ""}">${CLASSIC_IMG}</span>`;
  else if (rk && rk <= 10) { const t = rankTier(rk); out += `<span class="favstar award t-${t}" title="${TIER_NAME[t]} · #${rk} in your Top 100">${awardSVG(t)}<b>${rk}</b></span>`; }
  if (g.priority === "Extreme" && g.status !== "Completed" && g.status !== "Dropped") out += `<div class="flames" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>`;
  if ((st === "Paused" || g.status === "Paused") && st !== "Second chance") out += `<div class="cobweb" aria-hidden="true"><svg viewBox="0 0 60 60"><path d="M0 0L60 60M0 0L60 22M0 0L22 60M0 0L60 0M0 0L0 60M10 0Q8 8 0 10M22 0Q18 18 0 22M36 0Q30 30 0 36M52 0Q42 42 0 52"/></svg></div><div class="dust" aria-hidden="true"></div>`;
  if (st === "Second chance") out += `<span class="extralife" title="Second chance"><svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.5-9.1C1 8.4 3.2 5 6.6 5c2 0 3.4 1.1 4.2 2.4C11.6 6.1 13 5 15 5c3.4 0 5.6 3.4 4.1 6.9C17.1 16.4 12 21 12 21z"/></svg><b>↻ 1UP</b></span>`;
  return out;
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
function bookFx(b) {
  const out = [];
  if (b.status === "Read") out.push("fx-done");
  else if (b.status === "Dropped") out.push("fx-dropped");
  else if (b.priority === "Extreme") out.push("fx-extreme");
  else if (b.priority === "High") out.push("fx-high");
  if (b.status === "Reading") out.push("fx-reading");
  return out.join(" ");
}
function bookFxLayer(b) {
  let out = "";
  if (b.priority === "Extreme" && b.status !== "Read" && b.status !== "Dropped") out += `<div class="flames" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>`;
  if (b.status === "Reading") out += `<span class="bookmark" title="Reading now" aria-hidden="true"></span>`;
  if (b.score != null && b.score >= 9 && b.status === "Read") out += `<span class="favstar bookfav" title="Scored ${scoreText(b.score)}"><svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.5-9.1C1 8.4 3.2 5 6.6 5c2 0 3.4 1.1 4.2 2.4C11.6 6.1 13 5 15 5c3.4 0 5.6 3.4 4.1 6.9C17.1 16.4 12 21 12 21z"/></svg><b>${(+b.score).toFixed(b.score % 1 ? 1 : 0)}</b></span>`;
  return out;
}
function bookHTML(b, o = {}) {
  const cached = covers.get(coverKey(b));
  const art = cached ? `<img alt="" decoding="async" src="${cached}">` : `<div class="fallback book-fallback"><div class="t">${esc(b.name)}</div><div class="d">${esc(b.author)}</div></div>`;
  const badge = b.status === "Read" ? `<span class="badge done">✓</span>` : b.status === "Reading" ? `<span class="badge reading">Reading</span>` : b.priority === "Extreme" || b.priority === "High" ? `<span class="badge" style="color:${PRIO_COLOR[b.priority]}">${b.priority}</span>` : "";
  return `<button class="case book ${b.status === "Wishlist" ? "unowned" : ""} ${bookFx(b)}" data-id="${b.id}" data-kind="book" aria-label="${esc(b.name)}">
    <div class="stage"><div class="pages"></div>${bookFxLayer(b)}
      <div class="box"><div class="art" data-kind="book" data-id="${b.id}">${art}</div><div class="bspine"></div><div class="sheen"></div>${badge}${o.noLabel ? "" : quickBtn(b)}</div>
    </div>
    ${o.noLabel ? "" : `<div class="label"><div class="name">${esc(b.name)}</div><div class="sub">${esc(o.sub ?? [b.author, b.series && b.number ? `${b.series} #${b.number}` : b.series].filter(Boolean).join("  ·  "))}</div></div>`}
  </button>`;
}

/* ---------- selections ---------- */
const byPrio = (a, b) => (PRIO_ORDER[a.priority] ?? 9) - (PRIO_ORDER[b.priority] ?? 9) || a.name.localeCompare(b.name);
const byDone = (a, b) => (b.completed || "").localeCompare(a.completed || "");
function shelves() {
  const G = collapse(withCopies(state.games)), year = new Date().getFullYear();
  const fresh = G.filter(g => state.updated[g.name] && owned(g) && g.status !== "Completed");
  return [
    { title: "Continue playing", items: G.filter(g => g.status === "Playing" && g.type !== "Live service").concat(G.filter(g => g.status === "Paused").sort(byPrio)), view: "library", preset: { status: "Playing" } },
    { title: "Your live games", items: G.filter(g => g.type === "Live service" && g.status !== "Dropped"), view: "library", preset: { status: "Live service" } },
    { title: "Modpacks", items: G.filter(g => g.type === "Modded"), view: "library", preset: { status: "Modpacks" } },
    { title: "Replays", items: G.filter(g => (g.runs || 0) > 1 && g.status !== "Wishlist").sort(byDone), view: "library", preset: { status: "Replays" } },
    { title: "Newly updated", items: fresh, view: "library" },
    { title: "Up next", items: G.filter(g => g.status === "Library").sort(byPrio).slice(0, 24), view: "library", preset: { status: "Library" } },
    { title: "On the Steam Deck", items: G.filter(g => g.play_on === "Steam Deck" && ["Library", "Playing", "Paused"].includes(g.status)).sort(byPrio), view: "library", preset: { playOn: "Steam Deck" } },
    { title: "Upgrade these to PS5 or Switch 2", items: G.filter(g => g.upgrade && g.upgrade !== "No upgrade" && UPGRADE_TO[g.platform] && g.status !== "Completed" && !g.upgrade_owned && !factsOf(g).ps5_version), view: "library" },
    { title: "Wishlist, top priority", items: G.filter(g => g.status === "Wishlist").sort(byPrio).slice(0, 24), view: "wishlist" },
    { title: "Plan to migrate", items: G.filter(migrating), view: "library", preset: { status: "Plan to migrate" } },
    { title: `Finished in ${year}`, items: G.filter(g => g.status === "Completed" && (g.completed || "").startsWith(String(year))).sort(byDone), view: "stats" },
    { title: "Second chances", items: G.filter(g => statusOf(g) === "Second chance"), view: "played" },
  ];
}
/* ----- your Top 100 ----- */
let rankIndex = null, rankDirty = false;
function rankKey(n) {
  const R = { ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };
  return String(n || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[™®©]/g, "").replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ").split(" ").filter(w => w && w !== "the").map(w => R[w] || w).join(" ");
}
function rankOf(g) {
  if (!rankIndex) {
    rankIndex = new Map(); rankMatches = new Map();
    (state.ranking || []).forEach((n, i) => {
      if (!rankIndex.has(rankKey(n))) rankIndex.set(rankKey(n), i + 1);
      const m = rankMatch(n);
      rankMatches.set(n, m);
      if (m && !rankIndex.has(rankKey(m.g.name))) rankIndex.set(rankKey(m.g.name), i + 1);   // its edition or collection in your library wears the award
    });
  }
  return rankIndex.get(rankKey(g.name)) || null;
}
/* the game in your library a Top 100 entry means: the same name, another edition of it, or a collection it's part of */
let rankMatches = new Map();
const EDITION_WORDS = /\b(special|anniversary|remastered|remaster|definitive|enhanced|complete|ultimate|deluxe|goty|game of year|director s cut|directors cut|legendary|royal|hd|edition|vr|gold|premium|standard|digital|launch|day one)\b/g;
const baseKey = n => rankKey(String(n || "").replace(/\([^)]*\)/g, " ")).replace(EDITION_WORDS, " ").replace(/\s+/g, " ").trim();
// what may follow a name and still be the same game: 'Silent Hill 2 Remake', 'Ghostrunner I', 'XCOM 2 Collection'
const SAME_GAME_TAIL = new Set(["remake", "reloaded", "reload", "redux", "reforged", "remastered", "collection", "i", "1", "classic", "original"]);
const COLLECTIONS = [
  ["Mass Effect Legendary Edition", ["Mass Effect", "Mass Effect 2", "Mass Effect 3"]],
  ["Halo: The Master Chief Collection", ["Halo: Combat Evolved", "Halo: Combat Evolved Anniversary", "Halo 2", "Halo 2 Anniversary", "Halo 3", "Halo 3: ODST", "Halo: Reach", "Halo 4"]],
  ["Uncharted: The Nathan Drake Collection", ["Uncharted: Drake's Fortune", "Uncharted 2: Among Thieves", "Uncharted 3: Drake's Deception"]],
  ["Uncharted: Legacy of Thieves Collection", ["Uncharted 4: A Thief's End", "Uncharted: The Lost Legacy"]],
  ["BioShock: The Collection", ["BioShock", "BioShock 2", "BioShock Infinite"]],
  ["Metal Gear Solid: Master Collection Vol. 1", ["Metal Gear Solid", "Metal Gear Solid 2: Sons of Liberty", "Metal Gear Solid 3: Snake Eater"]],
  ["Grand Theft Auto: The Trilogy", ["Grand Theft Auto III", "Grand Theft Auto: Vice City", "Grand Theft Auto: San Andreas"]],
  ["Crash Bandicoot N. Sane Trilogy", ["Crash Bandicoot", "Crash Bandicoot 2: Cortex Strikes Back", "Crash Bandicoot: Warped"]],
  ["Spyro Reignited Trilogy", ["Spyro the Dragon", "Spyro 2: Ripto's Rage", "Spyro: Year of the Dragon"]],
  ["Dark Souls Trilogy", ["Dark Souls", "Dark Souls II", "Dark Souls III"]],
  ["Batman: Arkham Collection", ["Batman: Arkham Asylum", "Batman: Arkham City", "Batman: Arkham Knight"]],
  ["Assassin's Creed: The Ezio Collection", ["Assassin's Creed II", "Assassin's Creed Brotherhood", "Assassin's Creed Revelations"]],
  ["The Orange Box", ["Half-Life 2", "Half-Life 2: Episode One", "Half-Life 2: Episode Two", "Portal", "Team Fortress 2"]],
  ["Kingdom Hearts HD 1.5 + 2.5 ReMIX", ["Kingdom Hearts", "Kingdom Hearts II", "Kingdom Hearts Re:Chain of Memories", "Birth by Sleep"]],
  ["Final Fantasy X/X-2 HD Remaster", ["Final Fantasy X", "Final Fantasy X-2"]],
  ["Tony Hawk's Pro Skater 1 + 2", ["Tony Hawk's Pro Skater", "Tony Hawk's Pro Skater 2"]],
  ["Super Mario 3D All-Stars", ["Super Mario 64", "Super Mario Sunshine", "Super Mario Galaxy"]],
  ["The Witcher 3: Wild Hunt Complete Edition", ["The Witcher 3: Wild Hunt"]],
  ["Red Dead Redemption", ["Red Dead Redemption: Undead Nightmare"]],
].map(([c, parts]) => [rankKey(c), parts.map(baseKey)]);
function rankMatch(name) {
  const pool = [...state.games, ...accountCopies()];
  const owned = list => list.find(g => g.status !== "Wishlist") || list[0] || null;
  const k = rankKey(name), b = baseKey(name);
  let hit = owned(pool.filter(g => rankKey(g.name) === k));
  if (hit) return { g: hit, via: "" };
  hit = owned(pool.filter(g => baseKey(g.name) === b));
  if (hit) return { g: hit, via: "edition" };
  // 'The Elder Scrolls V: Skyrim' and '... Skyrim Special Edition', but never 'Mass Effect' and 'Mass Effect 2'
  const extends_ = (long, short) => short.length > 2 && long.startsWith(short + " ") && long.slice(short.length + 1).split(" ").every(w => SAME_GAME_TAIL.has(w));
  hit = owned(pool.filter(g => { const gb = baseKey(g.name); return extends_(gb, b) || extends_(b, gb); }));
  if (hit) return { g: hit, via: "edition" };
  // small spelling differences ('Clair Obscure' / 'Clair Obscur', 'Persona 3 Reload' / 'Reloaded'), same numbers only
  const nums = x => x.split(" ").filter(w => /^\d+$/.test(w)).join(" ");
  hit = owned(pool.filter(g => { const gb = baseKey(g.name); return nums(gb) === nums(b) && dice(gb, b) >= 0.86; }));
  if (hit) return { g: hit, via: "edition" };
  for (const [coll, parts] of COLLECTIONS) {
    if (!parts.includes(b)) continue;
    hit = owned(pool.filter(g => { const gk = rankKey(g.name); return gk === coll || gk.startsWith(coll + " ") || baseKey(g.name) === baseKey(coll) && coll.split(" ").length > baseKey(coll).split(" ").length && gk.length >= coll.length - 2; }));
    if (hit) return { g: hit, via: "collection" };
  }
  return null;
}
function dice(a, b) {
  if (a === b) return 1;
  const grams = x => { const m = new Map(); for (let i = 0; i < x.length - 1; i++) { const g = x.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = grams(a), B = grams(b); let both = 0;
  A.forEach((n, g) => { both += Math.min(n, B.get(g) || 0); });
  return (2 * both) / Math.max(1, a.length - 1 + b.length - 1);
}
function rankedGame(name) { if (!rankIndex) rankOf({ name: "" }); const m = rankMatches.has(name) ? rankMatches.get(name) : rankMatch(name); return m ? m.g : null; }
/* award tiers: crimson for the podium, diamond for 4-5, gold to 10, silver to 50, bronze for the rest */
function rankTier(n) { return !n ? "" : n <= 3 ? "crimson" : n <= 5 ? "diamond" : n <= 10 ? "gold" : n <= 50 ? "silver" : "bronze"; }
const TIER_NAME = { crimson: "Crimson award", diamond: "Diamond award", gold: "Gold award", silver: "Silver", bronze: "Bronze" };
function awardSVG(t) {
  const star = "M12 3.2l2.6 5.4 5.9.8-4.3 4.1 1.1 5.8L12 16.6l-5.3 2.7 1.1-5.8-4.3-4.1 5.9-.8z";
  if (t === "crimson") return `<svg viewBox="0 0 24 24" class="aw"><path class="flare" d="M12 .6c1.5 2 3.6 2.4 4.6 4.6 1.6-1 3.4-.6 4.3.6-1.7.6-1.9 2.4-1.2 4 1.4 3.3.4 7.4-2.6 9.6-1.4 1.1-3.2 1.8-5.1 1.8s-3.7-.7-5.1-1.8c-3-2.2-4-6.3-2.6-9.6.7-1.6.5-3.4-1.2-4 .9-1.2 2.7-1.6 4.3-.6C8.4 3 10.5 2.6 12 .6z"/><path class="core" d="${star}"/></svg>`;
  if (t === "diamond") return `<svg viewBox="0 0 24 24" class="aw"><path class="core" d="M6.5 3h11l4.5 6-10 12.5L2 9z"/><path class="facet" d="M2 9h20M6.5 3 9 9l3 12.5L15 9l2.5-6M9 9l3-6 3 6"/></svg>`;
  return `<svg viewBox="0 0 24 24" class="aw"><path class="core" d="${star}"/></svg>`;
}
/* ----- the All Time Classic: one game, crowned by you ----- */
function classicGame() {
  const n = state.settings.classic;
  if (!n) return null;
  const k = rankKey(n), all = collapse(withCopies(state.games));
  return all.find(g => rankKey(g.name) === k) || state.games.find(g => rankKey(g.name) === k) || null;
}
const isClassic = g => !!state.settings.classic && rankKey(g.name) === rankKey(state.settings.classic);
function setClassic(g) {
  const before = state.settings.classic;
  state.settings.classic = g ? g.name : "";
  api?.set_pref("classic", state.settings.classic);
  render();
  if (g) { try { FX.play.notify(); } catch {} toast(`${g.name} is your All Time Classic.`, "party", before && rankKey(before) !== rankKey(g.name) ? { label: "Undo", run: () => setClassic(state.games.find(x => x.name === before) || { name: before }) } : null); }
  else toast("The All Time Classic award is free again.");
}
const CLASSIC_IMG = `<img class="classic-logo" alt="" src="img/classic.png" draggable="false">`;
function classicHTML() {
  const g = classicGame();
  if (!g) return `<section class="classic empty"><div class="cosmos" aria-hidden="true"></div><div class="classic-award small">${CLASSIC_IMG}</div>
    <div><h2>All Time Classic</h2><p class="muted">One game, above the whole ranking. Right-click any cover and choose <b>Crown as All Time Classic</b>.</p></div></section>`;
  const runs = state.plays.filter(p => rankKey(p.game) === rankKey(g.name)).sort((a, b) => (a.run || 0) - (b.run || 0));
  const fa = factsOf(g);
  const runHours = runs.reduce((t, r) => t + (r.hours || 0), 0);
  const hours = Math.max(runHours, g.hours || 0, fa.minutes ? fa.minutes / 60 : 0);
  const done = runs.filter(r => r.finished).length || (g.status === "Completed" ? Math.max(1, g.runs || 1) : 0);
  const cover = covers.get(coverKey(g));
  const stat = (v, l) => v ? `<div class="cstat"><b>${v}</b><span>${l}</span></div>` : "";
  return `<section class="classic" data-open="${g.id}" data-kind="game">
    <div class="cosmos" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="classic-cover"><div class="art" data-kind="game" data-id="${g.id}">${cover ? `<img alt="" src="${cover}">` : `<div class="fallback"><div class="t">${esc(g.name)}</div></div>`}</div><div class="classic-award">${CLASSIC_IMG}</div></div>
    <div class="classic-body">
      <div class="classic-kicker">All Time Classic</div>
      <h2>${esc(g.name)}</h2>
      <p class="muted">${esc([g.developer, g.publisher && g.publisher !== g.developer ? g.publisher : "", plat(g.platform).label].filter(Boolean).join("  ·  "))}</p>
      <div class="cstats">${stat(hours ? `${Math.round(hours * 10) / 10} h` : "", "played")}${stat(runs.length || g.runs || "", (runs.length || g.runs) === 1 ? "run" : "runs")}${stat(done, "finished")}${stat(g.score != null ? scoreText(g.score) : "", "your score")}${stat(rankOf(g) ? `#${rankOf(g)}` : "", "in your Top 100")}</div>
      ${runs.length ? `<ol class="cruns">${runs.map(r => `<li><b>Run ${r.run || "·"}</b><span>${esc(plat(r.platform || g.platform).label)}${r.play_on ? ` on ${esc(r.play_on)}` : ""}</span><span>${r.hours ? `${r.hours} h` : ""}</span><span>${r.finished ? (r.finished_on ? `Finished ${fmtDate(r.finished_on)}` : "Finished") : "Unfinished"}</span><span class="tags">${r.modded ? "<i>Modded</i>" : ""}${r.dlc ? "<i>DLC</i>" : ""}${r.platinum ? "<i>100%</i>" : ""}</span>${r.notes ? `<small>${esc(r.notes)}</small>` : ""}</li>`).join("")}</ol>` : ""}
      <div class="cawards" id="classicAwards"><span class="spinner"></span> Looking up the awards it won…</div>
    </div>
    ${state.canEdit ? `<button class="ghost small classic-off" data-unclassic title="Take the award back">Remove award</button>` : ""}
  </section>`;
}
async function fillClassicAwards() {
  const box = $("#classicAwards"), g = classicGame();
  if (!box || !g || !api) return;
  const r = await Promise.resolve(api.awards(g)).catch(() => null);
  if (!$("#classicAwards") || classicGame() !== g) return;
  const wins = r?.wins || [];
  if (!wins.length) { box.innerHTML = `<p class="muted">No awards listed for it on Wikipedia${r?.url ? ` (<a role="link" tabindex="0" data-url="${esc(r.url)}">check the page</a>)` : ""}. Some classics win hearts, not trophies.</p>`; return; }
  const goty = wins.filter(w => /game of the year/i.test(w.category + " " + w.award));
  const list = [...goty, ...wins.filter(w => !goty.includes(w))];
  const li = w => `<li class="${goty.includes(w) ? "goty" : ""}"><b>${esc(w.category || w.award)}</b><span>${esc(w.category ? w.award : "")}${w.year ? ` · ${esc(w.year)}` : ""}</span></li>`;
  box.innerHTML = `<h3>${wins.length} award${wins.length === 1 ? "" : "s"} won${goty.length ? `, ${goty.length} Game of the Year` : ""}${r.nominations ? ` <small>from ${r.nominations} nominations</small>` : ""}</h3>
    <ul class="awardlist">${list.slice(0, 12).map(li).join("")}</ul>
    ${list.length > 12 ? `<details><summary>All ${list.length}</summary><ul class="awardlist">${list.slice(12).map(li).join("")}</ul></details>` : ""}
    <p class="fine">From <a role="link" tabindex="0" data-url="${esc(r.url)}">Wikipedia</a>.</p>`;
}
function rankVia(n, g) { const m = rankMatches.get(n); return m?.via === "collection" ? `In ${esc(g.name)} · ` : m?.via === "edition" ? `As ${esc(g.name)} · ` : ""; }
/* Top 100 games that aren't anywhere in your library get added to it (once; Undo takes them out again) */
async function addMissingRanked() {
  if (!api || !state.canEdit || state.rankingLocal || !state.games.length || !(state.ranking || []).length) return;
  rankOf({ name: "" });
  const tried = new Set(uiGet("rank_added", []));
  const missing = state.ranking.filter(n => !rankMatches.get(n) && !tried.has(rankKey(n)));
  if (!missing.length || addMissingRanked.busy) return;
  addMissingRanked.busy = true;
  uiSet("rank_added", [...tried, ...missing.map(rankKey)]);
  const r = await Promise.resolve(api.add_from_ranking(missing)).catch(e => ({ error: String(e) }));
  addMissingRanked.busy = false;
  if (!r || r.error || !r.added?.length) return;
  const names = r.added.map(a => a.name);
  toast(`Added ${names.length === 1 ? names[0] : names.length + " games"} from your Top 100 to your library as Completed. Change the platform with a right-click.`, "ok", {
    label: "Undo", run: async () => {
      for (const a of r.added.slice().reverse()) await Promise.resolve(api.delete_item("games", a.row, a.name)).catch(() => null);
      sync(true);
    } });
  sync(true);
}
function rankingHTML() {
  const list = state.ranking || [];
  const row = (n, i) => {
    const g = rankedGame(n), fav = i < 10;
    const art = g ? `<div class="art" data-kind="game" data-id="${g.id}"></div>` : `<div class="art virtual" data-vname="${esc(n)}"></div>`;
    const t = rankTier(i + 1);
    return `<li class="rk t-${t} ${fav ? "fav" : ""}" data-ri="${i}">
      <span class="rk-n t-${t}" title="${TIER_NAME[t]}">${i < 10 ? `<i class="rk-aw t-${t}">${awardSVG(t)}</i>` : ""}${i + 1}</span>${art}
      <div class="rk-t"><b>${esc(n)}</b><small>${g ? `${rankVia(n, g)}${esc(plat(g.platform).label)} · ${esc(statusOf(g))}${g.score != null ? ` · ${scoreText(g.score)}` : ""}` : "Not in your library yet"}</small></div>
      <div class="rk-act"><button class="icon" data-rkmove="${i}:-1" title="Move up" aria-label="Move up">▲</button><button class="icon" data-rkmove="${i}:1" title="Move down" aria-label="Move down">▼</button>
        ${g ? `<button class="ghost small" data-open="${g.id}" data-kind="game">Open</button>` : ""}<button class="icon" data-rkdel="${i}" title="Remove from Top 100" aria-label="Remove">✕</button></div></li>`;
  };
  const cell = (n, i) => {
    const g = rankedGame(n), fav = i < 10;
    const m = g && rankMatches.get(n);
    const inner = g && m?.via !== "collection" ? caseHTML(g, { sub: `${m?.via ? "Owned as " + g.name + " · " : ""}${plat(g.platform).label} · ${statusOf(g)}` })
      : `<button class="vcase" ${g ? `data-open="${g.id}" data-kind="game"` : ""} aria-label="${esc(n)}"><div class="vbox"><div class="art virtual" data-vname="${esc(n)}"><span>${esc(n)}</span></div></div><div class="label"><div class="name">${esc(n)}</div><div class="sub">${g ? `In ${esc(g.name)} · ${esc(plat(g.platform).label)}` : "Not in your library yet"}</div></div></button>`;
    const t = rankTier(i + 1);
    return `<div class="rkcell t-${t} ${fav ? "fav" : ""}" data-ri="${i}"><span class="rkbadge t-${t}" title="${TIER_NAME[t]}">${i < 10 ? `<i class="rk-aw">${awardSVG(t)}</i>` : ""}${i + 1}</span>${inner}</div>`;
  };
  const body = state.mode === "list" ? `<ol class="rklist" id="rkList">${list.map(row).join("")}</ol>`
    : `<div class="grid rkgrid">${list.map(cell).join("")}</div>`;
  return `<section class="ranking ${state.mode === "list" ? "" : "wide"}"><header class="deals-head"><div><h1>Top 100</h1><p class="muted">Drag to reorder (or use the arrows). Every place earns an award that shows on the game's cover everywhere in Masterlog.</p>
      <div class="tiers" aria-label="Award tiers">${[["crimson", "1–3"], ["diamond", "4–5"], ["gold", "6–10"], ["silver", "11–50"], ["bronze", "51–100"]].map(([t, r]) => `<span class="tier t-${t}"><i class="rk-aw">${awardSVG(t)}</i>${TIER_NAME[t]}<small>${r}</small></span>`).join("")}</div><p class="muted fine">${state.rankingLocal ? " Saved on this PC until you update the connection script (Settings)." : " Saved to the Ranking tab in your sheet."}</p></div>
    <div class="deals-actions">${modeSwitch()}${scaleSlider()}<input class="search" id="rankAdd" list="rankAddList" placeholder="Add a game to the ranking"><datalist id="rankAddList">${state.games.filter(g => !rankOf(g)).map(g => `<option value="${esc(g.name)}">`).join("")}</datalist></div></header>
    ${classicHTML()}
    ${body}</section>`;
}
/* put a game at a place in the Top 100: everything from that place down moves one step */
function placeInRanking(g, pos) {
  const L = state.ranking || (state.ranking = []), k = rankKey(g.name), at = L.findIndex(n => rankKey(n) === k);
  const cur = at >= 0 ? at + 1 : 0;
  if ((pos || 0) === cur) return false;
  const name = at >= 0 ? L.splice(at, 1)[0] : g.name;
  if (pos > 0) L.splice(Math.min(pos - 1, L.length), 0, name);
  saveRanking(pos > 0 ? `${g.name} is now #${Math.min(pos, L.length)} in your Top 100.` : `${g.name} left your Top 100.`);
  return true;
}
function saveRanking(msg) {
  rankDirty = true; rankIndex = null;
  clearTimeout(saveRanking.t);
  saveRanking.t = setTimeout(async () => {
    const r = await Promise.resolve(api?.save_ranking(state.ranking)).catch(e => ({ error: String(e) }));
    rankDirty = false;
    if (r?.error) toast(r.error, "err"); else if (msg) toast(msg, "ok");
  }, 700);
  const v = $("#view"), top = v.scrollTop;
  if (state.view === "ranking") { v.innerHTML = rankingHTML(); activateArt(v); loadVirtualArt(v); v.scrollTop = top; }
}
function loadVirtualArt(root) {
  root.querySelectorAll(".art.virtual").forEach(el => Promise.resolve(api?.cover(el.dataset.vname, "")).then(uri => { if (uri && el.isConnected) el.innerHTML = `<img alt="" decoding="async" src="${uri}">`; }).catch(() => {}));
}

/* ----- the same game more than once: one cover, the other copies stacked behind it ----- */
const PLAT_RANK = ["PS5", "Switch 2", "Switch", "Steam", "PS4", "GOG", "Epic Games", "EA", "Ubisoft Connect", "PC (Other)", "itch.io", "Emulation", "PS2"];
const VERSION_WORDS = [[/\banniversary( edition)?\b/, 3], [/\bspecial edition\b/, 3], [/\benhanced( edition)?\b/, 3], [/\bdefinitive( edition)?\b/, 2],
  [/\bremaster(ed)?\b/, 2], [/\bdirector'?s cut\b/, 2], [/\b(complete|ultimate|goty|game of the year)( edition)?\b/, 1], [/\blegacy( edition)?\b/, -3],
  [/\b(classic|original)( edition)?\b/, -2]];
function versionScore(name) { const n = name.toLowerCase(); return VERSION_WORDS.reduce((s, [re, v]) => s + (re.test(n) ? v : 0), 0); }
function baseTitle(name) {
  let n = name.toLowerCase().replace(/[™®©]/g, "").replace(/&/g, "and");
  const year = (n.match(/\((\d{4})\)/) || [])[1] || "";
  n = n.replace(/\(\d{4}\)/g, " ");
  for (const [re] of VERSION_WORDS) n = n.replace(re, " ");
  n = n.replace(/\blegendary edition\b/, " ").replace(/\b(edition|the)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  return { base: n, year };
}
const dupsOf = new WeakMap();   // main copy -> the other copies
function copyRank(g) {
  return [-versionScore(g.name), g.format === "Physical" ? 0 : 1, (PLAT_RANK.indexOf(g.platform) + 1) || 99, g.status === "Wishlist" ? 1 : 0];
}
/* copies you own on a linked account but the sheet lists elsewhere (Assassin's Creed II on Ubisoft Connect, owned on Steam too) */
let virtualCopies = [], virtualKey = "";
function accountCopies() {
  const key = JSON.stringify([state.games.length, state.facts && Object.keys(state.facts).length, state.syncedAt]);
  if (key === virtualKey) return virtualCopies;
  virtualKey = key; virtualCopies = [];
  const have = new Set(state.games.map(g => rankKey(g.name) + "|" + g.platform));
  for (const g of state.games) {
    if (g.status === "Wishlist" || g.type === "Modded") continue;
    for (const c of (state.facts?.[g.name]?.copies || [])) {
      if (!c.platform || c.platform === g.platform || have.has(rankKey(g.name) + "|" + c.platform)) continue;
      have.add(rankKey(g.name) + "|" + c.platform);
      virtualCopies.push({ ...g, id: 500000 + virtualCopies.length, platform: c.platform, format: "Digital", play_on: CONSOLES.has(c.platform) ? "" : (g.play_on || "PC"), virtual: true, from: SRC_LABEL[c.src] || c.src, upgrade: "", migrate_to: "" });
    }
  }
  return virtualCopies;
}
function withCopies(list) { const v = accountCopies().filter(c => list.some(g => g.row === c.row)); return v.length ? list.concat(v) : list; }
function collapse(list) {
  const groups = new Map(), years = new Map();
  for (const g of list) {
    if (g.type === "Modded") { groups.set("mod:" + g.id, [g]); continue; }   // a modpack is its own thing
    const { base, year } = baseTitle(g.name);
    if (!base) { groups.set("id:" + g.id, [g]); continue; }
    if (year) { if (!years.has(base)) years.set(base, new Set()); years.get(base).add(year); }
    const k = base + "|" + year;
    (groups.get(k) || groups.set(k, []).get(k)).push(g);
  }
  // 'God of War' and 'God of War (2018)' are the same game when there's only one God of War with a year
  for (const [base, ys] of years) {
    if (ys.size !== 1 || !groups.has(base + "|")) continue;
    const y = [...ys][0];
    groups.get(base + "|" + y).push(...groups.get(base + "|")); groups.delete(base + "|");
  }
  const out = [];
  for (const g of list) {
    for (const [k, arr] of groups) {
      if (arr[0] !== g && !arr.includes(g)) continue;
      if (arr.done) break;
      arr.done = true;
      const sorted = [...arr].sort((a, b) => { const x = copyRank(a), y = copyRank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; });
      dupsOf.set(sorted[0], sorted.slice(1));
      out.push(sorted[0]);
      break;
    }
  }
  return out;
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
  if (state.catalog === "news") { v.innerHTML = newsShellHTML(state.view); loadNews(state.view); return; }
  const empty = isBooks() ? !state.books.length && !state.games.length : !state.games.length;
  if (empty) { v.innerHTML = welcomeHTML(); bindWelcome(); return; }
  if (state.view === "home") v.innerHTML = homeHTML();
  else if (state.view === "stats") v.innerHTML = yearsHTML();
  else if (state.view === "ranking") { v.innerHTML = rankingHTML(); activateArt(v); loadVirtualArt(v); fillClassicAwards(); return; }
  else if (state.view === "deals") { v.innerHTML = dealsHTML(); activateArt(v); loadDeals(false); return; }
  else if (state.view === "shelf") v.innerHTML = bookShelfHTML();
  else if (state.view === "books") v.innerHTML = bookLibraryHTML();
  else if (state.view === "bookyears") v.innerHTML = bookYearsHTML();
  else v.innerHTML = libraryHTML();
  activateArt(v);
  if (state.view === "home") { updateHero(heroGame(), true); fillWhatsNew(); }
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
    return `<div class="welcome"><h1>Welcome</h1>
      <p class="intro">Already using Masterlog on another PC? Open your Google Sheet, go to the <b>Masterlog PCs</b> tab and copy the link at the top. Paste it here and you'll be asked to tick <b>Allow</b> in that tab. Everything else follows on its own.</p>
      <form class="welcome-link" id="wLinkForm"><input id="wLink" type="url" required placeholder="https://script.google.com/macros/s/…/exec" aria-label="Your sheet's Masterlog link"><button class="primary" type="submit">Connect</button></form>
      <div class="actions"><button class="ghost" id="wPair">Copy over Wi-Fi from my other PC instead</button><button class="ghost" id="wSettings">First time: set up the sheet</button></div></div>`;
  }
  return `<div class="welcome"><h1>Loading your backlog</h1><p class="intro">Reading the sheet…</p></div>`;
}
function bindWelcome() {
  $("#wSettings")?.addEventListener("click", () => openSettings(true));
  $("#wPair")?.addEventListener("click", () => openPair("receive"));
  $("#wLinkForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const link = $("#wLink").value.trim();
    if (!link) return;
    const btn = e.target.querySelector("button"); btn.disabled = true; btn.textContent = "Connecting…";
    const res = await api.save_settings({ sheet_url: link }).catch(err => ({ pair_error: String(err) }));
    btn.disabled = false; btn.textContent = "Connect";
    afterConnect(res);
  });
}
function afterConnect(res) {
  if (!res) return;
  if (res.version) state.settings = res;
  if (res.pair_error) return toast(`Couldn't connect: ${res.pair_error}`, "err");
  if (res.pending) return openSheetApproval(res.pending);
  if (res.paired) { toast(`Connected to ${typeof res.paired === "string" ? res.paired : "your sheet"}.`, "ok"); sync(true); }
}

/* a new PC asked your sheet for access: you tick Allow next to its code in the Masterlog PCs tab */
function openSheetApproval(p) {
  pairMode = "sheet";
  if ($("#settings").open) $("#settings").close();
  if (!$("#pairDialog").open) $("#pairDialog").showModal();
  $("#pairBody").dataset.stage = "sheet";
  $("#pairBody").innerHTML = `<h2 id="pairTitle">Allow this PC in your sheet</h2>
    <ol class="pairsteps"><li>Open your Google Sheet${p.title ? ` (<b>${esc(p.title)}</b>)` : ""} in a browser, on any device.</li><li>Go to the <b>${esc(p.tab || "Masterlog PCs")}</b> tab.</li><li>Tick <b>Allow</b> next to this code:</li></ol>
    <div class="paircode">${esc(p.code || "")}</div>
    <p class="news-loading"><span class="spinner"></span> Waiting for you to allow it…</p>
    <div class="row"><button type="button" class="ghost small" id="pairCancelSheet">Cancel</button></div>`;
  clearInterval(pairTimer);
  pairTimer = setInterval(async () => {
    if (!$("#pairDialog").open) return clearInterval(pairTimer);
    const r = await Promise.resolve(api?.pair_poll()).catch(() => null);
    if (!r || r.waiting) return;
    clearInterval(pairTimer);
    if (r.error) { $("#pairBody").innerHTML = `<h2 id="pairTitle">That didn't work</h2><p>${esc(r.error)}</p>`; return; }
    if (r.ok) {
      try { FX.play.save(); } catch {}
      $("#pairBody").innerHTML = `<h2 id="pairTitle">This PC is allowed</h2><p class="pair-ok">✓ Connected to ${esc(r.title || "your sheet")}.</p>
        <p>Your backlog is loading now, along with your All Time Classic, hidden games, covers and ambience track. Your account keys (Steam, PlayStation and the rest) come sealed from your other PC: they arrive the next time Masterlog is open there.</p>`;
      state.settings = await api.get_settings(); sync(true);
    }
  }, 3000);
}

/* ---------- your other PCs: copy everything over the home network ---------- */
let pairTimer = null, pairMode = null;
function openPair(mode) {
  pairMode = mode;
  if ($("#settings").open) $("#settings").close();
  $("#pairDialog").showModal();
  if (mode === "share") { Promise.resolve(api?.share_start()).then(paintPair); }
  else findPCs();
  clearInterval(pairTimer);
  pairTimer = setInterval(async () => {
    if (!$("#pairDialog").open) return clearInterval(pairTimer);
    const st = await Promise.resolve(pairMode === "share" ? api?.share_status() : api?.receive_status()).catch(() => null);
    if (st && (pairMode === "share" || st.stage !== "off")) paintPair(st);
  }, 600);
}
async function findPCs() {
  $("#pairBody").innerHTML = `<h2 id="pairTitle">Copy from my other PC</h2><p class="news-loading"><span class="spinner"></span> Looking for Masterlog on your network…</p>`;
  const r = await Promise.resolve(api?.receive_find()).catch(() => ({ pcs: [] }));
  const pcs = r?.pcs || [];
  $("#pairBody").innerHTML = `<h2 id="pairTitle">Copy from my other PC</h2>
    ${pcs.length ? `<p>Pick the PC to copy from:</p><div class="pclist">${pcs.map(p => `<button type="button" class="pcpick" data-pcip="${esc(p.ip)}" data-pcport="${p.port}"><b>${esc(p.name)}</b><small>${esc(p.ip)}</small></button>`).join("")}</div>`
      : `<p>No PC found yet. On the PC you already use, open Masterlog → Settings → <b>Your PCs</b> → <b>Set up another PC</b>, then look again.</p>`}
    <div class="row"><button type="button" class="ghost small" id="pairAgain">Look again</button></div>
    <details class="howto"><summary>Still not found?</summary><p class="fine">Both PCs must be on the same network. If Windows asked the other PC whether Masterlog may use the network, it needs <b>Allow</b>. You can also type the address the other PC shows:</p>
      <div class="row"><input id="pairIp" type="text" inputmode="decimal" placeholder="192.168.1.20" aria-label="Other PC's address"><button type="button" class="primary small" id="pairIpGo">Connect</button></div></details>`;
}
function paintPair(st) {
  const b = $("#pairBody");
  if (!st || !b) return;
  const done = `<p class="pair-ok">✓ Done.</p>`;
  if (pairMode === "share") {
    const where = (st.ips || []).join(", ");
    const ui = {
      waiting: `<h2 id="pairTitle">Set up another PC</h2><ol class="pairsteps"><li>On the other PC, install Masterlog and open it.</li><li>Choose <b>Copy from my other PC</b> (on the welcome screen, or Settings → Your PCs).</li><li>Check both screens show the same code, then press <b>Send</b> here.</li></ol>
        <p class="fine">Waiting for the other PC${where ? ` · this PC is <b>${esc(where)}</b>` : ""}. Sharing stops on its own in ten minutes. If Windows asks whether Masterlog may use the network, choose <b>Allow</b> (private networks).</p>${st.note ? `<p class="muted">${esc(st.note)}</p>` : ""}<p class="news-loading"><span class="spinner"></span> Waiting…</p>`,
      code: `<h2 id="pairTitle">${esc(st.peer || "Another PC")} wants a copy</h2><p>Does it show this code?</p><div class="paircode">${esc(st.code || "")}</div>
        <div class="row"><button type="button" class="ghost" data-pairdecide="0">No, cancel</button><button type="button" class="primary" data-pairdecide="1">Codes match, send</button></div>`,
      sending: `<h2 id="pairTitle">Sending to ${esc(st.peer || "the other PC")}…</h2><p class="news-loading"><span class="spinner"></span> Encrypting and sending your settings, keys, covers and ambience.</p>`,
      done: `<h2 id="pairTitle">${esc(st.peer || "The other PC")} is set up</h2>${done}<p>Press <b>Restart Masterlog</b> on it and your backlog appears there. From now on both PCs stay in step through your sheet.</p>`,
      expired: `<h2 id="pairTitle">Sharing stopped</h2><p>Ten minutes passed without a PC asking. Start again when the other PC is ready.</p><button type="button" class="primary" id="pairRestart">Share again</button>`,
      error: `<h2 id="pairTitle">That didn't work</h2><p>${esc(st.error || "")}</p><button type="button" class="primary" id="pairRestart">Try again</button>`,
    }[st.stage];
    if (ui && b.dataset.stage !== st.stage + (st.code || "")) { b.innerHTML = ui; b.dataset.stage = st.stage + (st.code || ""); if (st.stage === "code") { try { FX.play.notify(); } catch {} } }
    return;
  }
  const ui = {
    connecting: `<h2 id="pairTitle">Connecting…</h2><p class="news-loading"><span class="spinner"></span> Reaching ${esc(st.peer || "")}.</p>`,
    code: `<h2 id="pairTitle">Confirm on ${esc(st.peer || "your other PC")}</h2><p>Check that your other PC shows the same code, then press <b>Send</b> there.</p><div class="paircode">${esc(st.code || "")}</div><p class="news-loading"><span class="spinner"></span> Waiting for the other PC…</p>`,
    saving: `<h2 id="pairTitle">Saving…</h2><p class="news-loading"><span class="spinner"></span> Putting everything in place.</p>`,
    done: `<h2 id="pairTitle">Copied from ${esc(st.peer || "your other PC")}</h2>${done}<p>${pairSummary(st.summary)}</p><div class="row"><button type="button" class="primary" id="pairRestartApp">Restart Masterlog</button></div>`,
    error: `<h2 id="pairTitle">That didn't work</h2><p>${esc(st.error || "")}</p><button type="button" class="primary" id="pairAgain">Try again</button>`,
  }[st.stage];
  if (ui && b.dataset.stage !== st.stage + (st.code || "")) { b.innerHTML = ui; b.dataset.stage = st.stage + (st.code || ""); if (st.stage === "done") { try { FX.play.save(); } catch {} } }
}
function pairSummary(s) {
  if (!s) return "";
  const keys = (s.keys || []).map(k => ({ steam: "Steam", psn: "PlayStation", igdb: "IGDB", youtube: "YouTube", ebay: "eBay", reddit: "Reddit", nexus: "Nexus Mods" }[k] || k));
  return [s.sheet ? "Your sheet connection" : "", keys.length ? `${keys.join(", ")} keys` : "", s.covers ? `${s.covers} cover${s.covers > 1 ? "s" : ""} you picked` : "", s.audio ? "your ambience track" : ""].filter(Boolean).join(", ") + " came over. Restart to load it all.";
}

function homeHTML() {
  const rows = shelves().filter(s => s.items.length).map((s, i) => `
    <section class="shelf">
      <div class="shelf-head"><h2>${esc(s.title)}</h2><span class="count">${s.items.length}</span>
        <button class="more" data-go="${s.view}" data-shelf="${i}">See all</button>${s.title === "Modpacks" ? `<button class="more" data-modpacks>Find modpacks on this PC</button>` : ""}</div>
      <div class="shelf-row">${s.items.map(g => caseHTML(g)).join("")}</div>
    </section>`).join("");
  return `<section class="whatsnew" id="whatsNew" hidden></section><section class="hero"><div class="hero-bg" id="heroBg"></div><div id="heroCase"></div><div id="heroText"></div></section>${rows}`;
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
function splitList(s) { return String(s || "").split(/\s*[,/;&]\s*|\s+and\s+/i).map(x => x.trim().toLowerCase()).filter(Boolean); }
const SPECIAL = {
  "Live service": g => g.type === "Live service",
  "Modpacks": g => g.type === "Modded",
  "Replays": g => (g.runs || 0) > 1,
  "Plan to migrate": g => migrating(g) || (groupOf(g.platform) === "Exiled" && owned(g)) || (g.platform === "Epic Games" && owned(g)),
};
function asSet(v) { return v instanceof Set ? v : new Set(!v || v === "All" ? [] : [v]); }
function filtered() {
  const f = state.filter, q = f.q.trim().toLowerCase();
  f.status = asSet(f.status); f.prio = asSet(f.prio); f.formats = asSet(f.formats);
  const list = withCopies(state.games).filter(g => {
    if (state.view === "wishlist" && g.status !== "Wishlist") return false;
    if (state.view === "played" && !["Completed", "Dropped"].includes(g.status)) return false;
    if (state.view === "library" && g.status === "Wishlist" && !f.status.has("Wishlist")) return false;
    // inside one group any match counts; across groups every group has to match
    if (f.status.size && ![...f.status].some(st => SPECIAL[st] ? SPECIAL[st](g) : statusOf(g) === st || (st === "Dropped" && g.status === "Dropped"))) return false;
    if (f.plats.size && !f.plats.has(groupOf(g.platform))) return false;
    if (f.playOn === "Console" && !CONSOLES.has(g.platform)) return false;
    if (["PC", "Steam Deck"].includes(f.playOn) && (g.play_on !== f.playOn || CONSOLES.has(g.platform))) return false;
    if (f.prio.size && !f.prio.has(g.priority || "None")) return false;
    if (f.formats.size && !f.formats.has(g.format || "Digital")) return false;
    if (q && !`${g.name} ${g.genre} ${g.developer} ${g.publisher} ${g.platform}`.toLowerCase().includes(q)) return false;
    if (f.genre && !splitList(g.genre).some(x => f.genre.includes(x))) return false;
    if (f.studio && !splitList(`${g.developer},${g.publisher}`).some(x => f.studio.includes(x))) return false;
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
  list.sort(sorts[f.sort] || byPrio);
  return f.plats.size ? list : collapse(list);   // filtering by platform shows every copy on that platform
}
const multi = (set, name, options, labels = {}) => `<div class="seg multi" data-multi="${name}"><button aria-pressed="${!set.size}" data-v="All">All</button>${options.map(o => `<button aria-pressed="${set.has(o)}" data-v="${esc(o)}">${esc(labels[o] || o)}</button>`).join("")}</div>`;
const seg = (obj, name, options) => `<div class="seg" data-seg="${name}">${options.map(o => `<button aria-pressed="${obj[name] === o}" data-v="${esc(o)}">${esc(o)}</button>`).join("")}</div>`;
const scaleSlider = () => `<label class="scale" title="Cover size"><span aria-hidden="true">▫</span><input type="range" id="scale" min="0.7" max="1.7" step="0.05" value="${state.settings.scale || 1}" aria-label="Cover size"><span aria-hidden="true">◻</span></label>`;
function applyScale(v, save) {
  v = Math.min(1.7, Math.max(0.7, v || 1));
  document.documentElement.style.setProperty("--scale", v);
  state.settings.scale = v;
  if (save) { clearTimeout(applyScale.t); applyScale.t = setTimeout(() => api?.set_pref("scale", v), 400); }
}
const modeSwitch = () => `<div class="seg mode" data-mode><button aria-pressed="${state.mode === "covers"}" data-v="covers" title="Covers">▦ Covers</button><button aria-pressed="${state.mode === "list"}" data-v="list" title="List">☰ List</button></div>`;
function libraryHTML() {
  const f = state.filter;
  const statuses = state.view === "wishlist" ? [] : state.view === "played" ? ["Completed", "Dropped", "Second chance", "Replays"] : ["Library", "Playing", "Paused", "Completed", "Dropped", "Second chance", "Wishlist", "Live service", "Modpacks", "Replays", "Plan to migrate"];
  const present = new Set(state.games.map(g => groupOf(g.platform)));
  const groups = [...new Set(Object.keys(PLAT).map(groupOf))].filter(p => present.has(p));
  const chips = groups.map(p => {
    const c = GROUP_STYLE[p] || PLAT[p] || PLAT_FALLBACK;
    const label = GROUP_LABEL[p] || p;
    return `<button class="chip" data-plat="${esc(p)}" aria-pressed="${f.plats.has(p)}" style="--c:${c.chip};--t:${c.chipText}"><i></i>${esc(label)}</button>`;
  }).join("");
  const list = filtered();
  const active = f.status.size + f.prio.size + f.formats.size + f.plats.size + (f.playOn !== "All") + !!f.q + !!f.genre + !!f.studio;
  const pinned = [f.genre ? `<button class="chip on" data-unpin="genre">Genre: ${esc(f.genre.join(", "))} ✕</button>` : "", f.studio ? `<button class="chip on" data-unpin="studio">Made by: ${esc(f.studio.join(", "))} ✕</button>` : ""].join("");
  return `<div class="toolbar">
      <div class="line">
        <input class="search" id="search" type="search" placeholder="Search games, genres, studios" value="${esc(f.q)}">
        ${seg(f, "playOn", ["All", "PC", "Steam Deck", "Console"])}
        ${scaleSlider()}
        <select class="pick" id="sort">${[["priority", "Sort by priority"], ["name", "Sort by name"], ["score", "Sort by score"], ["recent", "Recently finished"], ["hours", "Most hours"], ["platform", "Sort by platform"]].map(([v, l]) => `<option value="${v}" ${f.sort === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        ${modeSwitch()}
        <button class="ghost small walkbtn" data-walk title="Walk through your library (Ctrl+L)">Walk the shelves</button>
        <span class="total">${list.length} ${list.length === 1 ? "game" : "games"}</span>
        ${active ? `<button class="ghost small" id="clearFilters">Clear filters (${active})</button>` : ""}
        ${state.canEdit ? `<button class="ghost small" data-add="games">+ Add game</button>${state.view === "wishlist" ? `<button class="ghost small" data-itch>Browse itch.io</button>` : `<button class="ghost small" data-modpacks>+ Modpack</button>`}` : ""}
      </div>
      ${statuses.length ? `<div class="line">${multi(f.status, "status", statuses)}</div>` : ""}
      <div class="line">${multi(f.prio, "prio", [...Object.keys(PRIO_ORDER), "None"], { None: "No priority" })}${multi(f.formats, "formats", ["Physical", "Digital"])}</div>
      <div class="line">${chips}</div>
      ${pinned ? `<div class="line">${pinned}</div>` : ""}
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
const freshBookFilter = () => ({ q: "", status: new Set(), prio: new Set(), formats: new Set(), author: null, series: null, sort: state.bfilter?.sort || "series" });
function bookFiltered() {
  const f = state.bfilter, q = f.q.trim().toLowerCase();
  const S = asSet(f.status), P = asSet(f.prio), F = asSet(f.formats);
  const list = state.books.filter(b => (!S.size || S.has(b.status)) && (!P.size || P.has(b.priority || "None")) && (!F.size || F.has(b.format))
    && (!f.author || b.author === f.author) && (!f.series || b.series === f.series)
    && (!q || `${b.name} ${b.author} ${b.series}`.toLowerCase().includes(q)));
  const sorts = { series: bySeries, name: (a, b) => a.name.localeCompare(b.name), author: (a, b) => a.author.localeCompare(b.author) || bySeries(a, b), priority: byPrio };
  return list.sort(sorts[f.sort] || bySeries);
}
function bookLibraryHTML() {
  const f = state.bfilter, list = bookFiltered();
  const bActive = asSet(f.status).size + asSet(f.prio).size + asSet(f.formats).size + (f.author ? 1 : 0) + (f.series ? 1 : 0);
  return `<div class="toolbar"><div class="line">
      <input class="search" id="bsearch" type="search" placeholder="Search books, authors, series" value="${esc(f.q)}">
      ${scaleSlider()}
      <select class="pick" id="bsort">${[["series", "By series"], ["author", "By author"], ["name", "By title"], ["priority", "By priority"]].map(([v, l]) => `<option value="${v}" ${f.sort === v ? "selected" : ""}>${l}</option>`).join("")}</select>
      ${modeSwitch()}
      <span class="total">${list.length} ${list.length === 1 ? "book" : "books"}</span>
      ${bActive ? `<button class="ghost small" id="bclear">Clear filters (${bActive})</button>` : ""}
      ${state.canEdit ? `<button class="ghost small" data-add="books">+ Add book</button>` : ""}
      <button class="ghost small walkbtn" data-walk title="Walk through your bookshelves (Ctrl+L)">Walk the shelves</button>
    </div>
    <div class="line">${multi(asSet(f.status), "status", opts("books", "status")).replace('data-multi="status"', 'data-bmulti="status"')}</div>
    <div class="line">${multi(asSet(f.prio), "prio", [...Object.keys(PRIO_ORDER), "None"], { None: "No priority" }).replace('data-multi="prio"', 'data-bmulti="prio"')}${multi(asSet(f.formats), "formats", opts("books", "format")).replace('data-multi="formats"', 'data-bmulti="formats"')}</div>
    ${f.author || f.series ? `<div class="line">${f.author ? `<button class="chip on" data-bunpin="author">By ${esc(f.author)} ✕</button>` : ""}${f.series ? `<button class="chip on" data-bunpin="series">Series: ${esc(f.series)} ✕</button>` : ""}</div>` : ""}
    </div>
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
      <div class="leaf front"><div class="face outside"><div class="art" data-kind="book" data-id="${item.id}">${cached ? `<img alt="" decoding="async" src="${cached}">` : ""}<button type="button" class="artedit" data-coverpick title="Change cover" aria-label="Change cover"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M4 5h11l2 2h3v12H4zm2 2v10h12V9h-2l-2-2zm2 8 3-4 2 3 1.5-2 2.5 3z"/></svg></button></div><div class="bspine"></div></div>
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
      <div class="face outside"><div class="band">${emblem(item.platform)}<span class="wm">${esc(p.label)}</span>${item.platform === "Steam" && item.play_on === "Steam Deck" ? emblem("deck") : ""}</div><div class="art" data-kind="game" data-id="${item.id}">${art}<button type="button" class="artedit" data-coverpick title="Change cover" aria-label="Change cover"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M4 5h11l2 2h3v12H4zm2 2v10h12V9h-2l-2-2zm2 8 3-4 2 3 1.5-2 2.5 3z"/></svg></button></div><div class="hinge"></div><div class="sheen"></div></div>
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
  const tabs = kind === "game" ? [["overview", "Overview"], ["ratings", "Ratings"], ["dlc", "DLC"], ...(item.type === "Live service" ? [["milestones", "Milestones"]] : []), ["watch", "Watch"], ["wiki", "Wiki"], ["news", "News"], ["edit", "Edit"]]
    : [["overview", "Overview"], ["wiki", "About"], ["edit", "Edit"]];
  if (!same) {
    try { FX.play.open(); } catch {}
    panel.innerHTML = `<div class="cv-bg"><div class="cv-art" id="cvArt"></div></div>
      <button class="icon close" aria-label="Close">✕</button><button class="icon refreshinfo" data-refresh title="${kind === "game" ? "Refresh info: fetch cover, synopsis, ratings and media again" : "Refresh info: fetch the cover, ratings and description again"}" aria-label="Refresh info">↻</button>
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
let currentPanelTab = "overview";
function showPanelTab(tab) {
  if (!panelItem) return;
  currentPanelTab = tab;
  const item = findItem(panelItem.kind, panelItem.id);
  if (!item) return closePanel();
  document.querySelectorAll("[data-ptab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.ptab === tab)));
  $("#panel").querySelectorAll("video").forEach(v => v.pause()); $("#panel").querySelectorAll("#wPlayer, #gMain iframe").forEach(x => x.remove()); try { FX.duck(false); } catch {}
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
  if (tab === "watch") { body.innerHTML = loading("Looking for streams and videos…"); Promise.resolve(api?.watch(item)).then(w => { if (still()) { body.innerHTML = watchHTML(item, w || {}); watchData = w; } }); }
  if (tab === "edit") body.innerHTML = editHTML("games", item);
}
let watchData = null;
function watchHTML(g, w) {
  const tw = w.twitch || {}, yt = w.youtube || [];
  const live = tw.needs_setup ? `<p class="muted">Live streams use the same free Twitch app as IGDB. Add it in Settings → Sheet &amp; sources to see who's streaming.</p>`
    : (tw.items || []).length ? `<div class="wgrid">${tw.items.map((s, i) => `<button class="wcard" data-twitch="${i}"><div class="wthumb"><img alt="" loading="lazy" src="${esc(s.thumb)}"><span class="live">LIVE</span><span class="viewers">${(s.viewers || 0).toLocaleString()} watching</span></div><b>${esc(s.name)}</b><small>${esc(s.title)}</small></button>`).join("")}</div>`
    : `<p class="muted">Nobody is streaming ${esc(g.name)} on Twitch right now.</p>`;
  const vids = yt.length ? `<div class="wgrid">${yt.map((v, i) => `<button class="wcard" data-ytw="${i}"><div class="wthumb"><img alt="" loading="lazy" src="${esc(v.thumb)}">${v.seconds ? `<span class="viewers">${Math.floor(v.seconds / 60)}:${String(v.seconds % 60).padStart(2, "0")}</span>` : ""}</div><b>${esc(v.name)}</b><small>${esc(v.channel || "")}${v.published ? ` · ${esc(v.published)}` : ""}</small></button>`).join("")}</div>` : `<p class="muted">No videos found.</p>`;
  return `<div class="player" id="wPlayer" hidden></div><h3>Live on Twitch</h3>${live}<h3>On YouTube</h3>${vids}`;
}
function playWatch(kind, i) {
  const box = $("#wPlayer"), w = watchData;
  if (!box || !w) return;
  const host = encodeURIComponent(location.hostname || w.host || "localhost");
  if (kind === "twitch") {
    const s = w.twitch.items[i];
    box.innerHTML = `<iframe title="${esc(s.name)} on Twitch" src="https://player.twitch.tv/?channel=${encodeURIComponent(s.login)}&parent=${host}&autoplay=true" allow="autoplay; fullscreen" allowfullscreen></iframe><button class="ghost small" data-url="https://www.twitch.tv/${esc(s.login)}">Open on Twitch</button>`;
  } else {
    const v = w.youtube[i];
    box.innerHTML = `<iframe title="${esc(v.name)}" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.youtube)}?autoplay=1&rel=0&modestbranding=1&origin=${encodeURIComponent(location.origin)}" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe><button class="ghost small" data-url="https://www.youtube.com/watch?v=${esc(v.youtube)}">Open on YouTube</button>`;
  }
  box.hidden = false; box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  try { FX.duck(true); } catch {}
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
  collapse(withCopies(state.games));
  const others = dupsOf.get(g) || withCopies(state.games).filter(x => x !== g && (dupsOf.get(x) || []).includes(g));
  const copies = (g.virtual ? `<div class="copiesbar"><span>Owned on ${esc(plat(g.platform).label)} (from your ${esc(g.from)} account); your sheet lists it on ${esc(plat(state.games.find(x => x.row === g.row)?.platform).label)}.</span></div>` : "")
    + (others.length ? `<div class="copiesbar"><span>Also in your library:</span>${others.map(o => `<button class="chip" data-open="${o.id}" data-kind="game">${esc(o.name)} · ${esc(plat(o.platform).label)}${o.format === "Physical" ? " (disc)" : ""} · ${esc(statusOf(o))}</button>`).join("")}</div>` : "");
  return `${fresh ? `<div class="freshbar" data-url="${esc(fresh.url || "")}"><b>Newly updated!</b> ${esc(fresh.title)} · ${ago(fresh.date)}</div>` : ""}${copies}
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
    if (it.youtube) {
      const id = encodeURIComponent(it.youtube), origin = encodeURIComponent(location.origin);
      main.innerHTML = `<iframe title="${esc(it.name || "Trailer")}" src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&origin=${origin}" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe>
        <button class="g-yt ghost small" data-url="https://www.youtube.com/watch?v=${id}">Open on YouTube</button>`;
      return;
    }
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
function dlcAppid(d) { const m = /\/app\/(\d+)/.exec(d.url || ""); return m ? +m[1] : null; }
function dlcHTML(g, list) {
  if (!list.length) return `<p class="muted">No DLC found for this game.</p>`;
  const marks = state.dlcMarks?.[g.name] || {};
  const rowEnd = d => {
    const id = dlcAppid(d), own = !!marks[d.name], wish = id && state.wishAppids?.has(id);
    return `${own ? `<span class="owntag">Owned</span>` : wish ? `<span class="wishtag">On your Steam wishlist</span>` : ""}
      <button class="ghost small" data-dlcown="${esc(d.name)}" aria-pressed="${own}">${own ? "Owned ✓" : "I own this"}</button>`;
  };
  const row0 = d => `<li class="${d.major ? "major" : ""} ${d.kind === "upgrade" ? "upg" : ""}">
      <div class="dl-art">${d.art ? `<img alt="" loading="lazy" decoding="async" src="${esc(d.art)}">` : `<span>${esc(shortDlc(g, d.name).slice(0, 2).toUpperCase())}</span>`}</div>
      <div class="dl-main"><div class="dl-title"><b>${esc(shortDlc(g, d.name))}</b>${d.major ? `<span class="majortag">Major expansion</span>` : d.kind === "upgrade" ? `<span class="minortag">Upgrade / pass</span>` : ""}${d.coming ? `<span class="minortag soon">Coming</span>` : ""}</div>
        <small>${[d.release, d.price].filter(Boolean).map(esc).join(" · ")}</small>${d.summary ? `<p>${esc(d.summary)}</p>` : ""}</div>
      <div class="dl-scores">${d.metacritic != null ? `<span class="mc ${mcClass(d.metacritic)}" data-url="${esc(d.metacritic_url || "")}" title="Metascore">${d.metacritic}</span>` : ""}
        ${d.steam ? `<span class="steamr" title="${esc(d.steam.label)}">${d.steam.percent}%</span>` : ""}
        ${d.url ? `<button class="linkish" data-url="${esc(d.url)}">Store</button>` : ""}${rowEnd(d)}</div></li>`;
  const n = Object.values(marks).filter(Boolean).length;
  return `<p class="fine">${n ? `You own ${n} of these.` : g.dlc_owned ? `You own DLC for this game${g.dlc_done ? " and you've finished it" : ""}.` : "Mark the DLC you own; DLC on your Steam wishlist is flagged automatically."}</p>
    <ul class="dlcs">${list.map(d => row0(d).replace(/^<li class="/, `<li class="${marks[d.name] ? "owned " : ""}`)).join("")}</ul>`;
}
function milestonesHTML(g, items) {
  if (!items.length) return `<p class="muted">No major updates found yet. Milestones come from the game's official update posts.</p>`;
  return `<ol class="milestones">${items.map(m => `<li class="${m.upcoming ? "soon" : ""}" data-url="${esc(m.url)}">
      <div class="ms-art">${m.thumb ? `<img alt="" loading="lazy" decoding="async" src="${esc(m.thumb)}">` : ""}</div>
      <div class="ms-text"><div class="meta">${m.upcoming ? `<span class="ntag soon">Coming ${new Date(m.start * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>` : `<span class="ntag major">${m.kind === "release" ? "Launch" : "Major update"}</span>`}<span>${m.date ? ago(m.date) : ""}</span></div>
        <b>${esc(m.title)}</b>${m.summary ? `<p>${esc(m.summary)}</p>` : ""}</div></li>`).join("")}</ol>`;
}
function wikiHTML(g, w) {
  const wp = w?.wikipedia, fd = w?.fandom, mg = w?.mapgenie;
  const pc = !CONSOLES.has(g.platform);
  const inside = (url, title, label = "Open in Masterlog", browser = "Open in browser") => `<button class="primary small" data-inside="${esc(url)}" data-title="${esc(title)}">${label}</button><button class="ghost small" data-url="${esc(url)}">${browser}</button>`;
  return `<section class="wsec"><h3>Wikipedia</h3>
      ${wp ? `<div class="wiki">${wp.thumb ? `<img alt="" src="${esc(wp.thumb)}">` : ""}<h4>${esc(wp.title)}</h4><p>${esc(wp.extract)}</p></div><div class="links">${inside(wp.url, wp.title)}</div>` : `<p class="muted">No Wikipedia article found.</p>`}</section>
    <section class="wsec"><h3>Fandom wiki</h3>
      ${fd ? `<div class="wiki fandom">${fd.article?.thumb ? `<img alt="" src="${esc(fd.article.thumb)}">` : fd.logo ? `<img alt="" src="${esc(fd.logo)}">` : ""}<h4>${esc(fd.name)}</h4>
          ${fd.article ? `<p><b>${esc(fd.article.title)}</b>${fd.article.abstract ? ` — ${esc(fd.article.abstract)}` : ""}</p>` : ""}</div>
        <div class="links">${fd.article ? inside(fd.article.url, fd.article.title, "Open the article", "Article in browser") : ""}${inside(fd.url, fd.name, "Open the wiki", "Wiki in browser")}</div>`
        : `<p class="muted">No Fandom wiki found for this game.</p><div class="links"><button class="ghost small" data-url="${esc(w?.fandom_search || "")}">Search Fandom</button></div>`}</section>
    <section class="wsec"><h3>Map Genie</h3>
      ${mg ? `<p class="muted">Interactive maps with every item, collectible and secret marked.</p><div class="mapgrid">${mg.maps.map(m => `<button class="mapbtn" data-inside="${esc(m.url)}" data-title="${esc(mg.game)}: ${esc(m.name)}"><span>🗺</span>${esc(m.name)}</button>`).join("")}</div>
        <div class="links"><button class="ghost small" data-url="${esc(mg.url)}">All of ${esc(mg.game)} on Map Genie (browser)</button></div>` : `<p class="muted">Map Genie doesn't have maps for this game.</p>`}</section>
    ${pc ? `<div class="links"><button class="ghost small" data-url="${esc(w?.pcgamingwiki || "")}">PCGamingWiki (fixes and settings)</button><button class="ghost small" data-nexus="${esc(g.name)}">Mods on Nexus Mods</button></div>` : ""}`;
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
  ["second_chance", "Second chance", "check"], ["upgrade_owned", "Upgrade owned", "check"], ["dlc_owned", "DLC owned", "check"], ["dlc_done", "DLC done", "check"], ["platinum", "100% / Platinum", "check"], ["modded", "Modded", "check"]];
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
    ${cat === "games" ? `<label class="rankfield">Top 100 place <input type="number" name="top_rank" min="1" max="${(state.ranking || []).length + 1}" value="${rankOf(item) || ""}" placeholder="Not ranked">
      <small>Type 55 and it goes to #55; #55 and everything below it move down one. Clear it to take the game out.</small></label>
      <div class="row"><button type="button" class="ghost small" data-classic="${item.id}">${isClassic(item) ? "Remove All Time Classic" : "Crown as All Time Classic"}</button></div>` : ""}
    <div class="row"><button type="button" class="ghost small" data-coverpick>Change cover…</button><button type="button" class="ghost small" data-refresh>Refresh info</button></div>
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
/* ----- walk the shelves (walk.js draws it) ----- */
function walkSections() {
  const G = collapse(withCopies(state.games)), byName = (a, b) => a.name.localeCompare(b.name);
  const item = g => ({ g, p: plat(g.platform), tier: isClassic(g) ? "classic" : rankTier(rankOf(g)) });
  const own = G.filter(g => g.status !== "Wishlist"), taken = new Set(), shelves = [];
  // PS5 and PS4 games share a shelf: they run on the same console
  const order = [["PlayStation", ["PS5", "PS4"], "PS5"], ["Switch 2", ["Switch 2"], "Switch 2"], ["Switch", ["Switch"], "Switch"], ["Steam", ["Steam"], "Steam"], ["PS2", ["PS2"], "PS2"]];
  for (const [title, keys, look] of order) {
    const items = own.filter(g => keys.includes(ALIAS[g.platform] || g.platform)).sort(byName);
    items.forEach(g => taken.add(g));
    if (items.length) shelves.push({ title, accent: firstHex(plat(look).accent), items: items.map(item) });
  }
  for (const grp of ["Heroic", "Exiled"]) {
    const items = own.filter(g => !taken.has(g) && GROUPS[g.platform] === grp).sort(byName);
    items.forEach(g => taken.add(g));
    if (items.length) shelves.push({ title: grp, accent: GROUP_STYLE[grp].chip, items: items.map(item) });
  }
  const other = own.filter(g => !taken.has(g)).sort(byName);
  if (other.length) shelves.push({ title: "Everything else", accent: "#ADB5BD", items: other.map(item) });
  const wish = G.filter(g => g.status === "Wishlist").sort((a, b) => (PRIO_ORDER[a.priority] ?? 9) - (PRIO_ORDER[b.priority] ?? 9) || byName(a, b));
  if (wish.length) shelves.push({ title: "Wishlist", accent: "#7FA6FF", items: wish.map(item) });
  return shelves;
}
// books stand like books: their own height and a thickness that varies a little from one to the next
const BOOK_SHADES = ["#5B1E1E", "#1F3A5B", "#2E4A2A", "#4A3463", "#6B4A1E", "#203F45", "#5A2843", "#3B3B3B", "#1E2F5B", "#57411F"];
function bookWalkItem(b) {
  const h = [...(b.series || b.author || b.name)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const t = 0.022 + ((h >> 3) % 7) * 0.004, tall = 0.21 + ((h >> 6) % 4) * 0.012;
  return { g: b, book: true, p: { label: b.format || "Book", shell: BOOK_SHADES[h % BOOK_SHADES.length], band: "#000", text: "#fff" }, dims: { d: tall * 0.66, h: tall, t, gap: 0.003 } };
}
function bookWalkSections() {
  const B = state.books, shelves = [];
  const add = (title, items, accent) => { if (items.length) shelves.push({ title, accent, items: items.map(bookWalkItem) }); };
  add("Reading now", B.filter(b => b.status === "Reading"), "#5BD38A");
  const series = [...new Set(B.filter(b => b.status !== "Wishlist").map(b => b.series).filter(Boolean))].sort();
  for (const sr of series) add(sr, B.filter(b => b.series === sr && b.status !== "Wishlist" && b.status !== "Reading").sort(bySeries), "#C9A45C");
  add("Standalone", B.filter(b => !b.series && !["Wishlist", "Reading"].includes(b.status)).sort((a, b) => (a.author || "").localeCompare(b.author || "") || a.name.localeCompare(b.name)), "#C9A45C");
  add("Wishlist", B.filter(b => b.status === "Wishlist").sort(byPrio), "#7FA6FF");
  return shelves;
}
const firstHex = c => (String(c).match(/#[0-9a-f]{3,8}/i) || ["#4A8CFF"])[0];
function openWalk() {
  const books = isBooks();
  if (state.catalog === "news") switchCatalog("games");
  if (books ? !state.books.length : !state.games.length) return toast(books ? "No books yet, so the shelves are empty." : "Your library is empty, so there's nothing on the shelves yet.");
  closePanel();
  const ok = Walk.open({
    sections: books ? bookWalkSections : walkSections,
    // posters on the walls: your Top 100 for games, your best-rated reads for books
    posters: () => books
      ? state.books.filter(b => b.status === "Read" || b.score != null).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 40).map(b => ({ name: b.name, url: () => loadCover(b) }))
      : [...new Set([state.settings.classic, ...(state.ranking || [])].filter(Boolean))].map(n => { const g = rankedGame(n) || { name: n, platform: "" }; return { name: n, url: () => Promise.resolve(api?.hero(n)).catch(() => null).then(u => u || loadCover(g)) }; }),
    featureFirst: !books && !!state.settings.classic,
    cover: g => loadCover(g),
    open: g => openPanel(books ? "book" : "game", g.id),
    error: msg => toast(msg, "err"),
    closed: () => $("#walkBtn")?.focus(),
  });
  if (ok) { try { FX.play.open(); } catch {} }
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
  if (Walk.active) setTimeout(() => Walk.resume(), 120);
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
  if (!rankDirty) { state.ranking = (res.ranking || []).map(r => r.game); state.rankingLocal = !!res.ranking_local; }
  rankIndex = null;
}
/* the sheet's connection script: updates itself from version 6; older ones need one last paste */
function scriptNotice(res) {
  const n = res.script_note;
  if (n?.ok) toast(`Your sheet's connection script updated itself to version ${n.version}.`, "ok");
  else if (n?.error) toast(`Couldn't update the sheet's connection script: ${n.error}`, "err", { label: "How to fix", run: () => openSettings(true) });
  const cur = res.script_version || 1, want = res.script_bundled || 0;
  if (state.canEdit && cur < 6 && want > cur && !scriptNotice.shown) {
    scriptNotice.shown = true;
    setTimeout(() => toast(`Your sheet's connection script is version ${cur}. Update it one last time (with the manifest) and it keeps itself up to date from then on.`, "", { label: "Show me", run: () => { openSettings(true); const d = document.querySelector("#settings details.howto"); if (d) d.open = true; } }), 4000);
  }
}
async function sync(manual) {
  if (!api) return;
  setSync("busy", "Syncing…");
  const res = await api.sync().catch(e => ({ error: String(e) }));
  if (res && !res.error) {
    const before = JSON.stringify([state.games, state.books, state.canEdit]);
    applyData(res); state.error = null;
    if (res.state_changed) { const s = await api.get_settings().catch(() => null); if (s) { state.settings = s; render(); } }
    $("#banner").hidden = true;
    const editing = document.activeElement?.closest?.("#editForm, #runForm");
    if ((before !== JSON.stringify([state.games, state.books, state.canEdit]) || manual) && !editing) {
      render();
      if (panelItem) refreshPanelHead();
    }
    refreshUpdated();
    setTimeout(addMissingRanked, 1500);
    scriptNotice(res);
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
  f.steam_cc.value = st.steam_cc || "GE";
  f.ps_locale.value = st.ps_locale || "en-us";
  f.money_gel.checked = st.money === "GEL";
  f.auto_names.checked = st.auto_names !== false;
  f.eshop_country.value = st.eshop_country || "DE";
  f.ebay_id.value = ""; f.ebay_secret.value = "";
  $("#ebayState").textContent = st.has_ebay ? "eBay is connected. Paste new keys to replace them, or type a space in both to remove." : "Optional.";
  $("#ebayState").className = st.has_ebay ? "ok" : "";
  ambienceState();
  $("#igdbState").textContent = st.has_igdb ? "IGDB is connected. Paste new values to replace them." : "Not connected.";
  $("#igdbState").className = st.has_igdb ? "ok" : "";
  f.youtube_key.value = ""; f.reddit_id.value = "";
  $("#redditState").textContent = st.has_reddit ? "Reddit app connected. Type a single space and Save to remove it." : "Not needed.";
  f.nexus_key.value = "";
  $("#pcsState").textContent = st.joined && !st.sealed ? "This PC is waiting for your account keys: open Masterlog on your other PC once and they arrive sealed." : st.sealed ? "Account keys are shared between your PCs, sealed." : "";
  $("#nexusState").textContent = st.has_nexus ? "Nexus Mods is connected. Paste a new key to replace it, or type a space to remove it." : "Optional. Collections installed through Vortex show up without it.";
  $("#nexusState").className = st.has_nexus ? "ok" : "";
  $("#redditState").className = st.has_reddit ? "ok" : "";
  $("#ytState").textContent = st.has_youtube ? "Using the official YouTube API. Type a single space and Save to remove it." : "Not needed: trailers are found on YouTube without it. A key (Google Cloud → YouTube Data API v3) just makes the search official.";
  $("#ytState").className = st.has_youtube ? "ok" : "";
  $("#keyState").textContent = st.has_sgdb_key ? "A key is saved. Paste a new one to replace it." : "Covers for every platform, including PS5 and Switch. Without a key, covers come from Steam only.";
  $("#connState").textContent = st.connected ? "Connected. You can edit and add from the app." : st.link_kind === "csv" ? "Read-only: this is a published sheet link. Use the connection script below to edit from the app." : "Paste the Web app link from the connection script.";
  $("#connState").className = st.connected ? "ok" : "";
  $("#settingsForm .howto").open = !!showHowTo && !st.connected;
  $("#versionText").textContent = `Masterlog ${st.version || "dev"}`;
  showSettingsTab(tab);
  $("#settings").showModal();
}
function ambienceState() {
  const a = state.settings.ambience;
  $("#ambState").textContent = a ? `${a.name}${a.intro_end ? ` · intro ${a.intro_end.toFixed(1)} s, then a seamless loop` : " · loops"}` : "None chosen. Without one, Masterlog stays quiet between clicks.";
  $("#ambClear").hidden = !a;
}
async function chooseAmbience(clear) {
  const r = clear ? await api.clear_ambience() : await api.choose_ambience();
  if (!r) return;
  if (r.error) return toast(r.error, "err");
  state.settings.ambience = r.ambience || null;
  ambienceState(); applySound();
  try { FX.startAmbient(false); } catch {}
  toast(clear ? "Ambience removed." : "Ambience set.", "ok");
}
function soundSettings() {
  const f = $("#settingsForm");
  return { sound_on: f.sound_on.checked, ambient_volume: +f.ambient_volume.value, fx_volume: +f.fx_volume.value, intro: f.intro.checked, big_picture: f.big_picture.checked,
    steam_cc: f.steam_cc.value, ps_locale: f.ps_locale.value, money: f.money_gel.checked ? "GEL" : "native", auto_names: f.auto_names.checked,
    eshop_country: f.eshop_country.value };
}
function applySound(st = state.settings) {
  try { FX.configure({ on: st.sound_on !== false, ambient: st.ambient_volume ?? 0.35, fx: st.fx_volume ?? 0.5, track: st.ambience || null }); } catch {}
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
  else if (res.pending) openSheetApproval(res.pending);
  else if (res.paired) toast(`Connected to ${typeof res.paired === "string" ? res.paired : "your sheet"}.`, "ok");
  if (!hadKey && state.settings.has_sgdb_key) { await api.clear_covers(); covers.clear(); }
  const iid = f.igdb_id.value.trim(), isec = f.igdb_secret.value.trim();
  if (iid && isec) {
    const r = await api.set_igdb(iid, isec);
    if (r.error) toast(r.error, "err");
    else { toast("IGDB connected. Missing covers will fill in as you browse.", "ok"); covers.forEach((v, k) => { if (!v) covers.delete(k); }); state.settings.has_igdb = true; render(); }
    f.igdb_id.value = ""; f.igdb_secret.value = "";
  }
  if (f.ebay_id.value || f.ebay_secret.value) {
    const r = await api.set_ebay_keys(f.ebay_id.value, f.ebay_secret.value);
    if (r.error) toast(r.error, "err"); else { state.settings.has_ebay = !r.removed; toast(r.removed ? "eBay removed." : "eBay connected. Physical prices appear in Deals shortly.", "ok"); }
    f.ebay_id.value = ""; f.ebay_secret.value = "";
  }
  if (f.nexus_key.value) {
    const r = await api.set_nexus_key(f.nexus_key.value);
    if (r.error) toast(r.error, "err"); else { state.settings.has_nexus = !r.removed; toast(r.removed ? "Nexus Mods removed." : `Nexus Mods connected${r.name ? ` as ${r.name}` : ""}.`, "ok"); }
    f.nexus_key.value = "";
  }
  if (f.reddit_id.value) {
    const r = await api.set_reddit_app(f.reddit_id.value);
    if (r.error) toast(r.error, "err"); else { state.settings.has_reddit = !r.removed; toast(r.removed ? "Reddit app removed." : "Reddit connected. News reloads now.", "ok"); newsState.data = {}; }
    f.reddit_id.value = "";
  }
  const yk = f.youtube_key.value;
  if (yk) {
    const r = await api.set_youtube_key(yk);
    if (r.error) toast(r.error, "err");
    else { state.settings.has_youtube = !r.removed; toast(r.removed ? "YouTube key removed." : "YouTube API connected.", "ok"); }
    f.youtube_key.value = ""; f.reddit_id.value = "";
  $("#redditState").textContent = st.has_reddit ? "Reddit app connected. Type a single space and Save to remove it." : "Only needed if Leaks, Marvel & DC or the deal subreddits won't load.";
  $("#redditState").className = st.has_reddit ? "ok" : "";
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
async function copyManifest() {
  const text = await api?.connection_manifest();
  if (!text) return;
  try { await navigator.clipboard.writeText(text); }
  catch { const t = document.createElement("textarea"); t.value = text; document.body.append(t); t.select(); document.execCommand("copy"); t.remove(); }
  toast("Manifest copied. Paste it over everything in appsscript.json.", "ok");
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
  }).join("") + `<div class="row"><button type="button" class="ghost small" id="syncAccounts">Check accounts now</button><button type="button" class="ghost small" id="reviewImports">Review games not in Masterlog</button><button type="button" class="ghost small" id="showHidden">Hidden games</button></div>`;
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
      state.facts = d.facts || {}; state.candidates = d.candidates || []; state.steamWish = d.wishlist || []; state.wishAppids = new Set(d.wish_appids || []);
      if (before !== JSON.stringify(state.facts) && !document.activeElement?.closest?.("#editForm")) { render(); if (panelItem) refreshPanelHead(); }
      if (d.unreviewed?.length && state.candidates.length && !importOffered && state.canEdit) { importOffered = true; openImport(d.unreviewed); }
      if (d.new?.length && state.canEdit) offerNew(d.new);
      syncTrophies();
    }
    accountsPoll = setTimeout(run, d?.running || fast ? 4000 : 120000);
  };
  accountsPoll = setTimeout(run, fast ? 2500 : 0);
}
let offeredNew = "";
function offerNew(items) {
  const key = items.map(i => i.id).sort().join(",");
  if (key === offeredNew) return;
  offeredNew = key;
  try { FX.play.notify(); } catch {}
  const n = items.length, bought = items.filter(i => !i.wishlist).length;
  toast(n === 1 ? `${items[0].name} just showed up on your ${SRC_LABEL[items[0].source] || ""} ${items[0].wishlist ? "wishlist" : "account"}.` : `${n} new games on your accounts${bought ? ` (${bought} bought)` : ""}.`,
    "party", { label: "Review", run: () => openImport(null, { fresh: items }) });
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
  for (const g of state.games.filter(g => factsOf(g).ps5_version && g.upgrade && g.upgrade !== "No upgrade" && !g.upgrade_owned && !platSynced.has("up:" + g.name)).slice(0, 6)) {
    platSynced.add("up:" + g.name);
    const r = await Promise.resolve(api?.edit("games", g.row, g.name, { upgrade_owned: true })).catch(() => null);
    if (r && !r.error) { g.upgrade_owned = true; toast(`${g.name}: your PlayStation account has the PS5 version, so the upgrade is marked as owned.`, "ok"); }
  }
  const todo = state.games.filter(g => factsOf(g).complete && !g.platinum && !platSynced.has(g.name)).slice(0, 8);
  for (const g of todo) {
    platSynced.add(g.name);
    await Promise.resolve(api?.edit("games", g.row, g.name, { platinum: true })).catch(() => null);
    g.platinum = true;
  }
  if (todo.length) { render(); toast(todo.length === 1 ? `${todo[0].name}: every achievement unlocked. Badge earned!` : `${todo.length} games just earned their 100% badge.`, "party"); }
}
/* ---------- games on your accounts: pick the ones you care about, by cover ---------- */
const SRC_LABEL = { steam: "Steam", psn: "PlayStation", heroic: "Heroic", itch: "itch.io" };
function openImport(sources, opts = {}) {
  const fresh = new Set((opts.fresh || []).map(c => c.id));
  const owned_ = state.candidates.filter(c => !sources || sources.includes(c.source));
  const wish = state.steamWish || [];
  if (!owned_.length && !wish.length) return toast("Everything on your accounts is already in Masterlog.", "ok");
  owned_.sort((a, b) => fresh.has(b.id) - fresh.has(a.id) || (b.minutes || 0) - (a.minutes || 0) || a.name.localeCompare(b.name));
  const all = [...owned_, ...wish.map(w => ({ ...w, wishlist: true }))];
  const tile = (c, i) => `<div class="itile" data-i="${i}" role="checkbox" aria-checked="false" tabindex="0" title="${esc(c.name)}">
      <div class="iart" data-cand="${i}"><span>${esc(c.name)}</span></div>
      ${fresh.has(c.id) ? `<span class="inew">New</span>` : ""}<span class="icheck">✓</span>
      <button type="button" class="ihide" data-hide="${i}" title="Never suggest this game">Never</button>
      <div class="iname">${esc(c.name)}</div><small>${esc(c.platform)} · ${esc(SRC_LABEL[c.source] || c.source)}${c.minutes ? ` · ${Math.round(c.minutes / 6) / 10} h` : ""}</small></div>`;
  const wStart = owned_.length;
  $("#importForm").innerHTML = `<h2>${opts.fresh?.length ? `New on your accounts` : `Games on your accounts`}</h2>
    <p class="fine">Pick only the ones you're interested in; nothing is added until you say so. "Never" hides a game for good (you can bring it back in Settings → Accounts).</p>
    ${owned_.length ? `<h3>You own these (${owned_.length})</h3><div class="igrid">${owned_.map((c, i) => tile(c, i)).join("")}</div>` : ""}
    ${wish.length ? `<h3>On your Steam wishlist (${wish.length})</h3><p class="fine">Picked ones go to your Masterlog wishlist.</p><div class="igrid">${wish.map((c, i) => tile({ ...c, wishlist: true }, wStart + i)).join("")}</div>` : ""}
    <div class="row sticky"><span id="impCount" class="muted">Nothing picked</span><span class="spacer"></span><button value="later" class="ghost">Not now</button><button value="add" class="primary" id="impAdd" disabled>Add picked</button></div>`;
  const form = $("#importForm");
  form._list = all; form._picked = new Set();
  $("#importDialog").showModal();
  // covers load as they scroll into view
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return; io.unobserve(e.target);
    const c = all[+e.target.dataset.cand];
    Promise.resolve(api?.candidate_cover(c.name, c.platform, c.appid || null, c.art || null)).then(uri => { if (uri) e.target.innerHTML = `<img alt="" decoding="async" src="${uri}">`; }).catch(() => {});
  }), { root: form, rootMargin: "200px" });
  form.querySelectorAll(".iart").forEach(el => io.observe(el));
}
function importPick(form, i) {
  const t = form.querySelector(`.itile[data-i="${i}"]`);
  form._picked.has(i) ? form._picked.delete(i) : form._picked.add(i);
  t.setAttribute("aria-checked", String(form._picked.has(i)));
  const n = form._picked.size;
  $("#impCount").textContent = n ? `${n} picked` : "Nothing picked";
  $("#impAdd").disabled = !n;
  try { FX.play.tab(); } catch {}
}
async function importHide(form, i) {
  const c = form._list[i];
  await Promise.resolve(api?.hide_games([c.id])).catch(() => null);
  form._picked.delete(i);
  form.querySelector(`.itile[data-i="${i}"]`)?.remove();
  state.candidates = state.candidates.filter(x => x.id !== c.id);
  state.steamWish = (state.steamWish || []).filter(x => x.id !== c.id);
  toast(`${c.name} won't be suggested again.`, "", { label: "Undo", run: () => api?.hide_games([c.id], true).then(() => pollAccounts(true)) });
}
async function submitImport(form, action) {
  await api?.accounts_seen();   // whatever you didn't pick stays reviewable, but no longer counts as new
  if (action !== "add") return;
  const chosen = [...form._picked].map(i => form._list[i]);
  if (!chosen.length) return;
  toast(`Adding ${chosen.length} game${chosen.length === 1 ? "" : "s"}…`);
  const res = await Promise.resolve(api?.import_games(chosen.map(c => ({ name: c.name, platform: c.platform, store_link: c.url, wishlist: !!c.wishlist })))).catch(e => ({ error: String(e) }));
  if (!res || res.error) return toast(res?.error || "Couldn't add them.", "err");
  try { FX.play.notify(); } catch {}
  toast(`Welcome aboard: ${res.added.length} game${res.added.length === 1 ? "" : "s"} added.${res.failed.length ? ` ${res.failed.length} couldn't be added.` : ""}`, "party");
  sync(true);
}
async function showHidden() {
  const list = await Promise.resolve(api?.hidden_games()).catch(() => []) || [];
  if (!list.length) return toast("No hidden games.", "ok");
  $("#importForm").innerHTML = `<h2>Hidden from suggestions (${list.length})</h2><p class="fine">Click a game to let Masterlog suggest it again.</p>
    <div class="hiddenlist">${list.map(c => `<button type="button" class="chip" data-unhide="${esc(c.id)}">${esc(c.name)} · ${esc(SRC_LABEL[c.source] || c.source)}</button>`).join("")}</div>
    <div class="row"><span class="spacer"></span><button value="close" class="ghost">Close</button></div>`;
  $("#importForm")._list = []; $("#importForm")._picked = new Set();
  $("#importDialog").showModal();
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
    w = c.width = Math.round(innerWidth * 0.6); h = c.height = Math.round(innerHeight * 0.6);  // soft shapes: a smaller canvas looks the same
    cols = Array.from({ length: 26 }, (_, i) => ({
      x: (i / 26) * w + Math.random() * w / 30, base: 0.25 + Math.random() * 0.55, phase: Math.random() * Math.PI * 2,
      speed: 0.00012 + Math.random() * 0.00018, width: (8 + Math.random() * 22) * 0.6, depth: 0.35 + Math.random() * 0.65,
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
      ctx.fillRect(col.x, y, col.width * col.depth, 1.2);
    }
  };
  resize(); addEventListener("resize", resize);
  if (reduce) { draw(0); return; }
  let last = 0;
  // the background moves slowly, so a dozen frames a second is plenty; it rests while you scroll, read a case or use another window
  let scrolling = 0;
  $("#view").addEventListener("scroll", () => { scrolling = performance.now(); }, { passive: true });
  const loop = t => {
    if (t - last > 85 && !document.hidden && document.hasFocus() && t - scrolling > 250 && !$("#panel").classList.contains("open")) { draw(t); last = t; }
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
  $("#ambChoose").addEventListener("click", () => chooseAmbience(false));
  $("#claudeBtn").addEventListener("click", () => { if (!state.canEdit) toast("Claude can suggest changes, but applying them needs the sheet connection (Settings)."); $("#claudeDialog").showModal(); });
  $("#claudeCopy").addEventListener("click", async () => {
    const ask = $("#claudeAsk").value.trim();
    if (!ask) return toast("Write what you want first.", "err");
    const text = claudePrompt(ask);
    try { await navigator.clipboard.writeText(text); } catch { const t = document.createElement("textarea"); t.value = text; document.body.append(t); t.select(); document.execCommand("copy"); t.remove(); }
    $("#claudeCopied").textContent = "Copied. Paste it into the new chat with Ctrl+V.";
    api?.open("https://claude.ai/new");
  });
  $("#claudeReply").addEventListener("input", () => { clearTimeout(claudePreview.t); claudePreview.t = setTimeout(claudePreview, 250); });
  $("#claudeApply").addEventListener("click", claudeApply);
  $("#coverGrid").addEventListener("click", e => { const b = e.target.closest("[data-cand]"); if (b) pickCover(+b.dataset.cand); });
  $("#coverSearch").addEventListener("click", () => openCoverPicker($("#coverQuery").value.trim()));
  $("#coverQuery").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); openCoverPicker($("#coverQuery").value.trim()); } });
  $("#coverFile").addEventListener("click", () => customCover(true));
  $("#coverAuto").addEventListener("click", () => customCover(false));
  $("#ambClear").addEventListener("click", () => chooseAmbience(true));
  $("#copyScript").addEventListener("click", copyScript);
  $("#copyManifest").addEventListener("click", copyManifest);
  document.querySelectorAll("[data-stab]").forEach(b => b.addEventListener("click", () => showSettingsTab(b.dataset.stab)));
  $("#settingsForm").addEventListener("input", e => { if (["sound_on", "ambient_volume", "fx_volume"].includes(e.target.name)) applySound({ ...state.settings, ...soundSettings() }); });
  $("#accountsBox").addEventListener("click", e => {
    const o = e.target.closest("[data-linkopen]"); if (o) { const f = $(`[data-linkform="${o.dataset.linkopen}"]`); f.hidden = !f.hidden; return; }
    const l = e.target.closest("[data-link]"); if (l) return linkAccount(l.dataset.link);
    const u = e.target.closest("[data-unlink]"); if (u) return Promise.resolve(api?.unlink_account(u.dataset.unlink)).then(() => { renderAccounts(); toast("Unlinked. Its saved key was deleted from this PC.", "ok"); });
    if (e.target.closest("#syncAccounts")) { api?.accounts_sync(); pollAccounts(true); return toast("Checking your accounts…"); }
    if (e.target.closest("#showHidden")) { $("#settings").close(); return showHidden(); }
    if (e.target.closest("#reviewImports")) { $("#settings").close(); return openImport(null); }
  });
  $("#importForm").addEventListener("submit", e => submitImport(e.target, e.submitter?.value));
  $("#importForm").addEventListener("keydown", e => { const t = e.target.closest?.(".itile"); if (t && (e.key === " " || e.key === "Enter")) { e.preventDefault(); importPick(e.currentTarget, +t.dataset.i); } });
  $("#importForm").addEventListener("click", e => {
    const form = e.currentTarget;
    const hide = e.target.closest("[data-hide]"); if (hide) { e.preventDefault(); return importHide(form, +hide.dataset.hide); }
    const am = e.target.closest("[data-addmod]"); if (am) { e.preventDefault(); return addModpack(+am.dataset.addmod, am); }
    const un = e.target.closest("[data-unhide]"); if (un) { api?.hide_games([un.dataset.unhide], true).then(() => { un.remove(); pollAccounts(true); toast("It can be suggested again.", "ok"); }); return; }
    const t = e.target.closest(".itile"); if (t) return importPick(form, +t.dataset.i);
  });
  $("#bigBtn").addEventListener("click", toggleBigPicture);
  $("#pairShare").addEventListener("click", () => openPair("share"));
  $("#pairReceive").addEventListener("click", () => openPair("receive"));
  $("#pairClose").addEventListener("click", () => { $("#pairDialog").close(); });
  $("#pairDialog").addEventListener("close", () => { clearInterval(pairTimer); if (pairMode === "share") api?.share_stop(); $("#pairBody").dataset.stage = ""; });
  $("#pairDialog").addEventListener("click", e => {
    const d = e.target.closest("[data-pairdecide]"); if (d) { api?.share_decide(d.dataset.pairdecide === "1"); return; }
    if (e.target.closest("#pairRestart")) { $("#pairBody").dataset.stage = ""; Promise.resolve(api?.share_start()).then(paintPair); return; }
    if (e.target.closest("#pairAgain")) { $("#pairBody").dataset.stage = ""; return findPCs(); }
    if (e.target.closest("#pairRestartApp")) { api?.restart_app(); return; }
    if (e.target.closest("#pairCancelSheet")) { clearInterval(pairTimer); api?.pair_cancel(); $("#pairDialog").close(); state.settings.sheet_url = ""; render(); return; }
    const pc = e.target.closest("[data-pcip]"); if (pc) { api?.receive_start(pc.dataset.pcip, +pc.dataset.pcport); return; }
    if (e.target.closest("#pairIpGo")) { const ip = $("#pairIp").value.trim(); if (ip) Promise.resolve(api?.receive_start(ip)).then(st => st?.stage === "error" && paintPair(st)); }
  });
  $("#walkBtn").addEventListener("click", openWalk);
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
      const pre = s?.preset || {};
      state.filter = { q: "", status: asSet(pre.status), plats: new Set(), playOn: pre.playOn || "All", prio: new Set(), formats: new Set(), sort: s?.title.startsWith("Finished") ? "recent" : "priority" };
      return go(more.dataset.go);
    }
    const yr = e.target.closest(".year > button");
    if (yr) { const y = +yr.parentElement.dataset.year; state.openYears.has(y) ? state.openYears.delete(y) : state.openYears.add(y); yr.parentElement.classList.toggle("open"); activateArt(yr.parentElement); return; }
    const chip = e.target.closest("[data-plat]");
    if (chip) { const p = chip.dataset.plat; state.filter.plats.has(p) ? state.filter.plats.delete(p) : state.filter.plats.add(p); return render(); }
    const m = e.target.closest("[data-mode] button");
    if (m) { state.mode = m.dataset.v; api?.set_pref("view_mode", state.mode); return render(); }
    const mb = e.target.closest("[data-multi] button");
    if (mb) {
      const key = mb.parentElement.dataset.multi, set = asSet(state.filter[key]);
      if (mb.dataset.v === "All") set.clear(); else set.has(mb.dataset.v) ? set.delete(mb.dataset.v) : set.add(mb.dataset.v);
      state.filter[key] = set; return render();
    }
    if (e.target.closest("#clearFilters")) { state.filter = { q: "", status: new Set(), plats: new Set(), playOn: "All", prio: new Set(), formats: new Set(), sort: state.filter.sort }; return render(); }
    const up = e.target.closest("[data-unpin]"); if (up) { state.filter[up.dataset.unpin] = null; return render(); }
    const segB = e.target.closest("[data-seg] button");
    if (segB) { state.filter[segB.parentElement.dataset.seg] = segB.dataset.v; return render(); }
    const bmb = e.target.closest("[data-bmulti] button");
    if (bmb) {
      const key = bmb.parentElement.dataset.bmulti, set = asSet(state.bfilter[key]);
      if (bmb.dataset.v === "All") set.clear(); else set.has(bmb.dataset.v) ? set.delete(bmb.dataset.v) : set.add(bmb.dataset.v);
      state.bfilter[key] = set; return render();
    }
    if (e.target.closest("#bclear")) { state.bfilter = { ...freshBookFilter(), q: state.bfilter.q }; return render(); }
    const bup = e.target.closest("[data-bunpin]"); if (bup) { state.bfilter[bup.dataset.bunpin] = null; return render(); }
    const bseg = e.target.closest("[data-bseg] button");
    if (bseg) { state.bfilter[bseg.parentElement.dataset.bseg] = bseg.dataset.v; return render(); }
    const add = e.target.closest("[data-add]"); if (add) return openAdd(add.dataset.add);
    const open = e.target.closest("[data-open]"); if (open) return openPanel(open.dataset.kind || "game", open.dataset.open);
    if (e.target.closest("[data-catalog-go]")) { switchCatalog("news"); return go("yours"); }
    if (e.target.closest("[data-modpacks]")) return openModpacks();
    if (e.target.closest("[data-walk]")) return openWalk();
    if (e.target.closest("[data-unclassic]")) { e.stopPropagation(); return setClassic(null); }
    if (e.target.closest(".classic [data-url], .classic details, .classic summary")) return;
    if (e.target.closest("[data-itch]")) { api?.browse_itch(); return toast("itch.io opened. On any game's page, press \"+ Add to Masterlog wishlist\".", "ok"); }
    const mv = e.target.closest("[data-rkmove]");
    if (mv) { const [i, d] = mv.dataset.rkmove.split(":").map(Number), j = i + d, L = state.ranking; if (j < 0 || j >= L.length) return; [L[i], L[j]] = [L[j], L[i]]; try { FX.play.move(); } catch {} return saveRanking(); }
    const rd = e.target.closest("[data-rkdel]");
    if (rd) { const n = state.ranking.splice(+rd.dataset.rkdel, 1)[0]; return saveRanking(`${n} removed from your Top 100.`); }
  });
  document.addEventListener("click", e => { const u = e.target.closest("[data-url]"); if (u && u.dataset.url && !(u.matches(".nitem.spoiler"))) api?.open(u.dataset.url); });
  // dragging in the Top 100 (grid or list): the others slide out of the way as you go
  let drag = null, swallowClick = false;
  const flip = (container, mutate) => {
    const items = [...container.children], first = new Map(items.map(n => [n, n.getBoundingClientRect()]));
    mutate();
    for (const n of items) {
      if (n === drag?.el) continue;
      const a = first.get(n), b = n.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
      if (dx || dy) n.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.2, .8, .2, 1)" });
    }
  };
  view.addEventListener("dragstart", e => { if (e.target.closest?.(".rkcell, .rk")) e.preventDefault(); });   // no browser image dragging here
  view.addEventListener("pointerdown", e => {
    const el = e.target.closest?.(".rkcell, .rk");
    if (!el || e.button !== 0 || e.target.closest("input, a, .rk-act, .qc, [data-coverpick]") || (e.target.closest("button") && !e.target.closest(".case"))) return;
    drag = { el, x: e.clientX, y: e.clientY, started: false, id: e.pointerId };
  });
  addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 7) return;
      const r = drag.el.getBoundingClientRect();
      drag.started = true; drag.dx = drag.x - r.left; drag.dy = drag.y - r.top;
      const ghost = drag.el.cloneNode(true);
      ghost.classList.add("rk-ghost"); ghost.removeAttribute("data-ri");
      Object.assign(ghost.style, { width: `${r.width}px`, height: `${r.height}px`, left: `${r.left}px`, top: `${r.top}px` });
      document.body.append(ghost); drag.ghost = ghost;
      drag.el.classList.add("rk-placeholder");
      hidePeek(); try { FX.play.click(); } catch {}
    }
    e.preventDefault();
    drag.ghost.style.transform = `translate(${e.clientX - drag.dx - parseFloat(drag.ghost.style.left)}px, ${e.clientY - drag.dy - parseFloat(drag.ghost.style.top)}px) rotate(${drag.el.classList.contains("rkcell") ? 3 : 0}deg) scale(1.04)`;
    // scroll when you hold it near the top or bottom
    const vr = view.getBoundingClientRect();
    drag.scroll = e.clientY < vr.top + 70 ? -14 : e.clientY > vr.bottom - 70 ? 14 : 0;
    if (drag.scroll && !drag.scrolling) { drag.scrolling = true; const tickScroll = () => { if (!drag?.scroll) { if (drag) drag.scrolling = false; return; } view.scrollTop += drag.scroll; requestAnimationFrame(tickScroll); }; requestAnimationFrame(tickScroll); }
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".rkcell, .rk");
    if (!over || over === drag.el || over.parentElement !== drag.el.parentElement) return;
    const sib = [...over.parentElement.children], from = sib.indexOf(drag.el), to = sib.indexOf(over);
    flip(over.parentElement, () => over.parentElement.insertBefore(drag.el, from < to ? over.nextSibling : over));
    try { FX.play.move(); } catch {}
  }, { passive: false });
  addEventListener("pointerup", e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    if (!d.started) return;
    swallowClick = true; setTimeout(() => { swallowClick = false; }, 50);
    const r = d.el.getBoundingClientRect(), g = d.ghost;
    g.style.transition = "transform .22s cubic-bezier(.2, .8, .2, 1)";
    g.style.transform = `translate(${r.left - parseFloat(g.style.left)}px, ${r.top - parseFloat(g.style.top)}px)`;
    const order = [...d.el.parentElement.children].map(n => +n.dataset.ri).filter(n => !isNaN(n));
    setTimeout(() => {
      g.remove(); d.el.classList.remove("rk-placeholder");
      const before = state.ranking.slice(), moved = before[+d.el.dataset.ri];
      state.ranking = order.map(i => before[i]);
      const at = state.ranking.indexOf(moved);
      if (at !== +d.el.dataset.ri) { try { FX.play.save(); } catch {} saveRanking(at < 10 ? `${moved} is now #${at + 1}: an all-time favourite.` : `${moved} is now #${at + 1}.`); }
    }, 230);
  });
  addEventListener("click", e => { if (swallowClick) { e.stopPropagation(); e.preventDefault(); swallowClick = false; } }, true);
  // right-click a cover (game or book) for quick changes
  document.addEventListener("contextmenu", e => {
    const c = e.target.closest?.(".case[data-kind], tr[data-kind]");
    if (!c || e.target.closest("#panel, #walk")) { closeCtx(); return; }
    const kind = c.dataset.kind === "book" ? "book" : "game", item = findItem(kind, c.dataset.id);
    if (!item) return;
    e.preventDefault(); hidePeek();
    ctxMenu(item, e.clientX, e.clientY, kind);
  });
  document.addEventListener("click", e => {
    const m = document.getElementById("ctx");
    if (!m) return;
    if (!m.contains(e.target)) return closeCtx();
    const li = e.target.closest("li[data-act], li[data-set], button[data-act]");
    if (li) { e.preventDefault(); e.stopPropagation(); ctxAction(li); }
  }, true);
  document.addEventListener("keydown", e => {
    const m = document.getElementById("ctx");
    if (!m) return;
    if (e.key === "Escape") { e.stopPropagation(); closeCtx(); }
    if (e.key === "Enter" && e.target.closest?.(".ctx-rank")) { e.preventDefault(); ctxAction(m.querySelector('[data-act="rank"]')); }
  }, true);
  view.addEventListener("scroll", closeCtx, { passive: true });
  view.addEventListener("change", e => {
    if (e.target.id === "rankAdd" && e.target.value.trim()) { const n = e.target.value.trim(); if (!state.ranking.some(x => rankKey(x) === rankKey(n))) { state.ranking.push(n); saveRanking(`${n} added at #${state.ranking.length}. Drag it where it belongs.`); } return; }
    if (e.target.id === "scale") applyScale(+e.target.value, true);
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

  view.addEventListener("click", e => {
    const ns = e.target.closest("[data-nsrc]"); if (ns) { newsState.source[state.view] = ns.dataset.nsrc; return paintNews(state.view); }
    if (e.target.closest("#newsRefresh")) return loadNews(state.view, true);
    if (e.target.closest("#redditHelp")) { openSettings(false, "sheet"); setTimeout(() => { const d = [...document.querySelectorAll("#settingsForm details.howto")].find(x => /Reddit/.test(x.textContent)); if (d) { d.open = true; d.scrollIntoView({ block: "center" }); } }, 60); return; }
    if (e.target.closest("#dealsRefresh")) return loadDeals(true);
    if (e.target.closest("#replaySale")) return maybeSaleEvent(true);
    const mon = e.target.closest("[data-money]");
    if (mon) { state.settings.money = mon.dataset.money; api?.set_pref("money", mon.dataset.money); $("#view").innerHTML = dealsHTML(); activateArt($("#view")); return; }
    const rn = e.target.closest("[data-rename]");
    if (rn) { rn.disabled = true; return api?.apply_rename(rn.dataset.rename).then(r => { toast(r?.error || "Renamed.", r?.error ? "err" : "ok"); dealState.data && delete dealState.data.renames[rn.dataset.rename]; sync(true); }); }
    const sp = e.target.closest(".nitem.spoiler"); if (sp) { setTimeout(() => sp.classList.remove("spoiler"), 0); }
  });
  panel.addEventListener("click", e => {
    if (e.target.closest(".close")) return closePanel();
    const t = e.target.closest("[data-ptab]"); if (t) return showPanelTab(t.dataset.ptab);
    const q = e.target.closest("[data-quick]");
    if (q) { const item = findItem(panelItem.kind, panelItem.id); if (item && item.status !== q.dataset.quick) saveEdit(panelItem.kind === "book" ? "books" : "games", item, { status: q.dataset.quick }); return; }
    const o = e.target.closest("[data-open]"); if (o) return openPanel(o.dataset.kind || "game", o.dataset.open);
    if (e.target.closest("#logRun")) return runForm();
    const gt = e.target.closest("[data-g]"); if (gt) return showGallery(+gt.dataset.g, galleryItems[+gt.dataset.g]?.video);
    const gp = e.target.closest("[data-gplay]"); if (gp) return showGallery(+gp.dataset.gplay, true);
    if (e.target.closest("[data-coverpick]")) { e.stopPropagation(); return openCoverPicker(); }
    const nx = e.target.closest("[data-nexus]"); if (nx) { Promise.resolve(api?.nexus_link(nx.dataset.nexus)).then(u => u && api.open_inside(u, `${nx.dataset.nexus} mods`)); return; }
    const cl = e.target.closest("[data-classic]"); if (cl) { const g = findItem("game", cl.dataset.classic); if (g) { setClassic(isClassic(g) ? null : g); showPanelTab("edit"); } return; }
    if (e.target.closest("[data-refresh]")) return refreshGame();
    const dl = e.target.closest("[data-dlcown]"); if (dl) return markDlc(dl.dataset.dlcown);
    const ins = e.target.closest("[data-inside]"); if (ins) { api?.open_inside(ins.dataset.inside, ins.dataset.title || "Masterlog"); return; }
    const tw = e.target.closest("[data-twitch]"); if (tw) return playWatch("twitch", +tw.dataset.twitch);
    const yw = e.target.closest("[data-ytw]"); if (yw) return playWatch("yt", +yw.dataset.ytw);
  });
  panel.addEventListener("submit", e => {
    e.preventDefault();
    const item = findItem(panelItem.kind, panelItem.id);
    if (e.target.id === "editForm") {
      const rf = e.target.elements.top_rank, cat = e.target.dataset.cat;
      const changes = readForm(e.target, cat, item);
      const ranked = rf && cat === "games" ? placeInRanking(item, rf.value === "" ? 0 : Math.max(1, Math.round(+rf.value))) : false;
      if (Object.keys(changes).length) saveEdit(cat, item, changes);
      else if (!ranked) toast("Nothing changed.");
    }
    if (e.target.id === "runFormEl") submitRun(e.target, item);
  });

  document.addEventListener("keydown", e => {
    if (e.key === "F11") { e.preventDefault(); toggleBigPicture(); return; }
    if (e.key === "l" && e.ctrlKey) { e.preventDefault(); Walk.active ? Walk.close() : openWalk(); return; }
    if (e.key === "Escape") { if ($("#panel").classList.contains("open")) closePanel(); return; }
    if (Walk.active && !$("#panel").classList.contains("open")) return;
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
async function markDlc(name) {
  const g = findItem(panelItem?.kind, panelItem?.id);
  if (!g || !api) return;
  const own = !(state.dlcMarks?.[g.name] || {})[name];
  state.dlcMarks = await api.mark_dlc(g.name, name, own);
  if (own && !g.dlc_owned && state.canEdit) { await saveEdit("games", g, { dlc_owned: true }, true); }
  try { FX.play.check(); } catch {}
  showPanelTab("dlc");
}
/* ---------- modpacks from your mod managers ---------- */
async function openModpacks() {
  if (!api) return;
  $("#importForm").innerHTML = `<h2>Modpacks on this PC</h2><div class="news-loading"><span class="spinner"></span> Looking in CurseForge, r2modman, Thunderstore, Vortex, Mod Organizer 2 and Nexus Mods…</div>`;
  $("#importForm")._list = []; $("#importForm")._picked = new Set();
  $("#importDialog").showModal();
  const r = await api.modpacks_scan().catch(() => ({ items: [] }));
  const items = r.items || [];
  $("#importForm")._mods = items;
  $("#importForm").innerHTML = `<h2>Modpacks on this PC</h2>
    <p class="fine">Profiles and modpacks from your mod managers, Nexus Mods collections you installed with Vortex${r.nexus ? ", and the mods you track and endorse on Nexus Mods" : ""}. Add one and it gets its own cover in Modpacks, on Home and in Library.</p>
    ${!r.nexus ? `<p class="fine">Add your free Nexus Mods API key in Settings → Accounts to also see the mods you track and endorse there.</p>` : ""}${r.nexus_app ? `<p class="fine">The Nexus Mods app is installed too. Its loadouts are kept in a database other apps can't read yet, so they aren't listed.</p>` : ""}
    ${items.length ? `<ul class="modlist">${items.map((p, i) => `<li class="${p.manager.startsWith("Nexus") ? "nexus" : ""}"><div><b>${esc(p.name)}</b><small>${esc(p.manager)}${p.mods ? ` · ${p.mods} mods` : ""}${p.detail ? ` · ${esc(p.detail)}` : ""}${p.last ? ` · used ${esc(ago(p.last))}` : ""}</small></div>
      ${p.url ? `<button type="button" class="ghost small" data-url="${esc(p.url)}">On Nexus</button>` : ""}${p.added ? `<span class="owntag">In Masterlog</span>` : `<button type="button" class="primary small" data-addmod="${i}">Add</button>`}</li>`).join("")}</ul>`
      : `<p class="muted">No modpacks found. Masterlog looks in the default folders of CurseForge (Minecraft), r2modman, Thunderstore Mod Manager, Vortex (including its Nexus Mods collections) and Mod Organizer 2.</p>`}
    <div class="row"><span class="spacer"></span><button value="close" class="ghost">Close</button></div>`;
}
async function addModpack(i, btn) {
  const p = $("#importForm")._mods?.[i];
  if (!p) return;
  btn.disabled = true;
  const r = await api.add_modpack(p).catch(e => ({ error: String(e) }));
  if (r.error) { btn.disabled = false; return toast(r.error, "err"); }
  btn.outerHTML = `<span class="owntag">Added</span>`;
  try { FX.play.save(); } catch {}
  toast(`${p.name} added to Modpacks.`, "ok");
  sync(true);
}

/* ---------- Claude, for free: copy a prompt, paste the answer back ---------- */
const CLAUDE_FIELDS = ["status", "priority", "platform", "play_on", "format", "hours", "score", "genre", "developer", "publisher", "notes", "type", "migrate_to", "upgrade", "upgrade_owned", "dlc_owned", "dlc_done", "platinum", "second_chance"];
function claudePrompt(ask) {
  const opts = state.options.games || {};
  const rows = state.games.map(g => [g.name, g.status, g.priority || "", g.platform, g.format || "", g.hours ?? "", g.score ?? "", g.genre || "", g.completed || "", g.type || "", rankOf(g) || ""].join(" | ")).join("\n");
  return `You're helping me manage my game backlog app, Masterlog. My library is below (one game per line).

My request: ${ask}

Answer normally (recommendations, thoughts) for me to read. If my request means changing my library, end your reply with ONE fenced code block labelled masterlog containing JSON like this:
\`\`\`masterlog
{"actions": [
  {"do": "update", "game": "<exact name from my library>", "set": {"status": "Completed", "score": 7, "hours": 10.5}},
  {"do": "add", "game": "<new game's official name>", "set": {"status": "Wishlist", "platform": "Steam", "priority": "High"}},
  {"do": "rank", "game": "<exact name>", "position": 26}
]}
\`\`\`
Rules: use exact names from my library for updates. Fields you may set: ${CLAUDE_FIELDS.join(", ")}.
Allowed values: status ${JSON.stringify(opts.status || ["Library", "Playing", "Paused", "Wishlist", "Completed", "Dropped"])}, priority ${JSON.stringify(opts.priority || ["Extreme", "High", "Medium", "Low"])}, platform ${JSON.stringify(opts.platform || Object.keys(PLAT))}, format ["Digital","Physical"], type ["Live service","Modded"]. Scores are out of 10, hours are numbers. Completion dates fill in automatically. "rank" places a game in my Top 100 (1 = best; the top 10 are my all-time favourites; position 0 removes it). My current Top 100 in order: ${(state.ranking || []).map((n, i) => `${i + 1}. ${n}`).join("; ")}.

My library (name | status | priority | platform | format | hours | score | genre | finished | type | top-100 rank):
${rows}`;
}
function parseClaude(text) {
  const m = /\`\`\`\s*masterlog\s*([\s\S]*?)\`\`\`/i.exec(text) || /\`\`\`(?:json)?\s*(\{[\s\S]*?"actions"[\s\S]*?\})\s*\`\`\`/i.exec(text);
  if (!m) return { actions: [], say: text.trim() };
  let data;
  try { data = JSON.parse(m[1]); } catch { return { error: "Claude's change list isn't valid JSON. Ask Claude to send the masterlog block again." }; }
  const actions = (data.actions || []).filter(a => a && (a.do === "update" || a.do === "add" || a.do === "rank") && a.game).map(a => {
    if (a.do === "rank") return { ...a, set: { position: +a.position || 0 }, ok: true };
    const set = {};
    for (const [k, v] of Object.entries(a.set || {})) if (CLAUDE_FIELDS.includes(k)) set[k] = v;
    const g = a.do === "update" ? state.games.find(x => x.name.toLowerCase() === String(a.game).toLowerCase()) : null;
    return { ...a, set, target: g, ok: a.do === "add" || !!g };
  });
  return { actions, say: text.replace(m[0], "").trim() };
}
function claudePreview() {
  const r = parseClaude($("#claudeReply").value || "");
  const box = $("#claudePreview");
  $("#claudeApply").disabled = !(r.actions || []).some(a => a.ok);
  if (r.error) { box.innerHTML = `<p class="nerr">${esc(r.error)}</p>`; return r; }
  if (!r.actions.length) { box.innerHTML = $("#claudeReply").value.trim() ? `<p class="muted">No library changes in this answer.</p>` : ""; return r; }
  box.innerHTML = `<h3>Changes Claude suggests</h3><ul class="claudeacts">${r.actions.map(a => `<li class="${a.ok ? "" : "bad"}"><b>${a.do === "add" ? "Add" : a.do === "rank" ? (a.set.position ? `Rank #${a.set.position}:` : "Remove from Top 100:") : "Update"} ${esc(a.game)}</b>
    <span>${Object.entries(a.set).map(([k, v]) => `${esc(k.replace(/_/g, " "))}: ${esc(v)}`).join(" · ") || "—"}</span>${a.ok ? "" : `<small>Not in your library, skipped</small>`}</li>`).join("")}</ul>`;
  return r;
}
async function claudeApply() {
  const r = claudePreview();
  const acts = (r.actions || []).filter(a => a.ok);
  if (!acts.length) return;
  $("#claudeApply").disabled = true;
  let done = 0;
  for (const a of acts) {
    if (a.do === "rank") {
      const L = state.ranking, k = rankKey(a.game), at = L.findIndex(n => rankKey(n) === k);
      const name = at >= 0 ? L.splice(at, 1)[0] : a.game;
      if (a.set.position > 0) L.splice(Math.min(a.set.position - 1, L.length), 0, name);
      saveRanking(); done++; continue;
    }
    const res = a.do === "add" ? await api.add("games", { name: a.game, status: "Library", format: "Digital", ...a.set }).catch(e => ({ error: String(e) }))
      : await api.edit("games", a.target.row, a.target.name, a.set).catch(e => ({ error: String(e) }));
    if (res && !res.error) done++;
  }
  try { FX.play.save(); } catch {}
  toast(`Applied ${done} of ${acts.length} change${acts.length === 1 ? "" : "s"} from Claude.`, done === acts.length ? "ok" : "err");
  $("#claudeDialog").close(); $("#claudeReply").value = ""; $("#claudePreview").innerHTML = "";
  sync(true);
}

/* ---------- right-click a cover: quick changes right where you are ---------- */
function ctxMenu(g, x, y, kind = "game") {
  closeCtx();
  if (kind === "book") return bookCtxMenu(g, x, y);
  const edit = state.canEdit ? "" : " disabled";
  const sub = (label, key, values, current, fmt = v => v) => `<li class="has-sub" role="menuitem" tabindex="-1"><span>${label}</span><i>›</i><ul class="sub" role="menu">${values.map(v =>
    `<li role="menuitemradio" tabindex="-1" aria-checked="${(current ?? "") === v}" data-set="${key}" data-val="${esc(v)}"${edit}>${esc(fmt(v))}</li>`).join("")}</ul></li>`;
  const opts = (k, d) => state.options.games?.[k]?.length ? state.options.games[k] : d;
  const genres = splitList(g.genre), studios = [...new Set(splitList(`${g.developer},${g.publisher}`))];
  const rk = rankOf(g);
  const m = document.createElement("div");
  m.id = "ctx"; m.className = "ctx"; m.setAttribute("role", "menu"); m.dataset.id = g.id; m.dataset.kind = "game";
  m.innerHTML = `<div class="ctx-head">${esc(g.name)}</div><ul>
    <li role="menuitem" tabindex="-1" data-act="open">Open</li>
    ${sub("Status", "status", opts("status", ["Library", "Playing", "Paused", "Wishlist", "Completed", "Dropped"]), g.status)}
    ${sub("Priority", "priority", [...opts("priority", ["Extreme", "High", "Medium", "Low"]), ""], g.priority, v => v || "No priority")}
    ${sub("Platform", "platform", opts("platform", Object.keys(PLAT)), g.platform, v => plat(v).label)}
    ${sub("Format", "format", ["Physical", "Digital"], g.format)}
    ${sub("Type", "type", ["", "Live service", "Modded"], g.type || "", v => v || "Normal game")}
    ${state.canEdit ? `<li role="menuitem" tabindex="-1" data-act="classic" class="ctx-classic">${isClassic(g) ? "Remove All Time Classic" : "Crown as All Time Classic"}</li>` : ""}
    <li role="menuitem" tabindex="-1" class="ctx-rank"><span>Top 100</span><input type="number" min="1" max="${(state.ranking || []).length + 1}" value="${rk || ""}" placeholder="place" aria-label="Top 100 place"><button type="button" data-act="rank">Set</button></li>
    <li class="sep" role="separator"></li>
    ${genres.length ? `<li role="menuitem" tabindex="-1" data-act="genre">Similar genre <small>${esc(genres.slice(0, 3).join(", "))}</small></li>` : ""}
    ${g.developer ? `<li role="menuitem" tabindex="-1" data-act="dev">More by ${esc(g.developer)}</li>` : ""}
    ${g.publisher && g.publisher !== g.developer ? `<li role="menuitem" tabindex="-1" data-act="pub">More from ${esc(g.publisher)}</li>` : ""}
    <li class="sep" role="separator"></li>
    <li role="menuitem" tabindex="-1" data-act="cover">Change cover…</li>
    <li role="menuitem" tabindex="-1" data-act="refresh">Refresh info</li>
    ${state.canEdit && !g.virtual ? `<li class="sep" role="separator"></li><li role="menuitem" tabindex="-1" data-act="delete" class="ctx-danger">${g.status === "Wishlist" ? "Remove from wishlist…" : "Delete from Masterlog…"}</li>` : ""}
  </ul>`;
  placeCtx(m, x, y);
}
const ctxSub = (label, key, values, current, fmt = v => v) => `<li class="has-sub" role="menuitem" tabindex="-1"><span>${label}</span><i>›</i><ul class="sub" role="menu">${values.map(v =>
  `<li role="menuitemradio" tabindex="-1" aria-checked="${(current ?? "") === v}" data-set="${key}" data-val="${esc(v)}"${state.canEdit ? "" : " disabled"}>${esc(fmt(v))}</li>`).join("")}</ul></li>`;
function bookCtxMenu(b, x, y) {
  const o = (k, d) => state.options.books?.[k]?.length ? state.options.books[k] : d;
  const inSeries = b.series ? state.books.filter(x => x.series === b.series).length : 0;
  const byAuthor = b.author ? state.books.filter(x => x.author === b.author).length : 0;
  const m = document.createElement("div");
  m.id = "ctx"; m.className = "ctx"; m.setAttribute("role", "menu"); m.dataset.id = b.id; m.dataset.kind = "book";
  m.innerHTML = `<div class="ctx-head">${esc(b.name)}${b.author ? `<small>${esc(b.author)}</small>` : ""}</div><ul>
    <li role="menuitem" tabindex="-1" data-act="open">Open</li>
    ${ctxSub("Status", "status", o("status", FALLBACK_OPTIONS.books.status), b.status)}
    ${ctxSub("Priority", "priority", [...o("priority", FALLBACK_OPTIONS.books.priority), ""], b.priority, v => v || "No priority")}
    ${ctxSub("Format", "format", o("format", FALLBACK_OPTIONS.books.format), b.format)}
    <li class="sep" role="separator"></li>
    ${byAuthor > 1 ? `<li role="menuitem" tabindex="-1" data-act="author">More by ${esc(b.author)} <small>${byAuthor} books</small></li>` : ""}
    ${inSeries > 1 ? `<li role="menuitem" tabindex="-1" data-act="series">The rest of ${esc(b.series)} <small>${inSeries} books</small></li>` : ""}
    ${byAuthor > 1 || inSeries > 1 ? `<li class="sep" role="separator"></li>` : ""}
    <li role="menuitem" tabindex="-1" data-act="cover">Change cover…</li>
    <li role="menuitem" tabindex="-1" data-act="refresh">Refresh info</li>
    ${state.canEdit ? `<li class="sep" role="separator"></li><li role="menuitem" tabindex="-1" data-act="delete" class="ctx-danger">Delete from Masterlog…</li>` : ""}
  </ul>`;
  placeCtx(m, x, y);
}
function placeCtx(m, x, y) {
  document.body.append(m);
  // keep it on screen, and open submenus to whichever side has room
  const r = m.getBoundingClientRect();
  const left = Math.min(x, innerWidth - r.width - 8), top = Math.min(y, innerHeight - r.height - 8);
  m.style.left = `${Math.max(8, left)}px`; m.style.top = `${Math.max(8, top)}px`;
  if (left + r.width * 2 > innerWidth) m.classList.add("flip");
  try { FX.play.tab(); } catch {}
  m.querySelector("li[data-act]")?.focus();
}
function closeCtx() { document.getElementById("ctx")?.remove(); }
async function ctxAction(li) {
  const m = document.getElementById("ctx");
  if (m?.dataset.kind === "book") return bookCtxAction(li, m);
  const g = findItem("game", m?.dataset.id);
  if (!g || li.hasAttribute("disabled")) return;
  const act = li.dataset.act;
  if (li.dataset.set) {
    const k = li.dataset.set, v = li.dataset.val;
    closeCtx();
    if ((g[k] ?? "") === v) return;
    const target = g.virtual ? state.games.find(x => x.row === g.row) : g;
    await saveEdit("games", target, { [k]: v }, true);
    toast(`${g.name}: ${k.replace("_", " ")} set to ${v || "none"}.`, "ok");
    return;
  }
  if (act === "delete") { if (!armDelete(li, g)) return; closeCtx(); return deleteItem("games", g); }
  if (act === "rank") { const v = m.querySelector(".ctx-rank input").value; closeCtx(); placeInRanking(g, v === "" ? 0 : Math.max(1, Math.round(+v))); return render(); }
  closeCtx();
  if (act === "open") return openPanel("game", g.id);
  if (act === "classic") return setClassic(isClassic(g) ? null : (g.virtual ? state.games.find(x => x.row === g.row) || g : g));
  if (act === "cover") { panelItem = { kind: "game", id: g.id }; coverFor = null; return openCoverPicker(); }
  if (act === "refresh") { openPanel("game", g.id); return refreshGame(); }
  if (act === "genre" || act === "dev" || act === "pub") {
    const vals = act === "genre" ? splitList(g.genre) : splitList(act === "dev" ? g.developer : g.publisher);
    state.filter = { q: "", status: new Set(), plats: new Set(), playOn: "All", prio: new Set(), formats: new Set(), sort: "priority",
      genre: act === "genre" ? vals : null, studio: act !== "genre" ? vals : null };
    if (state.catalog !== "games") switchCatalog("games");
    return go("library");
  }
}

/* fetch everything about a game again, in case something came out wrong */
async function bookCtxAction(li, m) {
  const b = findItem("book", m.dataset.id);
  if (!b || li.hasAttribute("disabled")) return;
  const act = li.dataset.act;
  if (act === "delete") { if (!armDelete(li, b)) return; closeCtx(); return deleteItem("books", b); }
  closeCtx();
  if (li.dataset.set) {
    const k = li.dataset.set, v = li.dataset.val;
    if ((b[k] ?? "") === v) return;
    const changes = { [k]: v };
    if (k === "status" && v === "Read" && !b.finished) changes.finished = new Date().toISOString().slice(0, 10);
    await saveEdit("books", b, changes, true);
    return toast(`${b.name}: ${k} set to ${v || "none"}.`, "ok");
  }
  if (act === "open") return openPanel("book", b.id);
  if (act === "cover") { panelItem = { kind: "book", id: b.id }; coverFor = null; return openCoverPicker(); }
  if (act === "refresh") { openPanel("book", b.id); return refreshGame(); }
  if (act === "author" || act === "series") {
    state.bfilter = { ...freshBookFilter(), sort: act === "series" ? "series" : "author", [act]: act === "author" ? b.author : b.series };
    if (state.catalog !== "books") switchCatalog("books");
    return go("books");
  }
}
/* deleting asks twice in the menu itself (no pop-up), then offers Undo */
function armDelete(li, item) {
  if (li.dataset.armed) return true;
  li.dataset.armed = "1";
  li.classList.add("armed");
  li.textContent = `Click again to delete "${item.name}"`;
  try { FX.play.tab(); } catch {}
  return false;
}
async function deleteItem(tab, item) {
  const list = tab === "books" ? state.books : state.games;
  const at = list.indexOf(item);
  if (at < 0) return;
  list.splice(at, 1);
  if (panelItem && findItem(panelItem.kind, panelItem.id) == null) closePanel();
  if (panelItem && panelItem.id === item.id && panelItem.kind === (tab === "books" ? "book" : "game")) closePanel();
  rankIndex = null; virtualKey = null;
  render();
  const r = await Promise.resolve(api?.delete_item(tab, item.row, item.name)).catch(e => ({ error: String(e) }));
  if (!r || r.error) {
    list.splice(at, 0, item); rankIndex = null; render();
    return toast(`Couldn't delete: ${r?.error || "no connection"}`, "err");
  }
  try { FX.play.back(); } catch {}
  toast(`Deleted ${item.name}.`, "ok", { label: "Undo", run: async () => {
    const u = await Promise.resolve(api.undo_delete(r.undo)).catch(e => ({ error: String(e) }));
    if (u?.error) toast(`Couldn't put it back: ${u.error}`, "err"); else { toast(`${item.name} is back.`, "ok"); sync(true); }
  } });
  setTimeout(() => sync(false), 2500);
}
async function refreshGame() {
  const g = findItem(panelItem?.kind, panelItem?.id);
  if (!g || !api) return;
  toast(`Fetching ${g.name} again…`);
  if (panelItem.kind === "book") {
    const r = await api.refresh_book(g).catch(() => null);
    covers.set(coverKey(g), r?.uri || null);
    closePanel(); render(); openPanel("book", g.id, "overview");
    return toast(`${g.name} refreshed.`, "ok");
  }
  const r = await api.refresh_game(g).catch(() => null);
  if (r?.renamed) {
    toast(`"${g.name}" is officially "${r.renamed}" (${r.source}). Renamed so its info can be found.`, "ok", { label: "Undo", run: async () => { await api.undo_rename(g.name, r.renamed, r.row); sync(true); } });
    await sync(true);
    const ng = state.games.find(x => x.name === r.renamed);
    if (ng) { closePanel(); render(); openPanel("game", ng.id, "overview"); }
    return;
  }
  covers.delete(coverKey(g));
  const uri = await api.cover(g.name, g.platform || "").catch(() => null);
  covers.set(coverKey(g), uri || null);
  closePanel(); render(); openPanel("game", g.id, "overview");
  toast(`${g.name} refreshed.`, "ok");
}

/* ---------- choosing a cover inside the app ---------- */
let coverFor = null;
async function openCoverPicker(query = "") {
  const g = coverFor && query ? coverFor : findItem(panelItem.kind, panelItem.id);
  if (!g || !api) return;
  coverFor = g;
  $("#coverTitle").textContent = `Cover for ${g.name}`;
  $("#coverQuery").value = query || "";
  $("#coverQuery").placeholder = `Search a different name than "${g.name}"`;
  const grid = $("#coverGrid");
  const isBook = g.author !== undefined;
  grid.innerHTML = `<div class="g-empty"><span class="spinner"></span> Looking in ${isBook ? "Open Library and Google Books" : "Steam, PlayStation Store, IGDB and SteamGridDB"}…</div>`;
  if (!$("#coverDialog").open) $("#coverDialog").showModal();
  const r = await (isBook ? api.book_cover_options(g, query) : api.cover_options(g.name, g.platform || "", query)).catch(e => ({ items: [], error: String(e) }));
  if (coverFor !== g) return;
  const items = r.items || [];
  grid.innerHTML = items.length
    ? items.map((c, i) => `<button type="button" class="covercand" role="listitem" data-cand="${i}" title="${esc(c.source)}${c.note ? ` · ${esc(c.note)}` : ""}"><img alt="" loading="lazy" decoding="async" src="${esc(c.thumb)}"><span class="src ${c.source === "SteamGridDB" ? "" : "official"}">${esc(c.source)}</span></button>`).join("")
    : `<p class="muted">No covers found${r.error ? ` (${esc(r.error)})` : ""}. ${isBook ? "Try the title as it's printed, or choose an image file." : "Try a different name, or add a SteamGridDB key or IGDB in Settings for more choices."}</p>`;
  grid._items = items;
}
async function pickCover(i) {
  const g = coverFor, c = $("#coverGrid")._items?.[i];
  if (!g || !c) return;
  const btn = document.querySelector(`[data-cand="${i}"]`); btn?.classList.add("busy");
  const r = await (g.author !== undefined ? api.pick_book_cover(g, c.url) : api.pick_cover(g.name, c.url)).catch(e => ({ error: String(e) }));
  btn?.classList.remove("busy");
  if (r.error) return toast(r.error, "err");
  coverChanged(g, r.uri, `New cover from ${c.source}.`);
}
async function customCover(set) {
  const g = coverFor || findItem(panelItem.kind, panelItem.id);
  if (!g) return;
  const isBook = g.author !== undefined;
  const res = await Promise.resolve(isBook ? (set ? api?.set_book_cover(g) : api?.clear_book_cover(g)) : set ? api?.set_cover(g.name) : api?.clear_cover(g.name)).catch(e => ({ error: String(e) }));
  if (res && res.error) return toast(res.error, "err");
  if (set && !res) return;
  if (!set) { covers.delete(coverKey(g)); const uri = isBook ? res : await api.cover(g.name, g.platform || ""); return coverChanged(g, uri, "Back to the automatic cover."); }
  coverChanged(g, res, "Cover updated.");
}
function coverChanged(g, uri, msg) {
  covers.set(coverKey(g), uri || null);
  if (uri && panelItem && findItem(panelItem.kind, panelItem.id) === g) $("#panel").querySelectorAll(".opencase img").forEach(img => { img.src = uri; });
  if ($("#coverDialog").open) $("#coverDialog").close();
  try { FX.play.save(); } catch {}
  render();
  toast(msg, "ok");
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
  if (cat === "news") $("#newsDot").hidden = true;
  state.catalog = cat;
  state.view = cat === "books" ? "shelf" : cat === "news" ? "leaks" : "home";
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
      const walking = Walk.active && !$("#panel").classList.contains("open");
      const press = (i, fn) => { const on = pad.buttons[i]?.pressed; if (on && !held[i] && !walking) fn(); held[i] = on; };
      press(12, () => move("u")); press(13, () => move("d")); press(14, () => move("l")); press(15, () => move("r"));
      press(0, () => document.activeElement?.click());
      press(1, () => closePanel());
      press(4, () => cycleTab(-1)); press(5, () => cycleTab(1));
      press(8, () => switchCatalog(isBooks() ? "games" : "books"));
      press(9, toggleBigPicture);
      const [x, y] = pad.axes;
      const stick = Math.abs(x) > 0.6 ? (x > 0 ? "r" : "l") : Math.abs(y) > 0.6 ? (y > 0 ? "d" : "u") : null;
      if (stick && !held.stick && !walking) move(stick);
      held.stick = stick;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- Deals, prices and countdowns ---------- */
const dealState = { data: null, loading: false, t: 0 };
const PS_CUR = { "en-us": "USD", "en-gb": "GBP", "en-tr": "TRY", "tr-tr": "TRY", "en-ua": "UAH", "uk-ua": "UAH", "en-pl": "PLN", "pl-pl": "PLN",
  "de-de": "EUR", "en-ie": "EUR", "en-cy": "EUR", "en-gr": "EUR", "en-in": "INR", "en-ca": "CAD", "en-au": "AUD", "ru-ru": "RUB", "en-ae": "USD" };
function num(str) {
  const t = String(str || "").replace(/[^\d.,]/g, "");
  if (!t) return null;
  const lastC = t.lastIndexOf(","), lastD = t.lastIndexOf(".");
  const dec = lastC > lastD && t.length - lastC <= 3 ? "," : ".";
  const v = parseFloat(dec === "," ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, ""));
  return isNaN(v) ? null : v;
}
function money(amount, cur) {
  if (amount == null) return "";
  const rates = dealState.data?.rates?.rates || {};
  if (state.settings.money === "GEL" && rates[cur]) return `₾${(amount * rates[cur]).toFixed(2)}`;
  if (amount === 0) return "Free";
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur || "USD", maximumFractionDigits: 2 }).format(amount); }
  catch { return `${amount.toFixed(2)} ${cur || ""}`; }
}
function inGEL(amount, cur) { const r = dealState.data?.rates?.rates || {}; return amount == null ? null : r[cur] ? amount * r[cur] : cur === "USD" ? amount * 2.6 : null; }
function countdown(ts) {
  const sec = ts - Date.now() / 1000;
  if (sec <= 0) return "now";
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
/* every place you could buy it, cheapest first */
function offersFor(name) {
  const e = dealState.data?.games?.[name];
  if (!e) return [];
  const out = [];
  if (e.steam) out.push({ store: "Steam", price: e.steam.final, was: e.steam.initial, cur: e.steam.currency, off: e.steam.discount, ends: e.steam_ends,
    url: e.appid ? `https://store.steampowered.com/app/${e.appid}` : "", region: true });
  for (const d of e.stores?.deals || []) {
    if (d.store === "Steam" && e.steam) continue;  // your regional Steam price beats CheapShark's U.S. one
    out.push({ store: d.store, price: d.price, was: d.retail, cur: "USD", off: d.savings, url: d.url });
  }
  if (e.eshop && e.eshop.initial) out.push({ store: "Nintendo eShop", price: e.eshop.final, was: e.eshop.initial, cur: e.eshop.currency, off: e.eshop.discount, ends: e.eshop.ends, url: e.eshop_url || "" });
  if (e.ebay && e.ebay.price) out.push({ store: `eBay${e.ebay.condition ? ` (${e.ebay.condition.toLowerCase()})` : ""}`, price: e.ebay.price + (e.ebay.shipping || 0), cur: e.ebay.currency, off: 0, url: e.ebay.url, note: e.ebay.shipping ? "incl. shipping" : "" });
  if (e.ps && e.ps.final) {
    const cur = PS_CUR[state.settings.ps_locale || "en-us"] || "USD";
    const f = /free/i.test(e.ps.final) ? 0 : num(e.ps.final), b = num(e.ps.base);
    if (f != null) out.push({ store: "PlayStation Store", price: f, was: b, cur, off: e.ps.discount ? Math.abs(parseInt(e.ps.discount, 10)) || (b ? Math.round(100 - f / b * 100) : 0) : 0, ends: e.ps.ends, url: e.ps.url });
  }
  return out.sort((a, b) => (inGEL(a.price, a.cur) ?? 1e9) - (inGEL(b.price, b.cur) ?? 1e9));
}
function priceTag(g) {
  const o = offersFor(g.name), e = dealState.data?.games?.[g.name];
  const rel = e?.release;
  if (rel?.coming && rel.ts && rel.ts > Date.now() / 1000) return `<span class="pricetag soon" title="Releases ${esc(rel.text || "")}">${countdown(rel.ts)}</span>`;
  if (!o.length) return "";
  const best = o[0];
  return best.off > 0 ? `<span class="pricetag sale" title="${esc(best.store)}"><b>-${best.off}%</b>${esc(money(best.price, best.cur))}</span>`
    : `<span class="pricetag" title="${esc(best.store)}">${esc(money(best.price, best.cur))}</span>`;
}
async function loadDeals(force) {
  if (!api || dealState.loading) return;
  if (!force && dealState.data && Date.now() - dealState.t < 60 * 1000 && !dealState.data.running) return;
  dealState.loading = true;
  try { dealState.data = await api.deals(!!force); dealState.t = Date.now(); } catch {}
  dealState.loading = false;
  maybeSaleEvent();
  if (state.catalog === "games" && (state.view === "deals" || state.view === "wishlist" || state.view === "home")) {
    if (state.view === "deals") { $("#view").innerHTML = dealsHTML(); activateArt($("#view")); }
    else render();
  }
  if (dealState.data?.running) setTimeout(() => loadDeals(false), 15000);
}
function saleBanner() {
  const s = dealState.data?.sale;
  if (!s) return "";
  return s.live
    ? `<div class="salebanner live"><div><b>${esc(s.name)} is on</b><span>Ends in ${countdown(s.end)} · ${new Date(s.end * 1000).toLocaleDateString(undefined, { month: "long", day: "numeric" })}</span></div><button class="ghost small" id="replaySale">Replay the intro</button></div>`
    : `<div class="salebanner"><div><b>Next big sale: ${esc(s.name)}</b><span>Starts in ${countdown(s.start)} · ${new Date(s.start * 1000).toLocaleDateString(undefined, { month: "long", day: "numeric" })}, until ${new Date(s.end * 1000).toLocaleDateString(undefined, { month: "long", day: "numeric" })}</span></div></div>`;
}
function dealCard(g) {
  const o = offersFor(g.name), best = o[0], e = dealState.data?.games?.[g.name] || {};
  const low = e.stores?.low;
  const alts = o.slice(1, 6).map(x => `<li data-url="${esc(x.url)}"><span>${esc(x.store)}${x.note ? ` <small>${esc(x.note)}</small>` : ""}</span><span>${x.off > 0 ? `<i>-${x.off}%</i> ` : ""}${esc(money(x.price, x.cur))}</span></li>`).join("");
  const ends = best?.ends ? `<span class="ends">Sale ends in ${countdown(best.ends)}</span>` : "";
  const rel = e.release?.coming ? `<span class="ends">${e.release.ts ? `Out in ${countdown(e.release.ts)}` : esc(e.release.text || "Coming soon")}</span>` : "";
  return `<article class="dealcard">
    ${caseHTML(g, { noLabel: true })}
    <div class="dbody"><h3>${esc(g.name)}</h3><p class="muted">${esc(plat(g.platform).label)}${g.format === "Physical" ? " · physical" : ""}</p>
      ${best ? `<div class="best" data-url="${esc(best.url)}"><span class="store">${esc(best.store)}${best.region ? " · your region" : ""}</span>
        <span class="now">${best.off > 0 ? `<b>-${best.off}%</b>` : ""}${esc(money(best.price, best.cur))}</span>${best.off > 0 && best.was ? `<s>${esc(money(best.was, best.cur))}</s>` : ""}</div>` : `<p class="muted">No store price yet.</p>`}
      ${ends}${rel}${low != null ? `<span class="low">All-time low ${esc(money(low, "USD"))}</span>` : ""}
      ${alts ? `<ul class="alts">${alts}</ul>` : ""}
      ${(dealState.data?.links?.[g.name] || []).map(l => `<button class="linkish" data-url="${esc(l.url)}">Search ${esc(l.store)}</button>`).join(" ")}
    </div></article>`;
}
function dealsHTML() {
  const d = dealState.data;
  const wish = state.games.filter(g => g.status === "Wishlist");
  const toggle = `<div class="seg" role="group" aria-label="Currency"><button data-money="native" aria-pressed="${state.settings.money !== "GEL"}">Store prices</button><button data-money="GEL" aria-pressed="${state.settings.money === "GEL"}">₾ GEL</button></div>`;
  const head = `<header class="deals-head"><div><h1>Deals</h1><p class="muted">Your wishlist across Steam (your region), GOG, Humble, Fanatical, Epic and more, the PlayStation Store, and the deal subreddits. ${d?.rates?.date ? `GEL at the ${esc(d.rates.source)} rate of ${new Date(d.rates.date).toLocaleDateString()}.` : ""}</p></div>
    <div class="deals-actions">${toggle}<button class="ghost small" id="dealsRefresh">${d?.running ? `<span class="spinner"></span> Checking prices…` : "Check prices now"}</button></div></header>`;
  if (!d) return `<section class="deals">${head}<div class="news-loading"><span class="spinner"></span> Checking prices for your wishlist…</div></section>`;
  const onSale = wish.filter(g => offersFor(g.name).some(o => o.off > 0));
  const soon = wish.filter(g => d.games[g.name]?.release?.coming).sort((a, b) => (d.games[a.name].release.ts || 9e12) - (d.games[b.name].release.ts || 9e12));
  const waiting = wish.filter(g => !onSale.includes(g) && !soon.includes(g) && offersFor(g.name).length);
  const renames = Object.entries(d.renames || {}).map(([old, h]) => `<li>${esc(old)} → <b>${esc(h.name)}</b> <small>(${h.suggest ? `spotted in ${esc(h.source)}, not on a store yet` : esc(h.source)})</small> <button class="ghost small" data-rename="${esc(old)}">Rename</button></li>`).join("");
  const subs = (d.subs || []).slice(0, 30).map(p => `<article class="nitem" data-url="${esc(p.url)}" tabindex="0">${p.thumb ? `<div class="nthumb"><img alt="" loading="lazy" referrerpolicy="no-referrer" src="${esc(p.thumb)}" onerror="this.parentNode.classList.add('none')"></div>` : ""}
      <div class="ntext"><div class="ntags"><span class="ngame">${esc(p.game)}</span>${p.owned ? `<span>You own it</span>` : ""}${p.flair ? `<span class="nflair">${esc(p.flair)}</span>` : ""}</div><h3>${esc(p.title)}</h3>
      <div class="nmeta"><span class="nsrc">${esc(p.source)}</span><span>${esc(ago(p.date))}</span>${p.domain ? `<span>${esc(p.domain)}</span>` : ""}</div>${p.link ? `<button class="linkish" data-url="${esc(p.link)}">Go to the deal</button>` : ""}</div></article>`).join("");
  const dlc = (d.dlc || []).map(x => `<li data-url="${esc(x.url)}">${x.art ? `<img alt="" loading="lazy" src="${esc(x.art)}">` : ""}<div><b>${esc(x.name)}</b><small>${esc(x.game || "")}${x.wishlisted ? " · on your Steam wishlist" : ""}</small>${x.alt ? `<small class="altstore" data-url="${esc(x.alt.url)}">Cheaper at ${esc(x.alt.store)}: ${esc(money(x.alt.price, "USD"))}</small>` : ""}</div><span><i>-${x.price.discount}%</i> ${esc(money(x.price.final, x.price.currency))}</span></li>`).join("");
  const bundles = (d.bundles || []).map(b => `<li data-url="${esc(b.url)}"><div><b>${esc(b.name)}</b><small>${esc(b.store)} · has ${esc(b.game)}${b.owned ? " (you own it)" : ""}${b.count ? ` · ${b.count} items` : ""}${b.ends ? ` · ends in ${countdown(b.ends)}` : ""}</small></div><span class="ghost small">Open</span></li>`).join("");
  const sec = (title, sub, list) => list.length ? `<section class="dsec"><h2>${title}</h2>${sub ? `<p class="muted">${sub}</p>` : ""}<div class="dgrid">${list.map(dealCard).join("")}</div></section>` : "";
  return `<section class="deals">${head}${saleBanner()}
    ${renames ? `<section class="dsec"><h2>Official titles found</h2><ul class="renames">${renames}</ul></section>` : ""}
    ${sec("On sale now", "Cheapest place first. Prices from stores other than Steam and PlayStation are in U.S. dollars.", onSale)}
    ${sec("Coming out", "Counting down to release.", soon)}
    ${dlc ? `<section class="dsec"><h2>DLC on sale</h2><p class="muted">For your Steam games and DLC on your Steam wishlist, minus DLC you've marked as owned.</p><ul class="dlcsale">${dlc}</ul></section>` : ""}
    ${bundles ? `<section class="dsec"><h2>In a bundle right now</h2><p class="muted">Humble Bundle and Fanatical bundles that include a game on your wishlist (or DLC territory for games you own).</p><ul class="dlcsale bundles">${bundles}</ul></section>` : ""}
    ${subs ? `<section class="dsec"><h2>Spotted on the deal subreddits</h2><p class="muted">r/GameDeals, r/PS5Deals, r/PS4Deals, r/NintendoSwitchDeals and r/FreeGameFindings: wishlist games, and DLC or editions for games you own. Amazon and eBay deals usually show up here.</p><div class="news-grid">${subs}</div></section>` : ""}
    ${sec("Waiting for a sale", d.sale && !d.sale.live ? `Full price for now. The ${esc(d.sale.name)} starts in ${countdown(d.sale.start)}.` : "Full price for now.", waiting)}
    ${!onSale.length && !soon.length && !waiting.length && !d.running ? `<p class="muted">No prices yet. Wishlist games need a Steam, PlayStation Store or PC store listing to be priced.</p>` : ""}
  </section>`;
}
/* the big seasonal Steam sale: a one-time celebration when it starts */
function maybeSaleEvent(force) {
  const s = dealState.data?.sale;
  if (!s || !s.live) return;
  if (!force && uiGet("sale_seen") === s.id) return;
  uiSet("sale_seen", s.id);
  const el = document.createElement("div");
  el.className = "saleevent"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", s.name);
  const tags = Array.from({ length: 34 }, (_, i) => `<i style="--x:${Math.random() * 100}%;--d:${(Math.random() * 2.4).toFixed(2)}s;--r:${Math.round(Math.random() * 60 - 30)}deg;--s:${(0.7 + Math.random() * 0.8).toFixed(2)}">-${[10, 20, 25, 33, 40, 50, 60, 67, 75, 80, 90][i % 11]}%</i>`).join("");
  el.innerHTML = `<div class="rain">${tags}</div><div class="sale-card"><small>It's here</small><h1>${esc(s.name)}</h1>
    <p>Until ${new Date(s.end * 1000).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} · ends in ${countdown(s.end)}</p>
    <button class="primary" id="saleGo">See what's on sale</button><button class="ghost" id="saleClose">Later</button></div>`;
  document.body.append(el);
  try { FX.play.notify(); setTimeout(() => FX.play.save(), 420); } catch {}
  requestAnimationFrame(() => el.classList.add("in"));
  const close = () => { el.classList.add("out"); setTimeout(() => el.remove(), 600); };
  el.querySelector("#saleClose").addEventListener("click", close);
  el.querySelector("#saleGo").addEventListener("click", () => { close(); if (state.catalog !== "games") switchCatalog("games"); go("deals"); });
  el.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  el.querySelector("#saleGo").focus();
}
async function pollRenames() {
  if (!api) return;
  let list = [];
  try { list = await api.renamed(); } catch {}
  for (const r of list || []) {
    toast(`Official title: "${r.old}" is now "${r.new}" (from ${r.source}).`, "ok", { label: "Undo", run: async () => {
      const res = await api.undo_rename(r.old, r.new, r.row);
      toast(res?.error ? res.error : `Back to "${r.old}".`, res?.error ? "err" : "ok"); sync(true);
    } });
    sync(true);
  }
}

/* ---------- What's New on Home, like Steam's: updates and events for the games you have ---------- */
async function fillWhatsNew() {
  const box = $("#whatsNew");
  if (!box || !api) return;
  let d = newsState.data.yours;
  if (!d || Date.now() - d.t > 10 * 60 * 1000) {
    try { d = { ...(await api.news_section("yours")), t: Date.now() }; newsState.data.yours = d; } catch { return; }
  }
  if (!$("#whatsNew")) return;
  const cutoff = Date.now() / 1000 - 21 * 86400;
  const rank = { major: 0, release: 0, update: 1, minor: 2, news: 3 };
  const seen = new Set();
  const items = (d.items || []).filter(i => (i.date >= cutoff || i.upcoming) && (i.kind !== "news" || i.thumb) && i.status !== "Wishlist")
    .sort((a, b) => (rank[a.kind] ?? 3) - (rank[b.kind] ?? 3) || b.date - a.date)
    .filter(i => { if (seen.has(i.game + i.kind)) return false; seen.add(i.game + i.kind); return true; }).slice(0, 10)
    .sort((a, b) => (b.upcoming ? b.start : b.date) - (a.upcoming ? a.start : a.date));
  if (!items.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<div class="wn-head"><h2>What's new</h2><button class="ghost small" data-catalog-go="news">All updates</button></div>
    <div class="wn-row">${items.map(i => `<article class="wn" data-url="${esc(i.url || "")}" tabindex="0">
      <div class="wn-art">${i.thumb ? `<img alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${esc(i.thumb)}">` : `<span>${esc(i.game)}</span>`}</div>
      <div class="wn-text"><span class="wn-kind k-${esc(i.kind || "news")}">${esc(KIND_LABEL[i.kind] || "News")}</span><h3>${esc(i.title)}</h3>
      <small>${esc(i.game)} · ${esc(i.upcoming && i.start ? `starts ${fmtDateTime(i.start)}` : ago(i.date))}</small></div></article>`).join("")}</div>`;
}

/* ---------- News ---------- */
const NEWS_INFO = {
  leaks: "Newest posts from r/GamingLeaksAndRumours. Rumours aren't confirmed until a studio says so.",
  breaking: "IGN, PC Gamer, Kotaku, Eurogamer, Steam, Bloomberg and Jason Schreier, newest first.",
  yours: "Patches, major updates and news for the games you're playing, own and want.",
  marvel: "Newest from r/MarvelStudiosSpoilers and r/DCULeaks. Spoiler-tagged posts stay hidden until you click them.",
};
const KIND_LABEL = { major: "Major update", update: "Update", minor: "Patch", release: "Release", news: "News" };
const newsState = { data: {}, source: {}, loading: {}, seen: {} };
/* small things to remember between runs (what you've seen), kept in Masterlog's settings */
function uiGet(k, d) { return (state.settings.ui_state || {})[k] ?? d; }
function uiSet(k, v) {
  state.settings.ui_state = { ...(state.settings.ui_state || {}), [k]: v };
  clearTimeout(uiSet.t); uiSet.t = setTimeout(() => api?.set_pref("ui_state", state.settings.ui_state), 500);
}
function newsShellHTML(sec) {
  return `<section class="news" data-sec="${sec}"><header class="news-head"><div><h1>${esc(TABS.news.find(t => t[0] === sec)?.[1] || "News")}</h1><p class="muted">${esc(NEWS_INFO[sec] || "")}</p></div>
    <button class="ghost small" id="newsRefresh">Refresh</button></header>
    <div class="news-filter" id="newsFilter"></div><div id="newsBody"><div class="news-loading"><span class="spinner"></span> Loading the latest…</div></div></section>`;
}
async function loadNews(sec, force) {
  const have = newsState.data[sec];
  if (have) paintNews(sec);
  if (!api || newsState.loading[sec] || (!force && have && Date.now() - have.t < 5 * 60 * 1000)) return;
  newsState.loading[sec] = true;
  try {
    const r = await api.news_section(sec);
    newsState.data[sec] = { ...r, t: Date.now() };
  } catch (e) { newsState.data[sec] = { items: have?.items || [], errors: [String(e)], t: Date.now() }; }
  newsState.loading[sec] = false;
  if (state.catalog === "news" && state.view === sec) paintNews(sec);
  if (sec === "yours" && newsState.data.yours?.pending) setTimeout(() => { if (state.catalog === "news" && state.view === "yours") loadNews("yours", true); }, 20000);
}
function newsItemHTML(it, lead, sec, seenBefore) {
  const fresh = seenBefore && it.date > seenBefore;
  const kind = it.kind && it.kind !== "news" ? `<span class="nk k-${esc(it.kind)}">${esc(KIND_LABEL[it.kind] || it.kind)}</span>` : "";
  const flair = it.flair ? `<span class="nflair">${esc(it.flair)}</span>` : "";
  const game = it.game ? `<span class="ngame">${esc(it.game)}</span>` : "";
  const when = it.upcoming && it.start ? `Starts ${fmtDateTime(it.start)}` : ago(it.date);
  const spoil = it.spoiler ? " spoiler" : "";
  const meta = `<div class="nmeta"><span class="nsrc">${esc(it.source)}</span><span>${esc(when)}</span>${it.comments != null ? `<span>${it.comments} comments</span>` : ""}${it.domain ? `<span>${esc(it.domain)}</span>` : ""}</div>`;
  const thumb = it.thumb ? `<div class="nthumb"><img alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${esc(it.thumb)}" onerror="this.parentNode.classList.add('none')"></div>` : `<div class="nthumb none"><span>${esc((it.source || "").replace(/^r\//, ""))}</span></div>`;
  return `<article class="nitem${lead ? " lead" : ""}${spoil}${fresh ? " fresh" : ""}" data-url="${esc(it.url || "")}" tabindex="0">
    ${thumb}<div class="ntext"><div class="ntags">${fresh ? `<span class="nnew">New</span>` : ""}${game}${kind}${flair}${it.spoiler ? `<span class="nflair sp">Spoiler · click to reveal</span>` : ""}</div>
    <h3>${esc(it.title)}</h3>${it.summary && (lead || sec !== "leaks") ? `<p>${esc(it.summary)}</p>` : ""}${meta}
    ${it.link ? `<button class="linkish" data-url="${esc(it.link)}">Open the source</button>` : ""}</div></article>`;
}
function paintNews(sec) {
  const d = newsState.data[sec], body = $("#newsBody"), filt = $("#newsFilter");
  if (!d || !body) return;
  const srcs = [...new Set(d.items.map(i => sec === "yours" ? i.game : i.source))].filter(Boolean);
  const pick = newsState.source[sec] || "All";
  if (filt) filt.innerHTML = srcs.length > 1 ? ["All", ...srcs.slice(0, sec === "yours" ? 18 : 12)].map(x => `<button class="chip ${x === pick ? "on" : ""}" data-nsrc="${esc(x)}">${esc(x)}</button>`).join("") : "";
  const items = d.items.filter(i => pick === "All" || (sec === "yours" ? i.game : i.source) === pick);
  const seenBefore = newsState.seen[sec] || 0;
  const blocked = (d.errors || []).filter(e => / blocked$/.test(e)).map(e => e.split(":")[0]);
  const other = (d.errors || []).filter(e => !/ blocked$/.test(e)).map(e => e.split(":")[0]);
  const errs = (blocked.length ? `<p class="fine nerr">Reddit is refusing Masterlog for ${esc(blocked.join(", "))}. A free Reddit app ID fixes this: <button class="linkish" id="redditHelp">set it up in Settings</button>.</p>` : "")
    + (other.length ? `<p class="fine nerr">Couldn't reach ${esc(other.join(", "))} just now. Showing the rest.</p>` : "");
  if (!items.length) {
    body.innerHTML = errs + `<p class="muted news-empty">${sec === "yours" && d.pending ? "Fetching news for your games. This fills in over the next minute." : "Nothing here yet."}</p>`;
    return;
  }
  const lead = items.find(i => i.thumb) || items[0];
  const rest = items.filter(i => i !== lead);
  body.innerHTML = errs + `<div class="news-grid">${newsItemHTML(lead, true, sec, seenBefore)}${rest.slice(0, 90).map(i => newsItemHTML(i, false, sec, seenBefore)).join("")}</div>`;
  newsState.seen[sec] = Math.max(seenBefore, ...items.map(i => i.date || 0));
  uiSet("news_seen", newsState.seen);
}
function fmtDateTime(ts) {
  return new Date(ts * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
async function checkNewsDot() {
  if (!api || state.catalog === "news") return;
  try {
    const r = await api.news_section("leaks");
    newsState.data.leaks = { ...r, t: Date.now() };
    const newest = Math.max(0, ...(r.items || []).map(i => i.date || 0));
    $("#newsDot").hidden = !(newsState.seen.leaks && newest > newsState.seen.leaks);
  } catch {}
}

/* covers are always cropped to the 2:3 frame (see style.css); nothing to measure here any more */

/* animations rest when Masterlog isn't the window you're using */
addEventListener("blur", () => document.body.classList.add("away"));
addEventListener("focus", () => document.body.classList.remove("away"));

/* ---------- start ---------- */
async function start() {
  api = window.pywebview?.api || null;
  bindGlobal(); tick(); setInterval(tick, 15000);
  if (!api) { $("#intro")?.remove(); towers(); render(); return; }
  state.settings = await api.get_settings();
  applySound(); applyScale(state.settings.scale || 1);
  Object.assign(newsState.seen, uiGet("news_seen", {}));
  state.dlcMarks = await Promise.resolve(api.dlc_marks()).catch(() => ({})) || {};
  document.body.classList.toggle("bigpic", !!state.settings.big_picture);
  if (state.settings.intro !== false && !window.SKIP_INTRO) await new Promise(r => playIntro(r));
  else $("#intro")?.remove();
  try { FX.startAmbient(false); } catch {}
  towers();
  state.mode = state.settings.view_mode === "list" ? "list" : "covers";
  const cached = await api.cached();
  if (cached?.games?.length) applyData(cached);
  render(); syncLabel(); scheduleRefresh();
  if (state.settings.pair_pending) openSheetApproval(state.settings.pair_pending);
  sync(false);
  setTimeout(() => checkForUpdate(false), 4000);
  setInterval(() => checkForUpdate(false), 6 * 3600 * 1000);
  setInterval(refreshUpdated, 5 * 60 * 1000);
  setTimeout(checkNewsDot, 15000); setInterval(checkNewsDot, 15 * 60 * 1000);
  setTimeout(() => loadDeals(false), 6000); setInterval(() => loadDeals(false), 30 * 60 * 1000);
  setInterval(pollRenames, 60 * 1000);
  setInterval(async () => { const a = await Promise.resolve(api?.itch_added()).catch(() => []); if (a?.length) { toast(`Added to your wishlist from itch.io: ${a.join(", ")}.`, "party"); sync(true); } }, 5000);
  setInterval(() => { if (state.catalog === "news") loadNews(state.view, true); }, 15 * 60 * 1000);
  pollAccounts(false);
}
if (window.pywebview?.api) start();
else window.addEventListener("pywebviewready", start, { once: true });
