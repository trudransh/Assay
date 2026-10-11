// Cursor glow for cards: a thin gradient border that turns to face the pointer and fades in as
// the pointer comes near (within 140px). One document-level listener, throttled to a frame,
// covers every card on the page, including cards a view adds later. Mouse only; nothing runs
// under reduced motion or on touch screens. Styling lives in CSS under .glow-on (::after).

const NEAR = 140;

export function initGlow(selector: string): void {
  if (typeof matchMedia !== "function") return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  document.documentElement.classList.add("glow-on");
  let x = -1e4;
  let y = -1e4;
  let queued = false;
  const lit = new Set<HTMLElement>();

  const paint = () => {
    queued = false;
    const seen = new Set<HTMLElement>();
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      const r = el.getBoundingClientRect();
      if (r.bottom < -NEAR || r.top > innerHeight + NEAR) continue;
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      const near = 1 - Math.min(1, Math.hypot(dx, dy) / NEAR);
      if (near <= 0) continue;
      const angle = (Math.atan2(y - (r.top + r.height / 2), x - (r.left + r.width / 2)) * 180) / Math.PI + 90;
      el.style.setProperty("--ga", angle.toFixed(1));
      el.style.setProperty("--go", near.toFixed(3));
      seen.add(el);
    }
    for (const el of lit) if (!seen.has(el)) el.style.setProperty("--go", "0");
    lit.clear();
    for (const el of seen) lit.add(el);
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(paint);
  };
  addEventListener(
    "pointermove",
    (e) => {
      x = e.clientX;
      y = e.clientY;
      queue();
    },
    { passive: true },
  );
  addEventListener("scroll", queue, { passive: true });
  document.addEventListener("pointerleave", () => {
    x = y = -1e4;
    queue();
  });
}
