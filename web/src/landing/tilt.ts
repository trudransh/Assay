// The app screenshot that tilts flat as you scroll, after Aceternity's ContainerScroll, rebuilt
// without React or motion. Progress runs from 0 when the frame's top enters the viewport to 1 when
// it is 12% from the top: the frame turns from rotateX(20deg) to flat and settles from 1.05 to 1
// (0.94 to 1 on phones), and the heading lifts a little. It is recomputed from the scroll
// position each frame, so scrolling back up reverses it. Reduced motion leaves it flat.

import { $, RM, clamp } from "./util.js";

export function initTilt(): void {
  const sec = $("#tilt");
  const frame = $("#tilt-frame");
  const head = $("#tilt-head");
  if (!sec || !frame || !head || RM) return;
  sec.classList.add("is-live");

  let queued = false;
  const paint = () => {
    queued = false;
    const r = frame.getBoundingClientRect();
    const vh = innerHeight;
    if (r.bottom < -200 || r.top > vh + 200) return;
    const p = clamp((vh - r.top) / (vh * 0.88), 0, 1);
    const e = 1 - Math.pow(1 - p, 2);
    const phone = innerWidth <= 768;
    const s0 = phone ? 0.94 : 1.05;
    sec.style.setProperty("--rx", `${(20 * (1 - e)).toFixed(2)}deg`);
    sec.style.setProperty("--sc", (s0 + (1 - s0) * e).toFixed(4));
    sec.style.setProperty("--ty", `${(-(phone ? 24 : 60) * e).toFixed(1)}px`);
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(paint);
  };
  addEventListener("scroll", queue, { passive: true });
  addEventListener("resize", queue);
  paint();
}
