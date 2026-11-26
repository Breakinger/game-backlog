/* Masterlog front end: Steam trading card idling (the Python side is cards.py).
   Loaded between parts 8 and 9; shares the same global scope. */
"use strict";

const cardsState = { v: null, timer: null };
const steamCap = a => `https://cdn.cloudflare.steamstatic.com/steam/apps/${a}/capsule_184x69.jpg`;
function hm(min) { const h = Math.floor((min || 0) / 60), m = (min || 0) % 60; return h ? `${h} h${m ? ` ${m} m` : ""}` : `${m} m`; }

async function openCards() {
  const d = $("#cardsDialog");
  if (!d.open) d.showModal();
  await paintCards();
  clearInterval(cardsState.timer);
  cardsState.timer = setInterval(() => { if (d.open) paintCards(); else clearInterval(cardsState.timer); }, 5000);
}
async function paintCards() {
  const v = await Promise.resolve(api?.cards_view?.(!!$("#cardsDialog")?.open)).catch(() => null);
  if (!v) return;
  cardsState.v = v;
  $("#cardsBtn")?.classList.toggle("on", !!v.active);
  if ($("#cardsBtn")) $("#cardsBtn").title = v.active ? (v.paused_for ? `Card idling paused while ${v.paused_for} runs` : "Card idling is on") : "Card idling";
  if (!$("#cardsDialog").open) return;
  const running = v.games.filter(g => g.state === "idling" || g.state === "starting");
  $("#cardsState").className = "cstate " + (v.active ? (v.paused_for ? "paused" : "on") : "off");
  $("#cardsState").textContent = v.active ? (v.paused_for ? "Paused" : running.length ? `Idling ${running.length > 1 ? `${running.length} games` : ""}`.trim() : "Starting") : "Off";
  const signed = v.signed_in !== false;
  $("#cardsBar").innerHTML = !signed
    ? `<button type="button" class="primary" data-cards="signin">Sign in to Steam</button><span class="muted">Opens Steam's own sign-in page. Masterlog needs it to see which games still drop cards.</span>`
    : `${v.active ? `<button type="button" class="primary stop" data-cards="stop">Stop idling</button>` : `<button type="button" class="primary" data-cards="start" ${v.drops ? "" : "disabled"}>Start idling</button>`}
       <span class="csum">${v.t ? `<b>${v.drops}</b> card drop${v.drops === 1 ? "" : "s"} to collect` : v.scanning ? "Reading your badges…" : "Not checked yet"}${v.t ? ` · checked ${esc(agoShort(v.t))}` : ""}</span>
       <button type="button" class="ghost small" data-cards="scan" ${v.scanning ? "disabled" : ""}>${v.scanning ? "Checking…" : "Check again"}</button>`;
  const s = v.settings || {};
  $("#cInvisible").checked = !!s.invisible; $("#cRefund").checked = !!s.refund_guard; $("#cParallel").value = String(s.parallel || 8);
  const notes = [];
  if (v.paused_for) notes.push(`Paused while <b>${esc(v.paused_for)}</b> is running. It picks up again a minute after you close it. <button type="button" class="linkish" data-cards="ignore" data-name="${esc(v.paused_for)}">${esc(v.paused_for)} isn't a game, ignore it</button>`);
  if (v.note) notes.push(esc(v.note));
  if (v.lib_missing) notes.push(v.windows ? "Masterlog couldn't find Valve's Steam library (steam_api64.dll) with a valid Valve signature in your installed games. Install any Steam game, even a free one, then try again."
    : "Masterlog couldn't find Valve's Steam library for Linux in your installed games. Install a game that runs natively on Linux (Counter-Strike 2 or Portal 2, say), then try again.");
  if (signed && v.t && s.refund_guard && v.lic_ok === false) notes.push("Couldn't read your purchase dates, so games under 2 hours wait until it can.");
  $("#cardsNote").innerHTML = notes.join("<br>");
  const order = { idling: 0, starting: 1, waiting: 2, held: 3, done: 4 };
  const list = [...v.games].sort((a, b) => order[a.state] - order[b.state] || b.drops - a.drops || a.name.localeCompare(b.name));
  $("#cardsList").innerHTML = !list.length ? (v.t && signed ? `<p class="muted cempty">None of your games has card drops left.</p>` : "")
    : list.map(g => {
      const label = { idling: "Idling", starting: "Starting", waiting: g.hours < 2 && (s.parallel || 8) > 1 ? "Next: first 2 hours" : "Waiting its turn", held: g.skipped ? "Skipped" : "Held back", done: "Done" }[g.state];
      return `<div class="crow st-${g.state}">
        <img alt="" loading="lazy" referrerpolicy="no-referrer" src="${steamCap(g.appid)}" onerror="this.style.visibility='hidden'">
        <div class="cinfo"><b>${esc(g.name)}</b><small>${g.drops ? `${g.drops} card${g.drops === 1 ? "" : "s"} left` : "All cards dropped"} · ${g.hours} h on Steam${g.idle_min ? ` · ${hm(g.idle_min)} of it idled` : ""}</small>${g.why && !g.skipped ? `<small class="cwhy">${esc(g.why)}</small>` : ""}</div>
        <span class="cchip">${label}</span>
        ${g.drops ? `<label class="cskip" title="Don't idle this game"><input type="checkbox" data-cskip="${g.appid}" ${g.skipped ? "checked" : ""}> Skip</label>` : ""}
      </div>`;
    }).join("");
}
$("#cardsBtn")?.addEventListener("click", openCards);
$("#cardsDialog")?.addEventListener("click", async e => {
  const b = e.target.closest("[data-cards]");
  if (!b) return;
  const act = b.dataset.cards;
  if (act === "start") {
    b.disabled = true;
    const r = await Promise.resolve(api?.cards_start?.()).catch(e => ({ error: String(e?.message || e) }));
    if (r?.error) toast(r.error);
  } else if (act === "stop") await Promise.resolve(api?.cards_stop?.()).catch(() => {});
  else if (act === "scan") await Promise.resolve(api?.cards_scan?.()).catch(() => {});
  else if (act === "signin") await Promise.resolve(api?.cards_signin?.()).catch(() => {});
  else if (act === "ignore") await Promise.resolve(api?.cards_ignore?.(b.dataset.name)).catch(() => {});
  setTimeout(paintCards, 400);
});
$("#cardsDialog")?.addEventListener("change", async e => {
  const t = e.target;
  if (t.dataset.cskip) await Promise.resolve(api?.cards_skip?.(+t.dataset.cskip, t.checked)).catch(() => {});
  else if (t.id === "cInvisible") await Promise.resolve(api?.cards_settings?.({ invisible: t.checked })).catch(() => {});
  else if (t.id === "cRefund") await Promise.resolve(api?.cards_settings?.({ refund_guard: t.checked })).catch(() => {});
  else if (t.id === "cParallel") await Promise.resolve(api?.cards_settings?.({ parallel: +t.value })).catch(() => {});
  paintCards();
});
// the toolbar button lights up while idling runs, even with the window closed
setInterval(() => { if (api?.cards_view && !$("#cardsDialog")?.open) paintCards(); }, 60000);
