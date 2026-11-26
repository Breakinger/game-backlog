/* Masterlog front end, part 7 of 9: mouse, keyboard and controller, right-click menus, cover picker.
   The parts load in order as plain scripts and share one global scope (see index.html). */
"use strict";

/* ---------- navigation: mouse, keyboard, controller ---------- */
function bindGlobal() {
  $("#tabs").addEventListener("click", e => { const t = e.target.closest(".tab"); if (t) go(t.dataset.view); });
  $("#view").addEventListener("click", e => { const t = e.target.closest(".subtab"); if (t && t.dataset.view !== state.view) { try { FX.play.tab(); } catch {} go(t.dataset.view); } });
  document.querySelectorAll(".catalog").forEach(c => c.addEventListener("click", () => switchCatalog(c.dataset.catalog)));
  $("#syncBtn").addEventListener("click", () => sync(true));
  $("#settingsBtn").addEventListener("click", () => openSettings(false));
  $("#addBtn").addEventListener("click", () => openAdd(isBooks() ? "books" : "games"));
  $("#updateBtn").addEventListener("click", installUpdate);
  $("#checkUpdates").addEventListener("click", () => checkForUpdate(true));
  $("#ambChoose").addEventListener("click", () => chooseAmbience(false));
  $("#claudeBtn").addEventListener("click", () => { if (!state.canEdit) toast("Claude can suggest changes, but applying them needs the sheet connection (Settings)."); $("#claudeDialog").showModal(); });
  $("#claudeCopy").addEventListener("click", async () => {
    const ask = $("#claudeAsk").value.trim();
    if (!ask) return toast("Write what you want first.", "err");
    const text = claudePrompt(ask);
    try { await navigator.clipboard.writeText(text); } catch { const t = document.createElement("textarea"); t.value = text; document.body.append(t); t.select(); document.execCommand("copy"); t.remove(); }
    $("#claudeCopied").textContent = "Copied. Paste it into the new chat with Ctrl+V.";
    api?.open("https://claude.ai/new");
  });
  $("#claudeReply").addEventListener("input", () => { clearTimeout(claudePreview.t); claudePreview.t = setTimeout(claudePreview, 250); });
  $("#claudeApply").addEventListener("click", claudeApply);
  $("#coverGrid").addEventListener("click", e => { const b = e.target.closest("[data-cand]"); if (b) pickCover(+b.dataset.cand); });
  $("#coverSearch").addEventListener("click", () => openCoverPicker($("#coverQuery").value.trim()));
  $("#coverQuery").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); openCoverPicker($("#coverQuery").value.trim()); } });
  $("#coverFile").addEventListener("click", () => customCover(true));
  $("#coverAuto").addEventListener("click", () => customCover(false));
  $("#ambClear").addEventListener("click", () => chooseAmbience(true));
  // the top bar steps out of the way once you scroll; the little arrow brings it back
  const mainEl = $("#view"), peekBtn = $("#barPeek");
  mainEl.addEventListener("scroll", () => {
    const y = mainEl.scrollTop, b = document.body.classList;
    if (y > 90 && !b.contains("bar-away")) b.add("bar-away");
    else if (y < 30 && b.contains("bar-away")) { b.remove("bar-away", "bar-peek"); peekBtn.setAttribute("aria-expanded", "false"); }
  }, { passive: true });
  peekBtn.addEventListener("click", () => {
    const on = document.body.classList.toggle("bar-peek");
    peekBtn.setAttribute("aria-expanded", String(on));
    peekBtn.title = on ? "Hide the top bar" : "Show the top bar";
    try { FX.play.tab(); } catch {}
  });
  $("#copyScript").addEventListener("click", copyScript);
  $("#copyManifest").addEventListener("click", copyManifest);
  document.querySelectorAll("[data-stab]").forEach(b => b.addEventListener("click", () => showSettingsTab(b.dataset.stab)));
  $("#settingsForm").addEventListener("input", e => {
    if (["sound_on", "ambient_volume", "fx_volume"].includes(e.target.name)) applySound({ ...state.settings, ...soundSettings() });
    if (e.target.name === "pad_scroll") { state.settings.pad_scroll = +e.target.value; $("#padScrollVal").textContent = `${(+e.target.value).toFixed(1)}×`; }
  });
  $("#accountsBox").addEventListener("click", e => {
    const o = e.target.closest("[data-linkopen]"); if (o) { const f = $(`[data-linkform="${o.dataset.linkopen}"]`); f.hidden = !f.hidden; return; }
    const l = e.target.closest("[data-link]"); if (l) return linkAccount(l.dataset.link);
    if (e.target.closest("[data-famlink]")) return linkFamily();
    if (e.target.closest("[data-famunlink]")) return Promise.resolve(api?.steam_family_unlink()).then(() => { familyState.data = null; familyState.key = ""; renderAccounts(); render(); toast("Steam Family unlinked. Its token was deleted from this PC.", "ok"); });
    const u = e.target.closest("[data-unlink]"); if (u) return Promise.resolve(api?.unlink_account(u.dataset.unlink)).then(() => { renderAccounts(); toast("Unlinked. Its saved key was deleted from this PC.", "ok"); });
    if (e.target.closest("#syncAccounts")) { api?.accounts_sync(); pollAccounts(true); return toast("Checking your accounts…"); }
    if (e.target.closest("#showHidden")) { $("#settings").close(); return showHidden(); }
    if (e.target.closest("#reviewImports")) { $("#settings").close(); return openImport(null); }
  });
  $("#importForm").addEventListener("submit", e => submitImport(e.target, e.submitter?.value));
  $("#importForm").addEventListener("keydown", e => { const t = e.target.closest?.(".itile"); if (t && (e.key === " " || e.key === "Enter")) { e.preventDefault(); importPick(e.currentTarget, +t.dataset.i); } });
  $("#importForm").addEventListener("click", e => {
    const form = e.currentTarget;
    const hide = e.target.closest("[data-hide]"); if (hide) { e.preventDefault(); return importHide(form, +hide.dataset.hide); }
    const am = e.target.closest("[data-addmod]"); if (am) { e.preventDefault(); return addModpack(+am.dataset.addmod, am); }
    const un = e.target.closest("[data-unhide]"); if (un) { api?.hide_games([un.dataset.unhide], true).then(() => { un.remove(); pollAccounts(true); toast("It can be suggested again.", "ok"); }); return; }
    const t = e.target.closest(".itile"); if (t) return importPick(form, +t.dataset.i);
  });
  $("#bigBtn").addEventListener("click", toggleBigPicture);
  $("#pairShare").addEventListener("click", () => openPair("share"));
  $("#pairReceive").addEventListener("click", () => openPair("receive"));
  $("#pairClose").addEventListener("click", () => { $("#pairDialog").close(); });
  $("#pairDialog").addEventListener("close", () => { clearInterval(pairTimer); if (pairMode === "share") api?.share_stop(); $("#pairBody").dataset.stage = ""; });
  $("#pairDialog").addEventListener("click", e => {
    const d = e.target.closest("[data-pairdecide]"); if (d) { api?.share_decide(d.dataset.pairdecide === "1"); return; }
    if (e.target.closest("#pairRestart")) { $("#pairBody").dataset.stage = ""; Promise.resolve(api?.share_start()).then(paintPair); return; }
    if (e.target.closest("#pairAgain")) { $("#pairBody").dataset.stage = ""; return findPCs(); }
    if (e.target.closest("#pairRestartApp")) { api?.restart_app(); return; }
    if (e.target.closest("#pairCancelSheet")) { clearInterval(pairTimer); api?.pair_cancel(); $("#pairDialog").close(); state.settings.sheet_url = ""; render(); return; }
    const pc = e.target.closest("[data-pcip]"); if (pc) { api?.receive_start(pc.dataset.pcip, +pc.dataset.pcport); return; }
    if (e.target.closest("#pairIpGo")) { const ip = $("#pairIp").value.trim(); if (ip) Promise.resolve(api?.receive_start(ip)).then(st => st?.stage === "error" && paintPair(st)); }
  });
  $("#walkBtn").addEventListener("click", openWalk);
  $("#soundBtn").addEventListener("click", () => {
    const on = state.settings.sound_on === false;
    state.settings.sound_on = on; api?.set_pref("sound_on", on); applySound();
    toast(on ? "Sound on." : "Sound off.");
  });
  $("#scrim").addEventListener("click", closePanel);
  $("#settingsForm").addEventListener("submit", e => { if (e.submitter?.value === "save") saveSettings(); });
  $("#addForm").addEventListener("submit", e => { if (e.submitter?.value === "add") submitAdd(e.target); });
  $("#clearCovers").addEventListener("click", async () => { await api?.clear_covers(); covers.clear(); render(); });

  const view = $("#view"), panel = $("#panel");
  view.addEventListener("click", e => {
    const qc = e.target.closest("[data-qc], [data-qown]");
    if (qc) { e.stopPropagation(); return quickMark(qc); }
    if (e.target.closest("select, input, option")) return;
    const c = e.target.closest(".case");
    if (c && !c.closest(".hero") && (e.shiftKey || selection.size)) { e.preventDefault(); return toggleSelect(c); }
    if (c && !c.closest(".hero")) return openPanel(c.dataset.kind, c.dataset.id);
    const tr = e.target.closest("tr[data-id]"); if (tr) return openPanel(tr.dataset.kind, tr.dataset.id);
    const more = e.target.closest("[data-go]");
    if (more) {
      const s = shelves()[+more.dataset.shelf];
      const pre = s?.preset || {};
      state.filter = { q: "", status: asSet(pre.status), plats: new Set(pre.plats || []), prio: new Set(), formats: new Set(), sort: s?.title.startsWith("Finished") ? "recent" : "priority" };
      return go(more.dataset.go);
    }
    const yr = e.target.closest(".year > button");
    if (yr) { const y = +yr.parentElement.dataset.year; state.openYears.has(y) ? state.openYears.delete(y) : state.openYears.add(y); yr.parentElement.classList.toggle("open"); activateArt(yr.parentElement); return; }
    const chip = e.target.closest("[data-plat]");
    if (chip) { const p = chip.dataset.plat; state.filter.plats.has(p) ? state.filter.plats.delete(p) : state.filter.plats.add(p); return render(); }
    const pl = e.target.closest("[data-pleaf]");
    if (pl) { const k = pl.dataset.pleaf, P = state.filter.plats; P.has(k) ? P.delete(k) : P.add(k); try { FX.play.tab(); } catch {} return render(); }
    const pg = e.target.closest("[data-pgroup]");
    if (pg) { const keys = pg.dataset.pgroup.split(","), P = state.filter.plats, on = keys.every(k => P.has(k)); keys.forEach(k => on ? P.delete(k) : P.add(k)); try { FX.play.tab(); } catch {} return render(); }
    const m = e.target.closest("[data-mode] button");
    if (m) { state.mode = m.dataset.v; api?.set_pref("view_mode", state.mode); return render(); }
    const mb = e.target.closest("[data-multi] button");
    if (mb) {
      const key = mb.parentElement.dataset.multi, set = asSet(state.filter[key]);
      if (mb.dataset.v === "All") set.clear(); else set.has(mb.dataset.v) ? set.delete(mb.dataset.v) : set.add(mb.dataset.v);
      state.filter[key] = set; return render();
    }
    if (e.target.closest("#clearFilters")) { state.filter = { q: "", status: new Set(), plats: new Set(), prio: new Set(), formats: new Set(), sort: state.filter.sort }; return render(); }
    const up = e.target.closest("[data-unpin]"); if (up) { state.filter[up.dataset.unpin] = null; return render(); }
    const segB = e.target.closest("[data-seg] button");
    if (segB) { state.filter[segB.parentElement.dataset.seg] = segB.dataset.v; return render(); }
    const bmb = e.target.closest("[data-bmulti] button");
    if (bmb) {
      const key = bmb.parentElement.dataset.bmulti, set = asSet(state.bfilter[key]);
      if (bmb.dataset.v === "All") set.clear(); else set.has(bmb.dataset.v) ? set.delete(bmb.dataset.v) : set.add(bmb.dataset.v);
      state.bfilter[key] = set; return render();
    }
    if (e.target.closest("#bclear")) { state.bfilter = { ...freshBookFilter(), q: state.bfilter.q }; return render(); }
    const bup = e.target.closest("[data-bunpin]"); if (bup) { state.bfilter[bup.dataset.bunpin] = null; return render(); }
    const bseg = e.target.closest("[data-bseg] button");
    if (bseg) { state.bfilter[bseg.parentElement.dataset.bseg] = bseg.dataset.v; return render(); }
    const evs = e.target.closest("[data-evstep]"); if (evs) { try { FX.play.move(); } catch {} return eventGo(eventState.i + +evs.dataset.evstep); }
    const evg = e.target.closest("[data-evgo]"); if (evg) return eventGo(+evg.dataset.evgo);
    if (e.target.closest("[data-evdeals]")) return go("deals");
    const gstep = e.target.closest("[data-gstep]");
    if (gstep) {
      const ys = (gotyState.data?.years || []).map(y => y.year), cur = state.gotyYear || gotyDefaultYear();
      const next = ys[ys.indexOf(cur) + +gstep.dataset.gstep];
      if (next) { state.gotyYear = next; try { FX.play.move(); } catch {} fillGotyHome(); }
      return;
    }
    const gyp = e.target.closest("[data-gyearpick]"); if (gyp) { state.gotyHistYear = +gyp.dataset.gyearpick; try { FX.play.move(); } catch {} return fillGotyHistory(); }
    if (e.target.closest("[data-gearly]")) { state.gotyEarly = true; return fillGotyHistory(); }
    const gpick = e.target.closest("[data-gpick]"); if (gpick) return openGotyPick(+gpick.dataset.gpick);
    const gclr = e.target.closest("[data-gclear]"); if (gclr) return setMyGoty(+gclr.dataset.gclear, null);
    const vg = e.target.closest("[data-vgame]");
    if (vg) { openAdd("games"); const f = $("#addForm"); if (f?.elements?.name) { f.elements.name.value = vg.dataset.vgame; if (f.elements.status) f.elements.status.value = "Wishlist"; } return; }
    const add = e.target.closest("[data-add]"); if (add) return openAdd(add.dataset.add);
    const open = e.target.closest("[data-open]"); if (open) return openPanel(open.dataset.kind || "game", open.dataset.open);
    if (e.target.closest("[data-catalog-go]")) { switchCatalog("news"); return go("yours"); }
    if (e.target.closest("[data-modpacks]")) return openModpacks();
    if (e.target.closest("[data-walk]")) return openWalk();
    if (e.target.closest("[data-unclassic]")) { e.stopPropagation(); return setClassic(null); }
    if (e.target.closest(".classic [data-url], .classic details, .classic summary")) return;
    if (e.target.closest("[data-itch]")) { api?.browse_itch(); return toast("itch.io opened. On any game's page, press \"+ Add to Masterlog wishlist\".", "ok"); }
    const mv = e.target.closest("[data-rkmove]");
    if (mv) { const [i, d] = mv.dataset.rkmove.split(":").map(Number), j = i + d, L = state.ranking; if (j < 0 || j >= L.length) return; [L[i], L[j]] = [L[j], L[i]]; try { FX.play.move(); } catch {} return saveRanking(); }
    const rd = e.target.closest("[data-rkdel]");
    if (rd) { const n = state.ranking.splice(+rd.dataset.rkdel, 1)[0]; return saveRanking(`${n} removed from your Top 100.`); }
  });
  document.addEventListener("click", e => { const u = e.target.closest("[data-url]"); if (u && u.dataset.url && !(u.matches(".nitem.spoiler"))) api?.open(u.dataset.url); });
  // dragging in the Top 100 (grid or list): the others slide out of the way as you go
  let drag = null, swallowClick = false;
  const flip = (container, mutate) => {
    const items = [...container.children], first = new Map(items.map(n => [n, n.getBoundingClientRect()]));
    mutate();
    for (const n of items) {
      if (n === drag?.el) continue;
      const a = first.get(n), b = n.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
      if (dx || dy) n.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.2, .8, .2, 1)" });
    }
  };
  view.addEventListener("dragstart", e => { if (e.target.closest?.(".rkcell, .rk")) e.preventDefault(); });   // no browser image dragging here
  view.addEventListener("pointerdown", e => {
    const el = e.target.closest?.(".rkcell, .rk");
    if (!el || e.button !== 0 || e.target.closest("input, a, .rk-act, .qc, [data-coverpick]") || (e.target.closest("button") && !e.target.closest(".case"))) return;
    drag = { el, x: e.clientX, y: e.clientY, started: false, id: e.pointerId };
  });
  addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 7) return;
      const r = drag.el.getBoundingClientRect();
      drag.started = true; drag.dx = drag.x - r.left; drag.dy = drag.y - r.top;
      const ghost = drag.el.cloneNode(true);
      ghost.classList.add("rk-ghost"); ghost.removeAttribute("data-ri");
      Object.assign(ghost.style, { width: `${r.width}px`, height: `${r.height}px`, left: `${r.left}px`, top: `${r.top}px` });
      document.body.append(ghost); drag.ghost = ghost;
      drag.el.classList.add("rk-placeholder");
      hidePeek(); try { FX.play.click(); } catch {}
    }
    e.preventDefault();
    drag.ghost.style.transform = `translate(${e.clientX - drag.dx - parseFloat(drag.ghost.style.left)}px, ${e.clientY - drag.dy - parseFloat(drag.ghost.style.top)}px) rotate(${drag.el.classList.contains("rkcell") ? 3 : 0}deg) scale(1.04)`;
    // scroll when you hold it near the top or bottom
    const vr = view.getBoundingClientRect();
    drag.scroll = e.clientY < vr.top + 70 ? -14 : e.clientY > vr.bottom - 70 ? 14 : 0;
    if (drag.scroll && !drag.scrolling) { drag.scrolling = true; const tickScroll = () => { if (!drag?.scroll) { if (drag) drag.scrolling = false; return; } view.scrollTop += drag.scroll; requestAnimationFrame(tickScroll); }; requestAnimationFrame(tickScroll); }
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".rkcell, .rk");
    if (!over || over === drag.el || over.parentElement !== drag.el.parentElement) return;
    const sib = [...over.parentElement.children], from = sib.indexOf(drag.el), to = sib.indexOf(over);
    flip(over.parentElement, () => over.parentElement.insertBefore(drag.el, from < to ? over.nextSibling : over));
    try { FX.play.move(); } catch {}
  }, { passive: false });
  addEventListener("pointerup", e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    if (!d.started) return;
    swallowClick = true; setTimeout(() => { swallowClick = false; }, 50);
    const r = d.el.getBoundingClientRect(), g = d.ghost;
    g.style.transition = "transform .22s cubic-bezier(.2, .8, .2, 1)";
    g.style.transform = `translate(${r.left - parseFloat(g.style.left)}px, ${r.top - parseFloat(g.style.top)}px)`;
    const order = [...d.el.parentElement.children].map(n => +n.dataset.ri).filter(n => !isNaN(n));
    setTimeout(() => {
      g.remove(); d.el.classList.remove("rk-placeholder");
      const before = state.ranking.slice(), moved = before[+d.el.dataset.ri];
      state.ranking = order.map(i => before[i]);
      const at = state.ranking.indexOf(moved);
      if (at !== +d.el.dataset.ri) { try { FX.play.save(); } catch {} saveRanking(at < 10 ? `${moved} is now #${at + 1}: an all-time favourite.` : `${moved} is now #${at + 1}.`); }
    }, 230);
  });
  addEventListener("click", e => { if (swallowClick) { e.stopPropagation(); e.preventDefault(); swallowClick = false; } }, true);
  // right-click a cover (game or book) for quick changes
  document.addEventListener("contextmenu", e => {
    const c = e.target.closest?.(".case[data-kind], tr[data-kind]");
    if (!c || e.target.closest("#panel, #walk")) { closeCtx(); return; }
    const kind = c.dataset.kind === "book" ? "book" : "game", item = findItem(kind, c.dataset.id);
    if (!item) return;
    e.preventDefault(); hidePeek();
    if (selection.size && c.classList.contains("sel")) return batchCtxMenu(e.clientX, e.clientY);
    ctxMenu(item, e.clientX, e.clientY, kind);
  });
  document.addEventListener("click", e => {
    const m = document.getElementById("ctx");
    if (!m) return;
    if (!m.contains(e.target)) return closeCtx();
    const bl = e.target.closest("li[data-bset], li[data-bact]");
    if (bl) { e.preventDefault(); e.stopPropagation(); return batchAction(bl); }
    const li = e.target.closest("li[data-act], li[data-set], button[data-act]");
    if (li) { e.preventDefault(); e.stopPropagation(); ctxAction(li); }
  }, true);
  document.addEventListener("keydown", e => {
    const m = document.getElementById("ctx");
    if (!m) return;
    if (e.key === "Escape") { e.stopPropagation(); closeCtx(); }
    if (e.key === "Enter" && e.target.closest?.(".ctx-rank")) { e.preventDefault(); ctxAction(m.querySelector('[data-act="rank"]')); }
  }, true);
  view.addEventListener("scroll", closeCtx, { passive: true });
  view.addEventListener("change", e => {
    if (e.target.id === "rankAdd" && e.target.value.trim()) { const n = e.target.value.trim(); if (!state.ranking.some(x => rankKey(x) === rankKey(n))) { state.ranking.push(n); saveRanking(`${n} added at #${state.ranking.length}. Drag it where it belongs.`); } return; }
    if (e.target.id === "scale") applyScale(+e.target.value, true);
    if (e.target.id === "sort") { state.filter.sort = e.target.value; render(); }
    if (e.target.id === "bsort") { state.bfilter.sort = e.target.value; render(); }
    if (e.target.classList.contains("cellsel")) {
      const tr = e.target.closest("tr"), item = findItem(tr.dataset.kind, tr.dataset.id);
      if (item) saveEdit(tr.dataset.kind === "book" ? "books" : "games", item, { [e.target.dataset.field]: e.target.value }, true);
    }
  });
  let searchT;
  view.addEventListener("input", e => {
    if (e.target.id !== "search" && e.target.id !== "bsearch") return;
    clearTimeout(searchT);
    const id = e.target.id;
    searchT = setTimeout(() => {
      (id === "search" ? state.filter : state.bfilter).q = e.target.value;
      const pos = e.target.selectionStart; render(); const s = $("#" + id); s.focus(); s.setSelectionRange(pos, pos);
    }, 160);
  });
  const hover = e => {
    const c = e.target.closest?.(".shelf .case");
    if (!c) return;
    if (state.view === "home" && c.dataset.kind === "game") { state.focusId = +c.dataset.id; updateHero(findItem("game", c.dataset.id)); }
    if (state.view === "shelf" && c.dataset.kind === "book") { state.focusId = +c.dataset.id; updateBookHero(findItem("book", c.dataset.id)); }
  };
  view.addEventListener("mouseover", hover);
  view.addEventListener("focusin", hover);
  document.addEventListener("mouseover", e => {
    const t = e.target.closest?.(".case, .tab, .catalog, .chip, .primary, .ghost, .seg button, .ptabs button, .qs");
    if (t && t !== document.lastHoverTarget) { document.lastHoverTarget = t; try { FX.play.hover(); } catch {} }
  });
  document.addEventListener("click", e => {
    if (e.target.closest(".case, [data-qc], [data-qown], .close")) return;
    if (e.target.closest(".tab, .catalog, .ptabs button, .stabs button")) { try { FX.play.tab(); } catch {} return; }
    if (e.target.closest("button, .chip, a, [data-url]")) { try { FX.play.click(); } catch {} }
  }, true);
  view.addEventListener("mouseover", e => {
    const tr = e.target.closest?.("tr[data-id]");
    if (!tr) return;
    if (tr.dataset.key === "1") return;
    view.querySelectorAll("tr[data-key='1']").forEach(x => { x.dataset.key = ""; });
    tr.dataset.key = "1";
    const item = findItem(tr.dataset.kind, tr.dataset.id);
    if (item) showPeek(item, e.clientX, e.clientY);
  });
  view.addEventListener("mousemove", e => { if (e.target.closest?.("tr[data-id]")) movePeek(e.clientX, e.clientY); });
  view.addEventListener("mouseout", e => {
    const tr = e.target.closest?.("tr[data-id]");
    if (tr && !tr.contains(e.relatedTarget)) { tr.dataset.key = ""; hidePeek(); }
  });
  view.addEventListener("scroll", hidePeek, { passive: true });

  view.addEventListener("click", e => {
    const ns = e.target.closest("[data-nsrc]"); if (ns) { newsState.source[state.view] = ns.dataset.nsrc; return paintNews(state.view); }
    if (e.target.closest("#newsRefresh")) return loadNews(state.view, true);
    if (e.target.closest("#redditHelp")) { openSettings(false, "sheet"); setTimeout(() => { const d = [...document.querySelectorAll("#settingsForm details.howto")].find(x => /Reddit/.test(x.textContent)); if (d) { d.open = true; d.scrollIntoView({ block: "center" }); } }, 60); return; }
    if (e.target.closest("#dealsRefresh")) return loadDeals(true);
    if (e.target.closest("#replaySale")) return maybeSaleEvent(true);
    const mon = e.target.closest("[data-money]");
    if (mon) { state.settings.money = mon.dataset.money; api?.set_pref("money", mon.dataset.money); $("#view").innerHTML = dealsHTML(); activateArt($("#view")); return; }
    const rn = e.target.closest("[data-rename]");
    if (rn) { rn.disabled = true; return api?.apply_rename(rn.dataset.rename).then(r => { toast(r?.error || "Renamed.", r?.error ? "err" : "ok"); dealState.data && delete dealState.data.renames[rn.dataset.rename]; sync(true); }); }
    const sp = e.target.closest(".nitem.spoiler"); if (sp) { setTimeout(() => sp.classList.remove("spoiler"), 0); }
  });
  panel.addEventListener("click", e => {
    if (e.target.closest(".close")) return closePanel();
    const t = e.target.closest("[data-ptab]"); if (t) return showPanelTab(t.dataset.ptab);
    const q = e.target.closest("[data-quick]");
    if (q) { const item = findItem(panelItem.kind, panelItem.id); if (item && item.status !== q.dataset.quick) saveEdit(panelItem.kind === "book" ? "books" : "games", item, { status: q.dataset.quick }); return; }
    const o = e.target.closest("[data-open]"); if (o) return openPanel(o.dataset.kind || "game", o.dataset.open);
    if (e.target.closest("#logRun")) return runForm();
    const gt = e.target.closest("[data-g]"); if (gt) return showGallery(+gt.dataset.g, galleryItems[+gt.dataset.g]?.video);
    const gp = e.target.closest("[data-gplay]"); if (gp) return showGallery(+gp.dataset.gplay, true);
    if (e.target.closest("[data-coverpick]")) { e.stopPropagation(); return openCoverPicker(); }
    const nx = e.target.closest("[data-nexus]"); if (nx) { Promise.resolve(api?.nexus_link(nx.dataset.nexus)).then(u => u && api.open_inside(u, `${nx.dataset.nexus} mods`)); return; }
    const fa = e.target.closest("[data-famadd]"); if (fa) { const g = findItem("game", fa.dataset.famadd); if (g) addFamilyGame(g); return; }
    const cl = e.target.closest("[data-classic]"); if (cl) { const g = findItem("game", cl.dataset.classic); if (g) { setClassic(isClassic(g) ? null : g); showPanelTab("edit"); } return; }
    if (e.target.closest("[data-refresh]")) return refreshGame();
    const dl = e.target.closest("[data-dlcown]"); if (dl) return markDlc(dl.dataset.dlcown);
    const cp = e.target.closest("[data-copy]"); if (cp) { navigator.clipboard?.writeText(cp.dataset.copy).then(() => toast("Copied.", "ok")).catch(() => toast("Couldn't copy.", "err")); return; }
    const op = e.target.closest("[data-openpath]"); if (op) { Promise.resolve(api?.open_path(op.dataset.openpath)).then(r => r !== true && toast(r || "That folder isn't on this PC.", "err")); return; }
    const ins = e.target.closest("[data-inside]"); if (ins) { api?.open_inside(ins.dataset.inside, ins.dataset.title || "Masterlog"); return; }
    const tw = e.target.closest("[data-twitch]"); if (tw) return playWatch("twitch", +tw.dataset.twitch);
    const yw = e.target.closest("[data-ytw]"); if (yw) return playWatch("yt", +yw.dataset.ytw);
  });
  panel.addEventListener("submit", e => {
    e.preventDefault();
    const ws = e.target.closest("[data-wikisearch]");
    if (ws) {
      const q = ws.querySelector("input").value.trim(); if (!q) return;
      const base = ws.dataset.wikisearch.replace(/\/wiki\/.*$/, "").replace(/\/$/, "");
      const url = ws.dataset.wikikind === "fandom" ? `${base}/wiki/Special:Search?query=${encodeURIComponent(q)}` : `${base}/${encodeURIComponent(q.replace(/ /g, "+"))}`;
      api?.open_inside(url, `${ws.dataset.wikiname}: ${q}`); return;
    }
    const item = findItem(panelItem.kind, panelItem.id);
    if (e.target.id === "editForm") {
      const rf = e.target.elements.top_rank, cat = e.target.dataset.cat;
      const changes = readForm(e.target, cat, item);
      const ranked = rf && cat === "games" ? placeInRanking(item, rf.value === "" ? 0 : Math.max(1, Math.round(+rf.value))) : false;
      const form = e.target;
      if (Object.keys(changes).length) Promise.resolve(saveEdit(cat, item, changes)).then(() => { form.classList.add("saved"); setTimeout(() => form.classList.remove("saved"), 900); modifyDirty(form); });
      else if (!ranked) toast("Nothing changed.");
      else modifyDirty(form);
    }
    if (e.target.id === "runFormEl") submitRun(e.target, item);
  });
  // Modify: live score, steppers, and a save bar that counts what you changed
  const modifyInput = e => {
    const form = e.target.closest?.("#editForm"); if (!form) return;
    if (e.target.matches("[data-score]")) {
      const box = e.target.closest(".score"), v = +e.target.value;
      form.elements.score.value = v; box.classList.remove("unset"); box.querySelector(".scorenum").textContent = String(v).replace(/\.0$/, "");
    }
    modifyDirty(form);
  };
  panel.addEventListener("input", modifyInput);
  panel.addEventListener("change", modifyInput);
  panel.addEventListener("click", e => {
    const form = e.target.closest?.("#editForm"); if (!form) return;
    const st = e.target.closest("[data-step]");
    if (st) { const inp = st.parentElement.querySelector("input"); const v = (+inp.value || 0) + (+st.dataset.step); inp.value = Math.max(0, Math.round(v * 10) / 10); modifyDirty(form); return; }
    if (e.target.closest("[data-scoreclear]")) { const box = form.querySelector(".score"); form.elements.score.value = ""; box.classList.add("unset"); box.querySelector(".scorenum").textContent = "–"; modifyDirty(form); return; }
    if (e.target.closest("[data-discard]")) { showPanelTab("edit"); toast("Changes discarded."); }
  });

  document.addEventListener("keydown", e => {
    if (e.key === "F11") { e.preventDefault(); toggleBigPicture(); return; }
    if (e.key === "l" && e.ctrlKey) { e.preventDefault(); Walk.active ? Walk.close() : openWalk(); return; }
    if (e.key === "Escape") { if ($("#panel").classList.contains("open") && !document.getElementById("ctx") && !document.querySelector("dialog[open]")) closePanel(); else if (!document.getElementById("ctx")) clearSelection(); return; }
    if (Walk.active && !$("#panel").classList.contains("open")) return;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName) || document.querySelector("dialog[open]")) return;
    const dir = { ArrowLeft: "l", ArrowRight: "r", ArrowUp: "u", ArrowDown: "d" }[e.key];
    if (dir) { e.preventDefault(); move(dir); }
    if (e.key === "q" || e.key === "e") cycleTab(e.key === "e" ? 1 : -1);
    if (e.key === "Tab" && e.shiftKey && e.ctrlKey) switchCatalog(isBooks() ? "games" : "books");
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) sync(false); });
  // every animation rests while Masterlog isn't the window you're using
  const calm = () => document.body.classList.toggle("calm", document.hidden || !document.hasFocus());
  addEventListener("blur", calm); addEventListener("focus", calm); document.addEventListener("visibilitychange", calm);
  pollPad();
  loadGoty();
  setTimeout(checkHealthDot, 60 * 1000); setInterval(checkHealthDot, 30 * 60 * 1000);
  $("#gotyPickList")?.addEventListener("click", e => {
    const b = e.target.closest("[data-gchoose]");
    if (!b) return;
    const year = +$("#gotyDialog").dataset.year;
    $("#gotyDialog").close();
    setMyGoty(year, b.dataset.gchoose);
  });
  Promise.resolve(api?.platform_info?.()).then(p => {
    if (!p) return;
    state.platform = p;
    document.body.dataset.os = p.os;
    document.body.classList.toggle("deck", !!p.deck);
    if (p.native_pad) nativePads();
  }).catch(() => {});
}
async function quickMark(btn) {
  const kind = btn.dataset.qkind, item = findItem(kind, btn.dataset.qc || btn.dataset.qown);
  if (!item) return;
  const caseEl = btn.closest(".case");
  if (btn.dataset.qown) {
    try { FX.play.click(); } catch {}
    return saveEdit(kind === "book" ? "books" : "games", item, { status: kind === "book" ? "To read" : "Library" });
  }
  try { FX.play.check(); } catch {}
  caseEl?.classList.add("popped");
  const changes = kind === "book" ? { status: "Read" } : { status: "Completed" };
  if (kind === "game" && item.hours == null) { const h = hoursFromAccounts(item); if (h) changes.hours = h; }
  await saveEdit(kind === "book" ? "books" : "games", item, changes, true);
  toast(kind === "book" ? `Finished ${item.name}. Nice read!` : `${item.name} completed${changes.hours ? ` in ${changes.hours} h` : ""}. GG!`, "ok");
}
async function markDlc(name) {
  const g = findItem(panelItem?.kind, panelItem?.id);
  if (!g || !api) return;
  const own = !(state.dlcMarks?.[g.name] || {})[name];
  state.dlcMarks = await api.mark_dlc(g.name, name, own);
  if (own && !g.dlc_owned && state.canEdit) { await saveEdit("games", g, { dlc_owned: true }, true); }
  try { FX.play.check(); } catch {}
  showPanelTab("dlc");
}
/* ---------- modpacks from your mod managers ---------- */
async function openModpacks() {
  if (!api) return;
  $("#importForm").innerHTML = `<h2>Modpacks on this PC</h2><div class="news-loading"><span class="spinner"></span> Looking in CurseForge, r2modman, Thunderstore, Vortex, Mod Organizer 2 and Nexus Mods…</div>`;
  $("#importForm")._list = []; $("#importForm")._picked = new Set();
  $("#importDialog").showModal();
  const r = await api.modpacks_scan().catch(() => ({ items: [] }));
  const items = r.items || [];
  $("#importForm")._mods = items;
  $("#importForm").innerHTML = `<h2>Modpacks on this PC</h2>
    <p class="fine">Profiles and modpacks from your mod managers, Nexus Mods collections you installed with Vortex${r.nexus ? ", and the mods you track and endorse on Nexus Mods" : ""}. Add one and it gets its own cover in Modpacks, on Home and in Library.</p>
    ${!r.nexus ? `<p class="fine">Add your free Nexus Mods API key in Settings → Accounts to also see the mods you track and endorse there.</p>` : ""}${r.nexus_app ? `<p class="fine">The Nexus Mods app is installed too. Its loadouts are kept in a database other apps can't read yet, so they aren't listed.</p>` : ""}
    ${items.length ? `<ul class="modlist">${items.map((p, i) => `<li class="${p.manager.startsWith("Nexus") ? "nexus" : ""}"><div><b>${esc(p.name)}</b><small>${esc(p.manager)}${p.mods ? ` · ${p.mods} mods` : ""}${p.detail ? ` · ${esc(p.detail)}` : ""}${p.last ? ` · used ${esc(ago(p.last))}` : ""}</small></div>
      ${p.url ? `<button type="button" class="ghost small" data-url="${esc(p.url)}">On Nexus</button>` : ""}${p.added ? `<span class="owntag">In Masterlog</span>` : `<button type="button" class="primary small" data-addmod="${i}">Add</button>`}</li>`).join("")}</ul>`
      : `<p class="muted">No modpacks found. Masterlog looks in the default folders of CurseForge (Minecraft), r2modman, Thunderstore Mod Manager, Vortex (including its Nexus Mods collections) and Mod Organizer 2.</p>`}
    <div class="row"><span class="spacer"></span><button value="close" class="ghost">Close</button></div>`;
}
async function addModpack(i, btn) {
  const p = $("#importForm")._mods?.[i];
  if (!p) return;
  btn.disabled = true;
  const r = await api.add_modpack(p).catch(e => ({ error: String(e) }));
  if (r.error) { btn.disabled = false; return toast(r.error, "err"); }
  btn.outerHTML = `<span class="owntag">Added</span>`;
  try { FX.play.save(); } catch {}
  toast(`${p.name} added to Modpacks.`, "ok");
  sync(true);
}

