// Hero object: a dot-matrix figure drawn with WebGL points, no library.
// It cycles through the receipt life cycle: the first mainnet receipt (gold, signed by the host),
// a Merkle batch (violet, anchored on Monad), a passkey fingerprint (pink, you co-sign) and the
// Assay mark (gold, anyone can check). The page backdrop never moves; the cursor tilts this object
// and pushes dots aside. Off screen or with the tab hidden it stops drawing. Reduced motion draws
// one still receipt, and the pips switch shapes without animation.

import { $, $$, FINE, HASH, RM, clamp } from "./util.js";

type Pt = [x: number, y: number, z: number, alpha: number];
interface ShapeOut { pitch: number; pts: Pt[] }
interface Sampled {
  w: number;
  h: number;
  /// Height of the shape in world units.
  H: number;
  draw: (c: CanvasRenderingContext2D, w: number, h: number) => void;
  /// Share of the point budget to spend on ink before paper.
  ink: number;
  z: (x: number, y: number, front: number) => number;
}
type Spec = { direct: () => ShapeOut } | Sampled;

const STAGES = [
  { k: "[ SIGNED ]", t: "The host signs every response it serves.", m: "X-Assay-Receipt: ES256 JWS", c: "var(--gold)", rgb: [0.86, 0.69, 0.18] },
  { k: "[ ANCHORED ]", t: "Receipts are batched and anchored on Monad.", m: "ReceiptAnchor.anchor(root, sig)", c: "var(--violet)", rgb: [0.55, 0.45, 1.0] },
  { k: "[ CO-SIGNED ]", t: "You can co-sign with your passkey.", m: "cosign(): WebAuthn on P-256", c: "var(--pink)", rgb: [1.0, 0.55, 0.81] },
  { k: "[ CHECKED ]", t: "Anyone can check it in a browser. No wallet.", m: "verifyReceipt(receipt)", c: "var(--gold-high)", rgb: [0.95, 0.79, 0.3] },
] as const;

/// The "A" of the logo mark, in the mark's own coordinates (public/assay-logo-dark.svg).
const MARK_A =
  "M42.52 98.0V92.64L50.84 92.0H52.52L60.28 92.64V98.0ZM46.36 98.0 64.6 45.6H75.96L94.44 98.0H78.6L64.76 54.96H65.08L63.48 63.2L52.44 98.0ZM55.24 83.52V78.24H80.84V83.52ZM70.6 98.0V92.72L79.96 92.16H87.4L97.48 92.72V98.0Z";

/// A 5x7 dot-matrix font, the kind a thermal printer uses. Each glyph is 7 rows of 5 bits.
const FONT: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [28, 18, 17, 17, 17, 18, 28],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 17, 10, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  "0": [14, 17, 19, 21, 25, 17, 14], "1": [4, 12, 4, 4, 4, 4, 14], "2": [14, 17, 1, 2, 4, 8, 31], "3": [31, 2, 4, 2, 1, 17, 14],
  "4": [2, 6, 10, 18, 31, 2, 2], "5": [31, 16, 30, 1, 1, 17, 14], "6": [6, 8, 16, 30, 17, 17, 14], "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14], "9": [14, 17, 17, 15, 1, 2, 12],
  ".": [0, 0, 0, 0, 0, 12, 12], ",": [0, 0, 0, 0, 12, 4, 8], ":": [0, 12, 12, 0, 12, 12, 0], "-": [0, 0, 0, 31, 0, 0, 0],
  "/": [0, 1, 2, 4, 8, 16, 0], x: [0, 0, 17, 10, 4, 10, 17], "*": [0, 1, 2, 20, 8, 0, 0], " ": [0, 0, 0, 0, 0, 0, 0],
};

