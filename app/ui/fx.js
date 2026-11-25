/* Masterlog sound and startup. Interface sounds are synthesized; the ambience is an audio file you choose. */
"use strict";

const FX = (() => {
  let ctx = null, master = null, fxBus = null, reverb = null;
  const cfg = { on: true, ambient: 0.35, fx: 0.5 };
  let focused = document.hasFocus() && !document.hidden;
  let lastHover = 0;

  function init() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
    reverb = ctx.createConvolver(); reverb.buffer = impulse(4.5, 2.6);
    const wet = ctx.createGain(); wet.gain.value = 0.55; reverb.connect(wet); wet.connect(master);
    fxBus = ctx.createGain(); fxBus.gain.value = cfg.fx; fxBus.connect(master);
    const fxWet = ctx.createGain(); fxWet.gain.value = 0.25; fxBus.connect(fxWet); fxWet.connect(reverb);
    return ctx;
  }
  function impulse(seconds, decay) {
    const len = ctx.sampleRate * seconds, buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  function noiseBuffer(seconds) {
    const len = ctx.sampleRate * seconds, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }  // brown noise
    return buf;
  }

  /* ---- the ambience: your own audio file, intro once, then a seamless crossfaded loop ----
     Two <audio> players take turns: shortly before the loop end the other one starts at the loop start and
     they crossfade, so there is never a gap or a click. Files are streamed from disk, not decoded into memory. */
  let track = null;          // { url, intro_end, loop_end, xfade }
  const players = [], amb = { on: false, cur: 0, level: 0, target: 0, fading: null, xf: null, timer: null };
  function player(i) {
    if (!players[i]) { const a = new Audio(); a.preload = "auto"; a.volume = 0; players[i] = a; }
    return players[i];
  }
  function loopPoints(a) {
    const d = a.duration || 0, x = Math.max(0.5, track.xfade || 3);
    const start = track.intro_end || 0;
    const end = track.loop_end && track.loop_end < d ? track.loop_end : Math.max(start + 5, d - x - 0.2);
    return { start, end, x };
  }
  function vol(a, v) { a.volume = Math.max(0, Math.min(1, v)); }
  function tick() {
    if (!track) return;
    // fade the whole bed toward its target (focus, mute, video playing, volume slider)
    const step = 0.06;
    amb.level += Math.sign(amb.target - amb.level) * Math.min(step * Math.max(0.15, cfg.ambient), Math.abs(amb.target - amb.level));
    const a = player(amb.cur), b = player(1 - amb.cur);
    if (amb.xf) {
      const k = Math.min(1, (performance.now() - amb.xf.t0) / (amb.xf.x * 1000));
      vol(a, amb.level * Math.cos(k * Math.PI / 2)); vol(b, amb.level * Math.sin(k * Math.PI / 2));
      if (k >= 1) { a.pause(); amb.cur = 1 - amb.cur; amb.xf = null; }
    } else {
      vol(a, amb.level);
      const lp = a.duration ? loopPoints(a) : null;
      if (lp && !a.paused && a.currentTime >= lp.end) {
        b.src === a.src || (b.src = a.src);
        b.currentTime = lp.start; vol(b, 0);
        b.play().catch(() => {});
        amb.xf = { t0: performance.now(), x: lp.x };
      }
    }
    // nothing audible: pause, so the app uses no CPU on sound in the background
    if (amb.level <= 0.001 && amb.target === 0) { players.forEach(p => p && !p.paused && p.pause()); amb.xf = null; }
  }
  function startAmbient(fromIntro = false) {
    if (!track || !cfg.on) return;
    const a = player(amb.cur);
    if (a.src !== track.url) { a.src = track.url; amb.started = false; }
    if (!amb.started) {
      amb.started = true;
      const seek = () => { a.currentTime = fromIntro ? 0 : (track.intro_end || 0); };
      if (a.readyState >= 1) seek(); else a.addEventListener("loadedmetadata", seek, { once: true });
    }
    amb.on = true;
    if (!amb.timer) amb.timer = setInterval(tick, 50);
    applyLevels();
  }
  let ducked = false;
  function audible() { return cfg.on && focused && !ducked; }
  function duck(on) { ducked = on; applyLevels(0.6); }
  function applyLevels() {
    if (track && amb.on) {
      amb.target = audible() ? cfg.ambient * 0.9 : 0;
      if (amb.target > 0) { const a = player(amb.cur); if (a.paused) a.play().catch(() => {}); }
    }
    if (!ctx) return;
    fxBus.gain.setTargetAtTime(cfg.on ? cfg.fx : 0, ctx.currentTime, 0.05);
    if (cfg.on && focused && ctx.state === "suspended") ctx.resume();
    if (!(cfg.on && focused)) setTimeout(() => { if (!(cfg.on && focused) && ctx.state === "running") ctx.suspend(); }, 500);
  }
  function setFocus(on) { focused = on; applyLevels(); }
  addEventListener("blur", () => setFocus(false));
  addEventListener("focus", () => setFocus(!document.hidden));
  document.addEventListener("visibilitychange", () => setFocus(!document.hidden && document.hasFocus()));
  // in case the system holds sound back until the first click or key press
  const unlock = () => { if (cfg.on) { init(); if (track && !amb.on) startAmbient(false); applyLevels(); } };
  addEventListener("pointerdown", unlock, { passive: true });
  addEventListener("keydown", unlock, { passive: true });

  /* ---- interface sounds ---- */
  function tone(freq, dur, { type = "sine", gain = 0.2, attack = 0.005, glide = 0, delay = 0 } = {}) {
    if (!init() || !cfg.on || !focused) return;
    if (ctx.state === "suspended") ctx.resume();
    const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(freq * glide, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(fxBus); o.start(t); o.stop(t + dur + 0.05);
  }
  function whoosh(dur = 0.5, from = 300, to = 2400, gain = 0.25) {
    if (!init() || !cfg.on || !focused) return;
    const t = ctx.currentTime, n = ctx.createBufferSource(); n.buffer = noiseBuffer(1);
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(from, t); bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(bp); bp.connect(g); g.connect(fxBus); n.start(t); n.stop(t + dur + 0.05);
  }
  const play = {
    hover() { const now = performance.now(); if (now - lastHover < 60) return; lastHover = now; tone(1318.5, 0.18, { gain: 0.03, attack: 0.012 }); tone(1975.5, 0.22, { gain: 0.012, attack: 0.02, delay: 0.015 }); },
    move() { tone(1174.7, 0.2, { gain: 0.04, attack: 0.01 }); tone(1760, 0.25, { gain: 0.015, delay: 0.02 }); },
    click() { tone(880, 0.25, { gain: 0.07, attack: 0.008 }); tone(1318.5, 0.35, { gain: 0.05, delay: 0.035 }); },
    back() { tone(740, 0.08, { gain: 0.1, type: "triangle" }); tone(494, 0.18, { gain: 0.08, delay: 0.04 }); },
    open() { whoosh(0.55, 220, 1800, 0.18); tone(196, 0.5, { gain: 0.12, delay: 0.32, glide: 0.98 }); tone(587, 0.6, { gain: 0.05, delay: 0.36 }); },
    save() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.55, { gain: 0.09, delay: i * 0.07 })); },
    check() { tone(880, 0.12, { gain: 0.1, type: "triangle" }); tone(1318.5, 0.5, { gain: 0.1, delay: 0.08 }); tone(1760, 0.6, { gain: 0.05, delay: 0.16 }); },
    error() { tone(196, 0.25, { gain: 0.14, type: "square", glide: 0.8 }); },
    tab() { tone(1175, 0.07, { gain: 0.06, type: "triangle" }); },
    notify() { [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.7, { gain: 0.07, delay: i * 0.09 })); },
    boot() {
      if (!init() || !cfg.on) return;
      const t = ctx.currentTime;
      [[73.42, 0], [110, 0.15], [146.83, 0.35], [220, 0.6], [293.66, 0.9], [440, 1.3]].forEach(([f, d], i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = i < 2 ? "sine" : "triangle"; o.frequency.value = f;
        g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(0.09 - i * 0.01, t + d + 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 4.5);
        o.connect(g); g.connect(fxBus); o.start(t + d); o.stop(t + d + 4.6);
      });
      whoosh(2.6, 120, 3200, 0.08);
    },
  };

  function configure(next) {
    if ("track" in next) {
      const t = next.track || null;
      if ((t && t.url) !== (track && track.url)) { players.forEach(p => { p.pause(); p.removeAttribute("src"); p.load(); }); amb.started = false; amb.xf = null; amb.cur = 0; amb.level = 0; }
      track = t; delete next.track;
      if (!track) amb.on = false;
    }
    Object.assign(cfg, next);
    if (cfg.on && track && amb.on) startAmbient(false);
    applyLevels();
  }
  /* startup: the file's own intro if it has one, otherwise a short synthesized chime */
  function intro() {
    if (track && track.intro_end > 0 && cfg.on) { amb.level = cfg.ambient * 0.9; startAmbient(true); return true; }
    play.boot();
    return false;
  }
  return { play, configure, duck, intro, startAmbient, hasTrack: () => !!track, get cfg() { return { ...cfg }; } };
})();