/* ---------- Claude, for free: copy a prompt, paste the answer back ---------- */
const CLAUDE_FIELDS = ["status", "priority", "platform", "play_on", "format", "hours", "score", "genre", "developer", "publisher", "notes", "type", "migrate_to", "upgrade", "upgrade_owned", "dlc_owned", "dlc_done", "platinum", "second_chance"];
function claudePrompt(ask) {
  const opts = state.options.games || {};
  const rows = state.games.map(g => [g.name, g.status, g.priority || "", g.platform, g.format || "", g.hours ?? "", g.score ?? "", g.genre || "", g.completed || "", g.type || "", rankOf(g) || ""].join(" | ")).join("\n");
  return `You're helping me manage my game backlog app, Masterlog. My library is below (one game per line).

My request: ${ask}

Answer normally (recommendations, thoughts) for me to read. If my request means changing my library, end your reply with ONE fenced code block labelled masterlog containing JSON like this:
\`\`\`masterlog
{"actions": [
  {"do": "update", "game": "<exact name from my library>", "set": {"status": "Completed", "score": 7, "hours": 10.5}},
  {"do": "add", "game": "<new game's official name>", "set": {"status": "Wishlist", "platform": "Steam", "priority": "High"}},
  {"do": "rank", "game": "<exact name>", "position": 26}
]}
\`\`\`
Rules: use exact names from my library for updates. Fields you may set: ${CLAUDE_FIELDS.join(", ")}.
Allowed values: status ${JSON.stringify(opts.status || ["Library", "Playing", "Paused", "Wishlist", "Completed", "Dropped"])}, priority ${JSON.stringify(opts.priority || ["Extreme", "High", "Medium", "Low"])}, platform ${JSON.stringify(opts.platform || Object.keys(PLAT))}, format ["Digital","Physical"], type ["Live service","Modded"]. Scores are out of 10, hours are numbers. Completion dates fill in automatically. "rank" places a game in my Top 100 (1 = best; the top 10 are my all-time favourites; position 0 removes it). My current Top 100 in order: ${(state.ranking || []).map((n, i) => `${i + 1}. ${n}`).join("; ")}.

My library (name | status | priority | platform | format | hours | score | genre | finished | type | top-100 rank):
${rows}`;
}
function parseClaude(text) {
  const m = /\`\`\`\s*masterlog\s*([\s\S]*?)\`\`\`/i.exec(text) || /\`\`\`(?:json)?\s*(\{[\s\S]*?"actions"[\s\S]*?\})\s*\`\`\`/i.exec(text);
  if (!m) return { actions: [], say: text.trim() };
  let data;
  try { data = JSON.parse(m[1]); } catch { return { error: "Claude's change list isn't valid JSON. Ask Claude to send the masterlog block again." }; }
  const actions = (data.actions || []).filter(a => a && (a.do === "update" || a.do === "add" || a.do === "rank") && a.game).map(a => {
    if (a.do === "rank") return { ...a, set: { position: +a.position || 0 }, ok: true };
    const set = {};
    for (const [k, v] of Object.entries(a.set || {})) if (CLAUDE_FIELDS.includes(k)) set[k] = v;
    const g = a.do === "update" ? state.games.find(x => x.name.toLowerCase() === String(a.game).toLowerCase()) : null;
    return { ...a, set, target: g, ok: a.do === "add" || !!g };
  });
  return { actions, say: text.replace(m[0], "").trim() };
}
function claudePreview() {
  const r = parseClaude($("#claudeReply").value || "");
  const box = $("#claudePreview");
  $("#claudeApply").disabled = !(r.actions || []).some(a => a.ok);
  if (r.error) { box.innerHTML = `<p class="nerr">${esc(r.error)}</p>`; return r; }
  if (!r.actions.length) { box.innerHTML = $("#claudeReply").value.trim() ? `<p class="muted">No library changes in this answer.</p>` : ""; return r; }
  box.innerHTML = `<h3>Changes Claude suggests</h3><ul class="claudeacts">${r.actions.map(a => `<li class="${a.ok ? "" : "bad"}"><b>${a.do === "add" ? "Add" : a.do === "rank" ? (a.set.position ? `Rank #${a.set.position}:` : "Remove from Top 100:") : "Update"} ${esc(a.game)}</b>
    <span>${Object.entries(a.set).map(([k, v]) => `${esc(k.replace(/_/g, " "))}: ${esc(v)}`).join(" · ") || "—"}</span>${a.ok ? "" : `<small>Not in your library, skipped</small>`}</li>`).join("")}</ul>`;
  return r;
}
async function claudeApply() {
  const r = claudePreview();
  const acts = (r.actions || []).filter(a => a.ok);
  if (!acts.length) return;
  $("#claudeApply").disabled = true;
  let done = 0;
  for (const a of acts) {
    if (a.do === "rank") {
      const L = state.ranking, k = rankKey(a.game), at = L.findIndex(n => rankKey(n) === k);
      const name = at >= 0 ? L.splice(at, 1)[0] : a.game;
      if (a.set.position > 0) L.splice(Math.min(a.set.position - 1, L.length), 0, name);
      saveRanking(); done++; continue;
    }
    const res = a.do === "add" ? await api.add("games", { name: a.game, status: "Library", format: "Digital", ...a.set }).catch(e => ({ error: String(e) }))
      : await api.edit("games", a.target.row, a.target.name, a.set).catch(e => ({ error: String(e) }));
    if (res && !res.error) done++;
  }
  try { FX.play.save(); } catch {}
  toast(`Applied ${done} of ${acts.length} change${acts.length === 1 ? "" : "s"} from Claude.`, done === acts.length ? "ok" : "err");
  $("#claudeDialog").close(); $("#claudeReply").value = ""; $("#claudePreview").innerHTML = "";
  sync(true);
}

/* ---------- right-click a cover: quick changes right where you are ---------- */
function ctxMenu(g, x, y, kind = "game") {
  closeCtx();
  if (kind === "book") return bookCtxMenu(g, x, y);
  if (g.family) {
    const m = document.createElement("div");
    m.id = "ctx"; m.className = "ctx"; m.setAttribute("role", "menu"); m.dataset.id = g.id; m.dataset.kind = "game";
    m.innerHTML = `<div class="ctx-head">${esc(g.name)}<small>Shared by ${esc((g.owners || []).join(", "))}</small></div><ul>
      <li role="menuitem" tabindex="-1" data-act="open">Open</li>
      ${state.canEdit ? `<li role="menuitem" tabindex="-1" data-act="famadd">Add to Masterlog</li>` : ""}
      <li role="menuitem" tabindex="-1" data-act="famplay">Play on Steam</li></ul>`;
    return placeCtx(m, x, y);
  }
  const edit = state.canEdit ? "" : " disabled";
  const sub = (label, key, values, current, fmt = v => v) => `<li class="has-sub" role="menuitem" tabindex="-1"><span>${label}</span><i>›</i><ul class="sub" role="menu">${values.map(v =>
    `<li role="menuitemradio" tabindex="-1" aria-checked="${(current ?? "") === v}" data-set="${key}" data-val="${esc(v)}"${edit}>${esc(fmt(v))}</li>`).join("")}</ul></li>`;
  const opts = (k, d) => state.options.games?.[k]?.length ? state.options.games[k] : d;
  const genres = splitList(g.genre), studios = [...new Set(splitList(`${g.developer},${g.publisher}`))];
  const rk = rankOf(g);
  const m = document.createElement("div");
  m.id = "ctx"; m.className = "ctx"; m.setAttribute("role", "menu"); m.dataset.id = g.id; m.dataset.kind = "game";
  m.innerHTML = `<div class="ctx-head">${esc(g.name)}</div><ul>
    <li role="menuitem" tabindex="-1" data-act="open">Open</li>
    ${sub("Status", "status", opts("status", ["Library", "Playing", "Paused", "Wishlist", "Completed", "Dropped"]), g.status)}
    ${sub("Priority", "priority", [...opts("priority", ["Extreme", "High", "Medium", "Low"]), ""], g.priority, v => v || "No priority")}
    ${sub("Platform", "platform", opts("platform", Object.keys(PLAT)), g.platform, v => plat(v).label)}
    ${sub("Format", "format", ["Physical", "Digital"], g.format)}
    ${sub("Type", "type", ["", "Live service", "Modded"], g.type || "", v => v || "Normal game")}
    ${state.canEdit ? `<li role="menuitem" tabindex="-1" data-act="classic" class="ctx-classic">${isClassic(g) ? "Remove All Time Classic" : "Crown as All Time Classic"}</li>` : ""}
    <li role="menuitem" tabindex="-1" data-act="mygoty" class="ctx-goty">${gotyOf(g)?.mine?.length ? `Your Game of ${gotyOf(g).mine.join(", ")} (change in History)` : "Crown as my Game of the Year"}</li>
    <li role="menuitem" tabindex="-1" class="ctx-rank"><span>Top 100</span><input type="number" min="1" max="${(state.ranking || []).length + 1}" value="${rk || ""}" placeholder="place" aria-label="Top 100 place"><button type="button" data-act="rank">Set</button></li>
    <li class="sep" role="separator"></li>
    ${genres.length ? `<li role="menuitem" tabindex="-1" data-act="genre">Similar genre <small>${esc(genres.slice(0, 3).join(", "))}</small></li>` : ""}
    ${g.developer ? `<li role="menuitem" tabindex="-1" data-act="dev">More by ${esc(g.developer)}</li>` : ""}
    ${g.publisher && g.publisher !== g.developer ? `<li role="menuitem" tabindex="-1" data-act="pub">More from ${esc(g.publisher)}</li>` : ""}
    <li class="sep" role="separator"></li>
    <li role="menuitem" tabindex="-1" data-act="cover">Change cover…</li>
    <li role="menuitem" tabindex="-1" data-act="refresh">Refresh info</li>
    ${state.canEdit && !g.virtual ? `<li class="sep" role="separator"></li><li role="menuitem" tabindex="-1" data-act="delete" class="ctx-danger">${g.status === "Wishlist" ? "Remove from wishlist…" : "Delete from Masterlog…"}</li>` : ""}
  </ul>`;
  placeCtx(m, x, y);
}
const ctxSub = (label, key, values, current, fmt = v => v) => `<li class="has-sub" role="menuitem" tabindex="-1"><span>${label}</span><i>›</i><ul class="sub" role="menu">${values.map(v =>
  `<li role="menuitemradio" tabindex="-1" aria-checked="${(current ?? "") === v}" data-set="${key}" data-val="${esc(v)}"${state.canEdit ? "" : " disabled"}>${esc(fmt(v))}</li>`).join("")}</ul></li>`;
function bookCtxMenu(b, x, y) {
  const o = (k, d) => state.options.books?.[k]?.length ? state.options.books[k] : d;
  const inSeries = b.series ? state.books.filter(x => x.series === b.series).length : 0;
  const byAuthor = b.author ? state.books.filter(x => x.author === b.author).length : 0;
  const m = document.createElement("div");
  m.id = "ctx"; m.className = "ctx"; m.setAttribute("role", "menu"); m.dataset.id = b.id; m.dataset.kind = "book";
  m.innerHTML = `<div class="ctx-head">${esc(b.name)}${b.author ? `<small>${esc(b.author)}</small>` : ""}</div><ul>
    <li role="menuitem" tabindex="-1" data-act="open">Open</li>
    ${ctxSub("Status", "status", o("status", FALLBACK_OPTIONS.books.status), b.status)}
    ${ctxSub("Priority", "priority", [...o("priority", FALLBACK_OPTIONS.books.priority), ""], b.priority, v => v || "No priority")}
    ${ctxSub("Format", "format", o("format", FALLBACK_OPTIONS.books.format), b.format)}
    <li class="sep" role="separator"></li>
    ${byAuthor > 1 ? `<li role="menuitem" tabindex="-1" data-act="author">More by ${esc(b.author)} <small>${byAuthor} books</small></li>` : ""}
    ${inSeries > 1 ? `<li role="menuitem" tabindex="-1" data-act="series">The rest of ${esc(b.series)} <small>${inSeries} books</small></li>` : ""}
    ${byAuthor > 1 || inSeries > 1 ? `<li class="sep" role="separator"></li>` : ""}
    <li role="menuitem" tabindex="-1" data-act="cover">Change cover…</li>
    <li role="menuitem" tabindex="-1" data-act="refresh">Refresh info</li>
    ${state.canEdit ? `<li class="sep" role="separator"></li><li role="menuitem" tabindex="-1" data-act="delete" class="ctx-danger">Delete from Masterlog…</li>` : ""}
  </ul>`;
  placeCtx(m, x, y);
}
function placeCtx(m, x, y) {
  document.body.append(m);
  // keep it on screen, and open submenus to whichever side has room
  const r = m.getBoundingClientRect();
  const left = Math.min(x, innerWidth - r.width - 8), top = Math.min(y, innerHeight - r.height - 8);
  m.style.left = `${Math.max(8, left)}px`; m.style.top = `${Math.max(8, top)}px`;
  if (left + r.width * 2 > innerWidth) m.classList.add("flip");
  try { FX.play.tab(); } catch {}
  m.querySelector("li[data-act]")?.focus();
}
function closeCtx() { document.getElementById("ctx")?.remove(); }
async function ctxAction(li) {
  const m = document.getElementById("ctx");
  if (m?.dataset.kind === "book") return bookCtxAction(li, m);
  const g = findItem("game", m?.dataset.id);
  if (!g || li.hasAttribute("disabled")) return;
  const act = li.dataset.act;
  if (li.dataset.set) {
    const k = li.dataset.set, v = li.dataset.val;
    closeCtx();
    if ((g[k] ?? "") === v) return;
    const target = g.virtual ? state.games.find(x => x.row === g.row) : g;
    await saveEdit("games", target, { [k]: v }, true);
    toast(`${g.name}: ${k.replace("_", " ")} set to ${v || "none"}.`, "ok");
    return;
  }
  if (act === "delete") { if (!armDelete(li, g)) return; closeCtx(); return deleteItem("games", g); }
  if (act === "rank") { const v = m.querySelector(".ctx-rank input").value; closeCtx(); placeInRanking(g, v === "" ? 0 : Math.max(1, Math.round(+v))); return render(); }
  closeCtx();
  if (act === "famadd") return addFamilyGame(g);
  if (act === "famplay") return api?.open(`steam://run/${g.appid}`);
  if (act === "open") return openPanel("game", g.id);
  if (act === "mygoty") { if (gotyOf(g)?.mine?.length) { state.gotyHistYear = gotyOf(g).mine[0]; return go("stats"); } return crownMine(g.virtual ? state.games.find(x => x.row === g.row) || g : g); }
  if (act === "classic") return setClassic(isClassic(g) ? null : (g.virtual ? state.games.find(x => x.row === g.row) || g : g));
  if (act === "cover") { panelItem = { kind: "game", id: g.id }; coverFor = null; return openCoverPicker(); }
  if (act === "refresh") { openPanel("game", g.id); return refreshGame(); }
  if (act === "genre" || act === "dev" || act === "pub") {
    const vals = act === "genre" ? splitList(g.genre) : splitList(act === "dev" ? g.developer : g.publisher);
    state.filter = { q: "", status: new Set(), plats: new Set(), prio: new Set(), formats: new Set(), sort: "priority",
      genre: act === "genre" ? vals : null, studio: act !== "genre" ? vals : null };
    if (state.catalog !== "games") switchCatalog("games");
    return go("library");
  }
}

/* fetch everything about a game again, in case something came out wrong */
async function bookCtxAction(li, m) {
  const b = findItem("book", m.dataset.id);
  if (!b || li.hasAttribute("disabled")) return;
  const act = li.dataset.act;
  if (act === "delete") { if (!armDelete(li, b)) return; closeCtx(); return deleteItem("books", b); }
  closeCtx();
  if (li.dataset.set) {
    const k = li.dataset.set, v = li.dataset.val;
    if ((b[k] ?? "") === v) return;
    const changes = { [k]: v };
    if (k === "status" && v === "Read" && !b.finished) changes.finished = new Date().toISOString().slice(0, 10);
    await saveEdit("books", b, changes, true);
    return toast(`${b.name}: ${k} set to ${v || "none"}.`, "ok");
  }
  if (act === "open") return openPanel("book", b.id);
  if (act === "cover") { panelItem = { kind: "book", id: b.id }; coverFor = null; return openCoverPicker(); }
  if (act === "refresh") { openPanel("book", b.id); return refreshGame(); }
  if (act === "author" || act === "series") {
    state.bfilter = { ...freshBookFilter(), sort: act === "series" ? "series" : "author", [act]: act === "author" ? b.author : b.series };
    if (state.catalog !== "books") switchCatalog("books");
    return go("books");
  }
}
/* deleting asks twice in the menu itself (no pop-up), then offers Undo */
function armDelete(li, item) {
  if (li.dataset.armed) return true;
  li.dataset.armed = "1";
  li.classList.add("armed");
  li.textContent = `Click again to delete "${item.name}"`;
  try { FX.play.tab(); } catch {}
  return false;
}
async function deleteItem(tab, item) {
  const list = tab === "books" ? state.books : state.games;
  const at = list.indexOf(item);
  if (at < 0) return;
  list.splice(at, 1);
  if (panelItem && findItem(panelItem.kind, panelItem.id) == null) closePanel();
  if (panelItem && panelItem.id === item.id && panelItem.kind === (tab === "books" ? "book" : "game")) closePanel();
  rankIndex = null; virtualKey = null;
  render();
  const r = await Promise.resolve(api?.delete_item(tab, item.row, item.name)).catch(e => ({ error: String(e) }));
  if (!r || r.error) {
    list.splice(at, 0, item); rankIndex = null; render();
    return toast(`Couldn't delete: ${r?.error || "no connection"}`, "err");
  }
  try { FX.play.back(); } catch {}
  toast(`Deleted ${item.name}.`, "ok", { label: "Undo", run: async () => {
    const u = await Promise.resolve(api.undo_delete(r.undo)).catch(e => ({ error: String(e) }));
    if (u?.error) toast(`Couldn't put it back: ${u.error}`, "err"); else { toast(`${item.name} is back.`, "ok"); sync(true); }
  } });
  setTimeout(() => sync(false), 2500);
}
async function refreshGame() {
  const g = findItem(panelItem?.kind, panelItem?.id);
  if (!g || !api) return;
  toast(`Fetching ${g.name} again…`);
  if (panelItem.kind === "book") {
    const r = await api.refresh_book(g).catch(() => null);
    covers.set(coverKey(g), r?.uri || null);
    closePanel(); render(); openPanel("book", g.id, "overview");
    return toast(`${g.name} refreshed.`, "ok");
  }
  const r = await api.refresh_game(g).catch(() => null);
  if (r?.renamed) {
    toast(`"${g.name}" is officially "${r.renamed}" (${r.source}). Renamed so its info can be found.`, "ok", { label: "Undo", run: async () => { await api.undo_rename(g.name, r.renamed, r.row); sync(true); } });
    await sync(true);
    const ng = state.games.find(x => x.name === r.renamed);
    if (ng) { closePanel(); render(); openPanel("game", ng.id, "overview"); }
    return;
  }
  covers.delete(coverKey(g));
  const uri = await api.cover(g.name, g.platform || "").catch(() => null);
  covers.set(coverKey(g), uri || null);
  closePanel(); render(); openPanel("game", g.id, "overview");
  toast(`${g.name} refreshed.`, "ok");
}

/* ---------- choosing a cover inside the app ---------- */
let coverFor = null;
async function openCoverPicker(query = "") {
  const g = coverFor && query ? coverFor : findItem(panelItem.kind, panelItem.id);
  if (!g || !api) return;
  coverFor = g;
  $("#coverTitle").textContent = `Cover for ${g.name}`;
  $("#coverQuery").value = query || "";
  $("#coverQuery").placeholder = `Search a different name than "${g.name}"`;
  const grid = $("#coverGrid");
  const isBook = g.author !== undefined;
  grid.innerHTML = `<div class="g-empty"><span class="spinner"></span> Looking in ${isBook ? "Open Library and Google Books" : "Steam, PlayStation Store, IGDB and SteamGridDB"}…</div>`;
  if (!$("#coverDialog").open) $("#coverDialog").showModal();
  const r = await (isBook ? api.book_cover_options(g, query) : api.cover_options(g.name, g.platform || "", query)).catch(e => ({ items: [], error: String(e) }));
  if (coverFor !== g) return;
  const items = r.items || [];
  grid.innerHTML = items.length
    ? items.map((c, i) => `<button type="button" class="covercand" role="listitem" data-cand="${i}" title="${esc(c.source)}${c.note ? ` · ${esc(c.note)}` : ""}"><img alt="" loading="lazy" decoding="async" src="${esc(c.thumb)}"><span class="src ${c.source === "SteamGridDB" ? "" : "official"}">${esc(c.source)}</span></button>`).join("")
    : `<p class="muted">No covers found${r.error ? ` (${esc(r.error)})` : ""}. ${isBook ? "Try the title as it's printed, or choose an image file." : "Try a different name, or add a SteamGridDB key or IGDB in Settings for more choices."}</p>`;
  grid._items = items;
}
async function pickCover(i) {
  const g = coverFor, c = $("#coverGrid")._items?.[i];
  if (!g || !c) return;
  const btn = document.querySelector(`[data-cand="${i}"]`); btn?.classList.add("busy");
  const r = await (g.author !== undefined ? api.pick_book_cover(g, c.url) : api.pick_cover(g.name, c.url)).catch(e => ({ error: String(e) }));
  btn?.classList.remove("busy");
  if (r.error) return toast(r.error, "err");
  coverChanged(g, r.uri, `New cover from ${c.source}.`);
}
async function customCover(set) {
  const g = coverFor || findItem(panelItem.kind, panelItem.id);
  if (!g) return;
  const isBook = g.author !== undefined;
  const res = await Promise.resolve(isBook ? (set ? api?.set_book_cover(g) : api?.clear_book_cover(g)) : set ? api?.set_cover(g.name) : api?.clear_cover(g.name)).catch(e => ({ error: String(e) }));
  if (res && res.error) return toast(res.error, "err");
  if (set && !res) return;
  if (!set) { covers.delete(coverKey(g)); const uri = isBook ? res : await api.cover(g.name, g.platform || ""); return coverChanged(g, uri, "Back to the automatic cover."); }
  coverChanged(g, res, "Cover updated.");
}
function coverChanged(g, uri, msg) {
  covers.set(coverKey(g), uri || null);
  if (uri && panelItem && findItem(panelItem.kind, panelItem.id) === g) $("#panel").querySelectorAll(".opencase img").forEach(img => { img.src = uri; });
  if ($("#coverDialog").open) $("#coverDialog").close();
  try { FX.play.save(); } catch {}
  render();
  toast(msg, "ok");
}
function runForm() {
  const box = $("#runForm"), g = findItem("game", panelItem.id);
  box.innerHTML = `<form class="editform" id="runFormEl"><div class="fields">
    <label>Platform<select name="platform">${opts("games", "platform").map(o => `<option ${o === g.platform ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>
    <label>Play on<select name="play_on"><option value=""></option>${["PC", "Steam Deck"].map(o => `<option>${o}</option>`).join("")}</select></label>
    <label>Hours<input name="hours" type="number" step="0.1" min="0"></label>
    <label class="wide">Notes<input name="notes" type="text"></label></div>
    <div class="checks"><label class="check"><input type="checkbox" name="finished" checked>Finished</label><label class="check"><input type="checkbox" name="modded">Modded</label><label class="check"><input type="checkbox" name="dlc">With DLC</label><label class="check"><input type="checkbox" name="platinum">100% / Platinum</label></div>
    <div class="row"><span class="spacer"></span><button class="primary" type="submit">Add run</button></div></form>`;
  $("#logRun").hidden = true;
}
async function submitRun(form, g) {
  const v = { game: g.name, platform: form.platform.value, finished: form.finished.checked, modded: form.modded.checked, dlc: form.dlc.checked, platinum: form.platinum.checked };
  if (form.play_on.value) v.play_on = form.play_on.value;
  if (form.hours.value) v.hours = +form.hours.value;
  if (form.notes.value.trim()) v.notes = form.notes.value.trim();
  const res = await Promise.resolve(api?.add("plays", v)).catch(e => ({ error: String(e) }));
  if (!res || res.error) return toast(`Couldn't add the run: ${res?.error || "no connection"}`, "err");
  toast("Run added. The sheet stamps the date.", "ok");
  sync(true);
}
async function toggleBigPicture() {
  const on = await Promise.resolve(api?.toggle_big_picture()).catch(() => null);
  document.body.classList.toggle("bigpic", !!on);
  try { FX.play.tab(); } catch {}
}
function switchCatalog(cat) {
  if (cat === state.catalog) return;
  selection.clear(); paintSelection();
  if (cat === "news") $("#newsDot").hidden = true;
  state.catalog = cat;
  state.view = cat === "books" ? "shelf" : cat === "news" ? "breaking" : "home";
  state.focusId = null;
  closePanel(); render(); $("#view").scrollTop = 0;
}
function go(v) { state.view = v; closePanel(); state.focusId = null; render(); $("#view").scrollTop = 0; }
function cycleTab(d) {
  const tabs = TABS[state.catalog].filter(t => t !== "|").map(t => t[0]);
  go(tabs[(tabs.indexOf(state.view) + d + tabs.length) % tabs.length]);
}
/* ---------- Keyboard and controller navigation ---------- */
// what can take focus, in whichever layer is on top: menu, dialog, panel, then the page
const NAV_SEL = ".case, button:not([disabled]), a[data-url], a[href], [data-url][tabindex], .chip, .tab, .subtab, .catalog, input:not([type=hidden]):not([disabled]), select, summary, tr[data-id], .itile, li[role^=menuitem]:not(.sep), [role=button][tabindex='0'], [tabindex='0']";
function navLayer() {
  const ctx = document.getElementById("ctx");
  if (ctx) return ctx;
  const dlg = [...document.querySelectorAll("dialog[open]")].pop();
  if (dlg) return dlg;
  if ($("#panel").classList.contains("open")) return $("#panel");
  return document;
}
function navTargets(root = navLayer()) {
  const out = [];
  for (const el of root.querySelectorAll(NAV_SEL)) {
    if (el.closest(".hero, [hidden], .sub") && !el.closest(".has-sub:focus-within > .sub")) continue;
    if (root === document && el.closest("#panel, dialog, #ctx, #walk")) continue;
    if (!el.getClientRects().length) continue;
    out.push(el);
  }
  return out;
}
function inView(el) { const r = el.getBoundingClientRect(); return r.bottom > 110 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; }
function focusFirst(root = navLayer()) {
  const items = navTargets(root);
  const pick = (root === document ? items.find(el => el.classList.contains("case") && inView(el)) : null) || items.find(inView) || items[0];
  pick && focusNav(pick, false);
}
function focusNav(el, smooth = true) {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: smooth ? "smooth" : "auto" });
}
function move(dir, smooth = true) {
  const root = navLayer();
  const cur = document.activeElement;
  if (!cur || cur === document.body || !root.contains(cur) || !cur.getClientRects().length) return focusFirst(root);
  // a submenu opens to the right of its row and closes back to it
  if (cur.matches(".has-sub") && dir === (cur.closest(".ctx")?.classList.contains("flip") ? "l" : "r")) {
    const first = cur.querySelector(".sub li:not([disabled])"); if (first) return focusNav(first);
  }
  const parentSub = cur.closest(".sub")?.closest(".has-sub");
  if (parentSub && dir === (cur.closest(".ctx")?.classList.contains("flip") ? "r" : "l")) return focusNav(parentSub);
  const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  const horiz = dir === "l" || dir === "r";
  let best = null, bestScore = Infinity;
  for (const el of navTargets(root)) {
    if (el === cur || el.contains(cur) || cur.contains(el)) continue;
    const b = el.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2;
    const dx = bx - ax, dy = by - ay;
    if (!(dir === "l" ? b.right <= a.left + 4 && dx < -5 : dir === "r" ? b.left >= a.right - 4 && dx > 5 : dir === "u" ? b.bottom <= a.top + 4 && dy < -5 : b.top >= a.bottom - 4 && dy > 5)) continue;
    // stay in the same row or column when one lines up
    const overlap = horiz ? Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) : Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const gap = horiz ? (dir === "l" ? a.left - b.right : b.left - a.right) : (dir === "u" ? a.top - b.bottom : b.top - a.bottom);
    const cross = overlap > 0 ? 0 : Math.abs(horiz ? dy : dx);
    const score = Math.max(0, gap) + cross * 3 + (overlap > 0 ? 0 : 60);
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) { focusNav(best, smooth); try { FX.play.move(); } catch {} }
  else if (root === document && !horiz) { const v = $("#view"); v.scrollBy({ top: dir === "u" ? -innerHeight * 0.6 : innerHeight * 0.6, behavior: smooth ? "smooth" : "auto" }); }
}
// B / Escape: close whatever is on top, one layer at a time
const caseFor = (id, kind) => [...document.querySelectorAll(`#view .case[data-id="${id}"][data-kind="${kind}"], #view tr[data-id="${id}"][data-kind="${kind}"]`)].find(x => !x.closest(".hero"));
function navBack() {
  const ctx = document.getElementById("ctx");
  if (ctx) { const id = ctx.dataset.id, kind = ctx.dataset.kind; const sub = document.activeElement?.closest?.(".sub")?.closest(".has-sub");
    if (sub) return focusNav(sub);
    closeCtx(); const c = caseFor(id, kind); c && focusNav(c, false); return; }
  const dlg = [...document.querySelectorAll("dialog[open]")].pop();
  if (dlg) { const c = dlg.querySelector("[data-close], .close, button[value=cancel], [formmethod=dialog]"); c ? c.click() : dlg.close(); return; }
  if ($("#panel").classList.contains("open")) { const id = panelItem?.id, kind = panelItem?.kind; closePanel(); const c = id != null && caseFor(id, kind === "book" ? "book" : "game"); c ? focusNav(c, false) : focusFirst(); return; }
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) { document.activeElement.blur(); return; }
  if (selection.size) return clearSelection();
  const home = state.catalog === "books" ? "shelf" : state.catalog === "news" ? "breaking" : "home";
  if (state.view !== home) { go(home); requestAnimationFrame(() => focusFirst()); }
}
function navActivate() {
  const el = document.activeElement;
  if (!el || el === document.body) return focusFirst();
  if (el.matches(".has-sub")) { const first = el.querySelector(".sub li:not([disabled])"); return first && focusNav(first); }
  if (el.matches("input[type=text], input[type=search], input[type=number], input:not([type]), textarea")) { el.select?.(); return; }
  if (el.tagName === "SUMMARY") { el.parentElement.open = !el.parentElement.open; return; }
  if (el.matches(".itile")) { el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return; }
  el.click();
}
// left/right change a dropdown or slider in place instead of leaving it
function navAdjust(el, d) {
  if (el?.tagName === "SELECT") { const i = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + d)); if (i !== el.selectedIndex) { el.selectedIndex = i; el.dispatchEvent(new Event("change", { bubbles: true })); } return true; }
  if (el?.matches?.("input[type=range]")) { d > 0 ? el.stepUp() : el.stepDown(); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); return true; }
  return false;
}
function navOptions() {
  const el = document.activeElement?.closest?.(".case[data-kind], tr[data-kind]");
  if (!el || document.getElementById("ctx")) return;
  const kind = el.dataset.kind === "book" ? "book" : "game", item = findItem(kind, el.dataset.id);
  if (!item) return;
  const r = el.getBoundingClientRect();
  ctxMenu(item, r.left + Math.min(r.width * 0.6, 160), Math.max(116, r.top + 24), kind);
}
function navSearch() {
  const s = $("#search") || $("#bsearch");
  if (s && !navLayer().contains?.(s) && navLayer() !== document) return;
  if (s) { s.focus(); s.select(); s.scrollIntoView({ block: "nearest" }); }
}
function cycleSub(d) {
  const layer = navLayer();
  if (layer === $("#panel")) return cyclePanelTab(d);
  const subs = [...document.querySelectorAll("#view .subtab")];
  if (subs.length) { const i = subs.findIndex(x => x.classList.contains("on") || x.getAttribute("aria-selected") === "true"); subs[(i + d + subs.length) % subs.length].click(); requestAnimationFrame(() => focusFirst()); }
}
function cyclePanelTab(d) {
  const t = [...$("#panel").querySelectorAll(".ptabs [data-ptab]")].filter(x => x.getClientRects().length);
  if (!t.length) return;
  const i = t.findIndex(x => x.classList.contains("on") || x.getAttribute("aria-selected") === "true");
  t[(i + d + t.length) % t.length].click();
}
/* Controller: polled only while one is plugged in, and slowly while Masterlog is in the background.
   A select · B back · X options · Y search · LB/RB tabs · LT/RT sub-tabs · right stick scrolls ·
   View switches games/books · Menu big picture · R3 walk mode */
