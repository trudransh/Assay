// Network switch: a two-option segmented control in the top bar. Mainnet | Testnet.
// - One click, always visible, same on phone and desktop. No native <select>.
// - role="radiogroup": Tab lands on the checked option, arrow keys move, Space or Enter picks.
// - Colour plus a word plus a dot: violet means mainnet (real MON), sky means testnet (free).
// - A page that reads another chain from its link (#grades?chain=10143, a testnet receipt)
//   calls showPageChain(id). The thumb moves there with a dashed edge, so the bar never says
//   "mainnet" while the page shows testnet data. Picking an option sets the remembered default.
// - A receipt lives on exactly one chain, so on a receipt page the switch is replaced by a locked
//   chip (lockToChain). Flipping networks there could only reload the same receipt. The chip opens a
//   small popover that says why and offers to browse the other network from Verify.

import { h } from "../dom.js";
import { CHAINS, CHAIN_ID, setSelectedChainId } from "../lib/config.js";
import { reducedMotion } from "./motion.js";

const ORDER = [143, 10143];
const TONE: Record<number, string> = { 143: "violet", 10143: "sky" };
const NOTE: Record<number, string> = {
  143: "Real MON. The live receipts and grades.",
  10143: "Free. The place to try things.",
};

let group: HTMLElement | null = null;
let slotEl: HTMLElement | null = null;
let lock: HTMLElement | null = null;
let closeLock: ((e: Event) => void) | null = null;
let listening = false;

function setChecked(id: number) {
  if (!group) return;
  group.dataset.chain = String(id);
  for (const b of group.querySelectorAll<HTMLButtonElement>(".net-opt")) {
    const on = Number(b.dataset.chain) === id;
    b.setAttribute("aria-checked", String(on));
    b.tabIndex = on ? 0 : -1;
  }
}

/// Picking a network remembers it, drops the link's query (its ?chain= or a host id like
/// erc8004:143:… would pin the old chain again), and reloads once the thumb has moved,
/// because every view reads its chain when it loads.
function choose(id: number) {
  const linkChain = location.hash.includes("?");
  if (id === CHAIN_ID && !group?.classList.contains("net-override")) return setChecked(id);
  setChecked(id);
  group?.classList.remove("net-override");
  setSelectedChainId(id);
  const go = () => {
    // An agent id lives on one chain, so a host profile becomes the picked network's own host.
    if (location.hash.startsWith("#hosts/")) location.hash = `#hosts/${CHAINS[id].referenceHost}?chain=${id}`;
    else if (linkChain) location.hash = location.hash.split("?")[0];
    location.reload();
  };
  if (reducedMotion()) go();
  else setTimeout(go, 260);
}

export function mountNetworkSwitch(slot: HTMLElement): void {
  const ids = ORDER.filter((id) => CHAINS[id]);
  if (ids.length < 2) return;
  group = h("div", { class: "net", role: "radiogroup", "aria-label": "Network", "data-chain": String(CHAIN_ID) });
  group.append(h("span", { class: "net-thumb", "aria-hidden": "true" }));
  for (const id of ids) {
    const b = h(
      "button",
      { type: "button", role: "radio", class: `net-opt tone-${TONE[id]}`, "data-chain": String(id), "aria-checked": "false", title: `${CHAINS[id].name}, chain ${id}. ${NOTE[id]}` },
      h("span", { class: "net-dot", "aria-hidden": "true" }),
      h("span", { class: "net-label" }, CHAINS[id].short),
    );
    b.addEventListener("click", () => choose(id));
    b.addEventListener("keydown", (e) => {
      const i = ids.indexOf(id);
      const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const next = group!.querySelector<HTMLButtonElement>(`.net-opt[data-chain="${ids[(i + step + ids.length) % ids.length]}"]`)!;
      next.focus();
      next.click();
    });
    group.append(b);
  }
  slotEl = slot;
  slot.replaceChildren(group);
  setChecked(CHAIN_ID);
}

const LOCK_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true" class="net-lock-icon"><rect x="4" y="8.5" width="12" height="8.5" rx="2"/><path d="M7 8.5V6.5a3 3 0 0 1 6 0v2"/></svg>';

/// Pin the bar to one chain: the page shows something that only exists there (a receipt).
/// The chip is a button, so a click never does nothing: it explains and offers the other network.
export function lockToChain(id: number, what = "receipt"): void {
  if (!slotEl || !CHAINS[id]) return;
  const c = CHAINS[id];
  const other = ORDER.find((x) => x !== id && CHAINS[x]);
  const pop = h(
    "div",
    { class: "net-pop", role: "dialog", "aria-label": "Why the network is locked", id: "net-pop" },
    h("p", {}, `A ${what} lives on one chain. This one is on ${c.name}, chain ${id}, so it looks the same whichever network you picked.`),
  );
  pop.hidden = true;
  if (other) {
    const go = h("button", { type: "button", class: "btn btn-secondary btn-sm" }, `Go to Verify on ${CHAINS[other].short.toLowerCase()}`);
    go.addEventListener("click", () => {
      setSelectedChainId(other);
      location.hash = "#verify";
      location.reload();
    });
    pop.append(go);
  }
  const chipBtn = h(
    "button",
    { type: "button", class: `net-lock tone-${TONE[id]}`, "aria-expanded": "false", "aria-controls": "net-pop", title: `This ${what} lives on ${c.name}.` },
    h("span", { class: "net-dot", "aria-hidden": "true" }),
    h("span", { class: "net-label" }, c.name),
  );
  chipBtn.insertAdjacentHTML("afterbegin", LOCK_ICON);
  const set = (open: boolean) => {
    pop.hidden = !open;
    chipBtn.setAttribute("aria-expanded", String(open));
  };
  chipBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    set(pop.hidden);
  });
  const wrap = h("span", { class: "net-lockwrap", "data-chain": String(id) }, chipBtn, pop);
  wrap.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !pop.hidden) {
      set(false);
      chipBtn.focus();
    }
  });
  closeLock = (e: Event) => {
    if (!pop.hidden && !wrap.contains(e.target as Node)) set(false);
  };
  if (!listening) {
    listening = true;
    document.addEventListener("click", (e) => closeLock?.(e));
  }
  lock = wrap;
  slotEl.replaceChildren(wrap);
  const foot = document.getElementById("network-foot");
  if (foot) foot.textContent = `${c.name}, chain ${id}.`;
}

/// Back to the switch and the remembered default, for any route that isn't pinned to one chain.
/// It also clears a page-chain override left by the previous route, so a page that reads no chain
/// of its own never inherits "testnet" from the hosts board it came from. Views that read another
/// chain call showPageChain after this.
export function unlockChain(): void {
  if (!slotEl || !group) return;
  if (lock) {
    lock = null;
    closeLock = null;
    slotEl.replaceChildren(group);
  }
  group.classList.remove("net-override");
  group.title = "";
  setChecked(CHAIN_ID);
  const foot = document.getElementById("network-foot");
  if (foot) foot.textContent = `${CHAINS[CHAIN_ID].name}, chain ${CHAIN_ID}.`;
}

/// A page whose data comes from another chain than the remembered default says so here.
export function showPageChain(id: number): void {
  if (!group || !CHAINS[id]) return;
  setChecked(id);
  group.classList.toggle("net-override", id !== CHAIN_ID);
  group.title = id !== CHAIN_ID ? `This page reads ${CHAINS[id].name} from its link. Your default is ${CHAINS[CHAIN_ID].name}.` : "";
  const foot = document.getElementById("network-foot");
  if (foot) foot.textContent = `${CHAINS[id].name}, chain ${id}.`;
}
