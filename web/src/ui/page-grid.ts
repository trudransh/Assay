// The landing hero's grid, carried into the app. The two column lines (.app-frame, fixed) run down
// the content edges; this adds the hairline under each page's head, with a plus where it crosses
// each column line, so every page opens the way the landing does. Purely decorative: aria-hidden,
// no pointer events. It is placed after every route draw and again whenever <main> changes size
// (async views fill in late), and wipes in once per route. Hidden on phones, like the frame.

const HEAD = ":is(.page-head, .receipt-head, .host-head)";

let grid: HTMLElement | null = null;
let line: HTMLElement;
let plusL: HTMLElement;
let plusR: HTMLElement;
let want = "";
let shown = "";

function build(): HTMLElement {
  const g = document.createElement("div");
  g.className = "page-grid";
  g.setAttribute("aria-hidden", "true");
  line = document.createElement("span");
  line.className = "pg-line";
  plusL = document.createElement("span");
  plusR = document.createElement("span");
  plusL.className = plusR.className = "pg-plus";
  plusR.style.setProperty("--i", "1");
  g.append(line, plusL, plusR);
  document.body.append(g);
  return g;
}

/// Positions the grid under the current page's head. `key` names the route; a new key replays the wipe.
export function placePageGrid(key = want): void {
  want = key;
  const main = document.getElementById("main");
  if (!main) return;
  grid ??= build();
  const head = main.querySelector<HTMLElement>(HEAD);
  if (!head) {
    grid.hidden = true;
    return;
  }
  grid.hidden = false;
  const cs = getComputedStyle(main);
  const m = main.getBoundingClientRect();
  const left = m.left + parseFloat(cs.paddingLeft) + scrollX;
  const right = m.right - parseFloat(cs.paddingRight) + scrollX;
  const h = head.getBoundingClientRect();
  // Halfway between the head and whatever comes after it.
  let next = head.nextElementSibling as HTMLElement | null;
  while (next && next.getBoundingClientRect().height === 0) next = next.nextElementSibling as HTMLElement | null;
  const below = next ? next.getBoundingClientRect().top : h.bottom + 40;
  const y = Math.round((h.bottom + Math.max(below, h.bottom + 8)) / 2 + scrollY);
  grid.style.setProperty("--y", `${y}px`);
  plusL.style.left = `${left}px`;
  plusR.style.left = `${right}px`;
  // Async views draw their head late; the wipe plays when the head first appears.
  if (want !== shown) {
    shown = want;
    grid.classList.remove("in");
    void grid.offsetWidth;
    grid.classList.add("in");
  }
}

/// Keeps the grid in place as views fill in and the window resizes.
export function initPageGrid(): void {
  const main = document.getElementById("main");
  if (!main || typeof ResizeObserver !== "function") return;
  let queued = false;
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      placePageGrid();
    });
  };
  new ResizeObserver(queue).observe(main);
  addEventListener("resize", queue);
  void document.fonts?.ready.then(queue);
}
