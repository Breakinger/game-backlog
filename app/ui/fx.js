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

  /* ---- the ambient bed: low drones, a slow tide of filtered noise, and the odd distant bell ---- */
  function startAmbient() {
    if (!init() || amb) return;
    const t = ctx.currentTime;
    const drones = [55, 82.41, 110.0, 164.81].map((f, i) => {
      const o = ctx.createOscillator(); o.type = i % 2 ? "triangle" : "sine"; o.frequency.value = f;
      o.detune.value = (i - 1.5) * 4;
      const g = ctx.createGain(); g.gain.value = [0.16, 0.09, 0.06, 0.025][i];
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.03 + i * 0.017;
      const lg = ctx.createGain(); lg.gain.value = g.gain.value * 0.45; lfo.connect(lg); lg.connect(g.gain);
      o.connect(g); g.connect(ambBus); o.start(t); lfo.start(t);
      return [o, lfo];
    });
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(8); n.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420; lp.Q.value = 0.6;
    const ng = ctx.createGain(); ng.gain.value = 0.05;
    const tide = ctx.createOscillator(); tide.frequency.value = 0.075;          // a wave every ~13 s
    const tg = ctx.createGain(); tg.gain.value = 0.045; tide.connect(tg); tg.connect(ng.gain);
    const sweep = ctx.createGain(); sweep.gain.value = 260; tide.connect(sweep); sweep.connect(lp.frequency);
    n.connect(lp); lp.connect(ng); ng.connect(ambBus); n.start(t); tide.start(t);
    const bells = setInterval(bell, 7000);
    amb = { nodes: [...drones.flat(), n, tide], bells };
    applyLevels(1.6);
  }
  function bell() {
    if (!ctx || !amb || !audible()) return;
    const scale = [440, 493.88, 587.33, 659.25, 739.99, 880];
    if (Math.random() < 0.35) return;
    const f = scale[Math.floor(Math.random() * scale.length)] / (Math.random() < 0.5 ? 2 : 1);
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.035, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + 5);
    o.connect(g); g.connect(ambBus); o.start(t); o.stop(t + 5.2);
  }
  function audible() { return cfg.on && focused; }
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
    hover() { const now = performance.now(); if (now - lastHover < 55) return; lastHover = now; tone(1560, 0.07, { gain: 0.035, type: "sine" }); },
    move() { tone(980, 0.06, { gain: 0.05, type: "triangle" }); },
    click() { tone(660, 0.09, { gain: 0.12, type: "triangle" }); tone(990, 0.16, { gain: 0.08, delay: 0.03 }); },
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
  return { play, configure, get cfg() { return { ...cfg }; } };
})();

/* ---------- startup: a dark void, light towers rising, the name settling in ---------- */
function playIntro(done) {
  const el = document.getElementById("intro");
  if (!el) return done();
  const c = el.querySelector("canvas"), g = c.getContext("2d");
  const W = c.width = innerWidth * devicePixelRatio, H = c.height = innerHeight * devicePixelRatio;
  const towers = Array.from({ length: 70 }, () => ({ x: Math.random() * 2 - 1, z: Math.random() * 1 + 0.15, h: 0.2 + Math.random() * 0.9, w: 0.012 + Math.random() * 0.03, d: Math.random() * 0.9 }));
  const motes = Array.from({ length: 120 }, () => ({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random(), s: Math.random() * 2 + 0.5 }));
  const start = performance.now(), TOTAL = 5600;
  let raf, finished = false;
  const finish = () => {
    if (finished) return; finished = true;
    cancelAnimationFrame(raf); el.classList.add("out");
    removeEventListener("keydown", finish); el.removeEventListener("pointerdown", finish);
    setTimeout(() => { el.remove(); done(); }, 700);
  };
  addEventListener("keydown", finish); el.addEventListener("pointerdown", finish);
  try { FX.play.boot(); } catch {}
  const frame = now => {
    const t = Math.min(1, (now - start) / TOTAL);
    g.fillStyle = "#02040C"; g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(W * 0.5, H * 0.62, 0, W * 0.5, H * 0.62, W * 0.7);
    glow.addColorStop(0, `rgba(40,70,190,${0.35 * Math.min(1, t * 2)})`); glow.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    const cam = t * 0.55;  // slow drift forward
    const sorted = towers.map(o => ({ ...o, zz: ((o.z - cam) % 1.15 + 1.15) % 1.15 + 0.08 })).sort((a, b) => b.zz - a.zz);
    for (const o of sorted) {
      const rise = Math.min(1, Math.max(0, (t * 1.6 - o.d * 0.6)));
      const sx = W / 2 + (o.x / o.zz) * W * 0.32, base = H * 0.74, hh = (o.h * rise * H * 0.55) / o.zz, ww = (o.w * W) / o.zz;
      const a = Math.min(0.9, 0.12 / o.zz) * rise;
      const grad = g.createLinearGradient(0, base - hh, 0, base);
      grad.addColorStop(0, `rgba(180,205,255,${a})`); grad.addColorStop(0.15, `rgba(90,130,240,${a * 0.6})`); grad.addColorStop(1, "rgba(20,30,90,0)");
      g.fillStyle = grad; g.fillRect(sx - ww / 2, base - hh, ww, hh);
      g.fillStyle = `rgba(235,242,255,${a})`; g.fillRect(sx - ww / 2, base - hh, ww, Math.max(1, 2 * devicePixelRatio / o.zz));
      g.fillStyle = `rgba(90,130,240,${a * 0.18})`; g.fillRect(sx - ww / 2, base, ww, hh * 0.25);  // reflection on the floor
    }
    for (const m of motes) {
      const y = ((m.y - t * 0.25 * m.s) % 2 + 2) % 2 - 1;
      g.fillStyle = `rgba(200,220,255,${0.25 * m.z * Math.min(1, t * 3)})`;
      g.fillRect(W / 2 + m.x * W * 0.6, H / 2 + y * H * 0.6, m.s * devicePixelRatio, m.s * devicePixelRatio);
    }
    if (t > 0.45) el.classList.add("name");
    if (t >= 1) return finish();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}
