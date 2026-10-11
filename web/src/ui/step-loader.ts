// A multi-step loader, after Aceternity's MultiStepLoader, rebuilt without React and tied to real
// work: each step lights when the code actually reaches it, never on a timer. The current step is
// lime with a filled check, done steps keep their check, upcoming steps are outlines that fade with
// distance, and the list slides so the current step stays in the middle.
// It covers its container (position: relative) with a blurred veil, says each step to screen
// readers, and finishes by marking every step done before it fades out.

import { h } from "../dom.js";
import { reducedMotion } from "./motion.js";

const RING = '<svg viewBox="0 0 24 24" class="sl-ico" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8.5 12.5l2.4 2.4 4.6-5.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const FILLED = '<svg viewBox="0 0 24 24" class="sl-ico" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M8.5 12.5l2.4 2.4 4.6-5.4" fill="none" stroke="var(--stone-0)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export interface StepLoader {
  el: HTMLElement;
  /// Light step i (0-based); earlier steps become done.
  go(i: number): void;
  /// Mark every step done (or stop on a failure), then fade out and remove.
  finish(ok?: boolean): Promise<void>;
}

export function stepLoader(title: string, steps: string[]): StepLoader {
  const list = h("ol", { class: "sl-list" });
  const items = steps.map((text) => {
    const li = h("li", { class: "sl-step" }, h("span", {}, text));
    list.append(li);
    return li;
  });
  const say = h("p", { class: "sr-only" });
  const el = h("div", { class: "sl", role: "status", "aria-live": "polite" }, h("div", { class: "sl-card" }, h("p", { class: "sl-title" }, title), h("div", { class: "sl-window" }, list), say));

  let at = -1;
  const paint = (cur: number, allDone = false) => {
    items.forEach((li, i) => {
      const done = allDone || i < cur;
      const now = !allDone && i === cur;
      li.classList.toggle("done", done);
      li.classList.toggle("now", now);
      li.style.setProperty("--d", String(Math.abs(i - Math.max(cur, 0))));
      const icon = done || now ? FILLED : RING;
      if (li.dataset.icon !== icon) {
        li.querySelector(".sl-ico")?.remove();
        li.insertAdjacentHTML("afterbegin", icon);
        li.dataset.icon = icon;
      }
    });
    list.style.setProperty("--at", String(Math.max(cur, 0)));
  };
  paint(0);

  return {
    el,
    go(i) {
      if (i <= at) return;
      at = Math.min(i, steps.length - 1);
      paint(at);
      say.textContent = steps[at];
    },
    async finish(ok = true) {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, reducedMotion() ? 0 : ms));
      if (ok) {
        paint(steps.length - 1, true);
        await wait(450);
      }
      el.classList.add("sl-out");
      await wait(260);
      el.remove();
    },
  };
}
