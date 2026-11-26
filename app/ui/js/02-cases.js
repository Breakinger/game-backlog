/* Masterlog front end, part 2 of 9: game and book cases, medals, effects, selections and the Top 100.
   The parts load in order as plain scripts and share one global scope (see index.html). */
"use strict";

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
  const medals = medalsHTML(g);
  const fresh = state.updated[g.name] ? `<span class="freshline" title="${esc(state.updated[g.name].title || "")}"><i></i>Newly updated!</span>` : "";
  const upOwned = g.upgrade_owned || factsOf(g).ps5_version;
  const up = g.upgrade && UPGRADE_TO[g.platform] && g.upgrade !== "No upgrade" ? `<span class="tag up ${upOwned ? "owned" : g.upgrade.startsWith("Free") ? "free" : "paid"}" title="${esc(upgradeLabel(g))}${upOwned ? " · you own the upgrade" : ""}">${upOwned ? `${esc(UPGRADE_TO[g.platform].replace("PlayStation ", "PS").replace("Nintendo ", ""))} ✓` : `${g.upgrade.startsWith("Free") ? "FREE" : "PAID"} ↑`}</span>` : "";
  const cached = covers.get(coverKey(g));
  const art = cached ? `<img alt="" decoding="async" src="${cached}">` : `<div class="fallback"><div class="t">${esc(g.name)}</div><div class="d">${esc(g.developer || g.genre || "")}</div></div>`;
  const deck = g.platform === "Steam" && g.play_on === "Steam Deck" ? emblem("deck") : p.tag ? `<span class="tag">${p.tag}</span>` : "";
  const typeTag = g.family ? `<span class="typetag fam">FAMILY</span>` : g.type === "Live service" ? `<span class="typetag live"><i></i>LIVE</span>` : g.type === "Modded" ? `<span class="typetag mod">MODDED</span>` : "";
  const ach = achBadge(g);
  const quick = !o.noLabel ? quickBtn(g) : "";
  const media = p.media === "card"
    ? `<div class="media card"><div class="card-face"><span>${esc(p.label.replace("Nintendo ", ""))}</span></div></div>`
    : `<div class="media disc ${p.disc || ""}"><div class="disc-face"></div></div>`;
  const dups = (dupsOf.get(g) || []).slice(0, 3);
  const stack = dups.length ? `<div class="fancards" aria-hidden="true">${dups.map((d, i) => { const dp = plat(d.platform), c = covers.get(coverKey(d)) || covers.get(coverKey(g)); return `<i style="--i:${i + 1};--n:${dups.length};--dc:${dp.band};--dt:${dp.text || "#fff"};--ds:${dp.shell || "#10162A"}"><em>${esc(dp.label)}</em>${c ? `<img alt="" src="${c}">` : ""}</i>`; }).join("")}</div><span class="copies" title="${esc(dups.map(d => `${d.name} (${plat(d.platform).label}, ${d.status})`).join(" · "))}">×${dups.length + 1}</span>` : "";
  return `<button class="case p-${(g.platform || "x").replace(/\W+/g, "")} ${isSel("game", g.virtual ? state.games.find(x => x.row === g.row) || g : g) ? "sel" : ""} ${g.status === "Wishlist" ? "unowned" : ""} ${dups.length ? "stacked" : ""} ${effectClass(g)} ${gotyClass(g)} ${ach ? "honored" : ""}" data-id="${g.id}" data-kind="game"
    style="--band:${p.band};--band-text:${p.text};--shell:${p.shell};--accent:${p.accent};--plat:${p.chip}" aria-label="${esc(g.name)}">
    <div class="stage">${stack}${media}${effectLayer(g)}${gotyLayer(g)}
      <div class="box"><div class="shell"></div>
        <div class="band">${emblem(g.platform)}<span class="wm">${esc(bandLabel(g.platform, p))}</span>${deck}${up}</div>
        <div class="art" data-kind="game" data-id="${g.id}">${art}</div>
        <div class="hinge"></div><div class="sheen"></div>${typeTag}${quick}
      </div>
    </div>
    ${o.noLabel ? "" : `<div class="label">${fresh}<div class="ltop"><div class="name">${esc(g.name)}</div>${medals}</div><div class="sub">${badge}${esc(o.sub ?? subline(g))}</div>${g.status === "Wishlist" ? priceTag(g) : ""}</div>`}
  </button>`;
}
function factsOf(g) { return state.facts[g.name] || {}; }
/* medals sit beside the game's name, under the cover, so they never cover its art, logo or tags */
function medalSVG(kind) {
  // completion: their own shapes, so they never read as a ranking medal
  if (kind === "full") return `<svg viewBox="0 0 30 32" aria-hidden="true"><defs><linearGradient id="mlFullRim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF4C2"/><stop offset=".45" stop-color="#F2B92C"/><stop offset="1" stop-color="#A86A06"/></linearGradient><linearGradient id="mlFullCore" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3FE08F"/><stop offset="1" stop-color="#0E7A45"/></linearGradient></defs>
    <path class="hex" fill="url(#mlFullRim)" d="M15 1.2 27.6 8.5v15L15 30.8 2.4 23.5v-15z"/><path class="hexin" fill="url(#mlFullCore)" d="M15 5.4 24 10.6v10.8L15 26.6 6 21.4V10.6z"/>
    <path class="tick" d="M10.2 16.2l3.3 3.4 6.6-7.2"/><path class="glint" d="M23.6 3.2l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7z"/></svg>`;
  if (kind === "plat") return `<svg viewBox="0 0 30 34" aria-hidden="true"><defs><linearGradient id="mlPlat" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".3" stop-color="#D9E4F7"/><stop offset=".55" stop-color="#9FB1D4"/><stop offset=".75" stop-color="#E9F0FF"/><stop offset="1" stop-color="#7C8DB3"/></linearGradient></defs>
    <path class="handle" d="M7.4 6.6H3.8a3.4 3.4 0 0 0 3.6 5.6M22.6 6.6h3.6a3.4 3.4 0 0 1-3.6 5.6"/>
    <path class="cupb" fill="url(#mlPlat)" d="M7 3.4h16v7.4a8 8 0 0 1-16 0z"/><path class="stem" fill="url(#mlPlat)" d="M13.2 18.4h3.6v5h-3.6z"/>
    <path class="base" fill="url(#mlPlat)" d="M8.6 23.2h12.8l1.4 4.6H7.2z"/><path class="plinth" d="M6 27.6h18v3.4H6z"/>
    <path class="star" d="M15 6.2l1.2 2.5 2.7.4-2 1.9.5 2.7-2.4-1.3-2.4 1.3.5-2.7-2-1.9 2.7-.4z"/><path class="glint" d="M24.8.6l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z"/></svg>`;
  // ranking: a medal on a ribbon; Legendary carries a small fiery-white diamond above its number
  const inner = kind === "crimson" ? `<path class="gem" d="M9.4 15.4h5.2l1.7 2.1-4.3 4.6-4.3-4.6z"/><path class="gemline" d="M7.7 17.5h8.6M10.8 15.4l1.2 6.7 1.2-6.7"/>` : "";
  return `<svg viewBox="0 0 24 34" aria-hidden="true"><path class="rib r1" d="M4.6 0h5.2l3.4 12.6-4.2 2.2z"/><path class="rib r2" d="M19.4 0h-5.2l-3.4 12.6 4.2 2.2z"/><circle class="disc" cx="12" cy="23" r="9.6"/><circle class="rim" cx="12" cy="23" r="7.6"/>${inner}</svg>`;
}
function medalsHTML(g) {
  const out = [], rk = rankOf(g), f = factsOf(g);
  if (rk && !isClassic(g)) { const t = rankTier(rk); out.push(`<span class="medal m-rank m-${t}" title="${TIER_NAME[t]} medal · #${rk} in your Top 100">${medalSVG(t)}<b>${rk}</b></span>`); }
  if (f.complete === "Platinum" || (g.platinum && CONSOLES.has(g.platform))) out.push(`<span class="medal m-plat" title="Platinum trophy">${medalSVG("plat")}</span>`);
  else if (f.complete || g.platinum) out.push(`<span class="medal m-full" title="100%: every achievement">${medalSVG("full")}</span>`);
  const crowns = gotyMedals(g);
  return out.length || crowns ? `<span class="medals">${crowns}${out.join("")}</span>` : "";
}
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
  // glows breathe through opacity only, which the graphics card handles without repainting anything
  if (isClassic(g)) out += `<i class="fxglow classic" aria-hidden="true"></i>`;
  else if (g.priority === "High" && g.status !== "Completed" && g.status !== "Dropped") out += `<i class="fxglow high" aria-hidden="true"></i>`;
  if (isClassic(g)) out += `<div class="flames classic-flames" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>${SPARKS}<div class="cosmos aura still" aria-hidden="true"></div><span class="classic-award oncover" title="All Time Classic · Mythical">${CLASSIC_IMG}</span>`;
  if (g.priority === "Extreme" && g.status !== "Completed" && g.status !== "Dropped") out += `<div class="flames" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>`;
  if ((st === "Paused" || g.status === "Paused") && st !== "Second chance") out += `<div class="cobweb" aria-hidden="true"><svg viewBox="0 0 60 60"><path d="M0 0L60 60M0 0L60 22M0 0L22 60M0 0L60 0M0 0L0 60M10 0Q8 8 0 10M22 0Q18 18 0 22M36 0Q30 30 0 36M52 0Q42 42 0 52"/></svg></div><div class="dust" aria-hidden="true"></div>`;
  if (st === "Second chance") out += `<span class="extralife" title="Second chance"><svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.5-9.1C1 8.4 3.2 5 6.6 5c2 0 3.4 1.1 4.2 2.4C11.6 6.1 13 5 15 5c3.4 0 5.6 3.4 4.1 6.9C17.1 16.4 12 21 12 21z"/></svg><b>↻ 1UP</b></span>`;
  return out;
}
function quickBtn(item) {
  if (!state.canEdit || item.family) return "";
  const kind = item.author !== undefined ? "book" : "game";
  if (item.status === "Wishlist") return `<span class="qc own" role="button" tabindex="-1" data-qown="${item.id}" data-qkind="${kind}" title="${kind === "book" ? "I have it now" : "I own it now"}">＋</span>`;
  if (kind === "game" && (item.status === "Completed" || item.type === "Live service")) return "";
  if (kind === "book" && item.status === "Read") return "";
  return `<span class="qc" role="button" tabindex="-1" data-qc="${item.id}" data-qkind="${kind}" title="${kind === "book" ? "Mark as read" : "Mark as completed"}">✓</span>`;
}
function hoursFromAccounts(g) { const m = factsOf(g).minutes; return m ? Math.round(m / 6) / 10 : null; }
function subline(g) {
  if (g.family) return `Shared by ${(g.owners || []).join(", ") || "your family"}`;
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
  return `<button class="case book ${isSel("book", b) ? "sel" : ""} ${b.status === "Wishlist" ? "unowned" : ""} ${bookFx(b)}" data-id="${b.id}" data-kind="book" aria-label="${esc(b.name)}">
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
    { title: "On the Steam Deck", items: G.filter(g => g.play_on === "Steam Deck" && ["Library", "Playing", "Paused"].includes(g.status)).sort(byPrio), view: "library", preset: { plats: ["deck"] } },
    { title: "Upgrade these to PS5 or Switch 2", items: G.filter(g => g.upgrade && g.upgrade !== "No upgrade" && UPGRADE_TO[g.platform] && g.status !== "Completed" && !g.upgrade_owned && !factsOf(g).ps5_version), view: "library" },
    { title: "Wishlist, top priority", items: G.filter(g => g.status === "Wishlist").sort(byPrio).slice(0, 24), view: "wishlist" },
    { title: "Plan to migrate", items: G.filter(migrating), view: "library", preset: { status: "Plan to migrate" } },
    { title: `Finished in ${year}`, items: G.filter(g => g.status === "Completed" && (g.completed || "").startsWith(String(year))).sort(byDone), view: "stats" },
    { title: "Second chances", items: G.filter(g => statusOf(g) === "Second chance"), view: "played" },
    { title: "Shared by your Steam Family", items: familyItems().slice().sort((a, b) => (familyState.data.apps.find(x => x.name === b.name)?.last || 0) - (familyState.data.apps.find(x => x.name === a.name)?.last || 0)).slice(0, 30), view: "library", preset: { status: "Steam Family" } },
  ];
}
/* ----- your Top 100 ----- */
let rankIndex = null, rankDirty = false;
// names are compared thousands of times per screen: work each one out once
const memo = fn => { const m = new Map(); return n => { const k = String(n ?? ""); let v = m.get(k); if (v === undefined) { if (m.size > 30000) m.clear(); v = fn(k); m.set(k, v); } return v; }; };
const rankKey = memo(rankKeyRaw);
function rankKeyRaw(n) {
  const R = { ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };
  return String(n || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[™®©]/g, "").replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ").replace(BRAND_PREFIX, "").split(" ").filter(w => w && w !== "the").map(w => R[w] || w).join(" ");
}
// "Tom Clancy's Rainbow Six Siege" and "Rainbow Six Siege" are the same game
const BRAND_PREFIX = /^\s*(tom clancy s|tom clancys|sid meier s|sid meiers|marvel s|marvels|disney s|disneys|clive barker s|american mcgee s|dreamworks|lego marvel s)\s+(?=\S)/;
function rankOf(g) {
  if (!rankIndex) {
    rankIndex = new Map(); rankMatches = new Map(); matchPool = null;
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
const baseKey = memo(n => rankKey(String(n || "").replace(/\([^)]*\)/g, " ")).replace(EDITION_WORDS, " ").replace(/\s+/g, " ").trim());
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
let matchPool = null;   // your library with its names already worked out, rebuilt with the Top 100 index
function rankPool() {
  if (!matchPool) {
    const pool = [...state.games, ...accountCopies()];
    const byKey = new Map(), byBase = new Map();
    for (const g of pool) {
      const k = rankKey(g.name), b = baseKey(g.name);
      (byKey.get(k) || byKey.set(k, []).get(k)).push(g);
      (byBase.get(b) || byBase.set(b, []).get(b)).push(g);
    }
    const nums = x => x.split(" ").filter(w => /^\d+$/.test(w)).join(" ");
    matchPool = { pool, byKey, byBase, fuzzy: pool.map(g => { const b = baseKey(g.name); return { g, b, n: nums(b), len: b.length }; }), nums };
  }
  return matchPool;
}
function rankMatch(name) {
  const { pool, byKey, byBase, fuzzy, nums } = rankPool();
  const owned = list => (list || []).find(g => g.status !== "Wishlist") || (list || [])[0] || null;
  const k = rankKey(name), b = baseKey(name);
  let hit = owned(byKey.get(k));
  if (hit) return { g: hit, via: "" };
  hit = owned(byBase.get(b));
  if (hit) return { g: hit, via: "edition" };
  // 'The Elder Scrolls V: Skyrim' and '... Skyrim Special Edition', but never 'Mass Effect' and 'Mass Effect 2'
  const extends_ = (long, short) => short.length > 2 && long.startsWith(short + " ") && long.slice(short.length + 1).split(" ").every(w => SAME_GAME_TAIL.has(w));
  hit = owned(pool.filter(g => { const gb = baseKey(g.name); return extends_(gb, b) || extends_(b, gb); }));
  if (hit) return { g: hit, via: "edition" };
  // small spelling differences ('Clair Obscure' / 'Clair Obscur', 'Persona 3 Reload' / 'Reloaded'), same numbers only
  const bn = nums(b), bl = b.length;
  hit = owned(fuzzy.filter(x => x.n === bn && Math.abs(x.len - bl) <= bl * 0.3 + 2 && dice(x.b, b) >= 0.86).map(x => x.g));
  if (hit) return { g: hit, via: "edition" };
  for (const [coll, parts] of COLLECTIONS) {
    if (!parts.includes(b)) continue;
    hit = owned(pool.filter(g => { const gk = rankKey(g.name); return gk === coll || gk.startsWith(coll + " ") || baseKey(g.name) === baseKey(coll) && coll.split(" ").length > baseKey(coll).split(" ").length && gk.length >= coll.length - 2; }));
    if (hit) return { g: hit, via: "collection" };
  }
  return null;
}
const bigrams = memo(x => { const m = new Map(); for (let i = 0; i < x.length - 1; i++) { const g = x.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; });
function dice(a, b) {
  if (a === b) return 1;
  const grams = bigrams;
  const A = grams(a), B = grams(b); let both = 0;
  A.forEach((n, g) => { both += Math.min(n, B.get(g) || 0); });
  return (2 * both) / Math.max(1, a.length - 1 + b.length - 1);
}
function rankedGame(name) { if (!rankIndex) rankOf({ name: "" }); const m = rankMatches.has(name) ? rankMatches.get(name) : rankMatch(name); return m ? m.g : null; }
/* award tiers: crimson for the podium, diamond for 4-5, gold to 10, silver to 50, bronze for the rest */
function rankTier(n) { return !n ? "" : n <= 5 ? "crimson" : n <= 10 ? "gold" : n <= 50 ? "silver" : "bronze"; }   // "crimson" is Legendary, 1–5
const TIER_NAME = { classic: "Mythical", crimson: "Legendary", diamond: "Diamond", gold: "Gold", silver: "Silver", bronze: "Bronze" };
function awardSVG(t) {
  // Legendary: a white diamond in fire (still: no per-frame flicker inside the icon)
  if (t === "crimson") return `<svg viewBox="0 0 24 24" class="aw legend"><path class="flare" d="M12 .3c1.7 2.3 4.1 2.7 5.2 5.2 1.8-1.2 3.8-.6 4.8.7-1.9.6-2.1 2.7-1.4 4.5 1.6 3.8.4 8.4-2.9 10.9-1.6 1.3-3.6 2-5.7 2s-4.1-.7-5.7-2C3 19.1 1.8 14.5 3.4 10.7c.7-1.8.5-3.9-1.4-4.5 1-1.3 3-1.9 4.8-.7C7.9 3 10.3 2.6 12 .3z"/><path class="flare2" d="M12 4.5c1 1.6 2.6 2 3.3 3.6 1.2-.7 2.4-.3 3 .5-1.2.5-1.3 1.8-.8 3 1 2.5.2 5.4-1.9 7-1.1.9-2.3 1.3-3.6 1.3s-2.5-.4-3.6-1.3c-2.1-1.6-2.9-4.5-1.9-7 .5-1.2.4-2.5-.8-3 .6-.8 1.8-1.2 3-.5C9.4 6.5 11 6.1 12 4.5z"/><path class="core" d="M7.6 8.2h8.8l3 4-7.4 8.6-7.4-8.6z"/><path class="facet" d="M4.6 12.2h14.8M7.6 8.2l2 4L12 20.8l2.4-8.6 2-4M9.6 12.2l2.4-4 2.4 4"/><path class="glint" d="M8.8 9.4l1.2-.4-.4 1.4z"/></svg>`;
  // Gold, Silver and Bronze: a medal on a ribbon
  return `<svg viewBox="0 0 24 24" class="aw medal"><path class="rib" d="M6.5 1.5h4l2 6-3 1.8zM17.5 1.5h-4l-2 6 3 1.8z"/><circle class="core" cx="12" cy="15" r="7.4"/><circle class="ring" cx="12" cy="15" r="5.4"/><path class="star" d="M12 11.2l1.1 2.3 2.5.3-1.8 1.7.5 2.5-2.3-1.2-2.3 1.2.5-2.5-1.8-1.7 2.5-.3z"/></svg>`;
}
/* ----- the All Time Classic: one game, crowned by you (its tier: Mythical) ----- */
const SPARKS = `<div class="sparks" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<i style="--i:${i}"></i>`).join("")}</div>`;
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
  // the classic stands above the Top 100, not in it
  if (g && state.ranking?.length) {
    const k = rankKey(g.name);
    const at = state.ranking.findIndex(n => rankKey(n) === k || rankMatch(n)?.g === g);
    if (at >= 0) { state.ranking.splice(at, 1); rankIndex = null; saveRanking(`${g.name} left the Top 100 to stand above it.`); }
  }
  render();
  if (g) { try { FX.play.notify(); } catch {} toast(`${g.name} is your All Time Classic.`, "party", before && rankKey(before) !== rankKey(g.name) ? { label: "Undo", run: () => setClassic(state.games.find(x => x.name === before) || { name: before }) } : null); }
  else toast("The All Time Classic award is free again.");
}
const CLASSIC_IMG = `<svg class="classic-logo" viewBox="0 0 140 120" aria-hidden="true">
  <g class="wing"><path d="M58 70 C40 62 22 48 6 22 C24 34 40 40 56 44 Z"/><path d="M57 80 C38 76 20 66 4 46 C22 56 38 60 56 60 Z"/><path d="M58 90 C42 90 26 84 12 70 C28 76 42 78 57 76 Z"/></g>
  <g class="wing" transform="translate(140 0) scale(-1 1)"><path d="M58 70 C40 62 22 48 6 22 C24 34 40 40 56 44 Z"/><path d="M57 80 C38 76 20 66 4 46 C22 56 38 60 56 60 Z"/><path d="M58 90 C42 90 26 84 12 70 C28 76 42 78 57 76 Z"/></g>
  <path class="crest" d="M70 8 L96 30 L90 86 L70 112 L50 86 L44 30 Z"/>
  <path class="crest-in" d="M70 18 L88 34 L83 82 L70 99 L57 82 L52 34 Z"/>
  <path class="flame" d="M70 92 C58 88 54 76 59 66 C61 72 64 74 66 74 C62 62 66 50 76 42 C74 52 80 58 84 66 C88 76 82 88 70 92 Z"/>
  <path class="flame-core" d="M70 88 C64 85 63 78 66 73 C68 77 70 78 72 77 C71 71 73 66 77 62 C78 70 82 74 80 80 C79 85 75 88 70 88 Z"/>
  <path class="star" d="M70 22 L72.4 29.6 L80 32 L72.4 34.4 L70 42 L67.6 34.4 L60 32 L67.6 29.6 Z"/></svg>`;
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
    <div class="classic-bg" id="classicBg" aria-hidden="true"></div>
    <div class="cosmos" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="classic-cover"><div class="flames classic-flames big" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>${SPARKS}<div class="art" data-kind="game" data-id="${g.id}">${cover ? `<img alt="" src="${cover}">` : `<div class="fallback"><div class="t">${esc(g.name)}</div></div>`}</div><div class="classic-award">${CLASSIC_IMG}</div></div>
    <div class="classic-body">
      <div class="classic-kicker"><span class="mythical">Mythical</span> All Time Classic</div>
      <h2>${esc(g.name)}</h2>
      <p class="muted">${esc([g.developer, g.publisher && g.publisher !== g.developer ? g.publisher : "", plat(g.platform).label].filter(Boolean).join("  ·  "))}</p>
      <div class="cstats">${stat(hours ? `${Math.round(hours * 10) / 10} h` : "", "played")}${stat(runs.length || g.runs || "", (runs.length || g.runs) === 1 ? "run" : "runs")}${stat(done, "finished")}${stat(g.score != null ? scoreText(g.score) : "", "your score")}${stat(rankOf(g) ? `#${rankOf(g)}` : "", "in your Top 100")}</div>
      ${runs.length ? `<ol class="cruns">${runs.map(r => `<li><b>Run ${r.run || "·"}</b><span>${esc(plat(r.platform || g.platform).label)}${r.play_on ? ` on ${esc(r.play_on)}` : ""}</span><span>${r.hours ? `${r.hours} h` : ""}</span><span>${r.finished ? (r.finished_on ? `Finished ${fmtDate(r.finished_on)}` : "Finished") : "Unfinished"}</span><span class="tags">${r.modded ? "<i>Modded</i>" : ""}${r.dlc ? "<i>DLC</i>" : ""}${r.platinum ? "<i>100%</i>" : ""}</span>${r.notes ? `<small>${esc(r.notes)}</small>` : ""}</li>`).join("")}</ol>` : ""}
      <div class="cawards" id="classicAwards"><span class="spinner"></span> Looking up its awards…</div>
    </div>
    ${state.canEdit ? `<button class="ghost small classic-off" data-unclassic title="Take the award back">Remove award</button>` : ""}
  </section>`;
}
async function fillClassicAwards() {
  const box = $("#classicAwards"), g = classicGame();
  if (g && $("#classicBg")) Promise.resolve(api?.hero(g.name)).catch(() => null).then(u => u || loadCover(g)).then(u => { const bg = $("#classicBg"); if (u && bg) bg.style.backgroundImage = `url("${u}")`; });
  if (!box || !g || !api) return;
  const r = await Promise.resolve(api.awards(g)).catch(() => null);
  if (!$("#classicAwards") || classicGame() !== g) return;
  const html = awardsHTML(r);
  box.innerHTML = html || `<p class="muted">${r?.error ? "Couldn't reach Wikipedia just now; the awards show up next time." : "No Game Awards, Golden Joystick, BAFTA or Steam Awards entries for it. Some classics win hearts, not trophies."}</p>`;
}
function rankVia(n, g) { const m = rankMatches.get(n); return m?.via === "collection" ? `In ${esc(g.name)} · ` : m?.via === "edition" ? `As ${esc(g.name)} · ` : ""; }
/* Top 100 games that aren't anywhere in your library get added to it (once; Undo takes them out again) */
async function addMissingRanked() {
  if (!api || !state.canEdit || state.rankingLocal || !state.games.length || !(state.ranking || []).length) return;
  rankOf({ name: "" });
  const tried = new Set(uiGet("rank_added", []));
  const missing = state.ranking.filter(n => !rankMatches.get(n) && !tried.has(rankKey(n)) && rankKey(n) !== rankKey(state.settings.classic || ""));
  if (!missing.length || addMissingRanked.busy) return;
  addMissingRanked.busy = true;
  uiSet("rank_added", [...tried, ...missing.map(rankKey)]);
  const r = await Promise.resolve(api.add_from_ranking(missing)).catch(e => ({ error: String(e) }));
  addMissingRanked.busy = false;
  if (!r || r.error || !r.added?.length) return;
  const names = r.added.map(a => a.name);
  const live = r.added.filter(a => a.live).length;
  toast(`Added ${names.length === 1 ? names[0] : names.length + " games"} from your Top 100 to your library${live === names.length ? " as live service" : live ? ` (${live} as live service)` : ""}. Finish dates are left as unknown; right-click one to fix its platform.`, "ok", {
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
      <div class="tiers" aria-label="Award tiers">${[["classic", "All Time Classic"], ["crimson", "1–5"], ["gold", "6–10"], ["silver", "11–50"], ["bronze", "51–100"]].map(([t, r]) => `<span class="tier t-${t}"><i class="rk-aw">${t === "classic" ? CLASSIC_IMG : awardSVG(t)}</i>${TIER_NAME[t]}<small>${r}</small></span>`).join("")}</div><p class="muted fine">${state.rankingLocal ? " Saved on this PC until you update the connection script (Settings)." : " Saved to the Ranking tab in your sheet."}</p></div>
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
  // each game's group, looked up directly (this used to scan every group for every game)
  const groupOfGame = new Map();
  for (const arr of groups.values()) for (const g of arr) groupOfGame.set(g, arr);
  const out = [];
  for (const g of list) {
    const arr = groupOfGame.get(g);
    if (!arr || arr.done) continue;
    arr.done = true;
    const sorted = arr.length > 1 ? [...arr].sort((a, b) => { const x = copyRank(a), y = copyRank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; }) : arr;
    dupsOf.set(sorted[0], sorted.slice(1));
    out.push(sorted[0]);
  }
  return out;
}
function migrating(g) { return !!g.migrate_to && g.migrate_to !== g.platform && owned(g); }
function heroGame() {
  const G = state.games;
  return G.find(g => g.id === state.focusId) || G.find(g => g.status === "Playing")
    || G.filter(g => g.status === "Paused").sort(byPrio)[0] || G.filter(g => g.status === "Library").sort(byPrio)[0] || G[0];
}
