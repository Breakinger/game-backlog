/* Masterlog front end, part 5 of 9: the game panel: overview, Wiki, Modify, books, multi-select.
   The parts load in order as plain scripts and share one global scope (see index.html). */
"use strict";

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
    <div class="line frow frow-status">${multi(asSet(f.status), "status", opts("books", "status")).replace('data-multi="status"', 'data-bmulti="status"')}</div>
    <div class="line frow frow-heat">${multi(asSet(f.prio), "prio", [...Object.keys(PRIO_ORDER), "None"], { None: "No priority" }).replace('data-multi="prio"', 'data-bmulti="prio"')}${multi(asSet(f.formats), "formats", opts("books", "format")).replace('data-multi="formats"', 'data-bmulti="formats"')}</div>
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
  const tray = p.media === "card" ? gameCardHTML(item, cached) : discHTML(item, cached);
  return `<div class="opencase p-${(item.platform || "x").replace(/\W+/g, "")}" style="--band:${p.band};--band-text:${p.text};--shell:${p.shell};--accent:${p.accent};--plat:${p.chip}">
    <div class="leaf back"><div class="tray">${tray}</div></div>
    <div class="leaf front">
      <div class="face outside"><div class="band">${emblem(item.platform)}<span class="wm">${esc(p.label)}</span>${item.platform === "Steam" && item.play_on === "Steam Deck" ? emblem("deck") : ""}</div><div class="art" data-kind="game" data-id="${item.id}">${art}<button type="button" class="artedit" data-coverpick title="Change cover" aria-label="Change cover"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M4 5h11l2 2h3v12H4zm2 2v10h12V9h-2l-2-2zm2 8 3-4 2 3 1.5-2 2.5 3z"/></svg></button></div><div class="hinge"></div><div class="sheen"></div></div>
      <div class="face inside"><div class="manual"><div class="manual-body" id="manual"><p class="muted">Opening the manual…</p></div></div></div>
    </div></div>`;
}
/* ---------- pick several games (Shift+click), then change them together with a right-click ---------- */
const selection = new Set();
const selKey = (kind, it) => `${kind}:${it.row}:${it.name}`;
const isSel = (kind, it) => selection.size > 0 && selection.has(selKey(kind, it));
function selectedItems() {
  const out = [];
  for (const k of selection) {
    const [kind, row, ...rest] = k.split(":"), name = rest.join(":");
    const list = kind === "book" ? state.books : state.games;
    const it = list.find(x => String(x.row) === row && x.name === name);
    if (it) out.push({ kind, item: it });
  }
  return out;
}
function toggleSelect(el) {
  const kind = el.dataset.kind === "book" ? "book" : "game", item = findItem(kind, el.dataset.id);
  if (!item) return;
  const target = item.virtual ? (kind === "game" ? state.games.find(x => x.row === item.row) || item : item) : item;
  const k = selKey(kind, target);
  // one kind at a time: games with games, books with books
  if (selection.size && [...selection][0].split(":")[0] !== kind) selection.clear();
  selection.has(k) ? selection.delete(k) : selection.add(k);
  try { FX.play.move(); } catch {}
  paintSelection();
}
function clearSelection() { if (!selection.size) return; selection.clear(); paintSelection(); }
function paintSelection() {
  document.body.classList.toggle("selecting", selection.size > 0);
  document.querySelectorAll("#view .case[data-kind]").forEach(el => {
    const kind = el.dataset.kind === "book" ? "book" : "game", it = findItem(kind, el.dataset.id);
    const base = it?.virtual && kind === "game" ? state.games.find(x => x.row === it.row) || it : it;
    el.classList.toggle("sel", !!base && selection.has(selKey(kind, base)));
  });
  let bar = document.getElementById("selbar");
  if (!selection.size) { bar?.remove(); return; }
  if (!bar) {
    bar = document.createElement("div"); bar.id = "selbar"; bar.className = "selbar";
    bar.innerHTML = `<b></b><span>Right-click any of them to change them together</span><button class="ghost small" data-selall>Select all shown</button><button class="ghost small" data-selclear>Clear</button>`;
    bar.addEventListener("click", e => {
      if (e.target.closest("[data-selclear]")) clearSelection();
      if (e.target.closest("[data-selall]")) {
        const kind = [...selection][0]?.split(":")[0] || "game";
        document.querySelectorAll(`#view .case[data-kind="${kind}"]`).forEach(el => { if (el.closest(".hero")) return; const it = findItem(kind, el.dataset.id); if (it) selection.add(selKey(kind, it.virtual && kind === "game" ? state.games.find(x => x.row === it.row) || it : it)); });
        paintSelection();
      }
    });
    document.body.append(bar);
  }
  const kind = [...selection][0].split(":")[0];
  bar.querySelector("b").textContent = `${selection.size} ${kind === "book" ? (selection.size === 1 ? "book" : "books") : (selection.size === 1 ? "game" : "games")} selected`;
}
function batchCtxMenu(x, y) {
  closeCtx();
  const picked = selectedItems();
  if (!picked.length) return;
  const kind = picked[0].kind, cat = kind === "book" ? "books" : "games";
  const o = (k, d) => state.options[cat]?.[k]?.length ? state.options[cat][k] : d;
  const sub = (label, key, values, fmt = v => v) => `<li class="has-sub" role="menuitem" tabindex="-1"><span>${label}</span><i>›</i><ul class="sub" role="menu">${values.map(v =>
    `<li role="menuitem" tabindex="-1" data-bset="${key}" data-val="${esc(v)}">${esc(fmt(v))}</li>`).join("")}</ul></li>`;
  const m = document.createElement("div");
  m.id = "ctx"; m.className = "ctx batch"; m.setAttribute("role", "menu"); m.dataset.batch = kind;
  m.innerHTML = `<div class="ctx-head">${picked.length} ${kind === "book" ? "books" : "games"}<small>${esc(picked.slice(0, 3).map(p => p.item.name).join(", "))}${picked.length > 3 ? "…" : ""}</small></div><ul>
    ${sub("Status", "status", o("status", FALLBACK_OPTIONS[cat].status))}
    ${sub("Priority", "priority", [...o("priority", FALLBACK_OPTIONS[cat].priority), ""], v => v || "No priority")}
    ${kind === "game" ? sub("Platform", "platform", o("platform", Object.keys(PLAT)), v => plat(v).label) : ""}
    ${sub("Format", "format", o("format", FALLBACK_OPTIONS[cat].format))}
    ${kind === "game" ? sub("Type", "type", ["", "Live service", "Modded"], v => v || "Normal game") : ""}
    ${kind === "game" ? `<li role="menuitem" tabindex="-1" data-bact="platinum">Mark as 100% / Platinum</li>` : ""}
    <li class="sep" role="separator"></li>
    <li role="menuitem" tabindex="-1" data-bact="clear">Clear selection</li>
    ${state.canEdit ? `<li role="menuitem" tabindex="-1" data-bact="delete" class="ctx-danger">Delete ${picked.length} ${kind === "book" ? "books" : "games"}…</li>` : ""}
  </ul>`;
  placeCtx(m, x, y);
}
async function batchAction(li) {
  const picked = selectedItems();
  if (!picked.length) return closeCtx();
  const kind = picked[0].kind, tab = kind === "book" ? "books" : "games";
  if (li.dataset.bact === "clear") { closeCtx(); return clearSelection(); }
  if (li.dataset.bact === "delete") {
    if (!li.dataset.armed) { li.dataset.armed = "1"; li.classList.add("armed"); li.textContent = `Click again to delete all ${picked.length}`; return; }
    closeCtx();
    const list = tab === "books" ? state.books : state.games, undo = [], failed = [];
    // bottom rows first, so the rows of the ones still to go don't shift
    for (const { item } of picked.sort((a, b) => b.item.row - a.item.row)) {
      const r = await Promise.resolve(api?.delete_item(tab, item.row, item.name)).catch(e => ({ error: String(e) }));
      if (!r || r.error) { failed.push(item.name); continue; }
      undo.push(r.undo); const at = list.indexOf(item); if (at >= 0) list.splice(at, 1);
    }
    clearSelection(); rankIndex = null; virtualKey = null; render();
    try { FX.play.back(); } catch {}
    toast(`Deleted ${undo.length} ${kind === "book" ? "books" : "games"}${failed.length ? `; couldn't delete ${failed.join(", ")}` : ""}.`, failed.length ? "err" : "ok", undo.length ? { label: "Undo", run: async () => {
      for (const u of undo.slice().reverse()) await Promise.resolve(api.undo_delete(u)).catch(() => null);
      toast("They're back.", "ok"); sync(true);
    } } : undefined);
    return setTimeout(() => sync(false), 2500);
  }
  const changes = li.dataset.bact === "platinum" ? { platinum: true } : { [li.dataset.bset]: li.dataset.val };
  closeCtx();
  const todo = picked.filter(({ item }) => Object.entries(changes).some(([k, v]) => (item[k] ?? (typeof v === "boolean" ? false : "")) !== v));
  if (!todo.length) return toast("They already are.");
  const before = todo.map(({ item }) => ({ ...item }));
  todo.forEach(({ item }) => Object.assign(item, changes));
  render();
  let failed = 0;
  for (let i = 0; i < todo.length; i++) {
    const r = await Promise.resolve(api?.edit(tab, before[i].row, before[i].name, changes)).catch(e => ({ error: String(e) }));
    if (!r || r.error) { failed++; Object.assign(todo[i].item, before[i]); }
  }
  render();
  try { FX.play.save(); } catch {}
  const [k, v] = Object.entries(changes)[0];
  toast(failed ? `Changed ${todo.length - failed} of ${todo.length}; ${failed} couldn't be saved.` : `${todo.length} ${kind === "book" ? "books" : "games"}: ${k.replace("_", " ")} set to ${v === true ? "yes" : v || "none"}.`, failed ? "err" : "ok");
  setTimeout(() => sync(false), 1500);
}

