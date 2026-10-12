// Landing page. Markup lives in index.html, styles in landing.css. Motion rules:
// - Only transform, opacity, clip-path and small filters animate.
// - <html class="js-motion"> carries the start states; reduced motion drops it at once, and
//   landing.css shows everything when scripting is off, so nothing stays hidden.
// - One scroll handler (rAF-throttled) drives the nav, the receipt scene and the cap meter.

import { initHeroDots } from "./hero-dots.js";
import { initNet } from "./net.js";
import { initTerminal } from "./terminal.js";
import { initTilt } from "./tilt.js";
import { initGlow } from "../ui/glow.js";
import { $, $$, FINE, HASH, RM, clamp } from "./util.js";

if (RM) document.documentElement.classList.remove("js-motion");

/* ---------- field: a faint wall of hex, drawn once ---------- */
{
  const pre = $("#field-hash");
  if (pre) {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const hex = "0123456789abcdef";
    const rows: string[] = [];
    for (let r = 0; r < 70; r++) {
      let row = "";
      for (let c = 0; c < 6; c++) row += `0x${Array.from({ length: 16 }, () => hex[(rnd() * 16) | 0]).join("")}   `;
      rows.push(row);
    }
    pre.textContent = rows.join("\n");
  }
}

/* ---------- barcode from the receipt hash ---------- */
{
  const svg = $("#barcode");
  if (svg) {
    const ns = [...HASH].map((ch) => parseInt(ch, 16));
    const total = ns.reduce((s, n) => s + (n & 3) + 1 + ((n >> 2) & 1) + 1, 0);
    const scale = 300 / total;
    let x = 0;
    const NS = "http://www.w3.org/2000/svg";
    for (const n of ns) {
      const w = ((n & 3) + 1) * scale;
      const rect = document.createElementNS(NS, "rect");
      rect.setAttribute("x", x.toFixed(2));
      rect.setAttribute("y", "0");
      rect.setAttribute("width", w.toFixed(2));
      rect.setAttribute("height", "40");
      rect.setAttribute("fill", "#151513");
      svg.append(rect);
      x += w + (((n >> 2) & 1) + 1) * scale;
    }
  }
}

/* ---------- cap meter rows: 13 hosts stop at 16 tokens, 3 run past it ---------- */
{
  const m = $("#meter");
  if (m) {
    const over = new Set([3, 8, 13]);
    for (let i = 0; i < 16; i++) {
      const row = document.createElement("div");
      row.className = "meter-row";
      const bar = document.createElement("span");
      bar.className = `mbar ${over.has(i) ? "over" : "ok"}`;
      bar.style.setProperty("--i", String(i));
      row.append(bar);
      m.append(row);
    }
  }
}

/* ---------- reveal on view ---------- */
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("is-in");
      io.unobserve(e.target);
    }
  },
  // Threshold 0 with a bottom margin: tall blocks (the stacked cards on a phone) start as soon as
  // their top is 12% into the screen, not once 18% of their whole height is visible.
  { threshold: 0, rootMargin: "0px 0px -12% 0px" },
);
for (const el of $$("[data-reveal],[data-pop],[data-watch],#bento,#honest,#ladder,#ladder-rail,#chips")) io.observe(el);

