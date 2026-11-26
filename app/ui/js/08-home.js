/* Masterlog front end, part 8 of 9: deals, source status, events, what's new, coming soon, news.
   The parts load in order as plain scripts and share one global scope (see index.html). */
"use strict";

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
function dealSig() {
  const d = dealState.data;
  if (!d) return "";
  return JSON.stringify(Object.entries(d.games || {}).map(([n, e]) => [n, e?.steam?.final, e?.steam?.discount, e?.release?.ts, e?.ps?.final])) + (d.dlc || []).length + (d.bundles || []).length;
}
async function loadDeals(force) {
  if (!api || dealState.loading) return;
  if (!force && dealState.data && Date.now() - dealState.t < 60 * 1000 && !dealState.data.running) return;
  dealState.loading = true;
  const before = dealSig();
  try { dealState.data = await api.deals(!!force); dealState.t = Date.now(); } catch {}
  dealState.loading = false;
  maybeSaleEvent();
  // redraw only when prices or dates actually changed, and never Home (its prices catch up on the next visit)
  if (dealSig() !== before && state.catalog === "games" && (state.view === "deals" || state.view === "wishlist")) {
    if (state.view === "deals") { const v = $("#view"), y = v.scrollTop; v.innerHTML = dealsHTML(); activateArt(v); v.scrollTop = y; }
    else { const v = $("#view"), y = v.scrollTop; render(); v.scrollTop = y; }
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
  if (!d) return `${wishTabs()}<section class="deals">${head}<div class="news-loading"><span class="spinner"></span> Checking prices for your wishlist…</div></section>`;
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
  return `${wishTabs()}<section class="deals">${head}${saleBanner()}
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

/* ---------- Settings → Source status: which outside sites answered lately ---------- */
function agoShort(ts) {
  if (!ts) return "never";
  const s = Date.now() / 1000 - ts, n = (v, u) => `${v} ${u}${v === 1 ? "" : "s"}`;
  return s < 90 ? "just now" : s < 3600 ? `${n(Math.round(s / 60), "minute")} ago` : s < 86400 ? `${n(Math.round(s / 3600), "hour")} ago` : `${n(Math.round(s / 86400), "day")} ago`;
}
function forShort(ts) { return agoShort(ts).replace(/ ago$/, "").replace(/^just now$/, "a moment"); }
async function paintHealth() {
  const r = await Promise.resolve(api?.sources_health?.()).catch(() => null);
  const list = r?.sources || [];
  const bad = list.filter(x => x.status === "failing"), hmm = list.filter(x => x.status === "trouble");
  $("#healthSum").innerHTML = !list.length ? `<span class="hs ok">Nothing checked yet. Use the app for a bit and come back.</span>`
    : bad.length ? `<span class="hs bad">${bad.length} not working for over a day</span>${hmm.length ? `<span class="hs warn">${hmm.length} had trouble recently</span>` : ""}`
    : hmm.length ? `<span class="hs warn">${hmm.length} had trouble recently; usually that sorts itself out</span>` : `<span class="hs ok">Everything answered the last time it was asked</span>`;
  $("#healthList").innerHTML = list.map(x => `<li class="h-${x.status}"><i class="hdot" aria-hidden="true"></i><div><b>${esc(x.name)}</b>${x.what ? `<small>${esc(x.what)}</small>` : ""}</div>
    <div class="hstate">${x.status === "ok" ? `Worked ${esc(agoShort(x.ok_t))}` : `<span>${x.status === "failing" ? "Not working" : "Trouble"} for ${esc(forShort(x.since))}</span><small>${esc(x.err || "")}</small>${x.ok_t ? `<small>Last worked ${esc(agoShort(x.ok_t))}</small>` : ""}`}</div></li>`).join("");
  $("#settingsBtn")?.classList.toggle("alert", !!r?.alert);
}
async function checkHealthDot() {
  const r = await Promise.resolve(api?.sources_health?.()).catch(() => null);
  const b = $("#settingsBtn");
  if (b) { b.classList.toggle("alert", !!r?.alert); b.title = r?.alert ? "Settings · a source has stopped working (see Source status)" : "Settings"; }
}

/* ---------- Events on Home, like Steam's big banner: showcases, The Game Awards and sales, live or starting soon ---------- */
const eventState = { data: null, t: 0, i: 0 };
const PARTICLES = { winter: 18, autumn: 14, spring: 14, halloween: 10, tga: 16, summer: 8 };
async function loadEvents(force) {
  if (!api?.events) return;
  if (!force && eventState.data && Date.now() - eventState.t < 10 * 60 * 1000) return fillEvents();
  const d = await Promise.resolve(api.events()).catch(() => null);
  if (!d) return;
  eventState.data = d; eventState.t = Date.now();
  fillEvents();
  if (!d.checked && !loadEvents.retry) { loadEvents.retry = true; setTimeout(() => loadEvents(true), 25000); }   // first look still running
}
function eventWhen(e) {
  const local = new Date(e.start * 1000);
  const opts = e.timed ? { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" } : { weekday: "long", day: "numeric", month: "long" };
  const when = local.toLocaleString(undefined, opts);
  if (e.state === "live") return e.sale ? `On now · ends in ${countdown(e.end)}` : `Live now · started ${new Date(e.start * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  if (e.state === "ended") return "Just ended · watch the replay";
  return `${when}${e.timed ? " your time" : ""} · in ${countdown(e.start)}`;
}
function eventSide(e) {
  if (e.series === "tga") {
    const y = (gotyState.data?.years || []).find(y => y.year === new Date(e.start * 1000).getUTCFullYear() || y.year === new Date(e.start * 1000).getUTCFullYear() - 0);
    const noms = y?.tga?.nominees || [];
    if (!noms.length) return "";
    return `<div class="ev-noms"><h5>Game of the Year nominees</h5><div class="ev-nomrow">${noms.map(n => {
      const m = rankMatch(n), g = m && m.via !== "collection" ? m.g : null;
      return `<button type="button" class="ev-nom" ${g ? `data-open="${g.id}" data-kind="game"` : `data-url="https://store.steampowered.com/search/?term=${encodeURIComponent(n)}"`} title="${esc(n)}${g ? "" : " · find it on Steam"}">
        <div class="art ${g ? "" : "virtual"}" ${g ? `data-kind="game" data-id="${g.id}"` : `data-vname="${esc(n)}"`}>${g ? "" : `<span>${esc(n)}</span>`}</div><b>${esc(n)}</b></button>`;
    }).join("")}</div></div>`;
  }
  if (e.sale) {
    const on = Object.values(dealState.data?.games || {}).filter(x => x?.steam?.discount > 0).length;
    const spots = [[4, 18, -8], [30, 2, 6], [56, 26, -4], [16, 58, 9], [44, 62, -10], [72, 54, 5]];
    return `<div class="ev-tags" aria-hidden="true">${["-90%", "-75%", "-50%", "-33%", "-60%", "-20%"].map((t, i) => `<i style="left:${spots[i][0]}%;top:${spots[i][1]}%;transform:rotate(${spots[i][2]}deg)">${t}</i>`).join("")}</div>${on ? `<p class="ev-onsale"><b>${on}</b> of your wishlist games are discounted right now</p>` : ""}`;
  }
  return `<div class="ev-glyph" aria-hidden="true"></div>`;
}
function eventCard(e, i) {
  const btns = [
    ...(e.watch || []).map(([l, u]) => `<button type="button" class="${e.state === "live" ? "primary" : "ghost"} ev-btn" data-url="${esc(u)}">${e.state === "ended" ? "Replay on" : "Watch on"} ${esc(l)}</button>`),
    ...(e.links || []).map(([l, u]) => `<button type="button" class="ghost ev-btn" data-url="${esc(u)}">${esc(l)}</button>`),
    e.sale ? `<button type="button" class="ghost ev-btn" data-evdeals>Your wishlist deals</button>` : "",
    e.url ? `<button type="button" class="linkish ev-src" data-url="${esc(e.url)}" title="${esc(e.headline || "")}">Announced on ${esc(e.source || "the news")}</button>` : "",
  ].join("");
  const n = PARTICLES[e.theme] || 0;
  return `<article class="ev ev-${esc(e.theme)} st-${e.state} ${e.art ? "has-art" : ""}" data-ev="${i}" aria-roledescription="slide">
    ${e.art ? `<div class="ev-art" aria-hidden="true"><img alt="" decoding="async" referrerpolicy="no-referrer" src="${esc(e.art)}"></div>` : ""}
    ${n ? `<div class="ev-fx" aria-hidden="true">${Array.from({ length: n }, (_, k) => `<i style="--k:${k};--x:${(k * 53) % 100}%;--d:${(k * 0.7) % 6}s"></i>`).join("")}</div>` : ""}
    <div class="ev-main">
      <div class="ev-kicker">${e.state === "live" ? `<span class="ev-live"><i></i>LIVE</span>` : e.state === "ended" ? `<span class="ev-ended">Ended</span>` : `<span class="ev-soon">Coming up</span>`}<span>${esc(e.kind)}</span></div>
      <h2 class="ev-title">${esc(e.title)}</h2>
      <p class="ev-when" data-evwhen="${i}">${esc(eventWhen(e))}</p>
      ${e.note ? `<p class="ev-note">${esc(e.note)}</p>` : ""}
      <div class="ev-actions">${btns}</div>
    </div>
    <div class="ev-side">${eventSide(e)}</div>
  </article>`;
}
/* a section that redraws itself (events, what's new, Game of the Year) keeps keyboard and controller focus where it was */
function keepFocus(box, redraw) {
  const a = document.activeElement, inside = box && a && box.contains(a);
  const idx = inside ? [...box.querySelectorAll(NAV_SEL)].indexOf(a) : -1;
  redraw();
  if (inside && !box.contains(document.activeElement)) {
    const items = [...box.querySelectorAll(NAV_SEL)];
    (items[idx] || items[0])?.focus({ preventScroll: true });
  }
}
function fillEvents() { keepFocus($("#eventsHome"), fillEventsNow); }
function fillEventsNow() {
  const box = $("#eventsHome");
  if (!box) return;
  const list = eventState.data?.events || [];
  if (!list.length) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  eventState.i = Math.min(eventState.i, list.length - 1);
  box.innerHTML = `<div class="ev-head"><h2>Events</h2><span class="ev-count">${list.filter(e => e.state === "live").length ? `${list.filter(e => e.state === "live").length} live now` : `${list.length} coming up`}</span></div>
    <div class="ev-car">
      ${list.length > 1 ? `<button type="button" class="wn-arrow prev ev-arrow" data-evstep="-1" aria-label="Previous event"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>` : ""}
      <div class="ev-track" style="--i:${eventState.i}">${list.map(eventCard).join("")}</div>
      ${list.length > 1 ? `<button type="button" class="wn-arrow next ev-arrow" data-evstep="1" aria-label="Next event"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>` : ""}
    </div>
    ${list.length > 1 ? `<div class="ev-dots">${list.map((e, i) => `<button type="button" class="${i === eventState.i ? "on" : ""}" data-evgo="${i}" aria-label="${esc(e.title)}"></button>`).join("")}</div>` : ""}`;
  box.querySelectorAll(".ev").forEach(el => fxObserver.observe(el));
  // official art that doesn't load leaves the event's own colours
  box.querySelectorAll(".ev-art img").forEach(img => img.addEventListener("error", () => { img.closest(".ev")?.classList.remove("has-art"); img.parentElement.remove(); }, { once: true }));
  activateArt(box); loadVirtualArt(box);
  eventsTick();
}
function eventGo(i) {
  const list = eventState.data?.events || [], box = $("#eventsHome");
  if (!box || !list.length) return;
  eventState.i = (i + list.length) % list.length;
  box.querySelector(".ev-track")?.style.setProperty("--i", eventState.i);
  box.querySelectorAll(".ev-dots button").forEach((b, k) => b.classList.toggle("on", k === eventState.i));
}
/* countdowns stay current while Home is open; the banner turns to the next event every 12 seconds unless you're on it */
function eventsTick() {
  clearInterval(eventsTick.t);
  eventsTick.t = setInterval(() => {
    const box = $("#eventsHome");
    if (!box || box.hidden || document.hidden) { if (!box) clearInterval(eventsTick.t); return; }
    const list = eventState.data?.events || [];
    box.querySelectorAll("[data-evwhen]").forEach(p => { const e = list[+p.dataset.evwhen]; if (e) p.textContent = eventWhen(e); });
    const now = Date.now() / 1000;
    if (list.some(e => (e.state === "soon" && now >= e.start) || (e.state === "live" && now >= e.end))) loadEvents(true);
    eventsTick.n = (eventsTick.n || 0) + 1;
    if (list.length > 1 && eventsTick.n % 4 === 0 && !box.matches(":hover, :focus-within")) eventGo(eventState.i + 1);
  }, 3000);
}

/* ---------- What's New on Home, like Steam's: updates and events for the games you have ---------- */
async function fillWhatsNew() {
  let box = $("#whatsNew");
  if (!box || !api) return;
  let d = newsState.data.yours;
  if (!d || Date.now() - d.t > 10 * 60 * 1000) {
    try { d = { ...(await api.news_section("yours")), t: Date.now() }; newsState.data.yours = d; } catch { return; }
  }
  box = $("#whatsNew");   // home may have been redrawn while the news loaded
  if (!box) return;
  const cutoff = Date.now() / 1000 - 21 * 86400;
  const rank = { major: 0, release: 0, update: 1, minor: 2, news: 3 };
  const seen = new Set();
  const items = (d.items || []).filter(i => (i.date >= cutoff || i.upcoming) && (i.kind !== "news" || i.thumb) && i.status !== "Wishlist")
    .sort((a, b) => (rank[a.kind] ?? 3) - (rank[b.kind] ?? 3) || b.date - a.date)
    .filter(i => { if (seen.has(i.game + i.kind)) return false; seen.add(i.game + i.kind); return true; }).slice(0, 16)
    .sort((a, b) => (b.upcoming ? b.start : b.date) - (a.upcoming ? a.start : a.date));
  if (!items.length) { box.hidden = true; return; }
  box.hidden = false;
  // newest on the left; the arrows page through to older ones, three or four at a time
  box.innerHTML = `<div class="wn-head"><h2>What's new</h2><span class="wn-count">${items.length} updates in the last three weeks</span><button class="ghost small" data-catalog-go="news">All updates</button></div>
    <div class="wn-car">
      <button type="button" class="wn-arrow prev" data-wn="-1" aria-label="Newer updates" title="Newer" disabled><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <div class="wn-row">${items.map(i => `<article class="wn" data-url="${esc(i.url || "")}" tabindex="0">
        <div class="wn-art">${i.thumb ? `<img alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${esc(i.thumb)}">` : `<span>${esc(i.game)}</span>`}<span class="wn-kind k-${esc(i.kind || "news")}">${esc(KIND_LABEL[i.kind] || "News")}</span></div>
        <div class="wn-text"><h3>${esc(i.title)}</h3>
        <small><b>${esc(i.game)}</b><span>${esc(i.upcoming && i.start ? `starts ${fmtDateTime(i.start)}` : ago(i.date))}</span></small></div></article>`).join("")}</div>
      <button type="button" class="wn-arrow next" data-wn="1" aria-label="Older updates" title="Older"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
    </div>`;
  const row = box.querySelector(".wn-row");
  const paint = () => {
    const max = row.scrollWidth - row.clientWidth - 2;
    box.querySelector(".wn-arrow.prev").disabled = row.scrollLeft <= 2;
    box.querySelector(".wn-arrow.next").disabled = row.scrollLeft >= max;
  };
  row.addEventListener("scroll", () => { cancelAnimationFrame(paint.f); paint.f = requestAnimationFrame(paint); }, { passive: true });
  box.querySelectorAll(".wn-arrow").forEach(b => b.addEventListener("click", () => {
    row.scrollBy({ left: +b.dataset.wn * row.clientWidth, behavior: "smooth" });
    try { FX.play.move(); } catch {}
  }));
  requestAnimationFrame(paint);
}

/* ---------- Coming soon: release dates for your wishlist ---------- */
function soonShellHTML() {
  return `${wishTabs()}<section class="news soon"><header class="news-head"><h1>Coming soon</h1><p class="muted">Release dates for the games on your wishlist, soonest first, with a countdown. Dates come from Steam, or IGDB for console games.</p></header>
    <div id="soonBody"><p class="news-loading"><span class="spinner"></span> Checking release dates…</p></div></section>`;
}
async function fillSoon() {
  if (!api) return;
  if (!dealState.data || Date.now() - dealState.t > 5 * 60 * 1000) { try { dealState.data = await api.deals(false); dealState.t = Date.now(); } catch {} }
  const box = $("#soonBody");
  if (!box || state.view !== "soon") return;
  const d = dealState.data || { games: {} }, now = Date.now() / 1000;
  const wish = collapse(state.games.filter(g => g.status === "Wishlist"));
  const rows = wish.map(g => ({ g, r: d.games?.[g.name]?.release })).filter(x => x.r && (x.r.coming || (x.r.ts && now - x.r.ts < 30 * 86400)));
  const out = rows.filter(x => x.r.ts && x.r.ts <= now).sort((a, b) => b.r.ts - a.r.ts);
  const dated = rows.filter(x => x.r.ts && x.r.ts > now).sort((a, b) => a.r.ts - b.r.ts);
  const vague = rows.filter(x => !x.r.ts).sort((a, b) => (a.r.text || "~").localeCompare(b.r.text || "~"));
  const groups = new Map();
  for (const x of dated) {
    const days = (x.r.ts - now) / 86400, dt = new Date(x.r.ts * 1000);
    const key = days < 7 ? "This week" : days < 31 ? "This month" : dt.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    (groups.get(key) || groups.set(key, []).get(key)).push(x);
  }
  const card = ({ g, r }) => {
    const days = r.ts ? Math.ceil((r.ts - now) / 86400) : null;
    const when = r.ts ? new Date(r.ts * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : (r.text || "To be announced");
    const pill = r.ts ? (r.ts <= now ? `<span class="spill out">Out now</span>` : days <= 1 ? `<span class="spill hot">${countdown(r.ts)}</span>` : `<span class="spill">${days} days</span>`) : `<span class="spill vague">${esc(r.text || "TBA")}</span>`;
    return `<button class="sitem" data-open="${g.id}" data-kind="game"><div class="sart"><div class="art" data-kind="game" data-id="${g.id}"></div></div>
      <div class="stext"><b>${esc(g.name)}</b><small>${esc(plat(g.platform).label)}${g.priority ? ` · ${esc(g.priority)}` : ""}</small><span class="swhen">${esc(when)}</span></div>${pill}</button>`;
  };
  const sec = (title, list) => list.length ? `<section class="sgroup"><h2>${esc(title)}</h2><div class="slist">${list.map(card).join("")}</div></section>` : "";
  box.innerHTML = rows.length ? [sec("Just out", out), ...[...groups].map(([k, l]) => sec(k, l)), sec("Dates still to come", vague)].join("")
    : `<p class="muted">${d.running ? "Still checking release dates; this fills in over the next minute." : "Nothing on your wishlist has a release date coming up."}</p>`;
  activateArt(box);
  if (d.running) setTimeout(() => { if (state.view === "soon") { dealState.t = 0; fillSoon(); } }, 15000);
}

/* ---------- News ---------- */
const NEWS_INFO = {
  breaking: "IGN, PC Gamer, Kotaku, Eurogamer, Steam, Bloomberg and Jason Schreier, newest first.",
  yours: "Patches, major updates and news for the games you're playing, own and want.",
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
  const errs = (blocked.length ? `<p class="fine nerr">Reddit isn't letting Masterlog read ${esc(blocked.join(", "))} right now. It tries again in a few minutes.</p>` : "")
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
    const r = await api.news_section("yours");
    newsState.data.yours = { ...r, t: Date.now() };
    const newest = Math.max(0, ...(r.items || []).map(i => i.date || 0));
    $("#newsDot").hidden = !(newsState.seen.yours && newest > newsState.seen.yours);
  } catch {}
}

/* covers are always cropped to the 2:3 frame (see style.css); nothing to measure here any more */

/* animations rest when Masterlog isn't the window you're using */
addEventListener("blur", () => document.body.classList.add("away"));
addEventListener("focus", () => document.body.classList.remove("away"));
