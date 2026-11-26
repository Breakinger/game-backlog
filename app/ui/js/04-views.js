/* Masterlog front end, part 4 of 9: the main views and copying between your PCs.
   The parts load in order as plain scripts and share one global scope (see index.html). */
"use strict";

/* ---------- views ---------- */
function renderTabs() {
  document.body.dataset.catalog = state.catalog;
  document.querySelectorAll(".catalog").forEach(c => c.setAttribute("aria-selected", String(c.dataset.catalog === state.catalog)));
  const on = v => state.view === v || (v === "wishlist" && WISH_VIEWS.includes(state.view));
  $("#tabs").innerHTML = TABS[state.catalog].map(t => t === "|" ? `<span class="tabsep" aria-hidden="true"></span>`
    : `<button class="tab" data-view="${t[0]}" role="tab" aria-selected="${on(t[0])}">${t[1]}</button>`).join("");
}
/* the Wishlist has three faces: the games, their deals, and when the unreleased ones come out */
const WISH_VIEWS = ["wishlist", "deals", "soon"];
const wishTabs = () => `<nav class="subtabs" role="tablist" aria-label="Wishlist">${[["wishlist", "Wishlist"], ["deals", "Deals"], ["soon", "Coming soon"]].map(([v, l]) =>
  `<button class="subtab" data-view="${v}" role="tab" aria-selected="${state.view === v}">${l}</button>`).join("")}</nav>`;
