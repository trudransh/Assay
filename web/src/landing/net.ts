// Landing network switch (Mainnet | Testnet) and the live numbers it swaps.
// - It shares the app's remembered network (localStorage "assay.chain"), so "Verify a receipt"
//   opens the app on the network the reader picked here.
// - Elements carry both values: data-m / data-t for text, data-hm / data-ht for links,
//   data-to-m / data-to-t for counted numbers, data-only="mainnet|testnet" for whole blocks.
// - Receipts live on one chain, so the receipt scene and the paid job stay on mainnet and say so.
// - Counts come from Envio on load. The values baked into the HTML (read 11 Oct) stay if that fails.

import { INDEXER_URL, selectedChainId, setSelectedChainId } from "../lib/config.js";
import { $, $$, RM } from "./util.js";

type Net = "mainnet" | "testnet";
const CHAIN: Record<Net, number> = { mainnet: 143, testnet: 10143 };

/// keccak256("moonshotai/kimi-k2.6"): grades store the model as a hash.
const KIMI_MODEL = "0x87ee87bf5e3d5cc82c897dd19527c9f47935f16d0bc8a2efda4c6a33066ad569";

const QUERY = `query Landing($kimi: String!) {
  m: Anchor(where: { id: { _like: "143-%" } }) { count }
  t: Anchor(where: { id: { _like: "10143-%" } }) { count }
  gm: Grade(where: { id: { _like: "143-%" }, model: { _eq: $kimi } }) { hostKey }
  gt: Grade(where: { id: { _like: "10143-%" } }) { id }
}`;

let net: Net = selectedChainId() === CHAIN.testnet ? "testnet" : "mainnet";
let recount: (el: HTMLElement) => void = () => {};

const fmt = (n: number) => n.toLocaleString("en-US");

function place(group: HTMLElement) {
  const on = $<HTMLElement>("[aria-checked='true']", group);
  const thumb = $<HTMLElement>(".net-thumb", group);
  if (!on || !thumb || !on.offsetWidth) return;
  thumb.style.setProperty("--tw", `${on.offsetWidth}px`);
  thumb.style.setProperty("--tx", `${on.offsetLeft}px`);
}

function swapText(el: HTMLElement, text: string) {
  if (el.textContent === text) return;
  el.textContent = text;
  if (!RM) el.animate([{ opacity: 0, filter: "blur(4px)" }, { opacity: 1, filter: "blur(0)" }], { duration: 380, easing: "cubic-bezier(.16,1,.3,1)" });
}

function apply(n: Net, first = false) {
  net = n;
  document.documentElement.dataset.net = n;
  for (const group of $$("[data-net-switch]")) {
    for (const b of $$<HTMLButtonElement>("[role='radio']", group)) {
      const on = b.dataset.net === n;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    place(group);
  }
  const t = n === "testnet";
  for (const el of $$("[data-m]")) swapText(el, (t ? el.dataset.t : el.dataset.m) ?? "");
  for (const a of $$<HTMLAnchorElement>("[data-hm]")) a.href = (t ? a.dataset.ht : a.dataset.hm) ?? a.href;
  for (const el of $$("[data-to-m]")) {
    const to = (t ? el.dataset.toT : el.dataset.toM) ?? "0";
    el.dataset.to = to;
    if (first || !el.dataset.counted) el.textContent = fmt(Number(to));
    else recount(el);
  }
  if (!first) setSelectedChainId(CHAIN[n]);
}

/// Live counts for both chains in one indexer call. Silent on failure: the baked values stay.
async function refresh() {
  try {
    const res = await fetch(INDEXER_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { kimi: KIMI_MODEL } }),
    });
    if (!res.ok) return;
    const json = (await res.json()) as { data?: { m: { count: number }[]; t: { count: number }[]; gm: { hostKey: string }[]; gt: unknown[] } };
    const d = json.data;
    if (!d) return;
    const values: Record<string, [number, number]> = {
      receipts: [d.m.reduce((s, a) => s + a.count, 0), d.t.reduce((s, a) => s + a.count, 0)],
      anchors: [d.m.length, d.t.length],
      grades: [new Set(d.gm.map((x) => x.hostKey)).size, d.gt.length],
    };
    for (const el of $$("[data-live]")) {
      const v = values[el.dataset.live ?? ""];
      if (!v || !v[0]) continue;
      el.dataset.toM = String(v[0]);
      el.dataset.toT = String(v[1]);
    }
    apply(net, true);
  } catch {
    // Offline or blocked: keep the numbers from 11 Oct.
  }
}

export function initNet(countUp: (el: HTMLElement) => void): void {
  recount = countUp;
  for (const group of $$("[data-net-switch]")) {
    group.addEventListener("click", (e) => {
      const b = (e.target as Element).closest<HTMLElement>("[role='radio']");
      if (b?.dataset.net) apply(b.dataset.net as Net);
    });
    group.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
      e.preventDefault();
      const n: Net = net === "mainnet" ? "testnet" : "mainnet";
      apply(n);
      $<HTMLElement>(`[data-net='${n}']`, group)?.focus();
    });
  }
  apply(net, true);
  const replace = () => $$("[data-net-switch]").forEach(place);
  addEventListener("resize", replace);
  void document.fonts?.ready.then(replace);
  $("#nav-menu")?.addEventListener("click", () => setTimeout(replace, 30));
  void refresh();
}