const VS = `
attribute vec4 a0; attribute vec4 a1; attribute vec4 a2; attribute vec4 a3; attribute float aSeed;
uniform float uFrom, uTo, uProg, uTime, uAspect, uScale, uSize, uMouseOn;
uniform vec2 uCenter, uRot, uMouse;
uniform vec3 uC0, uC1, uC2, uC3;
varying vec4 vC;
vec4 P(float i){ if(i<0.5) return a0; if(i<1.5) return a1; if(i<2.5) return a2; return a3; }
vec3 C(float i){ if(i<0.5) return uC0; if(i<1.5) return uC1; if(i<2.5) return uC2; return uC3; }
void main(){
  vec4 A = P(uFrom); vec4 B = P(uTo);
  float t = clamp((uProg - aSeed * 0.42) / 0.58, 0.0, 1.0);
  t = t < 0.5 ? 4.0*t*t*t : 1.0 - pow(-2.0*t + 2.0, 3.0) / 2.0;
  vec3 p = mix(A.xyz, B.xyz, t);
  float s = sin(t * 3.14159265);
  vec3 dir = normalize(vec3(sin(aSeed*91.7), cos(aSeed*47.3), sin(aSeed*13.1 + 1.0)) + 0.001);
  p += dir * s * (0.22 + 0.6 * aSeed);
  p.z += 0.012 * sin(uTime * 1.1 + aSeed * 40.0);
  p.y += 0.003 * sin(uTime * 0.9 + aSeed * 23.0);
  float a = mix(A.w, B.w, t);
  float cy = cos(uRot.x), sy = sin(uRot.x), cx = cos(uRot.y), sx = sin(uRot.y);
  p = vec3(cy*p.x + sy*p.z, p.y, -sy*p.x + cy*p.z);
  p = vec3(p.x, cx*p.y - sx*p.z, sx*p.y + cx*p.z);
  float D = 5.0; float w = D / (D - p.z);
  vec2 ndc = uCenter + vec2(p.x * uScale / uAspect, p.y * uScale) * w;
  vec2 dd = ndc - uMouse; dd.x *= uAspect;
  float dist = length(dd);
  float f = uMouseOn * smoothstep(0.24, 0.0, dist);
  ndc += (dd / (dist + 0.0001)) * f * 0.07 * vec2(1.0 / uAspect, 1.0);
  gl_Position = vec4(ndc, 0.0, 1.0);
  gl_PointSize = max(1.5, uSize * w * (0.72 + 0.34 * a) * (1.0 + s * 0.25));
  float tw = 0.86 + 0.14 * sin(uTime * 2.3 + aSeed * 71.0);
  vec3 col = min(mix(C(uFrom), C(uTo), t) * (0.9 + f * 0.9), vec3(1.0));
  vC = vec4(col, a * tw * clamp(0.85 + p.z * 0.5, 0.45, 1.0));
}`;
const FS = `
precision mediump float; varying vec4 vC;
void main(){ vec2 q = gl_PointCoord - 0.5; float r = length(q); float a = smoothstep(0.5, 0.14, r) * vC.a; if (a < 0.004) discard; gl_FragColor = vec4(vC.rgb * a, a); }`;

