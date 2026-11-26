/* Masterlog front end, part 9 of 9: starting up.
   The parts load in order as plain scripts and share one global scope (see index.html). */
"use strict";

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
  setTimeout(loadFamily, 3000); setInterval(loadFamily, 10 * 60 * 1000);
  setTimeout(setupChrome, 600);
  setInterval(async () => { const a = await Promise.resolve(api?.itch_added()).catch(() => []); if (a?.length) { toast(`Added to your wishlist from itch.io: ${a.join(", ")}.`, "party"); sync(true); } }, 5000);
  setInterval(() => { if (state.catalog === "news") loadNews(state.view, true); }, 15 * 60 * 1000);
  pollAccounts(false);
}
if (window.pywebview?.api) start();
else window.addEventListener("pywebviewready", start, { once: true });
