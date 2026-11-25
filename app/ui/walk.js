/* Masterlog: walk your library. An aisle of shelves with your games standing spine-out like books.
   Look at one and it tips out; click and it slides off the shelf into your hands and opens.
   Plain WebGL2, one draw call for every case; nothing is drawn while you stand still or use another window. */
"use strict";

const Walk = (() => {
  let gl, canvas, root, prog, atlasTex, coverTex, vao, instBuf, raf = 0, active = false, dirty = true;
  let cases = [], solids = [], signs = [], instData, instCount = 0;
  let opts = null, hover = -1, picked = null, keys = new Set(), last = 0, idleSince = 0;
  const cam = { x: 0, y: 1.55, z: 1.6, yaw: 0, pitch: -0.04 };
  const mouse = { x: 0.5, y: 0.5, locked: false, dragging: false, lx: 0, ly: 0 };
  const AISLE = 1.0;           // the spines line up at x = ±AISLE
  const UNIT = 2.3, LEVELS = [0.16, 0.6, 1.04, 1.48, 1.92], LEVEL_ORDER = [2, 3, 1, 4, 0];
  const CASE = { d: 0.235, h: 0.36, t: 0.034, gap: 0.006 };
  const SW = 30, SH = 300, SIGN_W = 512, SIGN_H = 80;
  let ATLAS = 2048, SCOLS = 68, SIGN_Y = 1800;   // grows to 4096 for big libraries

  /* ---------- tiny matrix helpers ---------- */
  const m4 = {
    mul(a, b) { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; },
    persp(fov, asp, n, f) { const t = 1 / Math.tan(fov / 2), o = new Float32Array(16); o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o; },
    view(c) {
      const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
      const f = [-sy * cp, sp, -cy * cp], r = [cy, 0, -sy], u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
      const e = [c.x, c.y, c.z], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      return new Float32Array([r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot(r, e), -dot(u, e), dot(f, e), 1]);
    },
    model(x, y, z, sx, sy, sz, yaw = 0, roll = 0) {
      const c = Math.cos(yaw), s = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll);
      // R = Ry(yaw) * Rz(roll), then scale
      return new Float32Array([c * cr * sx, sr * sx, -s * cr * sx, 0, -c * sr * sy, cr * sy, s * sr * sy, 0, s * sz, 0, c * sz, 0, x, y, z, 1]);
    },
  };
  const forward = () => [-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw)];

  /* ---------- shaders ---------- */
  const VS = `#version 300 es
  layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec2 aUv; layout(location=3) in float aFace;
  layout(location=4) in vec4 iM0; layout(location=5) in vec4 iM1; layout(location=6) in vec4 iM2; layout(location=7) in vec4 iM3;
  layout(location=8) in vec4 iColor; layout(location=9) in vec4 iRect; layout(location=10) in vec4 iFlags;
  uniform mat4 uVP;
  out vec3 vN; out vec2 vUv; out vec3 vW; flat out float vFace; out vec4 vColor; out vec4 vRect; out vec4 vFlags;
  void main() {
    mat4 M = mat4(iM0, iM1, iM2, iM3);
    vec4 w = M * vec4(aPos, 1.0);
    vW = w.xyz; vN = normalize(mat3(M) * aNor); vUv = aUv; vFace = aFace; vColor = iColor; vRect = iRect; vFlags = iFlags;
    gl_Position = uVP * w;
  }`;
  const FS = `#version 300 es
  precision highp float;
  in vec3 vN; in vec2 vUv; in vec3 vW; flat in float vFace; in vec4 vColor; in vec4 vRect; in vec4 vFlags;
  uniform sampler2D uAtlas; uniform sampler2D uCover; uniform vec3 uEye; uniform float uCoverOn;
  out vec4 o;
  void main() {
    vec3 base = vColor.rgb;
    bool lit = vFlags.w < 0.5;
    if (vFace == 0.0 && vFlags.x > 0.5) base = texture(uAtlas, vRect.xy + vUv * vRect.zw).rgb;
    if (vFace == 5.0 && vFlags.z > 0.5 && uCoverOn > 0.5) base = texture(uCover, vUv).rgb;
    vec3 col = base;
    if (lit) {
      vec3 L = normalize(vec3(0.25, 1.0, 0.35));
      float diff = max(dot(vN, L), 0.0) * 0.4 + 0.75;
      float pool = 0.62 + 0.38 * pow(0.5 + 0.5 * cos(vW.z * 6.2831853 / 2.3), 2.0);   // pools of light under the ceiling lamps
      float height = smoothstep(-0.2, 2.6, vW.y) * 0.25 + 0.85;
      col = base * diff * pool * height * (1.0 + vFlags.y * 0.45);
      if (vFlags.y > 0.5 && vFace == 0.0) col += vec3(0.10, 0.16, 0.32);
    }
    float d = length(vW - uEye);
    col = mix(col, vec3(0.02, 0.05, 0.14), 1.0 - exp(-d * 0.06));
    o = vec4(col, 1.0);
  }`;

  /* ---------- geometry: one unit box; face 0 = +x (the spine), face 5 = -z (the front cover) ---------- */
  function boxGeometry() {
    const P = [], F = [
      [[1, 0, 0], [[.5, -.5, .5], [.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5]]],
      [[-1, 0, 0], [[-.5, -.5, -.5], [-.5, -.5, .5], [-.5, .5, .5], [-.5, .5, -.5]]],
      [[0, 1, 0], [[-.5, .5, .5], [.5, .5, .5], [.5, .5, -.5], [-.5, .5, -.5]]],
      [[0, -1, 0], [[-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5], [-.5, -.5, .5]]],
      [[0, 0, 1], [[-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5]]],
      [[0, 0, -1], [[.5, -.5, -.5], [-.5, -.5, -.5], [-.5, .5, -.5], [.5, .5, -.5]]],
    ];
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    F.forEach(([n, q], f) => [0, 1, 2, 0, 2, 3].forEach(i => P.push(...q[i], ...n, ...uv[i], f)));
    return new Float32Array(P);
  }

  function compile() {
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, boxGeometry(), gl.STATIC_DRAW);
    const S = 9 * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, S, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, S, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, S, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, S, 32);
    instBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    const IS = 28 * 4;
    for (let i = 0; i < 7; i++) { gl.enableVertexAttribArray(4 + i); gl.vertexAttribPointer(4 + i, 4, gl.FLOAT, false, IS, i * 16); gl.vertexAttribDivisor(4 + i, 1); }
  }

  /* ---------- textures: every spine and sign drawn once into one atlas ---------- */
  const firstColor = c => (String(c).match(/#[0-9a-f]{3,8}/i) || ["#1B1F25"])[0];
  function hexRGB(h) { h = firstColor(h).slice(1); if (h.length === 3) h = h.split("").map(c => c + c).join(""); const n = parseInt(h.slice(0, 6), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
  function buildAtlas(list, sections) {
    const fits = size => Math.floor(size / SW) * Math.floor((size - Math.ceil(sections.length / Math.floor(size / SIGN_W)) * SIGN_H) / SH);
    ATLAS = fits(2048) >= list.length ? 2048 : Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    SCOLS = Math.floor(ATLAS / SW);
    const perRow = Math.floor(ATLAS / SIGN_W), cap = fits(ATLAS);
    SIGN_Y = Math.floor((ATLAS - Math.ceil(sections.length / perRow) * SIGN_H) / SH) * SH;
    const c = document.createElement("canvas"); c.width = c.height = ATLAS;
    const g = c.getContext("2d");
    g.fillStyle = "#101828"; g.fillRect(0, 0, ATLAS, ATLAS);
    list.forEach((it, i) => {
      if (i >= cap) { it.rect = null; return; }   // past what one texture holds: a plain spine
      const x = (i % SCOLS) * SW, y = Math.floor(i / SCOLS) * SH;
      const p = it.p;
      g.fillStyle = firstColor(p.shell); g.fillRect(x, y, SW, SH);
      g.fillStyle = firstColor(p.band); g.fillRect(x, y, SW, 34);
      g.fillStyle = "rgba(255,255,255,.08)"; g.fillRect(x, y, 3, SH);
      if (it.fav) { g.fillStyle = "#FFC93C"; g.fillRect(x, y + SH - 8, SW, 8); }
      if (it.g.status === "Completed") { g.fillStyle = "#5BD38A"; g.fillRect(x + SW - 3, y + 34, 3, SH - 34); }
      g.save(); g.translate(x + SW / 2, y + 40); g.rotate(Math.PI / 2);
      g.fillStyle = "#F2F5FA"; g.font = "600 17px Bahnschrift, 'Segoe UI', sans-serif"; g.textBaseline = "middle";
      let name = it.g.name; while (g.measureText(name).width > SH - 52 && name.length > 4) name = name.slice(0, -2);
      if (name !== it.g.name) name = name.trimEnd() + "…";
      g.fillText(name, 0, 0); g.restore();
      g.save(); g.translate(x + SW / 2, y + 17); g.fillStyle = firstColor(p.text); g.font = "800 9px Bahnschrift, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(String(p.label).replace("PlayStation ", "PS").replace("Nintendo ", "").slice(0, 6), 0, 0); g.restore();
      it.rect = [x / ATLAS, 1 - (y + SH) / ATLAS, SW / ATLAS, SH / ATLAS];
    });
    sections.forEach((s, i) => {
      const x = (i % perRow) * SIGN_W, y = SIGN_Y + Math.floor(i / perRow) * SIGN_H;
      const grd = g.createLinearGradient(x, y, x, y + SIGN_H); grd.addColorStop(0, "#1E3478"); grd.addColorStop(1, "#0D1838");
      g.fillStyle = grd; g.fillRect(x, y, SIGN_W, SIGN_H);
      g.fillStyle = s.accent || "#7FA6FF"; g.fillRect(x, y + SIGN_H - 5, SIGN_W, 5);
      g.fillStyle = "#EAF0FF"; g.font = "300 38px Bahnschrift, 'Segoe UI', sans-serif"; g.textBaseline = "middle"; g.textAlign = "center";
      g.fillText(s.title.toUpperCase(), x + SIGN_W / 2, y + SIGN_H / 2 - 2);
      s.rect = [x / ATLAS, 1 - (y + SIGN_H) / ATLAS, SIGN_W / ATLAS, SIGN_H / ATLAS];
    });
    if (atlasTex) gl.deleteTexture(atlasTex);
    atlasTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    const an = gl.getExtension("EXT_texture_filter_anisotropic");
    if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, 8);
  }
  // the front of the case you're holding: the platform band on top and the cover below, like the cases in the grid
  function frontCanvas(c, img) {
    const W = 480, H = Math.round(W * CASE.h / CASE.d), band = Math.round(H * 0.085);
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const g = cv.getContext("2d"), p = c.p;
    g.fillStyle = firstColor(p.shell); g.fillRect(0, 0, W, H);
    const area = { x: 14, y: band + 8, w: W - 28, h: H - band - 22 };
    if (img) {
      const r = Math.max(area.w / img.width, area.h / img.height), odd = Math.abs(img.width / img.height - 2 / 3) > 0.08;
      g.save(); g.beginPath(); g.rect(area.x, area.y, area.w, area.h); g.clip();
      if (odd) {   // not a box-art shape: show it whole over a soft blur of itself, the way the grid does
        g.filter = "blur(18px) brightness(.6)"; g.drawImage(img, area.x + (area.w - img.width * r) / 2, area.y + (area.h - img.height * r) / 2, img.width * r, img.height * r); g.filter = "none";
        const f = Math.min(area.w / img.width, area.h / img.height);
        g.drawImage(img, area.x + (area.w - img.width * f) / 2, area.y + (area.h - img.height * f) / 2, img.width * f, img.height * f);
      } else g.drawImage(img, area.x + (area.w - img.width * r) / 2, area.y + (area.h - img.height * r) / 2, img.width * r, img.height * r);
      g.restore();
    } else {
      const grd = g.createLinearGradient(0, area.y, 0, area.y + area.h); grd.addColorStop(0, "#22366F"); grd.addColorStop(1, "#0B1430");
      g.fillStyle = grd; g.fillRect(area.x, area.y, area.w, area.h);
      g.fillStyle = "#EAF0FF"; g.font = "300 40px Bahnschrift, 'Segoe UI', sans-serif"; g.textAlign = "center";
      const words = c.g.name.split(/\s+/), lines = [];
      for (const w of words) { const l = lines.length ? lines[lines.length - 1] + " " + w : w; if (lines.length && g.measureText(l).width < area.w - 50) lines[lines.length - 1] = l; else lines.push(w); }
      lines.slice(0, 5).forEach((l, i) => g.fillText(l, W / 2, area.y + area.h / 2 - (Math.min(lines.length, 5) - 1) * 25 + i * 50));
    }
    g.fillStyle = firstColor(p.band); g.fillRect(0, 0, W, band);
    g.fillStyle = firstColor(p.text); g.font = "800 30px Bahnschrift, 'Segoe UI', sans-serif"; g.textBaseline = "middle"; g.textAlign = "left";
    g.fillText(String(p.label).toUpperCase(), 22, band / 2 + 1);
    return cv;
  }
  function setCover(cv) {
    gl.bindTexture(gl.TEXTURE_2D, coverTex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv); } catch { return; }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (picked) picked.coverReady = true;
    dirty = true;
  }
  function loadCover(c, url) {
    coverTex = coverTex || gl.createTexture();
    if (!c) { gl.bindTexture(gl.TEXTURE_2D, coverTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([30, 40, 70, 255])); return; }
    const token = loadCover.token = {};
    setCover(frontCanvas(c, null));          // the title card straight away, the art as soon as it arrives
    if (!url) return;
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => { if (gl && token === loadCover.token) setCover(frontCanvas(c, img)); };
    img.src = url;
  }

  /* ---------- the room ---------- */
  function layout(sections) {
    cases = []; solids = []; signs = [];
    let unit = 0;
    const shelfColor = [0.11, 0.15, 0.30], edge = [0.30, 0.44, 0.85];
    const addUnit = (side, z0, sec, isFirst) => {
      const sx = side * (AISLE + 0.19);
      solids.push({ x: side * (AISLE + 0.38), y: 1.07, z: z0 - UNIT / 2, sx: 0.02, sy: 2.14, sz: UNIT, c: [0.05, 0.07, 0.15] });   // the back panel
      [z0, z0 - UNIT].forEach(z => solids.push({ x: sx, y: 1.1, z, sx: 0.4, sy: 2.2, sz: 0.05, c: shelfColor }));
      LEVELS.forEach(y => {
        solids.push({ x: sx, y: y - 0.015, z: z0 - UNIT / 2, sx: 0.4, sy: 0.03, sz: UNIT, c: shelfColor });
        solids.push({ x: side * (AISLE - 0.005), y: y - 0.008, z: z0 - UNIT / 2, sx: 0.012, sy: 0.016, sz: UNIT, c: edge, glow: true });   // the lit front edge of each shelf
      });
      if (isFirst) signs.push({ sec, x: side * (AISLE + 0.16), y: 2.42, z: z0 - UNIT / 2, side });
    };
    for (const sec of sections) {
      const per = Math.floor((UNIT - 0.12) / (CASE.t + CASE.gap));
      const units = Math.max(1, Math.ceil(sec.items.length / (per * LEVELS.length)));
      for (let u = 0; u < units; u++) {
        const side = unit % 2 ? 1 : -1, z0 = -Math.floor(unit / 2) * (UNIT + 0.25);
        addUnit(side, z0, sec, u === 0);
        const chunk = sec.items.slice(u * per * LEVELS.length, (u + 1) * per * LEVELS.length);
        // eye level fills first, then just above and below
        chunk.forEach((it, k) => {
          const lvl = LEVEL_ORDER[Math.floor(k / per)], slot = k % per;
          const z = z0 - 0.06 - CASE.t / 2 - slot * (CASE.t + CASE.gap);
          const x = side * (AISLE + CASE.d / 2 + 0.01), y = LEVELS[lvl] + CASE.h / 2;
          cases.push({ ...it, side, x, y, z, home: { x, y, z }, out: 0 });
        });
        unit++;
      }
    }
    // floor, ceiling and the lamps running down the aisle
    const len = Math.ceil(unit / 2) * (UNIT + 0.25) + 4;
    solids.push({ x: 0, y: -0.05, z: -len / 2 + 2, sx: 6, sy: 0.1, sz: len + 6, c: [0.06, 0.08, 0.17] });
    solids.push({ x: 0, y: 3.0, z: -len / 2 + 2, sx: 6, sy: 0.1, sz: len + 6, c: [0.03, 0.04, 0.09] });
    for (let z = 0.5; z > -len; z -= 2.3) solids.push({ x: 0, y: 2.93, z, sx: 0.7, sy: 0.03, sz: 0.12, c: [0.78, 0.85, 1.0], glow: true });
    solids.push({ x: 0, y: 1.5, z: -len, sx: 6, sy: 3.2, sz: 0.1, c: [0.03, 0.05, 0.13] });
    solids.push({ x: 0, y: 1.5, z: 3.5, sx: 6, sy: 3.2, sz: 0.1, c: [0.03, 0.05, 0.13] });
    cam.minZ = -len + 1.2;
    instData = new Float32Array((cases.length + solids.length + signs.length) * 28);
  }

  function writeInstances() {
    let n = 0;
    const put = (M, col, rect, flags) => { const o = n * 28; instData.set(M, o); instData.set(col, o + 16); instData.set(rect, o + 20); instData.set(flags, o + 24); n++; };
    for (const s of solids) put(m4.model(s.x, s.y, s.z, s.sx, s.sy, s.sz), [...s.c, 1], [0, 0, 0, 0], [0, 0, 0, s.glow ? 1 : 0]);
    for (const s of signs) put(m4.model(s.x, s.y, s.z, 0.02, 0.34, 2.2, s.side > 0 ? Math.PI : 0), [0.1, 0.15, 0.3, 1], s.sec.rect, [1, 0, 0, 1]);
    cases.forEach((c, i) => {
      const P = picked && picked.i === i ? picked : null;
      let x = c.home.x - c.side * c.out * 0.07, y = c.home.y, z = c.home.z, yaw = c.side > 0 ? Math.PI : 0, roll = -c.side * c.out * 0.05;
      if (P) { x = P.x; y = P.y; z = P.z; yaw = P.yaw; roll = 0; }
      const col = hexRGB(c.p.shell);
      put(m4.model(x, y, z, CASE.d, CASE.h, CASE.t, yaw, roll), [...col, 1], c.rect || [0, 0, 0, 0], [c.rect ? 1 : 0, i === hover ? 1 : 0, P ? 1 : 0, 0]);
    });
    instCount = n;
  }

  /* ---------- drawing ---------- */
  function frame(t) {
    raf = 0;
    if (!active) return;
    const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
    let moving = step(dt);
    if (document.hidden) { moving = false; }   // minimised: stop drawing until you come back
    if (moving || dirty) {
      dirty = false; idleSince = t;
      const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(devicePixelRatio || 1, 1.5);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.02, 0.05, 0.14, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      writeInstances();
      gl.useProgram(prog); gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf); gl.bufferData(gl.ARRAY_BUFFER, instData, gl.DYNAMIC_DRAW);
      const VP = m4.mul(m4.persp(1.05, canvas.width / canvas.height, 0.05, 60), m4.view(cam));
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "uVP"), false, VP);
      gl.uniform3f(gl.getUniformLocation(prog, "uEye"), cam.x, cam.y, cam.z);
      gl.uniform1f(gl.getUniformLocation(prog, "uCoverOn"), picked && picked.coverReady ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlasTex); gl.uniform1i(gl.getUniformLocation(prog, "uAtlas"), 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, coverTex); gl.uniform1i(gl.getUniformLocation(prog, "uCover"), 1);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, instCount);
    }
    // keep ticking while something can change; otherwise sleep until input wakes us
    if (moving || keys.size || padActive() || t - idleSince < 400) raf = requestAnimationFrame(frame);
  }
  const wake = () => { dirty = true; if (!raf && active) { last = 0; raf = requestAnimationFrame(frame); } };

  /* ---------- moving around ---------- */
  let pad = null;
  function padActive() { pad = navigator.getGamepads?.().find(p => p && p.connected) || null; return !!pad; }
  function step(dt) {
    let moved = false;
    const f = forward(), r = [-f[2], 0, f[0]];
    let mx = 0, mz = 0, look = 0, lookY = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) mz += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) mz -= 1;
    if (keys.has("KeyA")) mx -= 1;
    if (keys.has("KeyD")) mx += 1;
    if (keys.has("ArrowLeft")) look += 1.6;
    if (keys.has("ArrowRight")) look -= 1.6;
    const panelOpen = document.getElementById("panel")?.classList.contains("open");
    if (pad && !panelOpen) {
      const dz = v => Math.abs(v) < 0.15 ? 0 : v;
      mx += dz(pad.axes[0]); mz -= dz(pad.axes[1]);
      look -= dz(pad.axes[2] || 0) * 2.2; lookY -= dz(pad.axes[3] || 0) * 1.4;
      const b = i => pad.buttons[i]?.pressed;
      if (b(0) && !step.a) { step.a = true; select(); } if (!b(0)) step.a = false;
      if (b(1) && !step.b) { step.b = true; close(); return false; } if (!b(1)) step.b = false;
    }
    const speed = (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 3.2 : 1.7) * dt;
    if (mx || mz) {
      cam.x += (f[0] * mz + r[0] * mx) * speed; cam.z += (f[2] * mz + r[2] * mx) * speed;
      cam.x = Math.max(-AISLE + 0.3, Math.min(AISLE - 0.3, cam.x)); cam.z = Math.max(cam.minZ, Math.min(2.6, cam.z));
      cam.y = 1.55 + Math.sin(performance.now() / 160) * 0.008;   // a little step bob
      moved = true;
    }
    if (look || lookY) { cam.yaw += look * dt; cam.pitch = Math.max(-0.9, Math.min(0.7, cam.pitch + lookY * dt)); moved = true; }
    // the case you look at tips out a little
    const h = pick();
    if (h !== hover) { hover = h; moved = true; if (h >= 0) { try { FX.play.hover(); } catch {} } }
    for (let i = 0; i < cases.length; i++) {
      const target = i === hover && !picked ? 1 : 0, c = cases[i];
      if (Math.abs(c.out - target) > 0.001) { c.out += (target - c.out) * Math.min(1, dt * 14); moved = true; }
    }
    if (picked) moved = animatePick(dt) || moved;
    return moved;
  }
  function ray() {
    const f = forward(), cp = Math.cos(cam.pitch);
    const dir = [f[0] * cp, Math.sin(cam.pitch), f[2] * cp];
    if (mouse.locked) return dir;
    // through the mouse pointer
    const asp = canvas.clientWidth / canvas.clientHeight, t = Math.tan(1.05 / 2);
    const nx = (mouse.x * 2 - 1) * t * asp, ny = (1 - mouse.y * 2) * t;
    const r = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
    const u = [r[1] * dir[2] - r[2] * dir[1], r[2] * dir[0] - r[0] * dir[2], r[0] * dir[1] - r[1] * dir[0]];
    const d = [dir[0] + r[0] * nx + u[0] * ny, dir[1] + r[1] * nx + u[1] * ny, dir[2] + r[2] * nx + u[2] * ny];
    const l = Math.hypot(...d); return d.map(v => v / l);
  }
  function pick() {
    if (picked) return -1;
    const o = [cam.x, cam.y, cam.z], d = ray();
    let best = -1, bt = 4.2;
    cases.forEach((c, i) => {
      const hx = CASE.d / 2, hy = CASE.h / 2, hz = CASE.t / 2 + CASE.gap / 2;
      const lo = [c.home.x - hx, c.home.y - hy, c.home.z - hz], hi = [c.home.x + hx, c.home.y + hy, c.home.z + hz];
      let t0 = 0, t1 = bt;
      for (let k = 0; k < 3; k++) {
        if (Math.abs(d[k]) < 1e-6) { if (o[k] < lo[k] || o[k] > hi[k]) return; continue; }
        let a = (lo[k] - o[k]) / d[k], b = (hi[k] - o[k]) / d[k]; if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return;
      }
      if (t0 < bt) { bt = t0; best = i; }
    });
    return best;
  }

  /* ---------- taking a game off the shelf ---------- */
  function select() {
    if (picked || hover < 0) return;
    const i = hover, c = cases[i];
    picked = { i, t: 0, dir: 1, x: c.home.x, y: c.home.y, z: c.home.z, yaw: c.side > 0 ? Math.PI : 0, coverReady: false };
    hover = -1;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    try { FX.play.click(); } catch {}
    loadCover(c, null);
    Promise.resolve(opts.cover(c.g)).then(url => { if (picked && picked.i === i && url) loadCover(c, url); }).catch(() => {});
    wake();
  }
  const ease = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  function animatePick(dt) {
    const P = picked, c = cases[P.i];
    P.t = Math.max(0, Math.min(1, P.t + dt / 0.95 * P.dir));
    const k = ease(P.t);
    const f = forward(), hand = { x: cam.x + f[0] * 0.62, y: cam.y - 0.06, z: cam.z + f[2] * 0.62 };
    // slide straight out first, then glide into your hands turning the cover towards you
    const outK = Math.min(1, k / 0.35), glideK = Math.max(0, (k - 0.2) / 0.8);
    const sx = c.home.x - c.side * 0.3 * outK;
    P.x = sx + (hand.x - sx) * glideK; P.y = c.home.y + (hand.y - c.home.y) * glideK + Math.sin(glideK * Math.PI) * 0.06; P.z = c.home.z + (hand.z - c.home.z) * glideK;
    const yaw0 = c.side > 0 ? Math.PI : 0, yaw1 = Math.atan2(f[0], f[2]);   // turns the front cover (local -z) to face you
    let dy = ((yaw1 - yaw0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    P.yaw = yaw0 + dy * glideK;
    if (P.dir > 0 && P.t >= 1 && !P.opened) {
      P.opened = true;
      root.classList.add("dim");
      setTimeout(() => opts.open(c.g), 120);
    }
    if (P.dir < 0 && P.t <= 0) { picked = null; dirty = true; }
    return true;
  }

  /* ---------- input ---------- */
  function onKey(e) {
    if (!active || document.getElementById("panel")?.classList.contains("open")) return;
    if (e.type === "keydown") {
      if (e.code === "Escape" && !mouse.locked) { e.preventDefault(); return close(); }
      if (e.code === "Enter" || e.code === "KeyE" || e.code === "Space") { e.preventDefault(); return select(); }
      keys.add(e.code);
    } else keys.delete(e.code);
    wake();
  }
  function bind() {
    addEventListener("keydown", onKey); addEventListener("keyup", onKey);
    addEventListener("blur", () => { keys.clear(); });
    canvas.addEventListener("mousemove", e => {
      const r = canvas.getBoundingClientRect();
      if (mouse.locked) { cam.yaw -= e.movementX * 0.0024; cam.pitch = Math.max(-0.9, Math.min(0.7, cam.pitch - e.movementY * 0.0024)); }
      else if (mouse.dragging) { cam.yaw -= (e.clientX - mouse.lx) * 0.004; cam.pitch = Math.max(-0.9, Math.min(0.7, cam.pitch - (e.clientY - mouse.ly) * 0.004)); mouse.lx = e.clientX; mouse.ly = e.clientY; }
      mouse.x = (e.clientX - r.left) / r.width; mouse.y = (e.clientY - r.top) / r.height;
      wake();
    });
    canvas.addEventListener("mousedown", e => { if (e.button === 2 || e.button === 1) { mouse.dragging = true; mouse.lx = e.clientX; mouse.ly = e.clientY; e.preventDefault(); } });
    addEventListener("mouseup", () => { mouse.dragging = false; });
    canvas.addEventListener("contextmenu", e => e.preventDefault());
    canvas.addEventListener("click", () => { if (hover >= 0) select(); else if (!mouse.locked) canvas.requestPointerLock?.(); });
    canvas.addEventListener("wheel", e => { const f = forward(); cam.x += f[0] * -e.deltaY * 0.0012; cam.z = Math.max(cam.minZ, Math.min(2.6, cam.z + f[2] * -e.deltaY * 0.0012)); cam.x = Math.max(-AISLE + 0.3, Math.min(AISLE - 0.3, cam.x)); wake(); }, { passive: true });
    document.addEventListener("pointerlockchange", () => { mouse.locked = document.pointerLockElement === canvas; root.classList.toggle("locked", mouse.locked); wake(); });
    addEventListener("resize", wake);
    addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    addEventListener("gamepadconnected", wake);
    root.querySelector(".walk-exit").addEventListener("click", close);
  }

  /* ---------- open and close ---------- */
  function open(o) {
    opts = o;
    root = document.getElementById("walk");
    canvas = root.querySelector("canvas");
    if (!gl) {
      gl = canvas.getContext("webgl2", { antialias: true, powerPreference: "high-performance" });
      if (!gl) { o.error?.("Your graphics driver doesn't support WebGL2, so the walk-through library can't open."); return false; }
      compile(); bind();
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
      loadCover(null);
    }
    const sections = o.sections();
    const list = sections.flatMap(s => s.items);
    buildAtlas(list, sections);
    layout(sections);
    cam.x = 0; cam.z = 1.6; cam.yaw = 0; cam.pitch = -0.04; picked = null; hover = -1;
    active = true; root.hidden = false; root.classList.remove("dim");
    requestAnimationFrame(() => root.classList.add("in"));
    wake();
    return true;
  }
  function resume() {
    if (!active || !picked) return;
    root.classList.remove("dim");
    picked.dir = -1; picked.opened = false;
    try { FX.play.back(); } catch {}
    wake();
  }
  function close() {
    if (!active) return;
    active = false; keys.clear();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    root.classList.remove("in");
    setTimeout(() => { root.hidden = true; }, 350);
    try { FX.play.back(); } catch {}
    opts?.closed?.();
  }
  return { open, close, resume, get active() { return active; }, get hovered() { return hover >= 0 ? cases[hover].g.name : null; } };
})();