/* the disc or game card inside the case, after the real thing on each system (no logos, just the look) */
function discKind(platform) {
  return { PS2: "ps2", PS4: "ps4", PS5: "ps5" }[platform] || "pc";
}
function discHTML(item, cached) {
  const k = discKind(item.platform);
  const img = cached ? `<img alt="" decoding="async" src="${cached}">` : `<div class="dfall">${esc(item.name)}</div>`;
  const band = k === "ps4" ? `<div class="dband"><b>PS4</b></div>` : k === "ps5" ? `<div class="dband"><b>PS5</b></div>` : "";
  const arc = { ps2: "PlayStation 2 · DVD-ROM", ps4: "", ps5: "", pc: "PC DVD-ROM · " + (item.developer || "Windows") }[k];
  const id = "arc" + item.id;
  return `<div class="bigdisc disc-${k}">
    <div class="dlabel">${img}${band}</div>
    ${arc ? `<svg class="darc" viewBox="0 0 100 100" aria-hidden="true"><defs><path id="${id}" d="M50 50 m-43 0 a43 43 0 1 1 86 0 a43 43 0 1 1 -86 0"/></defs><text><textPath href="#${id}" startOffset="${k === "pc" ? "2%" : "60%"}">${esc(arc)}</textPath></text></svg>` : ""}
    <div class="hub"></div><div class="dglare"></div></div>`;
}
function gameCardHTML(item, cached) {
  const two = item.platform === "Switch 2";
  return `<div class="cardslot"><div class="gcard ${two ? "sw2" : "sw1"}">
    <div class="gc-label">${cached ? `<img alt="" decoding="async" src="${cached}">` : `<span>${esc(item.name)}</span>`}<i class="gc-strip">${two ? "SWITCH 2" : "SWITCH"}</i></div>
    <div class="gc-grip"></div></div></div><div class="clips"></div>`;
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
    ? `<h5>${g.dlc_owned ? "DLC included" : "DLC available"}</h5><ul class="mdlc">${list.map(d => `<li class="${g.dlc_owned ? "have" : ""}">${d.art ? `<img alt="" loading="lazy" decoding="async" src="${esc(d.art)}">` : `<span class="mdlc-blank"></span>`}<span class="mdlc-t">${esc(shortDlc(g, d.name))}${d.major ? ` <b>Major</b>` : ""}${g.dlc_owned ? ` <em>✓ owned</em>` : d.release && d.coming ? ` <em>${esc(d.release)}</em>` : ""}</span></li>`).join("")}</ul>`
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
  const tabs = kind === "game" ? [["overview", "Overview"], ["ratings", "Ratings"], ["dlc", "DLC"], ...(item.type === "Live service" ? [["milestones", "Milestones"]] : []), ["watch", "Watch"], ["wiki", "Wiki"], ["news", "News"]]
    : [["overview", "Overview"], ["wiki", "About"]];
  if (!same) {
    try { FX.play.open(); } catch {}
    panel.innerHTML = `<div class="cv-bg"><div class="cv-art" id="cvArt"></div></div>
      <button class="icon close" aria-label="Close">✕</button><button class="icon refreshinfo" data-refresh title="${kind === "game" ? "Refresh info: fetch cover, synopsis, ratings and media again" : "Refresh info: fetch the cover, ratings and description again"}" aria-label="Refresh info">↻</button>
      <div class="cv-stage">${openCaseHTML(kind, item)}</div>
      <div class="cv-info"><div class="cv-head"><div class="cv-title"><h2>${esc(item.name)}</h2><button class="modbtn" data-ptab="edit" aria-selected="${tab === "edit"}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17.5V20h2.5L17.6 8.9l-2.5-2.5zM19.7 6.8a1 1 0 0 0 0-1.4l-1.1-1.1a1 1 0 0 0-1.4 0l-1 1 2.5 2.5z"/></svg>Modify</button></div><div class="pills">${kind === "game" ? pillsHTML(item) : bookPills(item)}</div></div>
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
      // the disc or card label shows the cover as soon as it's ready
      loadCover(item).then(u => { if (!u || !still()) return; document.querySelectorAll("#panel .dlabel, #panel .gc-label").forEach(el => { if (el.querySelector("img")) return; el.querySelector(".dfall, span")?.remove(); el.insertAdjacentHTML("afterbegin", `<img alt="" decoding="async" src="${u}">`); }); }).catch(() => {});
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
    Promise.resolve(api?.awards(item)).then(r => { const box = $("#ovAwards"), html = awardsHTML(r); if (box && still() && html) { box.innerHTML = `<h3>Awards</h3>${html}`; box.hidden = false; } }).catch(() => {});
    Promise.resolve(api?.release_info?.({ name: item.name, release: item.release || "" })).then(r => { const box = $("#ovRelease"); if (box && still() && r?.date) { box.innerHTML = releaseHTML(item, r); box.hidden = false; } }).catch(() => {});
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
  if (fa.idle_minutes) kv.push(["Idled for cards", `${Math.round(fa.idle_minutes / 6) / 10} h, not counted as played`]);
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
    <section class="ovrelease" id="ovRelease" hidden></section>
    <section class="ovawards" id="ovAwards" hidden></section>
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
/* ---------- Wiki tab: the article in readable chapters, how it runs, its wikis and maps ---------- */
const DECK_TONE = { Verified: "good", Playable: "ok", Unsupported: "bad" };
const PROTON_TONE = { platinum: "good", gold: "good", silver: "ok", bronze: "ok", borked: "bad", native: "good" };
const VAL_ICON = { yes: "✓", no: "✕", fixable: "⚒", limited: "◐", "always on": "✓" };
function paras(text, max = 99) {
  return String(text || "").split(/\n{2,}|\n(?=[A-Z])/).map(t => t.trim()).filter(Boolean).slice(0, max)
    .map(t => /^[A-Z][^.!?]{2,60}$/.test(t) ? `<h5>${esc(t)}</h5>` : `<p>${esc(t)}</p>`).join("");
}
function wikiHTML(g, w) {
  if (!w) return `<p class="muted">Couldn't reach the wikis just now. Check your connection, then press ↻ to try again.</p>`;
  const wp = w.wikipedia, ar = w.article || {}, pc = w.pcgw, dk = w.deck, fd = w.fandom, fx = w.fextralife, mg = w.mapgenie;
  const failed = new Set(w.failed || []);
  const inside = (url, title, label) => `<button class="wbtn" data-inside="${esc(url)}" data-title="${esc(title)}">${esc(label)}</button>`;
  const lead = ar.lead || wp?.extract || "";
  const leadParas = lead.split(/\n+/).filter(Boolean);
  const article = wp ? `<section class="wcard wp">
      ${wp.thumb ? `<img class="wthumb" alt="" loading="lazy" src="${esc(wp.thumb)}">` : ""}
      <header><h3>${esc(wp.title)}</h3>${wp.description ? `<small>${esc(wp.description)}</small>` : ""}</header>
      <div class="wlead">${leadParas.slice(0, 2).map(t => `<p>${esc(t)}</p>`).join("")}</div>
      ${leadParas.length > 2 ? `<details class="wmore"><summary>Read the whole introduction</summary>${leadParas.slice(2).map(t => `<p>${esc(t)}</p>`).join("")}</details>` : ""}
      ${(ar.facts || []).length ? `<dl class="wfacts">${ar.facts.map(f => `<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join("")}</dl>` : ""}
      ${(ar.sections || []).length ? `<div class="wchapters">${ar.sections.map((sec, i) => `<details class="wchap ${sec.spoiler ? "spoil" : ""}" name="wchap" data-chap="${i}">
          <summary><b>${esc(sec.title)}</b>${sec.spoiler ? `<i>Spoilers</i>` : `<span>${esc(sec.text.split(/(?<=[.!?])\s/)[0].slice(0, 110))}…</span>`}</summary>
          <div class="wtext">${paras(sec.text)}</div></details>`).join("")}</div>` : ""}
      <footer>${inside(wp.url, wp.title, "Read on Wikipedia")}<button class="wbtn ghosty" data-url="${esc(wp.url)}">Open in browser</button></footer>
    </section>`
    : `<section class="wcard wp empty"><h3>Wikipedia</h3><p class="muted">${failed.has("wikipedia") ? "Wikipedia didn't answer just now. Press ↻ above to try again." : "No Wikipedia article for this one."}</p></section>`;
  const supportRow = f => `<li class="v-${esc(f.value.replace(/\s/g, ""))}" title="${esc(f.note || "")}"><i>${VAL_ICON[f.value] || "·"}</i><span>${esc(f.label)}</span><small>${esc(f.value === "fixable" ? "fixable" : f.value === "limited" ? "limited" : "")}</small></li>`;
  const paths = (label, obj) => {
    const plats = Object.entries(obj || {}).filter(([p]) => /windows|steam play|linux/i.test(p));
    if (!plats.length) return "";
    return `<div class="wpaths"><h5>${label}</h5>${plats.map(([p, list]) => list.map(path => `<div class="wpath"><small>${esc(p)}</small><code>${esc(path)}</code>
      <button class="wbtn tiny" data-copy="${esc(path)}">Copy</button>${/^%[A-Z]+%/.test(path) && IS_WINDOWS ? `<button class="wbtn tiny" data-openpath="${esc(path)}">Open folder</button>` : ""}</div>`).join("")).join("")}</div>`;
  };
  const runs = (pc || dk) ? `<section class="wcard runs-on"><h3>How it runs</h3>
      ${dk ? `<div class="wbadges">${dk.deck ? `<span class="wbadge ${DECK_TONE[dk.deck]}"><b>Steam Deck</b>${esc(dk.deck)}</span>` : ""}${dk.proton ? `<button class="wbadge ${PROTON_TONE[dk.proton] || "ok"}" data-url="${esc(dk.proton_url)}"><b>ProtonDB</b>${esc(dk.proton[0].toUpperCase() + dk.proton.slice(1))}</button>` : ""}</div>` : ""}
      ${pc ? `${(pc.video.length || pc.input.length) ? `<ul class="wsupport">${[...pc.video, ...pc.input].map(supportRow).join("")}</ul>` : ""}
        ${pc.fixes.length ? `<h5>Essential fixes</h5><div class="wchips">${pc.fixes.map(f => inside(f.url, `${pc.title}: ${f.title}`, f.title)).join("")}</div>` : ""}
        ${pc.issues.length ? `<h5>Known issues, with fixes</h5><div class="wchips">${pc.issues.map(f => inside(f.url, `${pc.title}: ${f.title}`, f.title)).join("")}</div>` : ""}
        ${paths("Saves", pc.saves)}${paths("Settings files", pc.config)}
        <footer>${inside(pc.url, pc.title, "Open on PCGamingWiki")}</footer>` : ""}
    </section>` : "";
  const wikiCard = (wk, kind) => wk ? `<div class="wcom ${kind}">
      ${wk.article?.thumb ? `<img alt="" loading="lazy" src="${esc(wk.article.thumb)}">` : wk.logo ? `<img alt="" loading="lazy" src="${esc(wk.logo)}">` : `<span class="wglyph">${kind === "fandom" ? "F" : "W"}</span>`}
      <div><b>${esc(wk.name)}</b>${wk.article?.abstract ? `<p>${esc(wk.article.abstract)}</p>` : `<p class="muted">${kind === "fandom" ? "Community wiki" : "Guides, builds, bosses and item locations"}</p>`}
      <form class="wsearch" data-wikisearch="${esc(wk.url)}" data-wikikind="${kind}" data-wikiname="${esc(wk.name)}"><input type="search" placeholder="Search ${esc(wk.name)}" aria-label="Search ${esc(wk.name)}"><button class="wbtn" type="submit">Search</button></form>
      <div class="wrow">${wk.article ? inside(wk.article.url, wk.article.title, "Open the article") : ""}${inside(wk.url, wk.name, "Open the wiki")}</div></div></div>` : "";
  const community = (fd || fx) ? `<section class="wcard"><h3>Game wikis</h3>${wikiCard(fx, "fextralife")}${wikiCard(fd, "fandom")}</section>` : "";
  const maps = mg ? `<section class="wcard"><h3>Interactive maps</h3><p class="muted">Every item, collectible and secret marked, from Map Genie.</p>
      <div class="mapgrid">${mg.maps.map(m => `<button class="mapbtn" data-inside="${esc(m.url)}" data-title="${esc(mg.game)}: ${esc(m.name)}"><span class="mapglyph" aria-hidden="true"></span>${esc(m.name)}</button>`).join("")}</div></section>` : "";
  const more = `<section class="wcard"><h3>More places to look</h3><div class="wchips">${(w.links || []).map(l => inside(l.url, `${g.name}: ${l.label}`, l.label)).join("")}${!CONSOLES.has(g.platform) ? `<button class="wbtn" data-nexus="${esc(g.name)}">Nexus Mods</button>` : ""}</div></section>`;
  return `<div class="wikiview">${article}${runs}${community}${maps}${more}</div>`;
}
/* the real-world awards, The Game Awards first */
const CEREMONY_MARK = { tga: "TGA", gj: "GJ", bafta: "BAFTA", steam: "STEAM" };
function awardsHTML(r, { title = true } = {}) {
  const cs = r?.ceremonies || [];
  if (!cs.length) return "";
  const yr = x => x.year ? `<small>${esc(x.year)}</small>` : "";
  return `${title ? `<p class="aw-title">${r.wins ? `${r.wins} win${r.wins === 1 ? "" : "s"}` : "No wins"}${r.noms ? `<span> and ${r.noms} nomination${r.noms === 1 ? "" : "s"}</span>` : ""}${r.goty ? `<em>${r.goty}× Game of the Year</em>` : ""}</p>` : ""}
    <div class="ceremonies">${cs.map(c => `<div class="ceremony c-${c.key}">
      <div class="c-mark" aria-hidden="true">${CEREMONY_MARK[c.key]}</div>
      <div class="c-body"><b>${esc(c.name)}</b>
        ${c.wins.length ? `<ul class="c-wins">${c.wins.map(x => `<li class="${/game of the year/i.test(x.category) ? "goty" : ""}">${esc(x.category || "Winner")}${yr(x)}</li>`).join("")}</ul>` : ""}
        ${c.noms.length ? `<ul class="c-noms">${c.noms.map(x => `<li>${esc(x.category || "Nominee")}${yr(x)}</li>`).join("")}</ul>` : ""}
      </div></div>`).join("")}</div>
    ${r.url ? `<p class="fine">From <a role="link" tabindex="0" data-url="${esc(r.url)}">Wikipedia</a>.</p>` : ""}`;
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
  ["release", "Release date", "date"], ["genre", "Genre", "text"], ["store_link", "Store link", "text"], ["notes", "Notes", "textarea"],
  ["second_chance", "Second chance", "check"], ["upgrade_owned", "Upgrade owned", "check"], ["dlc_owned", "DLC owned", "check"], ["dlc_done", "DLC done", "check"], ["platinum", "100% / Platinum", "check"], ["modded", "Modded", "check"]];
const BOOK_FORM = [["name", "Title", "text"], ["author", "Author", "text"], ["series", "Series", "text"], ["number", "Number in series", "number"],
  ["status", "Status", "select"], ["priority", "Priority", "select"], ["format", "Format", "select"], ["score", "Score (0–10)", "number"],
  ["store_link", "Store link", "text"], ["notes", "Notes", "textarea"]];
/* ---------- Modify: the game's details, laid out the way you think about them ---------- */
const CHIP_FIELDS = new Set(["status", "priority", "play_on", "format", "type"]);
const FORM_GROUPS = {
  games: [["Progress", ["status", "priority"]], ["Where you play it", ["platform", "play_on", "format", "type", "upgrade", "migrate_to"]], ["Your take", ["hours", "score"]], ["Details", ["release", "genre", "store_link", "notes"]]],
  books: [["Progress", ["status", "priority"]], ["The book", ["author", "series", "number", "format"]], ["Your take", ["score"]], ["Details", ["store_link", "notes"]]],
};
const NONE_LABEL = { priority: "None", type: "Normal", play_on: "Any", format: "Not set" };
function fieldHTML(cat, [k, label, type], item) {
  const v = item?.[k];
  if (type === "select" && CHIP_FIELDS.has(k) && opts(cat, k).length <= 8) {
    const list = k === "status" ? opts(cat, k) : k === "type" || k === "play_on" ? ["", ...opts(cat, k)] : [...opts(cat, k), ""];
    const tint = o => k === "status" ? STATUS_COLOR[o] : k === "priority" ? PRIO_COLOR[o] : "";
    return `<fieldset class="mf chips" data-field="${k}"><legend>${label}</legend><div class="chiprow">${list.map(o => `<label class="mchip" style="${tint(o) ? `--c:${tint(o)}` : ""}"><input type="radio" name="${k}" value="${esc(o)}" ${(v ?? "") === o ? "checked" : ""}><span>${esc(o || NONE_LABEL[k] || "None")}</span></label>`).join("")}</div></fieldset>`;
  }
  if (type === "select") return `<label class="mf" data-field="${k}">${label}<select name="${k}"><option value="">Not set</option>${opts(cat, k).map(o => `<option value="${esc(o)}" ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
  if (k === "score") {
    const has = v != null && v !== "";
    return `<div class="mf score ${has ? "" : "unset"}" data-field="score"><span class="mlabel">${label}</span><div class="scorebox"><b class="scorenum">${has ? (+v).toFixed(1).replace(/\.0$/, "") : "–"}</b><small>/10</small>
      <input type="range" min="0" max="10" step="0.5" value="${has ? v : 5}" data-score aria-label="Score">
      <button type="button" class="mclear" data-scoreclear title="No score">Clear</button></div><input type="hidden" name="score" value="${has ? v : ""}"></div>`;
  }
  if (type === "number") return `<label class="mf num" data-field="${k}">${label}<span class="stepper"><button type="button" data-step="-1" aria-label="Less">−</button><input name="${k}" type="number" step="${k === "number" ? 1 : 0.1}" min="0" value="${v ?? ""}" placeholder="–"><button type="button" data-step="1" aria-label="More">+</button></span></label>`;
  if (type === "date") return `<label class="mf" data-field="${k}">${label}<input name="${k}" type="date" value="${esc(v || "")}" max="2100-12-31"><small class="mhint">Set it when two games share a name (an original and its remake): it picks the right cover and details.</small></label>`;
  if (type === "textarea") return `<label class="mf wide" data-field="${k}">${label}<textarea name="${k}" rows="3" placeholder="Anything worth remembering">${esc(v || "")}</textarea></label>`;
  if (type === "check") return `<label class="mswitch" data-field="${k}"><input name="${k}" type="checkbox" ${v ? "checked" : ""}><i aria-hidden="true"></i><span>${label}</span></label>`;
  return `<label class="mf ${k === "store_link" ? "wide" : ""}" data-field="${k}">${label}<input name="${k}" type="text" value="${esc(v ?? "")}" ${k === "store_link" ? 'placeholder="https://"' : ""}></label>`;
}
function editHTML(cat, item) {
  if (item?.family) return `<div class="mgroup famnote"><h4>Shared with you</h4><p>${esc(item.name)} is in your Steam Family's library, shared by ${esc((item.owners || []).join(", ") || "a family member")}. It isn't in your sheet, so there's nothing to change yet.</p>
    ${state.canEdit ? `<button class="primary" data-famadd="${item.id}">Add it to Masterlog</button>` : ""}</div>`;
  if (!state.canEdit) return `<p class="muted">To change things here, connect the app to your sheet: open Settings and follow "How to connect your sheet". Until then, edit the sheet itself and the app picks up the changes on the next sync.</p>`;
  const form = cat === "games" ? GAME_FORM : BOOK_FORM, byKey = Object.fromEntries(form.map(f => [f[0], f]));
  return `<form class="modify" id="editForm" data-cat="${cat}" autocomplete="off">
    <label class="mname" data-field="name"><span>${byKey.name[1]}</span><input name="name" type="text" value="${esc(item?.name ?? "")}" required></label>
    ${FORM_GROUPS[cat].map(([title, keys]) => `<section class="mgroup ${title === "Details" ? "mdetails" : ""}"><h4>${title}</h4><div class="mgrid">${keys.filter(k => byKey[k]).map(k => fieldHTML(cat, byKey[k], item)).join("")}</div></section>`).join("")}
    ${cat === "games" ? `<section class="mgroup mextras"><h4>Extras</h4><div class="mswitches">${form.filter(f => f[2] === "check").map(f => fieldHTML(cat, f, item)).join("")}</div></section>
      <section class="mgroup"><h4>Top 100</h4><div class="mrank"><label class="mf num" data-field="top_rank">Place<input type="number" name="top_rank" min="1" max="${(state.ranking || []).length + 1}" value="${rankOf(item) || ""}" placeholder="Not ranked"></label>
        <p class="fine">Type 55 and it goes to #55; everything from #55 down moves one place. Clear it to take the game out.</p>
        <button type="button" class="mcrown" data-classic="${item.id}">${isClassic(item) ? "Remove All Time Classic" : "Crown as All Time Classic"}</button></div></section>` : ""}
    <section class="mgroup mtools"><div class="mrow"><button type="button" class="ghost small" data-coverpick>Change cover…</button><button type="button" class="ghost small" data-refresh>Refresh info</button></div>
      <p class="fine">Finish and drop dates, runs and "Beaten on" are filled in by the sheet itself. Renaming also renames the game's replays and fetches the cover for the new name.</p></section>
    <div class="msave" id="msave"><span id="mcount">No changes yet</span><button type="button" class="ghost small" data-discard>Discard</button><button type="submit" class="primary">Save changes</button></div>
  </form>`;
}
function modifyDirty(form) {
  const item = panelItem && findItem(panelItem.kind, panelItem.id);
  if (!item || !form) return;
  const ch = readForm(form, form.dataset.cat, item);
  const rankChanged = !!form.elements.top_rank && String(form.elements.top_rank.value) !== String(rankOf(item) || "");
  const n = Object.keys(ch).length + (rankChanged ? 1 : 0);
  form.querySelectorAll("[data-field]").forEach(el => el.classList.toggle("changed", el.dataset.field in ch || (el.dataset.field === "top_rank" && rankChanged)));
  form.classList.toggle("dirty", n > 0);
  const c = form.querySelector("#mcount"); if (c) c.textContent = n ? `${n} change${n === 1 ? "" : "s"} not saved yet` : "No changes yet";
}
function readForm(form, cat, item) {
  const fields = cat === "games" ? GAME_FORM : BOOK_FORM;
  const changes = {};
  for (const [k, , type] of fields) {
    const el = form.elements[k];
    if (!el) continue;
    let v = type === "check" ? el.checked : (el.value || "").trim();
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
  if (head) { head.querySelector("h2").textContent = item.name; head.querySelector(".pills").innerHTML = panelItem.kind === "game" ? pillsHTML(item) : bookPills(item); }
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

/* when it came out: the first release and where, later ports, and newer versions of it */
function releaseHTML(g, r) {
  const plats = (r.platforms || []).join(", ");
  const newer = (r.newer || []).map(n => {
    const m = rankMatch(n.name), own = m && m.via !== "collection" && rankKey(m.g.name) !== rankKey(g.name) ? m.g : null;
    const y = n.date ? new Date(n.date * 1000).getUTCFullYear() : "";
    return `<button type="button" class="relnewer" ${own ? `data-open="${own.id}" data-kind="game"` : `data-url="https://store.steampowered.com/search/?term=${encodeURIComponent(n.name)}"`}>
      <b>${esc(n.name)}</b><small>${esc(n.kind)}${y ? `, ${y}` : ""}${own ? " · in your library" : ""}</small></button>`;
  }).join("");
  return `<div class="relmain"><small>Released</small><b>${esc(fmtRelease(r.date, r.precision))}</b>${plats ? `<span>on ${esc(plats)}</span>` : ""}${r.manual ? `<i class="relset" title="The release date you set">set by you</i>` : ""}</div>
    ${(r.ports || []).map(p => `<div class="relport"><span class="relarrow" aria-hidden="true">↳</span>${esc(p.platform)} port <b>${esc(fmtRelease(p.date, p.precision))}</b></div>`).join("")}
    ${newer ? `<div class="relnew"><span>Newer version${(r.newer || []).length > 1 ? "s" : ""}:</span>${newer}</div>` : ""}`;
}