/* ---------- startup: drifting dust, then glowing block towers on a dark floor, the camera circling, the name ---------- */
function playIntro(done) {
  const el = document.getElementById("intro");
  if (!el) return done();
  const c = el.querySelector("canvas"), g = c.getContext("2d");
  const dpr = devicePixelRatio || 1, W = c.width = innerWidth * dpr, H = c.height = innerHeight * dpr;
  // clusters of towers on a grid, like memory blocks
  const towers = [];
  for (let cx = -4; cx <= 4; cx++) for (let cz = -4; cz <= 4; cz++) {
    if (Math.random() < 0.42) continue;
    const n = 1 + Math.floor(Math.random() * 4);
    for (let k = 0; k < n; k++) towers.push({ x: cx * 1.6 + (Math.random() - .5) * .9, z: cz * 1.6 + (Math.random() - .5) * .9, s: .18 + Math.random() * .26,
      h: .4 + Math.pow(Math.random(), 1.6) * 3.4, delay: Math.random() * .5, hue: 215 + Math.random() * 25 });
  }
  const dust = Array.from({ length: 160 }, () => ({ x: (Math.random() - .5) * 16, y: Math.random() * 5, z: (Math.random() - .5) * 16, v: .1 + Math.random() * .3 }));
  const start = performance.now();
  let TOTAL = 7000;
  let raf, finished = false;
  const finish = () => {
    if (finished) return; finished = true;
    cancelAnimationFrame(raf); el.classList.add("out");
    removeEventListener("keydown", finish); el.removeEventListener("pointerdown", finish);
    setTimeout(() => { el.remove(); done(); }, 800);
  };
  addEventListener("keydown", finish); el.addEventListener("pointerdown", finish);
  let ownIntro = false;
  try { ownIntro = FX.intro(); } catch {}
  if (ownIntro) TOTAL = 9500;  // your intro rings longer; the menu ambience carries on from it
  const ease = x => x < 0 ? 0 : x > 1 ? 1 : 1 - Math.pow(1 - x, 3);
  const frame = now => {
    const t = Math.min(1, (now - start) / TOTAL);
    const ang = -0.9 + t * 1.25, camR = 13 - t * 3, camY = 2.6 + t * 1.8;
    const cx = Math.sin(ang) * camR, cz = Math.cos(ang) * camR, f = H * 0.9;
    const proj = (x, y, z) => {
      const dx = x - cx, dz = z - cz, dy = y - camY;
      const rx = dx * Math.cos(ang) - dz * Math.sin(ang), rz = dx * Math.sin(ang) + dz * Math.cos(ang);
      const depth = -rz; if (depth < 0.3) return null;
      const tilt = 0.22, yy = dy * Math.cos(tilt) + depth * Math.sin(tilt), zz = depth * Math.cos(tilt) - dy * Math.sin(tilt);
      return [W / 2 + rx / zz * f, H * 0.5 - yy / zz * f, zz];
    };
    g.fillStyle = "#010208"; g.fillRect(0, 0, W, H);
    const fog = g.createRadialGradient(W / 2, H * .62, 0, W / 2, H * .62, W * .75);
    fog.addColorStop(0, `rgba(30,55,160,${.42 * ease(t * 1.6 - .1)})`); fog.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = fog; g.fillRect(0, 0, W, H);
    // dust first, so it reads as depth
    for (const d of dust) {
      const p = proj(d.x, (d.y + t * 2 * d.v) % 5, d.z); if (!p) continue;
      const a = Math.min(.55, .9 / p[2]) * ease(t * 3);
      g.fillStyle = `rgba(170,200,255,${a})`; g.fillRect(p[0], p[1], 1.6 * dpr, 1.6 * dpr);
    }
    const order = towers.map(o => ({ o, d: Math.hypot(o.x - cx, o.z - cz) })).sort((a, b) => b.d - a.d);
    for (const { o } of order) {
      const rise = ease((t - .18 - o.delay * .5) * 2.2); if (rise <= 0) continue;
      const h = o.h * rise, s = o.s;
      const c8 = [[-s, 0, -s], [s, 0, -s], [s, 0, s], [-s, 0, s], [-s, h, -s], [s, h, -s], [s, h, s], [-s, h, s]].map(([x, y, z]) => proj(o.x + x, y, o.z + z));
      if (c8.some(p => !p)) continue;
      const near = Math.min(0.7, 4.5 / c8[0][2]);
      const faces = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
      for (const fc of faces) {
        g.beginPath(); fc.forEach((i, k) => k ? g.lineTo(c8[i][0], c8[i][1]) : g.moveTo(c8[i][0], c8[i][1])); g.closePath();
        const gr = g.createLinearGradient(0, c8[fc[3]][1], 0, c8[fc[0]][1]);
        gr.addColorStop(0, `hsla(${o.hue},90%,72%,${.26 * near})`); gr.addColorStop(1, `hsla(${o.hue},80%,40%,${.03 * near})`);
        g.fillStyle = gr; g.fill();
      }
      g.beginPath(); [4, 5, 6, 7].forEach((i, k) => k ? g.lineTo(c8[i][0], c8[i][1]) : g.moveTo(c8[i][0], c8[i][1])); g.closePath();
      g.fillStyle = `hsla(${o.hue},100%,90%,${.55 * near})`; g.shadowColor = `hsla(${o.hue},100%,75%,.9)`; g.shadowBlur = 14 * dpr * near; g.fill(); g.shadowBlur = 0;
      // reflection on the glossy floor
      const r0 = c8[0], r1 = c8[2];
      g.fillStyle = `hsla(${o.hue},90%,60%,${.06 * near})`;
      g.fillRect(Math.min(r0[0], r1[0]), Math.max(r0[1], r1[1]), Math.abs(r1[0] - r0[0]) + 2, (c8[0][1] - c8[4][1]) * .35);
    }
    if (t > .62) el.classList.add("name");
    if (t >= 1) return finish();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}
