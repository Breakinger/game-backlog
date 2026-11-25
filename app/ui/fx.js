/* Masterlog sound and startup. Everything here is synthesized in the browser: no audio files. */
"use strict";

const FX = (() => {
  let ctx = null, master = null, ambBus = null, fxBus = null, reverb = null, amb = null;
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
    ambBus = ctx.createGain(); ambBus.gain.value = 0; ambBus.connect(master); ambBus.connect(reverb);
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

  /* ---- the ambient bed: waves rolling onto a beach, a warm pad, and the odd soft chime ---- */
  function pinkBuffer(seconds) {
    const len = ctx.sampleRate * seconds, buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      }
    }
    return buf;
  }
  let surf = null;
  function wave() {
    if (!ctx || !amb) return;
    const t = ctx.currentTime + 0.05;
    const swell = 2.6 + Math.random() * 1.6, wash = 5.5 + Math.random() * 3, size = 0.6 + Math.random() * 0.5;
    const src = ctx.createBufferSource(); src.buffer = surf; src.loop = true;
    src.loopStart = Math.random() * 4; src.playbackRate.value = 0.9 + Math.random() * 0.2;
    // the body of the wave: a low rumble that opens up as it breaks, then hisses back down the sand
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 0.4;
    lp.frequency.setValueAtTime(220, t); lp.frequency.linearRampToValueAtTime(900 + 500 * size, t + swell); lp.frequency.exponentialRampToValueAtTime(260, t + swell + wash);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16 * size, t + swell);
    g.gain.setTargetAtTime(0.0001, t + swell + 0.2, wash / 3.2);
    // foam: a soft high fizz only at the moment it breaks
    const hp = ctx.createBiquadFilter(); hp.type = "bandpass"; hp.frequency.value = 3200; hp.Q.value = 0.5;
    const fg = ctx.createGain();
    fg.gain.setValueAtTime(0.0001, t + swell * 0.85); fg.gain.exponentialRampToValueAtTime(0.03 * size, t + swell + 0.4);
    fg.gain.setTargetAtTime(0.0001, t + swell + 0.6, wash / 4);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) pan.pan.value = Math.random() * 1.2 - 0.6;
    const out = pan || ambBus;
    src.connect(lp); lp.connect(g); g.connect(out);
    src.connect(hp); hp.connect(fg); fg.connect(out);
    if (pan) pan.connect(ambBus);
    src.start(t, src.loopStart); src.stop(t + swell + wash + 1.5);
  }
  const CHORDS = [[146.83, 220, 277.18, 329.63, 369.99], [123.47, 185, 246.94, 293.66, 369.99], [98, 146.83, 246.94, 293.66, 369.99], [110, 164.81, 246.94, 329.63, 415.3]];
  let chordIx = 0, padVoices = [];
  function pad() {
    if (!ctx || !amb) return;
    const t = ctx.currentTime, notes = CHORDS[chordIx++ % CHORDS.length];
    padVoices.forEach(v => { v.g.gain.setTargetAtTime(0.0001, t, 2.2); v.o.stop(t + 9); });
    padVoices = notes.map((f, i) => {
      const o = ctx.createOscillator(); o.type = i === 0 ? "sine" : "triangle"; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 8;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
      const g = ctx.createGain(); g.gain.value = 0.0001;
      g.gain.setTargetAtTime([0.05, 0.022, 0.016, 0.013, 0.01][i], t, 2.8);
      o.connect(lp); lp.connect(g); g.connect(ambBus); o.start(t);
      return { o, g };
    });
  }
  function startAmbient() {
    if (!init() || amb) return;
    surf = pinkBuffer(10);
    amb = { timers: [] };
    pad(); wave();
    const loop = () => { if (!amb) return; if (audible()) wave(); amb.timers[0] = setTimeout(loop, 7500 + Math.random() * 5000); };
    amb.timers[0] = setTimeout(loop, 5200);
    amb.timers[1] = setInterval(() => audible() && pad(), 14000);
    amb.timers[2] = setInterval(bell, 6000);
    applyLevels(1.6);
  }
  function bell() {
    if (!ctx || !amb || !audible() || Math.random() < 0.45) return;
    const chord = CHORDS[(chordIx + CHORDS.length - 1) % CHORDS.length];
    const f = chord[1 + Math.floor(Math.random() * 4)] * (Math.random() < 0.6 ? 4 : 2);
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.022, t + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
    o.connect(g); g.connect(ambBus); o.start(t); o.stop(t + 4.7);
  }
  let ducked = false;
  function audible() { return cfg.on && focused && !ducked; }
  function duck(on) { ducked = on; applyLevels(0.6); }
  function applyLevels(fade = 0.8) {
    if (!ctx) return;
    const t = ctx.currentTime;
    ambBus.gain.cancelScheduledValues(t);
    ambBus.gain.setTargetAtTime(audible() ? cfg.ambient * 0.9 : 0, t, fade / 3);
    fxBus.gain.setTargetAtTime(cfg.on ? cfg.fx : 0, t, 0.05);
    if (audible() && ctx.state === "suspended") ctx.resume();
    if (!audible()) setTimeout(() => { if (!audible() && ctx.state === "running") ctx.suspend(); }, fade * 1000 + 200);
  }
  function setFocus(on) { focused = on; applyLevels(on ? 1.2 : 0.5); }
  addEventListener("blur", () => setFocus(false));
  addEventListener("focus", () => setFocus(!document.hidden));
  document.addEventListener("visibilitychange", () => setFocus(!document.hidden && document.hasFocus()));
  // browsers only allow sound after the first click or key press
  const unlock = () => { if (cfg.on) { startAmbient(); applyLevels(); } };
  addEventListener("pointerdown", unlock, { once: false, passive: true });
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
    Object.assign(cfg, next);
    if (cfg.on && ctx) startAmbient();
    applyLevels();
  }
  return { play, configure, duck, get cfg() { return { ...cfg }; } };
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
  const start = performance.now(), TOTAL = 7000;
  let raf, finished = false;
  const finish = () => {
    if (finished) return; finished = true;
    cancelAnimationFrame(raf); el.classList.add("out");
    removeEventListener("keydown", finish); el.removeEventListener("pointerdown", finish);
    setTimeout(() => { el.remove(); done(); }, 800);
  };
  addEventListener("keydown", finish); el.addEventListener("pointerdown", finish);
  try { FX.play.boot(); } catch {}
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