/* ---------- count up ---------- */
function countUp(el: HTMLElement) {
  const to = Number(el.dataset.to);
  el.dataset.counted = "1";
  if (RM || !Number.isFinite(to)) {
    el.textContent = to.toLocaleString("en-US");
    return;
  }
  const t0 = performance.now();
  el.textContent = "0";
  const step = (t: number) => {
    const p = clamp((t - t0) / 1100, 0, 1);
    el.textContent = Math.round(to * (1 - (1 - p) ** 3)).toLocaleString("en-US");
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
for (const el of $$("[data-count]")) {
  const host = el.closest<HTMLElement>("[data-pop],[data-reveal],.card") ?? el;
  const o = new IntersectionObserver(
    (es) => {
      if (!es[0].isIntersecting) return;
      o.disconnect();
      if (!el.dataset.counted) countUp(el);
    },
    { threshold: 0.3 },
  );
  o.observe(host);
}

initNet(countUp);

/* ---------- nav: scrolled state, hide on scroll down, scroll-spy ---------- */
const nav = $("#nav")!;
const ind = $(".nav-ind");
const links = $$<HTMLAnchorElement>(".nav-links a[href^='#']");
const SPY = ["how", "problem", "proof", "dev"];
let lastY = scrollY;
let menuOpen = false;

function placeInd(a: HTMLAnchorElement | undefined) {
  if (!ind) return;
  if (!a) {
    ind.style.opacity = "0";
    return;
  }
  ind.style.opacity = "1";
  ind.style.width = `${a.offsetWidth}px`;
  ind.style.transform = `translateX(${a.offsetLeft}px)`;
}

function onScrollNav() {
  const y = scrollY;
  nav.classList.toggle("is-scrolled", y > 24);
  if (!RM && !menuOpen && !nav.contains(document.activeElement)) {
    if (y > 520 && y > lastY + 6) nav.classList.add("is-hidden");
    else if (y < lastY - 6 || y < 520) nav.classList.remove("is-hidden");
  }
  lastY = y;
  const line = innerHeight * 0.4;
  let cur: string | null = null;
  for (const id of SPY) if ((document.getElementById(id)?.getBoundingClientRect().top ?? Infinity) < line) cur = id;
  if ((document.getElementById("verify")?.getBoundingClientRect().top ?? Infinity) < line) cur = null;
  for (const a of links) {
    if (a.getAttribute("href") === `#${cur}`) a.setAttribute("aria-current", "true");
    else a.removeAttribute("aria-current");
  }
  placeInd(links.find((a) => a.getAttribute("href") === `#${cur}`));
}

/* ---------- phone menu: a sheet under the pill. Escape closes, focus stays inside ---------- */
{
  const btn = $<HTMLButtonElement>("#nav-menu");
  const sheet = $("#sheet");
  if (btn && sheet) {
    const items = () => $$<HTMLElement>("a, button", sheet);
    const set = (open: boolean) => {
      menuOpen = open;
      sheet.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
      btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      nav.classList.remove("is-hidden");
      if (open) items()[0]?.focus();
    };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      set(!menuOpen);
    });
    sheet.addEventListener("click", (e) => {
      if ((e.target as Element).closest("a")) set(false);
    });
    document.addEventListener("click", (e) => {
      if (menuOpen && !sheet.contains(e.target as Node) && !btn.contains(e.target as Node)) set(false);
    });
    document.addEventListener("keydown", (e) => {
      if (!menuOpen) return;
      if (e.key === "Escape") {
        set(false);
        btn.focus();
        return;
      }
      if (e.key !== "Tab") return;
      const list = [btn, ...items()];
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }
}

/* ---------- magnetic buttons and tilting cards (mouse only) ---------- */
if (FINE && !RM) {
  for (const b of $$("[data-magnetic]")) {
    b.addEventListener("pointermove", (e) => {
      const r = b.getBoundingClientRect();
      b.style.setProperty("--tx", `${(((e.clientX - (r.left + r.width / 2)) / (r.width / 2)) * 6).toFixed(2)}px`);
      b.style.setProperty("--ty", `${(((e.clientY - (r.top + r.height / 2)) / (r.height / 2)) * 4).toFixed(2)}px`);
    });
    b.addEventListener("pointerleave", () => {
      b.style.setProperty("--tx", "0px");
      b.style.setProperty("--ty", "0px");
    });
  }
  for (const c of $$("[data-tilt]")) {
    c.addEventListener("pointermove", (e) => {
      const r = c.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      const max = c.classList.contains("card-lg") ? 3 : 6;
      c.style.setProperty("--ry", `${((px - 0.5) * 2 * max).toFixed(2)}deg`);
      c.style.setProperty("--rx", `${((0.5 - py) * 2 * max).toFixed(2)}deg`);
      c.style.setProperty("--sx", `${(px * 100).toFixed(1)}%`);
      c.style.setProperty("--sy", `${(py * 100).toFixed(1)}%`);
    });
    c.addEventListener("pointerleave", () => {
      c.style.setProperty("--rx", "0deg");
      c.style.setProperty("--ry", "0deg");
    });
  }
}

/* ---------- receipt scene: the receipt stays put, the beats scroll past it ---------- */
const scene = $("#scene");
const beats = $$(".beat");
const stamps = new Map($$("[data-stamp]").map((s) => [s.dataset.stamp!, s] as const));
const rows = $$("[data-line]");
const ORDER = ["host", "model", "anchor", "you", "terms"];
const ALL = 99;
let curIdx: number | null = null;
const sceneMode = () => !RM && innerWidth > 900;

/// One state for the whole scene, recomputed from the scroll position every frame, so scrolling
/// back up undoes it exactly: beat idx is lit, stamps 0..idx are on, rows for beat idx are highlighted.
function setActive(idx: number) {
  if (idx === curIdx) return;
  curIdx = idx;
  const key = idx >= 0 ? ORDER[idx] : null;
  beats.forEach((b, i) => b.classList.toggle("is-on", i === idx));
  ORDER.forEach((k, i) => stamps.get(k)?.classList.toggle("on", idx >= 0 && i <= idx));
  for (const r of rows) {
    for (const k of ORDER) r.classList.remove(`hl-${k}`);
    if (key && r.dataset.line === key) r.classList.add(`hl-${key}`);
  }
}

function onScrollScene() {
  if (!scene) return;
  if (!sceneMode()) {
    if (curIdx !== ALL) {
      curIdx = ALL;
      for (const b of beats) b.classList.add("is-on");
    }
    return;
  }
  if (curIdx === ALL) {
    curIdx = null;
    for (const s of stamps.values()) s.classList.remove("on");
  }
  const line = innerHeight * 0.6;
  let idx = -1;
  beats.forEach((b, i) => {
    const r = b.getBoundingClientRect();
    if (r.top + r.height / 2 < line) idx = i;
  });
  setActive(idx);
}

// Phones and reduced motion: no scroll scene. Every stamp lands once the receipt is on screen.
{
  const receipt = $(".receipt");
  if (receipt) {
    const o = new IntersectionObserver(
      (es) => {
        if (es[0].isIntersecting && !sceneMode()) for (const s of stamps.values()) s.classList.add("on");
      },
      { threshold: 0.25 },
    );
    o.observe(receipt);
  }
}

/* ---------- cap meter: bars grow as it scrolls into view ---------- */
const meter = $("#meter");
function onScrollMeter() {
  if (!meter) return;
  if (RM) return void meter.style.setProperty("--g", "1");
  const r = meter.getBoundingClientRect();
  meter.style.setProperty("--g", clamp((innerHeight * 0.95 - r.top) / (innerHeight * 0.4), 0, 1).toFixed(4));
}

let ticking = false;
function onScroll() {
  ticking = false;
  onScrollNav();
  onScrollScene();
  onScrollMeter();
}
addEventListener(
  "scroll",
  () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(onScroll);
  },
  { passive: true },
);
addEventListener("resize", onScroll);
onScroll();
void document.fonts?.ready.then(onScroll);

/* ---------- copy the install command ---------- */
{
  const b = $<HTMLButtonElement>("#copy");
  if (b) {
    const done = (ok: boolean) => {
      b.textContent = ok ? "Copied" : "Select";
      b.classList.toggle("done", ok);
      setTimeout(() => {
        b.textContent = "Copy";
        b.classList.remove("done");
      }, 1600);
    };
    const select = () => {
      const r = document.createRange();
      r.selectNodeContents(b.previousElementSibling!);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(r);
      done(false);
    };
    b.addEventListener("click", () => {
      navigator.clipboard?.writeText("npm install assay-receipts").then(() => done(true), select) ?? select();
    });
  }
}

initHeroDots();
initTerminal();
initTilt();
initGlow("[data-glow]");