export function initHeroDots(): void {
  const hero = $("#top");
  const canvas = $<HTMLCanvasElement>("#dots");
  const stage = $("#stage-obj");
  const hlEl = $(".h1 .hl");
  const frameEl = $(".hero-grid .frame");
  const tagEl = $("#stage-tag");
  const inEl = $(".hero-in");
  const midEls = [$("#grid-mid"), $("#plus-mid")].filter((e): e is HTMLElement => !!e);
  if (!hero || !canvas || !stage) return;
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: true, depth: false, powerPreference: "high-performance" });
  } catch {
    gl = null;
  }
  if (!gl) return void hero.classList.add("no-gl");
  const g: WebGLRenderingContext = gl;

  const small = innerWidth < 760;
  const N = small ? 6400 : 8800;

  // Seeded, so the object is the same on every load.
  let s0 = 1234567;
  const rnd = () => ((s0 = (s0 * 16807) % 2147483647) - 1) / 2147483646;

  function drawBatch(c: CanvasRenderingContext2D, w: number) {
    const levels = [8, 4, 2, 1];
    const ys = [352, 258, 164, 70];
    const pos = levels.map((n) => Array.from({ length: n }, (_, i) => 35 + ((w - 70) * (i + 0.5)) / n));
    c.strokeStyle = "#fff";
    c.lineWidth = 6;
    c.lineCap = "round";
    for (let li = 0; li < 3; li++)
      pos[li].forEach((x, i) => {
        const px = pos[li + 1][i >> 1];
        c.beginPath();
        c.moveTo(x, ys[li] - 18);
        c.lineTo(x, ys[li] - 46);
        c.lineTo(px, ys[li + 1] + 46);
        c.lineTo(px, ys[li + 1] + 20);
        c.stroke();
      });
    pos.forEach((row, li) =>
      row.forEach((x) => {
        const s = li === 3 ? 30 : 18;
        c.fillStyle = "rgb(70,70,70)";
        c.fillRect(x - s, ys[li] - s, s * 2, s * 2);
        c.lineWidth = 6;
        c.strokeRect(x - s, ys[li] - s, s * 2, s * 2);
      }),
    );
  }

  function drawPasskey(c: CanvasRenderingContext2D, w: number, h: number) {
    const cx = w / 2;
    const cy = h / 2 + 18;
    c.strokeStyle = "#fff";
    c.lineWidth = 8;
    c.lineCap = "round";
    let s1 = 99;
    const pr = () => (s1 = (s1 * 48271) % 2147483647) / 2147483647;
    for (let k = 0; k < 9; k++) {
      const r = 22 + k * 19;
      const end = Math.PI * (2.08 + k * 0.012);
      let a = Math.PI * (0.92 - k * 0.012);
      while (a < end) {
        const b = Math.min(end, a + Math.PI * (0.35 + pr() * 0.6));
        c.beginPath();
        c.ellipse(cx, cy, r, r * 1.16, 0, a, b);
        c.stroke();
        a = b + Math.PI * (0.06 + pr() * 0.08);
      }
    }
    c.beginPath();
    c.moveTo(cx, cy - 6);
    c.lineTo(cx, cy + 34);
    c.stroke();
  }

  function drawMark(c: CanvasRenderingContext2D, w: number, h: number) {
    const poly = (pts: number[][]) => {
      c.beginPath();
      pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
      c.closePath();
      c.stroke();
    };
    c.save();
    c.translate(w / 2 - 70 * 2.7, h / 2 - 80 * 2.7);
    c.scale(2.7, 2.7);
    c.lineJoin = "miter";
    // The ring is drawn in pure red and the "A" in white, so sampling can put the letter in front.
    c.strokeStyle = "rgb(255,0,0)";
    c.lineWidth = 8;
    poly([[38, 14], [102, 14], [126, 38], [126, 122], [102, 146], [38, 146], [14, 122], [14, 38]]);
    c.lineWidth = 3;
    poly([[42, 24], [98, 24], [116, 42], [116, 118], [98, 136], [42, 136], [24, 118], [24, 42]]);
    c.fillStyle = "#fff";
    c.fill(new Path2D(MARK_A));
    c.fillRect(48, 111.5, 44, 5);
    c.restore();
  }

  /// The hero receipt, set dot by dot from the real first mainnet receipt so every line reads.
  function receiptPoints(): ShapeOut {
    const COLS = 141;
    const M = 5;
    const lit = new Set<string>();
    const ink: [number, number, number][] = [];
    let row = 6;
    const dot = (c: number, r: number, a: number) => {
      const key = `${c},${r}`;
      if (lit.has(key)) return;
      lit.add(key);
      ink.push([c, r, a]);
    };
    const glyph = (ch: string, c0: number, r0: number, s: number) => {
      const gl7 = FONT[ch] ?? FONT[" "];
      for (let r = 0; r < 7; r++)
        for (let c = 0; c < 5; c++)
          if ((gl7[r] >> (4 - c)) & 1) for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) dot(c0 + c * s + dx, r0 + r * s + dy, 1);
    };
    const text = (str: string, align: "l" | "c" | "r", r0: number, s = 1) => {
      const w = str.length * 6 * s - s;
      const c0 = align === "c" ? Math.round((COLS - w) / 2) : align === "r" ? COLS - M - w : M;
      for (let i = 0; i < str.length; i++) glyph(str[i], c0 + i * 6 * s, r0, s);
    };
    const center = (str: string, s = 1) => {
      text(str, "c", row, s);
      row += 7 * s + 3;
    };
    const pair = (l: string, r: string) => {
      text(l, "l", row);
      text(r, "r", row);
      row += 10;
    };
    const rule = (dbl = false) => {
      for (let c = M; c < COLS - M; c++) {
        if (dbl || c % 3 !== 2) dot(c, row + 1, 0.8);
        if (dbl) dot(c, row + 3, 0.8);
      }
      row += dbl ? 7 : 6;
    };
    center("ASSAY", 2);
    row += 1;
    center("RECEIPT 0x1B44..C5F2");
    center("MONAD MAINNET");
    center("2026-10-05 06:46 UTC");
    rule();
    pair("MODEL", "GEMMA-4-31B-IT");
    pair("HOST", "AGENT 10278");
    pair("SIGNED", "ES256 *");
    pair("PROMPT", "0xDC6D..6E23");
    pair("ANSWER", "0xDD16..B6DD");
    pair("TOKENS", "8 IN 1 OUT");
    rule();
    pair("ROOT", "0x4066..60CB");
    pair("BLOCK", "110,684,366");
    pair("CO-SIGN", "NONE");
    rule(true);
    let c = M + 1;
    for (let i = 0; i < HASH.length && c < COLS - M - 1; i++) {
      const n = parseInt(HASH[i], 16);
      const bw = (n & 1) + 1;
      for (let x = 0; x < bw && c + x < COLS - M; x++) for (let r = 0; r < 16; r++) dot(c + x, row + r, 1);
      c += bw + ((n >> 1) & 1) + 1;
    }
    row += 20;
    center("KEEP YOUR SALT");
    const ROWS = row + 5;
    // Paper: torn top and bottom edges at full pitch, faint sides, and a sparse fill kept off the type.
    const near = (cc: number, rr: number) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (lit.has(`${cc + dx},${rr + dy}`)) return true;
      return false;
    };
    const paper: [number, number, number][] = [];
    for (let cc = 0; cc <= COLS; cc++) {
      const t = cc % 6;
      const tri = t < 3 ? t : 6 - t;
      paper.push([cc, tri - 2, 0.42], [cc, ROWS + 2 - tri, 0.42]);
    }
    for (let rr = 1; rr < ROWS; rr += 2) paper.push([0, rr, 0.32], [COLS, rr, 0.32]);
    const room = N - ink.length - paper.length - 300;
    let fill: [number, number, number][] = [];
    for (let step = 3; step < 9; step++) {
      fill = [];
      for (let fr = 2; fr < ROWS - 1; fr += step) for (let fc = 2; fc < COLS - 1; fc += step) if (!near(fc, fr)) fill.push([fc, fr, 0.24]);
      if (fill.length <= room) break;
    }
    const P = 2.5 / ROWS;
    return {
      pitch: P,
      pts: [...ink, ...paper, ...fill].map(([pc, pr, pa]): Pt => {
        const x = (pc - COLS / 2) * P;
        const y = -(pr - ROWS / 2) * P;
        return [x, y, -0.14 * y * y + 0.07 + (rnd() - 0.5) * 0.008, pa];
      }),
    };
  }

  function sampled(spec: Sampled): ShapeOut {
    const cv = document.createElement("canvas");
    cv.width = spec.w;
    cv.height = spec.h;
    const cx = cv.getContext("2d", { willReadFrequently: true })!;
    cx.fillStyle = "#000";
    cx.fillRect(0, 0, spec.w, spec.h);
    spec.draw(cx, spec.w, spec.h);
    const d = cx.getImageData(0, 0, spec.w, spec.h).data;
    const grid = (step: number) => {
      const ink: number[][] = [];
      const base: number[][] = [];
      for (let y = step / 2; y < spec.h; y += step)
        for (let x = step / 2; x < spec.w; x += step) {
          const i = ((y | 0) * spec.w + (x | 0)) * 4;
          const v = d[i] / 255;
          if (v > 0.55) ink.push([x, y, v, d[i + 1] / 255]);
          else if (v > 0.12) base.push([x, y, v, d[i + 1] / 255]);
        }
      return { ink, base };
    };
    let step = 4 * Math.sqrt(Math.max(1, grid(4).ink.length) / (N * spec.ink));
    let gr = grid(step);
    if (gr.ink.length > N) {
      step *= Math.sqrt(gr.ink.length / (N * 0.95));
      gr = grid(step);
    }
    for (let i = gr.base.length - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      [gr.base[i], gr.base[j]] = [gr.base[j], gr.base[i]];
    }
    const nb = Math.min(gr.base.length, Math.floor(Math.max(0, N - gr.ink.length) * 0.7));
    return {
      pitch: (step / spec.h) * spec.H,
      pts: [...gr.ink, ...gr.base.slice(0, nb)].map(([px, py, v, front]): Pt => {
        const x = ((px - spec.w / 2) / spec.h) * spec.H;
        const y = (-(py - spec.h / 2) / spec.h) * spec.H;
        return [x, y, spec.z(x, y, front) + (rnd() - 0.5) * 0.03, v > 0.55 ? 1 : 0.5];
      }),
    };
  }

  const SHAPES: Spec[] = [
    { direct: receiptPoints },
    { w: 420, h: 420, H: 2.2, draw: drawBatch, ink: 0.5, z: (_x, y) => y * 0.42 },
    { w: 420, h: 420, H: 2.2, draw: drawPasskey, ink: 0.6, z: (x, y) => 0.4 * (1 - Math.min(1, Math.hypot(x, y) / 1.2) ** 2) },
    { w: 420, h: 440, H: 2.25, draw: drawMark, ink: 0.65, z: (_x, _y, front) => (front > 0.5 ? 0.26 : -0.04) },
  ];

  function build(spec: Spec): { data: Float32Array; step: number } {
    const s = "direct" in spec ? spec.direct() : sampled(spec);
    // Top to bottom, so each morph flows the way a printer feeds.
    const pts = s.pts.slice(0, N).sort((a, b) => b[1] - a[1] + (a[0] - b[0]) * 0.15);
    const out = new Float32Array(N * 4);
    pts.forEach((p, i) => out.set(p, i * 4));
    for (let q = pts.length; q < N; q++) {
      const th = rnd() * Math.PI * 2;
      const ph = Math.acos(2 * rnd() - 1);
      const rr = 1.55 + rnd() * 1.1;
      out.set([rr * Math.sin(ph) * Math.cos(th) * 1.25, rr * Math.cos(ph) * 0.95, rr * Math.sin(ph) * Math.sin(th) * 0.5, 0.05 + rnd() * 0.12], q * 4);
    }
    return { data: out, step: s.pitch };
  }

  let built: { data: Float32Array; step: number }[];
  let prog: WebGLProgram;
  try {
    built = SHAPES.map(build);
    const sh = (type: number, src: string) => {
      const s = g.createShader(type)!;
      g.shaderSource(s, src);
      g.compileShader(s);
      if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    prog = g.createProgram()!;
    g.attachShader(prog, sh(g.VERTEX_SHADER, VS));
    g.attachShader(prog, sh(g.FRAGMENT_SHADER, FS));
    g.linkProgram(prog);
    if (!g.getProgramParameter(prog, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(prog) ?? "link");
  } catch {
    return void hero.classList.add("no-gl");
  }
  g.useProgram(prog);

  const attr = (name: string, data: Float32Array, size: number) => {
    g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
    g.bufferData(g.ARRAY_BUFFER, data, g.STATIC_DRAW);
    const loc = g.getAttribLocation(prog, name);
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, size, g.FLOAT, false, 0, 0);
  };
  built.forEach((b, i) => attr(`a${i}`, b.data, 4));
  attr("aSeed", Float32Array.from({ length: N }, rnd), 1);
  const U: Record<string, WebGLUniformLocation | null> = {};
  for (const n of ["uFrom", "uTo", "uProg", "uTime", "uAspect", "uScale", "uSize", "uMouseOn", "uCenter", "uRot", "uMouse", "uC0", "uC1", "uC2", "uC3"]) U[n] = g.getUniformLocation(prog, n);
  STAGES.forEach((s, i) => g.uniform3fv(U[`uC${i}`], s.rgb));
  g.disable(g.DEPTH_TEST);
  g.enable(g.BLEND);
  g.blendFunc(g.ONE, g.ONE);
  g.clearColor(0, 0, 0, 0);

  const dotPitch = built[0].step;
  const dpr = Math.min(devicePixelRatio || 1, small ? 1.75 : 2);
  const geo = { cx: 0, cy: 0, scale: 1, aspect: 1, size: 3 };
  const cvs = canvas;
  const stg = stage;
  const hro = hero;

  function layout() {
    const hr = hro.getBoundingClientRect();
    const sr = stg.getBoundingClientRect();
    const W = Math.max(1, Math.round(hr.width * dpr));
    const Hh = Math.max(1, Math.round(hr.height * dpr));
    if (cvs.width !== W || cvs.height !== Hh) {
      cvs.width = W;
      cvs.height = Hh;
    }
    g.viewport(0, 0, W, Hh);
    const narrow = innerWidth <= 900;
    let cxPx = sr.left - hr.left + sr.width * 0.5;
    let cyPx = sr.top - hr.top + sr.height * 0.5;
    let objPx = Math.min(sr.height * 0.9, sr.width * 1.15);
    if (!narrow && hlEl && frameEl) {
      // The middle grid line sits just right of "response.", and the shape fills the space between
      // that line and the right edge, above the caption. Widest shape spans about 0.88 * objPx.
      const fr = frameEl.getBoundingClientRect();
      const hl = hlEl.getBoundingClientRect();
      const lineX = clamp(hl.right + 36, fr.left + fr.width * 0.416, fr.left + fr.width * 0.62);
      for (const el of midEls) el.style.left = `${(lineX - fr.left).toFixed(1)}px`;
      const left = lineX + 40;
      const right = sr.right;
      // Right of the line nothing sits above the stage, so the shape may start level with the status row.
      const tagTop = tagEl ? tagEl.getBoundingClientRect().top - 24 : sr.bottom;
      const top = inEl ? inEl.getBoundingClientRect().top + 8 : sr.top;
      const bottom = Math.min(sr.bottom, tagTop);
      // The tallest shape (the receipt, tilted) spans about 1.02 * objPx.
      objPx = Math.max(240, Math.min((right - left) / 0.88, (bottom - top) / 1.02));
      cxPx = (left + right) / 2 - hr.left;
      cyPx = (top + bottom) / 2 - hr.top;
    }
    geo.cx = (cxPx / hr.width) * 2 - 1;
    geo.cy = 1 - (cyPx / hr.height) * 2;
    geo.scale = ((objPx / hr.height) * 2) / 2.5;
    geo.aspect = hr.width / hr.height;
    geo.size = Math.max(1.6, ((dotPitch * geo.scale * Hh) / 2) * 0.86);
  }

  const tag = $("#stage-tag");
  const tk = $("#tag-k");
  const tt = $("#tag-t");
  const tm = $("#tag-m");
  const pips = $$<HTMLButtonElement>(".pip");
  function showTag(i: number) {
    const s = STAGES[i];
    tag?.classList.add("swap");
    setTimeout(
      () => {
        if (tk) tk.textContent = s.k;
        if (tt) tt.textContent = s.t;
        if (tm) tm.textContent = s.m;
        tag?.style.setProperty("--c", s.c);
        requestAnimationFrame(() => tag?.classList.remove("swap"));
      },
      RM ? 0 : 240,
    );
    pips.forEach((p, j) => p.setAttribute("aria-pressed", String(j === i)));
  }

  const HOLDS = [4600, 2800, 2800, 3000];
  const MORPH = 1800;
  let cur = 0;
  let to = 0;
  let prog01 = 0;
  let state: "hold" | "morph" = "hold";
  let holdT = 0;
  let mx = 0, my = 0, tmx = 0, tmy = 0, mOn = 0, tOn = 0, mnx = 0, mny = 0;
  let running = false;
  let visible = true;
  let raf = 0;
  let last = 0;
  const t0 = performance.now();

  function startMorph(j: number) {
    if (j === cur && state === "hold") return;
    if (state === "morph") cur = to;
    to = j;
    prog01 = 0;
    state = "morph";
    showTag(j);
  }
  pips.forEach((p, j) =>
    p.addEventListener("click", () => {
      if (RM) {
        cur = to = j;
        prog01 = 0;
        state = "hold";
        showTag(j);
        draw(performance.now());
        return;
      }
      holdT = 0;
      startMorph(j);
    }),
  );

  function draw(t: number) {
    g.clear(g.COLOR_BUFFER_BIT);
    const time = (t - t0) / 1000;
    const yaw = (RM ? -0.1 : Math.sin(time * 0.22) * 0.16 - 0.06) + mx * 0.32;
    const pitch = (RM ? 0.03 : -0.02 + Math.sin(time * 0.17) * 0.04) + my * 0.16;
    g.uniform1f(U.uFrom, cur);
    g.uniform1f(U.uTo, state === "morph" ? to : cur);
    g.uniform1f(U.uProg, state === "morph" ? prog01 : 0);
    g.uniform1f(U.uTime, RM ? 0 : time);
    g.uniform1f(U.uAspect, geo.aspect);
    g.uniform1f(U.uScale, geo.scale);
    g.uniform1f(U.uSize, geo.size);
    g.uniform1f(U.uMouseOn, mOn);
    g.uniform2f(U.uCenter, geo.cx, geo.cy);
    g.uniform2f(U.uRot, yaw, pitch);
    g.uniform2f(U.uMouse, mnx, mny);
    g.drawArrays(g.POINTS, 0, N);
  }
  function frame(t: number) {
    raf = 0;
    if (!running) return;
    const dt = Math.min(50, t - (last || t));
    last = t;
    if (state === "hold") {
      holdT += dt;
      if (holdT > HOLDS[cur]) {
        holdT = 0;
        startMorph((cur + 1) % 4);
      }
    } else {
      prog01 += dt / MORPH;
      if (prog01 >= 1) {
        cur = to;
        prog01 = 0;
        state = "hold";
        holdT = 0;
      }
    }
    mx += (tmx - mx) * 0.08;
    my += (tmy - my) * 0.08;
    mOn += (tOn - mOn) * 0.1;
    draw(t);
    raf = requestAnimationFrame(frame);
  }
  function setRun() {
    const want = visible && !document.hidden && !RM;
    if (want && !running) {
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    } else if (!want) {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  if (FINE && !RM) {
    hero.addEventListener("pointermove", (e) => {
      const hr = hro.getBoundingClientRect();
      const sr = stg.getBoundingClientRect();
      tmx = clamp((e.clientX - (sr.left + sr.width / 2)) / (hr.width / 2), -1, 1);
      tmy = clamp((e.clientY - (sr.top + sr.height / 2)) / (hr.height / 2), -1, 1);
      mnx = ((e.clientX - hr.left) / hr.width) * 2 - 1;
      mny = 1 - ((e.clientY - hr.top) / hr.height) * 2;
      tOn = 1;
    });
    hero.addEventListener("pointerleave", () => {
      tmx = tmy = tOn = 0;
    });
  }

  const redraw = () => {
    layout();
    if (!running) draw(performance.now());
  };
  layout();
  new ResizeObserver(redraw).observe(hero);
  void document.fonts?.ready.then(redraw);
  new IntersectionObserver((es) => {
    visible = es[0].isIntersecting;
    setRun();
  }).observe(hero);
  document.addEventListener("visibilitychange", setRun);
  draw(performance.now());
  setRun();
}
