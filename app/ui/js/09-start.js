/* Masterlog front end, part 9 of 9: starting up.
   The parts load in order as plain scripts and share one global scope (see index.html). */
"use strict";

/* ---------- errors worth knowing about: kept (scrubbed) for Settings → Source status → Copy diagnostics ---------- */
const errSeen = new Map();
function noteError(where, err) {
  const msg = String(err?.message || err || "").slice(0, 600);
  if (!msg || /AbortError|ResizeObserver loop/.test(msg)) return;
  const k = where + "|" + msg, now = Date.now();
  if (now - (errSeen.get(k) || 0) < 5000) return;
  errSeen.set(k, now);
  try { window.pywebview?.api?.ui_error?.(where, msg)?.catch?.(() => {}); } catch {}
}
function watchApi(raw) {
  return new Proxy(raw, { get(t, k) {
    const f = t[k];
    if (typeof f !== "function") return f;
    return (...a) => {
      let p;
      try { p = f.apply(t, a); } catch (e) { noteError(`api.${String(k)}`, e); throw e; }
      return Promise.resolve(p).catch(e => { noteError(`api.${String(k)}`, e); throw e; });
    };
  } });
}
window.addEventListener("error", e => noteError(`${(e.filename || "").split("/").pop()}:${e.lineno || 0}`, e.error || e.message));
window.addEventListener("unhandledrejection", e => noteError("promise", e.reason));
/* what the window looks like from the inside: no names, no keys */
function uiDiag() {
  let pads = [];
  try { pads = [...(navigator.getGamepads?.() || [])].filter(Boolean).map(p => p.id.replace(/\(.*?\)/g, "").trim().slice(0, 40)); } catch {}
  const ua = navigator.userAgent.match(/(Edg|Chrome|QtWebEngine)\/[\d.]+/g) || [];
  return { view: state.view, window: `${innerWidth}x${innerHeight}`, screen: `${screen.width}x${screen.height}`, dpr: devicePixelRatio, scale: state.settings?.scale || 1,
    engine: ua.join(" "), pads, games: state.games?.length || 0, books: state.books?.length || 0, big_picture: document.body.classList.contains("bigpic"), online: navigator.onLine };
}
async function copyDiagnostics(show) {
  const out = $("#diagText"), b = $("#diagCopy");
  const text = await Promise.resolve(api?.diagnostics?.(uiDiag())).catch(e => `Couldn't build the report: ${e?.message || e}`);
  if (!text) return;
  out.value = text; out.hidden = false;
  if (show) return;
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {}
  if (!ok) { out.select(); try { ok = document.execCommand("copy"); } catch {} }
  if (b) { b.textContent = ok ? "Copied" : "Select the text below and copy it"; setTimeout(() => { b.textContent = "Copy diagnostics"; }, 2500); }
}

/* ---------- start ---------- */
async function start() {
  api = window.pywebview?.api ? watchApi(window.pywebview.api) : null;
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
