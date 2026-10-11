// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { CHAIN_ID } from "../src/lib/config.js";
import { countUp, initReveal, typewrite } from "../src/ui/motion.js";
import { lockToChain, mountNetworkSwitch, showPageChain, unlockChain } from "../src/ui/network-switch.js";

const reduce = (on: boolean) => {
  (window as any).matchMedia = (q: string) => ({ matches: on && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} });
};

describe("network switch", () => {
  beforeEach(() => {
    document.body.innerHTML = `<span id="network-switch"></span><span id="network-foot"></span>`;
    reduce(true);
  });

  it("is a radiogroup with Mainnet then Testnet, the remembered chain checked and the only tab stop", () => {
    mountNetworkSwitch(document.getElementById("network-switch")!);
    const group = document.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute("aria-label")).toBe("Network");
    const opts = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(opts.map((o) => o.textContent)).toEqual(["Mainnet", "Testnet"]);
    const checked = opts.filter((o) => o.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(Number(checked[0].dataset.chain)).toBe(CHAIN_ID);
    expect(opts.filter((o) => o.tabIndex === 0)).toEqual(checked);
  });

  it("moves to the chain a page reads from its link, marks it as an override and updates the footer", () => {
    mountNetworkSwitch(document.getElementById("network-switch")!);
    const other = CHAIN_ID === 143 ? 10143 : 143;
    showPageChain(other);
    const group = document.querySelector<HTMLElement>(".net")!;
    expect(group.dataset.chain).toBe(String(other));
    expect(group.classList.contains("net-override")).toBe(true);
    expect(document.querySelector(`.net-opt[data-chain="${other}"]`)!.getAttribute("aria-checked")).toBe("true");
    expect(document.getElementById("network-foot")!.textContent).toContain(`chain ${other}`);
    showPageChain(CHAIN_ID);
    expect(group.classList.contains("net-override")).toBe(false);
  });
});

describe("network lock on chain-pinned pages", () => {
  beforeEach(() => {
    document.body.innerHTML = `<span id="network-switch"></span><span id="network-foot"></span>`;
    reduce(true);
  });

  it("a receipt route shows a locked chip for its chain and no radio inputs", () => {
    mountNetworkSwitch(document.getElementById("network-switch")!);
    lockToChain(143);
    const slot = document.getElementById("network-switch")!;
    expect(slot.querySelectorAll('[role="radio"]')).toHaveLength(0);
    const chip = slot.querySelector<HTMLButtonElement>(".net-lock")!;
    expect(chip.textContent).toContain("Monad mainnet");
    expect(document.getElementById("network-foot")!.textContent).toContain("chain 143");
  });

  it("clicking the chip opens an explanation with a way to the other network, and Escape closes it", () => {
    mountNetworkSwitch(document.getElementById("network-switch")!);
    lockToChain(143);
    const chip = document.querySelector<HTMLButtonElement>(".net-lock")!;
    const pop = document.querySelector<HTMLElement>(".net-pop")!;
    expect(pop.hidden).toBe(true);
    chip.click();
    expect(pop.hidden).toBe(false);
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    expect(pop.textContent).toContain("lives on one chain");
    expect(pop.querySelector("button")!.textContent).toBe("Go to Verify on testnet");
    pop.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(pop.hidden).toBe(true);
  });

  it("unpinned routes get the radiogroup back", () => {
    mountNetworkSwitch(document.getElementById("network-switch")!);
    lockToChain(10143);
    unlockChain();
    const slot = document.getElementById("network-switch")!;
    expect(slot.querySelector(".net-lock")).toBeNull();
    expect(slot.querySelectorAll('[role="radio"]')).toHaveLength(2);
  });
});

describe("motion helpers under reduced motion", () => {
  beforeEach(() => reduce(true));

  it("typewrite shows the whole text at once and keeps a screen-reader copy", async () => {
    const p = document.createElement("p");
    await typewrite(p, "Canberra.");
    expect(p.querySelector('[aria-hidden="true"]')!.textContent).toBe("Canberra.");
    expect(p.querySelector(".sr-only")!.textContent).toBe("Canberra.");
    expect(p.classList.contains("is-typing")).toBe(false);
  });

  it("countUp leaves the real number in place", () => {
    const n = document.createElement("span");
    n.textContent = "39%";
    countUp(n);
    expect(n.textContent).toBe("39%");
  });

  it("initReveal shows everything straight away and never hides content", () => {
    document.body.innerHTML = `<section data-reveal></section><ul data-reveal-group><li></li><li></li></ul>`;
    initReveal();
    expect(document.querySelectorAll(".is-in")).toHaveLength(3);
    expect(document.documentElement.classList.contains("js-reveal")).toBe(false);
  });
});