/* On Linux (the Steam Deck) the browser engine doesn't see controllers, so Masterlog reads them itself and the
   page sees them through the usual navigator.getGamepads(): same code for the controller everywhere, Walk mode too. */
function nativePads() {
  if (nativePads.on) return;
  nativePads.on = true;
  const own = navigator.getGamepads ? navigator.getGamepads.bind(navigator) : () => [];
  let pad = null, busy = false;
  navigator.getGamepads = () => { const list = [...(own() || [])]; return list.some(p => p && p.connected) ? list : pad ? [pad] : list; };
  const poll = async () => {
    if (!busy) {
      busy = true;
      const st = await Promise.resolve(api?.pad_state?.()).catch(() => null);
      busy = false;
      if (st) {
        const was = !!pad;
        pad = { id: st.id, index: 0, connected: true, mapping: "standard", timestamp: performance.now(), axes: st.axes,
          buttons: st.buttons.map(v => ({ pressed: v > 0.5, touched: v > 0, value: v })) };
        if (!was) dispatchEvent(new Event("gamepadconnected"));
      } else if (pad) { pad = null; dispatchEvent(new Event("gamepaddisconnected")); }
    }
    // quick while a controller is there and Masterlog is in front, a slow look otherwise
    setTimeout(poll, pad && !document.hidden && document.hasFocus() ? 16 : 1000);
  };
  poll();
}
const Pad = (() => {
  const held = {}, rep = {};
  let raf = 0, timer = 0, lastInput = 0;
  const FIRST = 360, NEXT = 95;
  const present = () => [...(navigator.getGamepads?.() || [])].find(p => p && p.connected) || null;
  function showHints(on) {
    document.body.classList.toggle("pad", on);
    const h = document.getElementById("padHints");
    if (h) h.hidden = !on;
  }
  function hintText() {
    const h = document.getElementById("padHints");
    if (!h || h.hidden) return;
    const layer = navLayer();
    const L = PAD_LABELS[padFamily(present()?.id)], tabs = `${L[4]} ${L[5]}`;
    const set = layer.id === "ctx" ? [[L[0], "Choose"], [L[1], "Close"]]
      : layer.tagName === "DIALOG" ? [[L[0], "Select"], [L[1], "Close"]]
      : layer.id === "panel" ? [[L[0], "Select"], [tabs, "Tabs"], [L[1], "Close"]]
      : [[L[0], "Open"], [L[2], "Options"], [L[3], "Search"], [tabs, "Tabs"], [L[1], selection.size ? "Clear" : "Back"]];
    const html = set.map(([k, t]) => `<span><b>${esc(k)}</b>${t}</span>`).join("");
    if (h.dataset.html !== html) { h.innerHTML = html; h.dataset.html = html; }
  }
  // fire once on press, then repeat while held (for moving through long lists)
  function repeatable(key, on, now, fn) {
    if (!on) { rep[key] = 0; return; }
    if (!rep[key]) { rep[key] = now + FIRST; fn(true); }
    else if (now >= rep[key]) { rep[key] = now + NEXT; fn(false); }
  }
  function frame(now) {
    raf = 0;
    const pad = present();
    if (!pad) { stop(); return; }
    const walking = Walk.active && !$("#panel").classList.contains("open");
    const btn = i => !!pad.buttons[i]?.pressed || (pad.buttons[i]?.value || 0) > 0.5;
    let acted = false;
    const press = (i, fn) => { const on = btn(i); if (on && !held[i] && !walking) { fn(); acted = true; } held[i] = on; };
    if (!walking) {
      const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes;
      const dirs = { u: btn(12) || ly < -0.55, d: btn(13) || ly > 0.55, l: btn(14) || lx < -0.55, r: btn(15) || lx > 0.55 };
      for (const k of ["u", "d", "l", "r"]) repeatable(k, dirs[k], now, first => {
        acted = true;
        const el = document.activeElement;
        if ((k === "l" || k === "r") && navAdjust(el, k === "r" ? 1 : -1)) return;
        move(k, first);
      });
      // right stick scrolls whatever you're looking at
      const sy = Math.abs(ry) > 0.2 ? ry : 0, sx = Math.abs(rx) > 0.2 ? rx : 0;
      if (sy || sx) {
        acted = true;
        const layer = navLayer();
        const box = layer === document ? $("#view") : layer.querySelector(".pbody, .scroll, form") || layer;
        const row = document.activeElement?.closest?.(".shelf-row");
        const speed = 28 * (+state.settings.pad_scroll || 1);
        box.scrollTop += sy * Math.abs(sy) * speed;
        if (sx && row) row.scrollLeft += sx * Math.abs(sx) * speed;
      }
    }
    press(0, navActivate);
    press(1, navBack);
    press(2, navOptions);
    press(3, navSearch);
    press(4, () => navLayer() === $("#panel") ? cyclePanelTab(-1) : (cycleTab(-1), requestAnimationFrame(() => focusFirst())));
    press(5, () => navLayer() === $("#panel") ? cyclePanelTab(1) : (cycleTab(1), requestAnimationFrame(() => focusFirst())));
    press(6, () => cycleSub(-1));
    press(7, () => cycleSub(1));
    press(8, () => { switchCatalog(state.catalog === "books" ? "games" : "books"); requestAnimationFrame(() => focusFirst()); });
    press(9, toggleBigPicture);
    press(11, () => Walk.active ? Walk.close() : openWalk());
    if (acted) { lastInput = now; if (!document.body.classList.contains("pad")) showHints(true); }
    if (document.body.classList.contains("pad")) hintText();
    schedule();
  }
  function schedule() {
    if (raf || timer) return;
    // full speed while Masterlog is in front; a slow check otherwise so a press still wakes it
    if (document.hidden || !document.hasFocus()) timer = setTimeout(() => { timer = 0; schedule(); }, 500);
    else raf = requestAnimationFrame(frame);
  }
  function stop() { cancelAnimationFrame(raf); clearTimeout(timer); raf = timer = 0; for (const k in rep) rep[k] = 0; }
  function start() { if (present()) schedule(); }
  addEventListener("gamepadconnected", () => { start(); toast("Controller connected. A to open, B to go back, X for options.", "ok"); });
  addEventListener("gamepaddisconnected", () => { if (!present()) { stop(); showHints(false); } });
  addEventListener("focus", start);
  // the mouse takes over again: hide the controller hints and focus ring
  addEventListener("mousemove", () => { if (document.body.classList.contains("pad") && performance.now() - lastInput > 600) showHints(false); }, { passive: true });
  return { start };
})();
function pollPad() { Pad.start(); }
