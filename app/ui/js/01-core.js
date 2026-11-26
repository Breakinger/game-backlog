/* Masterlog front end, part 1 of 9: platforms, helpers, covers, the title bar.
   The parts load in order as plain scripts and share one global scope (see index.html). */
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
const STATUS_COLOR = { Family: "#66C0F4", Library: "#8F9BB3", Playing: "#4DABF7", Paused: "#FFB547", Wishlist: "#9775FA", Completed: "#5BD38A", Dropped: "#FF6B6B", "Second chance": "#FF922B",
  "To read": "#8F9BB3", Reading: "#4DABF7", Read: "#5BD38A" };
const CONSOLES = new Set(["PS5", "PS4", "PS2", "Switch 2", "Switch"]);
const IS_WINDOWS = /Windows/.test(navigator.userAgent);
const UPGRADE_TO = { PS4: "PS5", Switch: "Switch 2" };
const FALLBACK_OPTIONS = {
  games: { status: ["Library", "Playing", "Paused", "Wishlist", "Completed", "Dropped"], priority: ["Extreme", "High", "Medium", "Low"],
    platform: Object.keys(PLAT), play_on: ["PC", "Steam Deck"], format: ["Digital", "Physical"], upgrade: ["Free upgrade", "Paid upgrade", "No upgrade"],
    type: ["Live service", "Modded"], migrate_to: ["Steam", "GOG", "PS5", "Switch 2", "Undecided"] },
  books: { status: ["To read", "Reading", "Read", "Dropped", "Wishlist"], priority: ["Extreme", "High", "Medium", "Low"], format: ["Physical", "eBook", "Audiobook"] },
};
const TABS = {
  // three groups: what the app is for, everything you have or want, and your history with games
  games: [["home", "Home"], ["backlog", "Backlog"], "|", ["played", "Completed"], ["library", "Library"], ["wishlist", "Wishlist"], "|", ["ranking", "Top 100"], ["stats", "History"]],
  books: [["shelf", "Shelf"], ["books", "All books"], ["bookyears", "Read"]],
  news: [["breaking", "Breaking news"], ["yours", "Your games"]],
};

