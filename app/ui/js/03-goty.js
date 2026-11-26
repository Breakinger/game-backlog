/* Masterlog front end, part 3 of 9: Game of the Year.
   The parts load in order as plain scripts and share one global scope (see index.html). */
"use strict";

/* ---------- Game of the Year: the official one (The Game Awards), yours, and the other big ceremonies ----------
   The official winner wears a gold crown and gold fire; yours a white crown and white fire. A crowned game you
   haven't played yet keeps its crown, greyed out. Winners come from goty.py (checked list + weekly Wikipedia read). */
const gotyState = { data: null, key: "", index: new Map() };
const CEREMONY = { tga: "The Game Awards", gj: "Golden Joystick Awards", bafta: "BAFTA Games Awards", steam: "The Steam Awards" };
const CROWN = kind => `<svg class="crown ${kind}" viewBox="0 0 32 24" aria-hidden="true"><path class="cr-body" d="M3 7.5l6.2 5.3L16 3l6.8 9.8L29 7.5l-2.6 12.2H5.6z"/><path class="cr-band" d="M5.4 19h21.2v3H5.4z"/><circle class="cr-gem" cx="16" cy="3.2" r="2.2"/><circle class="cr-gem" cx="3" cy="7.4" r="1.7"/><circle class="cr-gem" cx="29" cy="7.4" r="1.7"/><circle class="cr-jewel" cx="16" cy="15.6" r="1.6"/></svg>`;
const myGoty = () => (state.settings.my_goty && typeof state.settings.my_goty === "object") ? state.settings.my_goty : {};
const played = g => !!g && (["Completed", "Playing", "Paused", "Dropped"].includes(g.status) || (g.hours || 0) > 0 || (g.runs || 0) > 0 || !!g.completed || (factsOf(g).minutes || 0) > 0);
async function loadGoty(force) {
  const d = await Promise.resolve(api?.goty?.()).catch(() => null);
  if (!d?.years) return;
  const before = JSON.stringify(gotyState.data?.years);
  gotyState.data = d; gotyState.key = "";
  if (before !== JSON.stringify(d.years) || force) { if (state.view === "home") fillGotyHome(); if (state.view !== "home" && state.catalog === "games") render(); }
  if (!gotyState.retry && !d.checked) { gotyState.retry = true; setTimeout(() => loadGoty(), 20000); }   // the first weekly read is still running
}
/* game id -> what it won: { official: [years], mine: [years], also: [{ceremony, year}] } */
function gotyIndex() {
  const d = gotyState.data, mine = myGoty();
  const key = JSON.stringify([d?.checked, d?.years?.length, mine, state.games.length, state.syncedAt]);
  if (key === gotyState.key) return gotyState.index;
  const idx = new Map();
  const mark = (name, field, val) => {
    const m = name && rankMatch(name);
    if (!m || m.via === "collection") return;
    const g = m.g, e = idx.get(g.id) || { official: [], mine: [], also: [], names: new Set() };
    e[field].push(val); idx.set(g.id, e);
    (dupsOf.get(g) || []).forEach(c => idx.set(c.id, e));
  };
  for (const y of d?.years || []) {
    if (y.tga?.winner) mark(y.tga.winner, "official", y.year);
    (y.gj || []).forEach(n => mark(n, "also", { c: "gj", year: y.year }));
    if (y.bafta) mark(y.bafta, "also", { c: "bafta", year: y.year });
    if (y.steam) mark(y.steam, "also", { c: "steam", year: y.year });
  }
  for (const [year, name] of Object.entries(mine)) if (name) mark(name, "mine", +year);
  gotyState.index = idx; gotyState.key = key;
  return idx;
}
const gotyOf = g => (g && !g.virtual && !g.family && gotyIndex().get(g.id)) || null;
function gotyClass(g) {
  const e = gotyOf(g);
  if (!e || (!e.official.length && !e.mine.length)) return "";
  return `${e.official.length ? "fx-goty" : "fx-mygoty"} ${played(g) ? "" : "goty-unplayed"}`;
}
function gotyLayer(g) {
  const e = gotyOf(g);
  if (!e || (!e.official.length && !e.mine.length) || !played(g)) return "";
  const gold = !!e.official.length;
  // kept light: four tongues of flame and five sparks, all moved on the graphics card
  return `<div class="flames goty-flames ${gold ? "gold" : "white"}" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div class="sparks goty-sparks ${gold ? "gold" : "white"}" aria-hidden="true">${Array.from({ length: 5 }, (_, i) => `<i style="--i:${i * 2}"></i>`).join("")}</div>`;
}
function gotyMedals(g) {
  const e = gotyOf(g);
  if (!e) return "";
  const dim = played(g) ? "" : " dim";
  let out = "";
  if (e.official.length) out += `<span class="medal m-goty${dim}" title="Game of the Year ${e.official.join(", ")} · The Game Awards${dim ? " · not played yet" : ""}">${CROWN("gold")}</span>`;
  if (e.mine.length) out += `<span class="medal m-mygoty${dim}" title="Your Game of the Year ${e.mine.join(", ")}${dim ? " · not played yet" : ""}">${CROWN("white")}</span>`;
  return out;
}
/* one game's slot in a year's line-up: its cover (or the store art when it isn't in your library), crown and status */
function gotySlot(name, kind, year, opts = {}) {
  const m = name && rankMatch(name), g = m && m.via !== "collection" ? m.g : null;
  const has = g && played(g);
  const label = kind === "gold" ? "Game of the Year" : kind === "white" ? "Your Game of the Year" : opts.label || "";
  const state_ = !g ? "Not in your library" : has ? (g.completed ? `Finished ${fmtDate(g.completed)}` : statusOf(g) === "Completed" ? "Finished" : `${statusOf(g)}${g.hours ? ` · ${g.hours} h` : ""}`) : g.status === "Wishlist" ? "On your wishlist · not played yet" : "In your library · not played yet";
  const art = g ? `<div class="art" data-kind="game" data-id="${g.id}"></div>` : `<div class="art virtual" data-vname="${esc(name)}"><span>${esc(name)}</span></div>`;
  return `<article class="gslot ${kind} ${has ? "played" : "unplayed"} ${opts.small ? "small" : ""}" ${g ? `data-open="${g.id}" data-kind="game"` : `data-vgame="${esc(name)}"`} tabindex="0">
    <div class="gcover">${kind === "gold" || kind === "white" ? `<div class="gfire" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>` : ""}<div class="gbox">${art}</div><span class="gcrown">${CROWN(kind === "white" ? "white" : "gold")}</span></div>
    <div class="gtext">${label ? `<span class="gkind">${esc(label)}${year ? ` ${year}` : ""}</span>` : ""}<h4>${esc(name)}</h4>
      <small>${esc(state_)}</small>${has && (kind === "gold" || kind === "white") ? `<span class="milestone">Milestone of ${year}</span>` : ""}
      ${kind === "gold" || kind === "white" ? `<div class="gwins" data-wins="${esc(name)}"></div>` : ""}</div></article>`;
}
function gotyYearHTML(y, { nav = false } = {}) {
  if (!y) return "";
  const mine = myGoty()[y.year];
  const official = y.tga?.winner;
  const pending = !official && y.tga?.nominees?.length;
  const others = [["gj", y.gj?.length ? y.gj : []], ["bafta", y.bafta ? [y.bafta] : []], ["steam", y.steam ? [y.steam] : []]].filter(x => x[1].length);
  const years = (gotyState.data?.years || []).map(x => x.year);
  const i = years.indexOf(y.year);
  return `<div class="gyear" data-gyear="${y.year}">
    <header class="ghead">${nav ? `<button type="button" class="gnav" data-gstep="-1" aria-label="Newer year" ${i <= 0 ? "disabled" : ""}><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>` : ""}
      <h2><span>Game of the Year</span> <b>${y.year}</b></h2>
      ${nav ? `<button type="button" class="gnav" data-gstep="1" aria-label="Older year" ${i >= years.length - 1 ? "disabled" : ""}><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>` : ""}
      ${nav ? `<button type="button" class="gfold" data-gfold aria-label="Hide or show Game of the Year" title="Hide or show"><svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg></button>` : ""}
      ${y.year < 2014 ? `<span class="gnote">The Game Awards began in 2014; this year's crowns come from the other ceremonies.</span>` : pending ? `<span class="gnote">The Game Awards ${y.year} haven't been held yet: these are the nominees.</span>` : ""}</header>
    <div class="gstage">
      ${official ? gotySlot(official, "gold", y.year) : ""}
      ${pending ? `<div class="gnoms">${y.tga.nominees.map(n => gotySlot(n, "nominee", y.year, { small: true, label: "Nominee" })).join("")}</div>` : ""}
      ${mine ? gotySlot(mine, "white", y.year) : `<button type="button" class="gslot pick" data-gpick="${y.year}"><span class="gcrown">${CROWN("white")}</span><b>Choose your Game of ${y.year}</b><small>From the games you have that came out in ${y.year}</small></button>`}
      ${others.length ? `<div class="gothers"><h5>Also crowned</h5>${others.map(([c, names]) => names.map(n => `<div class="gother" ${(() => { const m = rankMatch(n); return m && m.via !== "collection" ? `data-open="${m.g.id}" data-kind="game"` : `data-vgame="${esc(n)}"`; })()} tabindex="0"><span class="cer c-${c}">${CROWN("gold")}</span><div><small>${esc(CEREMONY[c])}</small><b>${esc(n)}</b>${(() => { const m = rankMatch(n); return m && m.via !== "collection" && played(m.g) ? `<i class="pl">Played</i>` : `<i class="np">Not played</i>`; })()}</div></div>`).join("")).join("")}</div>` : ""}
    </div>
    ${mine ? `<div class="gfoot"><button type="button" class="linkish" data-gpick="${y.year}">Change your pick</button> <button type="button" class="linkish" data-gclear="${y.year}">Remove</button></div>` : ""}
  </div>`;
}
/* inside each History year: that year's Game of the Year frame on the right, the official winner and yours;
   one cover with both crowns when they're the same game; a game you haven't played sits apart, greyed out */