// a redraw keeps your place: whatever had focus (by game, tab or id) gets it back
function focusKey(el) {
  if (!el || el === document.body || !$("#view").contains(el) && !$("#tabs").contains(el)) return null;
  if (el.dataset.id && el.dataset.kind) return `[data-id="${el.dataset.id}"][data-kind="${el.dataset.kind}"]${el.classList.contains("case") ? ".case" : ""}`;
  if (el.dataset.view) return `${el.classList.contains("subtab") ? ".subtab" : ".tab"}[data-view="${el.dataset.view}"]`;
  if (el.id) return `#${CSS.escape(el.id)}`;
  return null;
}
function render() {
  const fk = focusKey(document.activeElement);
  renderView();
  if (selection.size) paintSelection();
  if (fk && (!document.activeElement || document.activeElement === document.body)) {
    const el = [...document.querySelectorAll(`#view ${fk}, #tabs ${fk}`)].find(x => !x.closest(".hero"));
    el?.focus({ preventScroll: true });
  }
}
function renderView() {
  lazyQueue.length = 0; lazyToken++;
  renderTabs();
  const v = $("#view");
  hidePeek();
  if (state.catalog === "games" && state.view === "soon") { v.innerHTML = soonShellHTML(); fillSoon(); return; }
  if (state.catalog === "news") { v.innerHTML = newsShellHTML(state.view); loadNews(state.view); return; }
  const empty = isBooks() ? !state.books.length && !state.games.length : !state.games.length;
  if (empty) { v.innerHTML = welcomeHTML(); bindWelcome(); return; }
  if (state.view === "home") v.innerHTML = homeHTML();
  else if (state.view === "stats") v.innerHTML = yearsHTML();
  else if (state.view === "ranking") { v.innerHTML = rankingHTML(); activateArt(v); loadVirtualArt(v); fillClassicAwards(); return; }
  else if (state.view === "deals") { v.innerHTML = dealsHTML(); activateArt(v); loadDeals(false); return; }
  else if (state.view === "backlog") v.innerHTML = backlogHTML();
  else if (state.view === "shelf") v.innerHTML = bookShelfHTML();
  else if (state.view === "books") v.innerHTML = bookLibraryHTML();
  else if (state.view === "bookyears") v.innerHTML = bookYearsHTML();
  else v.innerHTML = libraryHTML();
  activateArt(v);
  drainLazy(v);
  if (state.view === "home") { updateHero(heroGame(), true); fillWhatsNew(); fillGotyHome(); loadEvents(); }
  if (state.view === "stats") { fillGotyHistory(); loadVirtualArt(v); }
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
      ${lazyCases(s.items, "shelf-row", 10)}
    </section>`).join("");
  return `<section class="events" id="eventsHome" hidden></section><section class="whatsnew" id="whatsNew" hidden></section><section class="hero"><div class="hero-bg" id="heroBg"></div><div id="heroCase"></div><div id="heroText"></div></section><section class="gotyhome" id="gotyHome" hidden></section>${rows}`;
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
/* a column appears only where it means something: no Finished, Runs, Hours or Score for games nobody has played
   yet (your backlog), and Play on only for PC games, since every console game plays on its console */
function gameListHTML(list) {
  const any = fn => list.some(fn);
  const cols = [
    ["Game", true], ["Status", true], ["Priority", true],
    ["Finished", any(g => g.completed || g.status === "Completed" || g.dropped)], ["Platform", true],
    ["Play on", any(g => !CONSOLES.has(g.platform))], ["Format", true], ["Upgrade", any(g => g.upgrade && g.upgrade !== "No upgrade")],
    ["DLC", true], ["100%", any(g => played(g))], ["Modded", true],
    ["Runs", any(g => g.runs)], ["Hours", any(g => g.hours_text)], ["Score", any(g => g.score != null)], ["Genre", true],
  ];
  const on = Object.fromEntries(cols);
  const td = (k, html) => on[k] ? html : "";
  return `<div class="sheet-wrap"><table class="sheet"><thead><tr>${cols.filter(c => c[1]).map(([h]) => `<th>${h}</th>`).join("")}</tr></thead><tbody>
    ${list.map(g => {
      const p = plat(g.platform);
      const canCheck = state.canEdit && owned(g) && g.status !== "Completed" && g.type !== "Live service";
      return `<tr data-id="${g.id}" data-kind="game" tabindex="0" class="${g.status === "Wishlist" ? "unowned" : ""}">
        <td class="name ${g.status === "Completed" ? "done" : ""}">${esc(g.name)}${state.updated[g.name] ? ` <span class="fresh-dot" title="Newly updated">NEW</span>` : ""}${canCheck ? `<button class="rowcheck" data-qc="${g.id}" data-qkind="game" title="Mark as completed">✓</button>` : ""}</td>
        <td>${selectCell("games", "status", g)}</td><td>${selectCell("games", "priority", g)}</td>
        ${td("Finished", `<td class="date">${g.completed ? "✓ " + g.completed : g.status === "Completed" ? "unknown" : g.dropped ? "✗ " + g.dropped : ""}</td>`)}
        <td><span class="platpill" style="background:${p.chip};color:${p.chipText}">${esc(g.platform)}</span></td>
        ${td("Play on", `<td class="muted">${CONSOLES.has(g.platform) ? "" : esc(g.play_on)}</td>`)}<td class="muted">${esc(g.format)}</td>
        ${td("Upgrade", `<td>${g.upgrade && g.upgrade !== "No upgrade" ? `<span class="upgcell ${g.upgrade.startsWith("Free") ? "free" : "paid"}">${esc(g.upgrade)}</span>` : ""}</td>`)}
        <td>${cellBool(g.dlc_owned)}${g.dlc_done ? `<span class="tick on small">done</span>` : ""}</td>${td("100%", `<td>${played(g) ? cellBool(g.platinum) : ""}</td>`)}<td>${cellBool(g.modded)}</td>
        ${td("Runs", `<td class="num">${g.runs || ""}</td>`)}${td("Hours", `<td class="num">${esc(g.hours_text)}</td>`)}
        ${td("Score", `<td class="num">${g.score != null ? `<span class="scorecell" style="--s:${g.score / 10}">${scoreText(g.score)}</span>` : ""}</td>`)}
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
  "Steam Family": g => !!g.family,
};
function asSet(v) { return v instanceof Set ? v : new Set(!v || v === "All" ? [] : [v]); }
function filtered() {
  const f = state.filter, q = f.q.trim().toLowerCase();
  f.status = asSet(f.status); f.prio = asSet(f.prio); f.formats = asSet(f.formats);
  const fam = state.view === "library" && f.status.has("Steam Family") ? familyItems() : [];
  const list = withCopies(state.games).concat(fam).filter(g => {
    if (state.view === "wishlist" && g.status !== "Wishlist") return false;
    if (state.view === "backlog" && !inBacklog(g)) return false;
    if (state.view === "played" && !["Completed", "Dropped"].includes(g.status)) return false;
    if (state.view === "library" && g.status === "Wishlist" && !f.status.has("Wishlist")) return false;
    // inside one group any match counts; across groups every group has to match
    if (f.status.size && ![...f.status].some(st => SPECIAL[st] ? SPECIAL[st](g) : statusOf(g) === st || (st === "Dropped" && g.status === "Dropped"))) return false;
    if (f.plats.size && !PLAT_LEAVES.some(l => f.plats.has(l.key) && l.match(g))) return false;
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
/* where you play: PC (Steam, Heroic, Exiled, itch.io), Consoles, Handhelds; pick as many as you like */
const PLAT_TREE = [
  { group: "PC", items: [
    { key: "steam", label: "Steam", c: "#66C0F4", match: g => g.platform === "Steam" },
    { sub: "Heroic", c: "#9F7AEA", items: [{ key: "epic", label: "Epic", match: g => g.platform === "Epic Games" }, { key: "gog", label: "GOG", match: g => g.platform === "GOG" }] },
    { sub: "Exiled", c: "#FF6B6B", items: [{ key: "ea", label: "EA", match: g => g.platform === "EA" || g.platform === "EA App" }, { key: "ubisoft", label: "Ubisoft", match: g => g.platform === "Ubisoft Connect" }] },
    { key: "itch", label: "itch.io", c: "#FA5C5C", match: g => g.platform === "itch.io" },
    { key: "pcother", label: "Other PC", c: "#ADB5BD", match: g => g.platform === "PC (Other)" || g.platform === "Emulation" },
  ] },
  { group: "Consoles", items: [
    { key: "ps5", label: "PlayStation 5", c: "#3D8BFF", match: g => g.platform === "PS5" || g.platform === "PS4" },
    { key: "ps2", label: "PlayStation 2", c: "#C9D1DC", match: g => g.platform === "PS2" },
  ] },
  { group: "Handhelds", items: [
    { key: "switch", label: "Nintendo Switch 2", c: "#FF3B4A", match: g => g.platform === "Switch 2" || g.platform === "Switch" },
    { key: "deck", label: "Steam Deck", c: "#1A9FFF", match: g => g.play_on === "Steam Deck" },
  ] },
];
const PLAT_LEAVES = PLAT_TREE.flatMap(t => t.items.flatMap(i => i.sub ? i.items.map(x => ({ ...x, c: i.c })) : [i]));
function platPicker(f) {
  const has = new Set(PLAT_LEAVES.filter(l => state.games.some(l.match)).map(l => l.key));
  const leaf = (l, c) => `<button type="button" class="pleaf" data-pleaf="${l.key}" aria-pressed="${f.plats.has(l.key)}" style="--c:${c || l.c}">${esc(l.label)}</button>`;
  const allOn = keys => keys.length && keys.every(k => f.plats.has(k));
  return `<div class="plats" role="group" aria-label="Where you play">${PLAT_TREE.map(t => {
    const items = t.items.map(i => i.sub ? { ...i, items: i.items.filter(x => has.has(x.key)) } : i).filter(i => i.sub ? i.items.length : has.has(i.key));
    if (!items.length) return "";
    const keys = items.flatMap(i => i.sub ? i.items.map(x => x.key) : [i.key]);
    return `<div class="pgroup"><button type="button" class="phead" data-pgroup="${keys.join(",")}" aria-pressed="${allOn(keys)}">${t.group}</button>${items.map(i => i.sub
      ? `<span class="psub" style="--c:${i.c}"><button type="button" class="psubhead" data-pgroup="${i.items.map(x => x.key).join(",")}" aria-pressed="${allOn(i.items.map(x => x.key))}">${i.sub}</button>${i.items.map(x => leaf(x, i.c)).join("")}</span>`
      : leaf(i)).join("")}</div>`;
  }).join("")}</div>`;
}
/* ----- your backlog: every game you own that has a priority, by priority ----- */
const inBacklog = g => !!g.priority && g.status !== "Completed" && g.status !== "Wishlist" && !g.virtual;
const PRIO_LANE = { Extreme: { c: "#FF3D6E", say: "Play these first" }, High: { c: "#FF922B", say: "Next up" }, Medium: { c: "#FFD43B", say: "When there's time" }, Low: { c: "#4DABF7", say: "Someday" } };
function backlogHTML() {
  const f = state.filter;
  const list = filtered();
  const all = state.games.filter(inBacklog);
  const counts = Object.keys(PRIO_ORDER).map(p => [p, all.filter(g => g.priority === p).length]);
  const total = all.length || 1;
  const playing = list.filter(g => g.status === "Playing");
  const lanes = Object.keys(PRIO_ORDER).map(p => [p, list.filter(g => g.priority === p && g.status !== "Playing")]).filter(([, l]) => l.length);
  const lane = (title, items, c, say) => `<section class="blane" style="--c:${c}"><header><h2>${esc(title)}</h2><span class="count">${items.length}</span>${say ? `<small>${say}</small>` : ""}</header>
    ${state.mode === "list" ? gameListHTML(items) : lazyCases(items, "grid", 24)}</section>`;
  return `<div class="toolbar">
      <div class="line">
        <input class="search" id="search" type="search" placeholder="Search your backlog" value="${esc(f.q)}">
        ${scaleSlider()}${modeSwitch()}
        <span class="total">${list.length} ${list.length === 1 ? "game" : "games"} to play</span>
        ${f.plats.size || f.q ? `<button class="ghost small" id="clearFilters">Clear filters</button>` : ""}
      </div>
      <div class="line frow frow-plats">${platPicker(f)}</div>
    </div>
    <section class="bsummary">
      <div class="btotal"><b>${all.length}</b><span>games in your backlog</span></div>
      <div class="bbar" role="img" aria-label="${counts.map(([p, n]) => `${n} ${p}`).join(", ")}">${counts.filter(([, n]) => n).map(([p, n]) => `<i style="--c:${PRIO_LANE[p].c};flex:${n}" title="${n} ${p}"></i>`).join("")}</div>
      <div class="bcounts">${counts.map(([p, n]) => `<span style="--c:${PRIO_LANE[p].c}"><i></i>${p} <b>${n}</b></span>`).join("")}</div>
      <p class="fine">Give any game a priority (right-click → Priority) and it lands here. Finishing it takes it off.</p>
    </section>
    ${!list.length ? `<p class="empty">${all.length ? "Nothing matches these filters." : "No games with a priority yet. Right-click a game in your Library and set its Priority."}</p>` : ""}
    ${playing.length ? lane("Playing now", playing, "#5BD38A", "On the go") : ""}
    ${lanes.map(([p, items]) => lane(p, items, PRIO_LANE[p].c, PRIO_LANE[p].say)).join("")}`;
}
function libraryHTML() {
  const f = state.filter;
  const statuses = state.view === "wishlist" ? [] : state.view === "played" ? ["Completed", "Dropped", "Second chance", "Replays"] : ["Library", "Playing", "Paused", "Completed", "Dropped", "Second chance", "Wishlist", "Live service", "Modpacks", "Replays", "Plan to migrate", ...(familyItems().length ? ["Steam Family"] : [])];
  const list = filtered();
  const active = f.status.size + f.prio.size + f.formats.size + f.plats.size + !!f.q + !!f.genre + !!f.studio;
  const pinned = [f.genre ? `<button class="chip on" data-unpin="genre">Genre: ${esc(f.genre.join(", "))} ✕</button>` : "", f.studio ? `<button class="chip on" data-unpin="studio">Made by: ${esc(f.studio.join(", "))} ✕</button>` : ""].join("");
  return `${state.view === "wishlist" ? wishTabs() : ""}<div class="toolbar">
      <div class="line">
        <input class="search" id="search" type="search" placeholder="Search games, genres, studios" value="${esc(f.q)}">
        ${scaleSlider()}
        <select class="pick" id="sort">${[["priority", "Sort by priority"], ["name", "Sort by name"], ["score", "Sort by score"], ["recent", "Recently finished"], ["hours", "Most hours"], ["platform", "Sort by platform"]].map(([v, l]) => `<option value="${v}" ${f.sort === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        ${modeSwitch()}
        <button class="ghost small walkbtn" data-walk title="Walk through your library (Ctrl+L)">Walk the shelves</button>
        <span class="total">${list.length} ${list.length === 1 ? "game" : "games"}</span>
        ${active ? `<button class="ghost small" id="clearFilters">Clear filters (${active})</button>` : ""}
        ${state.canEdit ? `<button class="ghost small" data-add="games">+ Add game</button>${state.view === "wishlist" ? `<button class="ghost small" data-itch>Browse itch.io</button>` : `<button class="ghost small" data-modpacks>+ Modpack</button>`}` : ""}
      </div>
      ${statuses.length ? `<div class="line frow frow-status">${multi(f.status, "status", statuses)}</div>` : ""}
      <div class="line frow frow-heat">${multi(f.prio, "prio", [...Object.keys(PRIO_ORDER), "None"], { None: "No priority" })}${multi(f.formats, "formats", ["Physical", "Digital"])}</div>
      <div class="line frow frow-plats">${platPicker(f)}</div>
      ${pinned ? `<div class="line">${pinned}</div>` : ""}
    </div>
    ${!list.length ? `<p class="empty">No games match these filters. Clear the search or pick another platform.</p>`
      : state.mode === "list" ? gameListHTML(list) : lazyCases(list)}`;
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
        <span class="y">${y.year}${yearCrowns(y.year)}</span>
        <span class="bars" title="${y.games.length} games, ${y.replays.length} replays"><span class="g" style="width:${y.games.length / max * 100}%"></span><span class="r" style="width:${y.replays.length / max * 100}%"></span></span>
        <span class="num"><b>${y.games.length}</b><small>games</small></span>
        <span class="num"><b>${Math.round(y.hours) || "–"}</b><small>hours</small></span>
        <span class="num"><b>${avg}</b><small>avg score</small></span>
      </button>
      <div class="detail ${yearGotyHTML(y.year) ? "with-goty" : ""}">
        <div class="ymain">
        <div class="best">${top ? `Best of the year: <b>${esc(top.name)}</b>, ${scoreText(top.score)}` : "Nothing rated yet."}${main ? `  ·  Mostly on ${esc(main[0])}` : ""}${y.replays.length ? `  ·  ${y.replays.length} replay${y.replays.length > 1 ? "s" : ""}` : ""}</div>
        ${list.length ? `<div class="shelf-row">${list.map(g => caseHTML(g, { sub: fmtDate(g.completed) })).join("")}</div>` : `<p class="intro">No games finished yet this year. Set a game to Completed and it shows up here.</p>`}
        </div>${yearGotyHTML(y.year)}
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
      <section class="gotyhist" id="gotyHistory" hidden></section>
      <h2>History</h2>
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