const state = {
  catalog: "games",
  games: [], plays: [], books: [], options: { games: {}, plays: {}, books: {} }, canEdit: false,
  syncedAt: null, error: null, settings: {}, updated: {}, facts: {}, candidates: [],
  view: "home", focusId: null, mode: "covers",
  filter: { q: "", status: new Set(), plats: new Set(), prio: new Set(), formats: new Set(), sort: "priority" },
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
function activateArt(root) { root.querySelectorAll(".art").forEach(el => { if (!el.querySelector("img")) coverObserver.observe(el); }); fxWatch(root); }

/* effects only move while you can see them: flames, glows and sparks rest once a cover scrolls out of view */
const FX_MOVING = ".flames, .fxglow, .sparks, .freshline, .typetag.live";
const fxObserver = new IntersectionObserver(entries => entries.forEach(e => e.target.classList.toggle("live", e.isIntersecting)), { rootMargin: "120px" });
function fxWatch(root) { root.querySelectorAll?.(".case").forEach(el => { if (el.querySelector(FX_MOVING)) fxObserver.observe(el); }); }

/* big lists arrive in pieces: the first screenful at once, the rest while the app is idle */
let lazyToken = 0;
const lazyQueue = [];
function lazyCases(list, cls = "grid", first = 42, make = g => caseHTML(g)) {
  if (list.length <= first) return `<div class="${cls}">${list.map(make).join("")}</div>`;
  lazyQueue.push({ rest: list.slice(first), make });
  return `<div class="${cls}" data-lazy="${lazyQueue.length - 1}">${list.slice(0, first).map(make).join("")}</div>`;
}
function drainLazy(root) {
  const token = ++lazyToken;
  const jobs = [...root.querySelectorAll("[data-lazy]")].map(el => ({ el, job: lazyQueue[+el.dataset.lazy] })).filter(x => x.job);
  lazyQueue.length = 0;
  const later = window.requestIdleCallback ? f => requestIdleCallback(f, { timeout: 150 }) : f => setTimeout(f, 16);
  const step = () => {
    if (token !== lazyToken) return;
    const j = jobs.find(x => x.job.rest.length);
    if (!j) return;
    const tpl = document.createElement("template");
    tpl.innerHTML = j.job.rest.splice(0, 48).map(j.job.make).join("");
    activateArt(tpl.content);
    j.el.append(tpl.content);
    later(step);
  };
  if (jobs.length) later(step);
}
function findItem(kind, id) { return kind === "book" ? state.books.find(x => x.id === +id) : (state.games.find(x => x.id === +id) || accountCopies().find(x => x.id === +id) || familyItems().find(x => x.id === +id)); }
/* ----- Steam Family: games other members share with you (not in your sheet; read-only) ----- */
const familyState = { data: null, key: "", items: [] };
function familyItems() {
  const d = familyState.data;
  if (!d?.apps?.length) return [];
  const k = d.t + ":" + d.apps.length + ":" + state.games.length;
  if (familyState.key === k) return familyState.items;
  const mine = new Set(state.games.map(g => rankKey(g.name)));
  familyState.items = d.apps.filter(a => !mine.has(rankKey(a.name))).map((a, i) => ({
    id: 900000 + i, row: -1, name: a.name, platform: "Steam", format: "Digital", status: "Family", family: true, appid: a.appid,
    owners: a.owners, priority: "", type: "", beaten_on: [], hours: a.playtime ? Math.round(a.playtime / 6) / 10 : null }));
  familyState.key = k;
  return familyState.items;
}
/* ---------- Masterlog's own title bar (Windows): drag the top bar, double-click it to maximize ---------- */
async function setupChrome() {
  const c = await Promise.resolve(api?.window_chrome?.()).catch(() => null);
  if (!c?.custom) { if (c && !c.native_pref && c.windows && !setupChrome.tries) { setupChrome.tries = 1; setTimeout(setupChrome, 1500); } return; }
  document.body.classList.add("chrome");
  $("#winctl").hidden = false; $("#dragStrip").hidden = false;
  const paintMax = m => { document.body.classList.toggle("win-max", !!m); $('#winctl [data-win="max"]').title = m ? "Restore" : "Maximize"; };
  paintMax(c.max);
  if (setupChrome.bound) return;
  setupChrome.bound = true;
  $("#winctl").addEventListener("click", async e => {
    const b = e.target.closest("[data-win]"); if (!b) return;
    if (b.dataset.win === "min") api.win_min();
    if (b.dataset.win === "max") paintMax(await api.win_max());
    if (b.dataset.win === "close") api.win_close();
  });
  const draggable = t => !t.closest("button, a, input, select, textarea, label, [role=tab], [data-url], .catalog, .tab, .clock, .sync");
  const down = e => {
    if (e.button !== 0 || !draggable(e.target)) return;
    if (e.detail === 2) { e.preventDefault(); Promise.resolve(api.win_max()).then(paintMax); return; }
    api.win_drag();
  };
  document.querySelector(".bar").addEventListener("mousedown", down);
  $("#dragStrip").addEventListener("mousedown", down);
  addEventListener("resize", () => { clearTimeout(setupChrome.rt); setupChrome.rt = setTimeout(async () => { const s = await Promise.resolve(api.window_chrome()).catch(() => null); if (s) paintMax(s.max); }, 200); });
}
async function addFamilyGame(g) {
  const r = await Promise.resolve(api?.add("games", { name: g.name, status: "Library", platform: "Steam", format: "Digital", notes: `Shared through Steam Family by ${(g.owners || []).join(", ")}` })).catch(e => ({ error: String(e) }));
  if (!r || r.error) return toast(`Couldn't add it: ${r?.error || "no connection"}`, "err");
  try { FX.play.save(); } catch {}
  toast(`${g.name} added to your library.`, "ok");
  if (panelItem?.id === g.id) closePanel();
  sync(true);
}
async function loadFamily() {
  const d = await Promise.resolve(api?.steam_family?.()).catch(() => null);
  if (!d) return;
  const changed = JSON.stringify(d.apps?.length) + d.t !== JSON.stringify(familyState.data?.apps?.length) + familyState.data?.t;
  familyState.data = d;
  if (changed && d.apps?.length && ["home", "library"].includes(state.view)) render();
}