function gotyYear(year) { return (gotyState.data?.years || []).find(y => y.year === year) || null; }
function yearCrowns(year) {
  const y = gotyYear(year), mine = myGoty()[year];
  if (!y?.tga?.winner && !mine) return "";
  const lit = n => { const m = n && rankMatch(n); return m && m.via !== "collection" && played(m.g) ? "lit" : "dim"; };
  return `<span class="ycrowns">${y?.tga?.winner ? `<i class="${lit(y.tga.winner)}" title="Game of the Year: ${esc(y.tga.winner)}">${CROWN("gold")}</i>` : ""}${mine ? `<i class="${lit(mine)}" title="Your Game of the Year: ${esc(mine)}">${CROWN("white")}</i>` : ""}</span>`;
}
function gotyFrameCard(name, kinds, year) {
  const m = name && rankMatch(name), g = m && m.via !== "collection" ? m.g : null, has = g && played(g);
  const both = kinds.length > 1, gold = kinds.includes("gold");
  const title = both ? `Game of the Year ${year}, and yours` : gold ? `Game of the Year ${year}` : `Your Game of ${year}`;
  const art = g ? `<div class="art" data-kind="game" data-id="${g.id}"></div>` : `<div class="art virtual" data-vname="${esc(name)}"><span>${esc(name)}</span></div>`;
  const sub = !g ? "Not in your library" : has ? (g.completed ? `Finished ${fmtDate(g.completed)}` : statusOf(g)) : g.status === "Wishlist" ? "On your wishlist" : "Not played yet";
  return `<div class="yg ${gold ? "gold" : "white"} ${both ? "both" : ""} ${has ? "played" : "unplayed"}" ${g ? `data-open="${g.id}" data-kind="game"` : `data-vgame="${esc(name)}"`} tabindex="0">
    <div class="ygcover">${has ? `<div class="gfire" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>` : ""}<div class="gbox">${art}</div>
      <span class="ygcrowns">${kinds.map(k => `<i class="${k}">${CROWN(k)}</i>`).join("")}</span></div>
    <small class="ygk">${esc(title)}</small><b>${esc(name)}</b><small>${esc(sub)}</small>${has ? `<span class="milestone">Milestone of ${year}</span>` : ""}</div>`;
}
function yearGotyHTML(year) {
  const y = gotyYear(year), official = y?.tga?.winner, mine = myGoty()[year];
  if (!official && !mine && !(y?.tga?.nominees?.length)) return "";
  const same = official && mine && rankKey(official) === rankKey(mine);
  const cards = same ? [[official, ["gold", "white"]]] : [official && [official, ["gold"]], mine && [mine, ["white"]]].filter(Boolean);
  const isPlayed = n => { const m = rankMatch(n); return m && m.via !== "collection" && played(m.g); };
  const playedCards = cards.filter(c => isPlayed(c[0])), waiting = cards.filter(c => !isPlayed(c[0]));
  return `<aside class="ygoty" aria-label="Game of the Year ${year}">
    <h4>${CROWN("gold")}<span>Game of the Year ${year}</span></h4>
    ${!official && y?.tga?.nominees?.length ? `<p class="fine">The Game Awards ${year} haven't picked a winner yet.</p>` : ""}
    ${playedCards.length ? `<div class="ygrow">${playedCards.map(c => gotyFrameCard(c[0], c[1], year)).join("")}</div>` : ""}
    ${waiting.length ? `<div class="ygwait"><span class="ygwait-label">Not played yet</span><div class="ygrow">${waiting.map(c => gotyFrameCard(c[0], c[1], year)).join("")}</div></div>` : ""}
    ${mine ? "" : `<button type="button" class="ghost small ygpick" data-gpick="${year}">${CROWN("white")}Choose your Game of ${year}</button>`}
  </aside>`;
}
/* the other awards a crowned game won (Best Narrative, Best Art Direction…), as small chips under it */
function fillGotyWins(root) {
  root.querySelectorAll(".gwins[data-wins]").forEach(box => {
    const name = box.dataset.wins;
    Promise.resolve(api?.awards({ name })).then(r => {
      if (!box.isConnected || !r?.ceremonies) return;
      const wins = r.ceremonies.flatMap(c => c.wins.filter(w => !/game of the year|ultimate game|best game$/i.test(w.category)).map(w => ({ c: c.key, cat: w.category })));
      const noms = r.ceremonies.reduce((a, c) => a + c.noms.length, 0);
      if (!wins.length && !noms) return;
      box.innerHTML = wins.slice(0, 6).map(w => `<span class="gwin c-${w.c}" title="${esc(CEREMONY[w.c] || "")}">${esc(w.cat)}</span>`).join("") + (wins.length > 6 ? `<span class="gwin more">+${wins.length - 6} more</span>` : "") + (noms ? `<span class="gnom">${noms} other nomination${noms > 1 ? "s" : ""}</span>` : "");
    }).catch(() => {});
  });
}
function gotyDefaultYear() {
  const ys = gotyState.data?.years || [];
  return (ys.find(y => y.tga?.winner) || ys[0])?.year;
}
function fillGotyHome() { keepFocus($("#gotyHome"), fillGotyHomeNow); }
function fillGotyHomeNow() {
  const box = $("#gotyHome");
  if (!box) return;
  const ys = gotyState.data?.years || [];
  if (!ys.length) { box.hidden = true; return; }
  const year = state.gotyYear || gotyDefaultYear();
  box.hidden = false;
  box.innerHTML = gotyYearHTML(ys.find(y => y.year === year) || ys[0], { nav: true });
  box.querySelectorAll(".gyear").forEach(el => fxObserver.observe(el));
  activateArt(box); loadVirtualArt(box); fillGotyWins(box);
}
function fillGotyHistory() {
  const box = $("#gotyHistory");
  if (!box) return;
  const ys = (gotyState.data?.years || []).filter(y => y.year >= (state.gotyEarly ? 1980 : 2003));
  if (!ys.length) { box.hidden = true; return; }
  const sel = state.gotyHistYear || gotyDefaultYear();
  const idx = gotyIndex();
  // the timeline: one stop per year, its crowns lit if you played them, grey if not
  const stop = y => {
    const m = y.tga?.winner && rankMatch(y.tga.winner), mine = myGoty()[y.year], mm = mine && rankMatch(mine);
    const o = y.tga?.winner ? (m && m.via !== "collection" && played(m.g) ? "lit" : "dim") : "none";
    const w = mine ? (mm && played(mm.g) ? "lit" : "dim") : "none";
    return `<button type="button" class="gstop ${y.year === sel ? "on" : ""}" data-gyearpick="${y.year}" title="${esc([y.tga?.winner, mine && "yours: " + mine].filter(Boolean).join(" · ") || "No Game Awards winner")}"><span class="g-o ${o}">${CROWN("gold")}</span><span class="g-w ${w}">${CROWN("white")}</span><b>${y.year}</b></button>`;
  };
  box.hidden = false;
  box.innerHTML = `<div class="gtimeline-head"><h2>Games of the Year</h2><p class="intro">The official winner from The Game Awards wears gold, your own pick wears white. Lit crowns are games you've played; grey ones are still waiting for you.</p></div>
    <div class="gtimeline">${ys.map(stop).join("")}${state.gotyEarly ? "" : `<button type="button" class="gstop more" data-gearly>Earlier</button>`}</div>
    ${gotyYearHTML(ys.find(y => y.year === sel) || ys[0])}`;
  void idx;
  box.querySelectorAll(".gyear").forEach(el => fxObserver.observe(el));
  activateArt(box); loadVirtualArt(box); fillGotyWins(box);
}
/* choosing your Game of the Year: the games you have that came out that year */
async function openGotyPick(year) {
  const dlg = $("#gotyDialog");
  if (!dlg) return;
  dlg.dataset.year = year;
  $("#gotyPickTitle").textContent = `Your Game of ${year}`;
  $("#gotyPickQ").value = "";
  dlg.showModal();
  const pool = collapse(state.games.filter(g => g.status !== "Wishlist" && !g.virtual));
  const paint = years => {
    const q = rankKey($("#gotyPickQ").value || "");
    const order = (a, b) => (played(b) - played(a)) || ((b.score ?? -1) - (a.score ?? -1)) || a.name.localeCompare(b.name);
    const list = pool.filter(g => years[g.name] === +year && (!q || rankKey(g.name).includes(q))).sort(order);
    // searching also finds your games from other years (or with no known date), in case a date is off
    const extra = q ? pool.filter(g => years[g.name] !== +year && rankKey(g.name).includes(q)).sort(order).slice(0, 24) : [];
    const card = (g, other) => `<button type="button" class="gpick ${played(g) ? "" : "unplayed"}" data-gchoose="${esc(g.name)}"><div class="art" data-kind="game" data-id="${g.id}"></div><b>${esc(g.name)}</b><small>${other ? (years[g.name] ? `Came out in ${years[g.name]}` : "Release year unknown") : played(g) ? `${esc(statusOf(g))}${g.score != null ? ` · ${scoreText(g.score)}` : ""}` : "Not played yet"}</small></button>`;
    $("#gotyPickList").innerHTML = (list.length ? list.map(g => card(g, false)).join("") : `<p class="muted gpick-empty">No ${q ? "matching " : ""}games from ${year} found yet${years.__pending ? "" : ". Search for one by name to pick it anyway."}</p>`)
      + (extra.length ? `<h4 class="gpick-other">Your other games matching “${esc($("#gotyPickQ").value.trim())}”</h4>${extra.map(g => card(g, true)).join("")}` : "");
    activateArt($("#gotyPickList"));
  };
  const known = {};
  const poll = async () => {
    if (!dlg.open) return;
    const r = await Promise.resolve(api?.release_years(pool.map(g => g.name))).catch(() => null);
    if (!r) return;
    Object.assign(known, r.years);
    known.__pending = r.pending;
    $("#gotyPickNote").textContent = r.pending ? `Checking when ${r.pending} more of your games came out…` : "";
    paint(known);
    if (r.pending) setTimeout(poll, 3000);
  };
  $("#gotyPickQ").oninput = () => paint(known);
  paint(known);
  poll();
}
function setMyGoty(year, name) {
  const all = { ...myGoty() };
  if (name) all[year] = name; else delete all[year];
  state.settings.my_goty = all;
  api?.set_pref("my_goty", all);
  gotyState.key = "";
  try { FX.play.save(); } catch {}
  toast(name ? `${name} is your Game of ${year}.` : `Your Game of ${year} is cleared.`, "ok");
  render();
}
async function crownMine(g) {
  toast(`Checking when ${g.name} came out…`);
  const year = await Promise.resolve(api?.release_year(g.name)).catch(() => null);
  if (!year) return toast(`Couldn't find when ${g.name} came out. Open History, pick the year, and search for it in "Choose your Game of…".`, "err");
  const prev = myGoty()[year];
  setMyGoty(year, g.name);
  if (prev && prev !== g.name) toast(`${g.name} is your Game of ${year}, replacing ${prev}.`, "ok");
}
