/* Masterlog front end, part 6 of 9: sync, updates, settings, linked accounts, the clock and background.
   The parts load in order as plain scripts and share one global scope (see index.html). */
"use strict";

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
  if (t === "pad") padTester();
  if (t === "health") paintHealth();
}
/* which kind of controller, so hints show the letters printed on it */
function padFamily(id = "") {
  if (/054c|dualsense|dualshock|wireless controller|playstation/i.test(id)) return "ps";
  if (/057e|nintendo|pro controller|joy-?con/i.test(id)) return "nin";
  if (/28de|steam/i.test(id)) return "deck";
  return "xbox";
}
const PAD_LABELS = {
  xbox: ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "View", "Menu", "LS", "RS", "Up", "Down", "Left", "Right", "Guide"],
  deck: ["A", "B", "X", "Y", "L1", "R1", "L2", "R2", "View", "Menu", "L3", "R3", "Up", "Down", "Left", "Right", "Steam"],
  ps: ["✕", "○", "□", "△", "L1", "R1", "L2", "R2", "Create", "Options", "L3", "R3", "Up", "Down", "Left", "Right", "PS"],
  nin: ["B", "A", "Y", "X", "L", "R", "ZL", "ZR", "−", "+", "LS", "RS", "Up", "Down", "Left", "Right", "Home"],
};
const PAD_NAMES = { xbox: "Xbox-style controller", deck: "Steam Input controller", ps: "PlayStation controller", nin: "Nintendo controller" };
function padTester() {
  if (padTester.on) return;
  padTester.on = true;
  const loop = () => {
    const pane = document.querySelector('[data-spane="pad"]');
    if (!pane || pane.hidden || !$("#settings").open) { padTester.on = false; return; }
    const pad = [...(navigator.getGamepads?.() || [])].find(p => p && p.connected);
    if (pad) {
      const fam = padFamily(pad.id), labels = PAD_LABELS[fam];
      $("#padName").textContent = PAD_NAMES[fam];
      $("#padHelp").textContent = pad.id.replace(/\s*\(.*?Vendor.*?\)/i, "").slice(0, 80) + (pad.mapping === "standard" ? "" : " · not in the standard layout: add Masterlog to Steam to fix the buttons");
      const pressed = pad.buttons.map((b, i) => b.pressed ? labels[i] || `#${i}` : null).filter(Boolean);
      const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes;
      $("#padTest").innerHTML = `${pressed.length ? pressed.map(p => `<kbd>${esc(p)}</kbd>`).join("") : `<span class="muted">Press a button to test it</span>`}
        <span class="sticks"><i style="--x:${lx};--y:${ly}"></i><i style="--x:${rx};--y:${ry}"></i></span>`;
      $("#padNow").classList.add("on");
    } else { $("#padNow").classList.remove("on"); $("#padTest").innerHTML = ""; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
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
  f.smooth_scroll.checked = st.smooth_scroll !== false;
  f.native_titlebar.checked = !!st.native_titlebar;
  f.pad_scroll.value = st.pad_scroll || 1; $("#padScrollVal").textContent = `${(+f.pad_scroll.value).toFixed(1)}×`;
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
    smooth_scroll: f.smooth_scroll.checked, native_titlebar: f.native_titlebar.checked, pad_scroll: +f.pad_scroll.value,
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
  }).join("") + familyRowHTML() + `<div class="row"><button type="button" class="ghost small" id="syncAccounts">Check accounts now</button><button type="button" class="ghost small" id="reviewImports">Review games not in Masterlog</button><button type="button" class="ghost small" id="showHidden">Hidden games</button></div>`;
}
function familyRowHTML() {
  const d = familyState.data || {};
  const st = !d.linked ? `<span class="st">Not linked</span>` : d.none ? `<span class="st">You're not in a Steam Family</span>`
    : `<span class="st ok">${d.apps?.length || 0} shared games${d.family ? ` from ${esc(d.family)}` : ""}${d.t ? ` · checked ${ago(new Date(d.t * 1000).toISOString())}` : ""}${d.valid ? "" : " · sign in again to refresh"}</span>`;
  return `<div class="acct"><div class="acct-head"><span class="sw" style="background:#66C0F4"></span><b>Steam Family</b>${st}<span class="spacer"></span>
    ${d.linked ? `<button type="button" class="ghost small" data-famlink>${d.valid ? "Check now" : "Sign in again"}</button><button type="button" class="ghost small" data-famunlink>Unlink</button>` : `<button type="button" class="primary small" data-famlink>Sign in to Steam</button>`}</div>
    <p class="fine">Shows the games your family shares with you, in Library → Steam Family and on Home. You sign in on Steam's own page in a Masterlog window; Masterlog keeps only a short-lived read-only token, on this PC.</p></div>`;
}
async function linkFamily() {
  const r = await Promise.resolve(api?.steam_family_link()).catch(e => ({ error: String(e) }));
  if (!r || r.error) return toast(r?.error || "Couldn't open Steam's sign-in.", "err");
  toast(r.done ? "Checking your Steam Family…" : "Sign in to Steam in the window that opened. It closes on its own when you're done.");
  let n = 0;
  const tick = async () => { await loadFamily(); if (familyState.data?.apps?.length || familyState.data?.none || ++n > 60) { renderAccounts(); if (familyState.data?.apps?.length) toast(`Found ${familyState.data.apps.length} games shared by your Steam Family.`, "ok"); return; } setTimeout(tick, 4000); };
  setTimeout(tick, 3000);
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

/* ---------- PS2 boot towers ----------
   Each tower rises and falls on the graphics card (a transform animation), so the background moves smoothly at the
   screen's own refresh rate and costs the page nothing; it rests with every other animation when Masterlog isn't in front. */
function towers() {
  const c = $("#towers");
  if (!c || c.childElementCount) return;
  const n = 26, rnd = (a, b) => a + Math.random() * (b - a);
  c.innerHTML = Array.from({ length: n }, (_, i) => {
    const base = rnd(0.25, 0.8), depth = rnd(0.35, 1), top = Math.min(0.98, base + 0.12), low = Math.max(0.05, base - 0.12);
    const half = rnd(10, 26);
    return `<i style="left:${((i / n) * 100 + rnd(0, 3.3)).toFixed(2)}%;width:${(rnd(8, 30) * depth).toFixed(1)}px;height:${(top * 100).toFixed(1)}%;--lo:${(low / top).toFixed(3)};--d:${depth.toFixed(2)};animation-duration:${half.toFixed(1)}s;animation-delay:-${rnd(0, half * 2).toFixed(1)}s"></i>`;
  }).join("");
}
