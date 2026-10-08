import { hostKeyForAgent } from "@assay/receipts";
import { badge, chip, emptyState, errorText, h, kv, shortHash } from "../dom.js";
import { CHAIN_ID, CHAINS, EXTRA_HOSTS, chainConfig } from "../lib/config.js";
import { fetchBatch } from "../lib/host.js";
import { hostProfile, type HostProfile } from "../lib/indexer.js";
import type { Hex } from "viem";
import type { Route } from "../router.js";
import { showPageChain } from "../ui/network-switch.js";

const DAYS = 14;
const link = (label: string, href: string) => h("a", { href, ...(href.startsWith("http") ? { target: "_blank", rel: "noopener" } : {}) }, label);
const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
const card = (title: string, aside: string | Node | null, ...body: (Node | null)[]) =>
  h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, title), typeof aside === "string" ? h("span", { class: "hint" }, aside) : aside), ...body);

export function tile(label: string, value: number | string, tone: string, sub?: string) {
  return h("div", { class: `tile ${tone}` }, h("p", { class: "tile-label" }, label), h("p", { class: "tile-value" }, String(value)), sub ? h("p", { class: "hint" }, sub) : null);
}

/// A batch root that opens into its receipts, asked from the network's host only when opened.
export function batchReceipts(root: Hex, chainId: number, load = fetchBatch): HTMLElement {
  const list = h("div", { class: "batch-receipts" }, h("p", { class: "hint" }, "Loading…"));
  const d = h("details", {}, h("summary", { "aria-label": `Batch ${root}: show its receipts` }, shortHash(root)), list);
  let asked = false;
  d.addEventListener("toggle", async () => {
    if (!d.open || asked) return;
    asked = true;
    try {
      const b = await load(chainConfig(chainId).host, root);
      list.replaceChildren(h("ul", { class: "entries" }, ...b.receipts.map((r) => h("li", {}, h("a", { href: `#r/${r}` }, shortHash(r))))));
    } catch (e) {
      asked = false;
      list.replaceChildren(h("p", { class: "hint" }, `The host couldn't list this batch (${errorText(e)}). The chain only holds its root.`));
    }
  });
  return d;
}

/// The last 14 UTC days, oldest first. Days with no activity are zero, never missing.
export function lastDays(activity: HostProfile["activity"], today = new Date()): HostProfile["activity"] {
  const byDay = new Map(activity.map((a) => [a.day, a]));
  const out: HostProfile["activity"] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i)).toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? { day, anchors: 0, receipts: 0, cosigns: 0 });
  }
  return out;
}

function activityChart(activity: HostProfile["activity"]) {
  const days = lastDays(activity);
  const max = Math.max(1, ...days.flatMap((d) => [d.anchors, d.receipts, d.cosigns]));
  const bar = (n: number, kind: string) => h("span", { class: `bar ${kind}`, style: `height:${Math.round((n / max) * 100)}%` });
  const list = h("ol", { class: "bars" });
  for (const d of days) {
    const text = `${d.day}: ${d.anchors} batches, ${d.receipts} receipts, ${d.cosigns} co-signs`;
    list.append(h("li", { title: text }, h("span", { class: "sr-only" }, text), bar(d.anchors, "k-violet"), bar(d.receipts, "k-gold"), bar(d.cosigns, "k-pink")));
  }
  return list;
}

export function table(head: string[], rows: (Node | string)[][]) {
  return h(
    "div",
    { class: "table-wrap" },
    h("table", {}, h("thead", {}, h("tr", {}, ...head.map((c) => h("th", { scope: "col" }, c)))), h("tbody", {}, ...rows.map((r) => h("tr", {}, ...r.map((c) => h("td", {}, c)))))),
  );
}

export function renderHost(p: HostProfile, chainId: number = CHAIN_ID): HTMLElement {
  const { explorer: EXPLORER, name: network } = chainConfig(chainId);
  const a = p.agent;
  const id = a.agentId;
  // Our own hosts are named in config, for when the indexer couldn't load their card yet.
  const name = a.name ?? EXTRA_HOSTS.find((x) => x.chainId === chainId && String(x.agentId) === String(id))?.name ?? `Agent ${id}`;
  const card8004 = a.cardStatus === "OK" ? chip("Agent card OK", "lime", { dot: true }) : chip(`Agent card ${(a.cardStatus ?? "missing").toLowerCase()}`, "muted");
  const head = h(
    "header",
    { class: "host-head" },
    h("nav", { class: "crumbs", "aria-label": "Breadcrumb" }, link("Hosts", "#hosts"), " / ", `Agent ${id}`),
    h(
      "div",
      { class: "host-title" },
      h("span", { class: "host-badge", "aria-hidden": "true" }, id),
      h("div", {}, h("div", { class: "row" }, chip("Assay host", "gold"), card8004), h("h1", { id: "page-title" }, name), a.description ? h("p", { class: "lede" }, a.description) : null),
      h("div", { class: "row" }, h("a", { class: "btn btn-primary", href: `#grades?host=erc8004:${chainId}:${id}` }, "See grades"), a.agentURI ? h("a", { class: "btn btn-secondary", href: a.agentURI, target: "_blank", rel: "noopener" }, "Agent card") : null),
    ),
  );

  const tiles = h(
    "div",
    { class: "tiles" },
    tile("Batches anchored", a.anchorCount, "k-violet"),
    tile("Receipts anchored", a.receiptCount, "k-gold"),
    tile("Co-signatures", a.cosignCount, "k-pink"),
    tile("Signing keys", a.keyCount, "k-bone"),
  );

  const batches = p.anchors.length
    ? table(
        ["Root", "Receipts", "Co-signs", "Signed by key", "Block"],
        p.anchors.map((x) => [batchReceipts(x.root as Hex, chainId), String(x.count), String(x.cosignCount), shortHash(x.hostKey.keyHash), link(String(x.block), `${EXPLORER}/tx/${x.txHash}`)]),
      )
    : h("p", { class: "hint" }, "No batches anchored yet.");

  const grades = p.grades.length
    ? table(
        ["Model", "Verifier", "Passed", "95% interval"],
        p.grades.map((g) => [shortHash(g.model), shortHash(g.verifier.address), `${g.passed} of ${g.total}`, `${pct(g.ciLowBps)} to ${pct(g.ciHighBps)}`]),
      )
    : emptyState({ title: "No grade yet", text: `No verifier has graded erc8004:${chainId}:${id} yet. Receipts from this host stay at Level 0 until one does.`, tone: "lime" });

  const identity = kv([
    ["Agent", `erc8004:${chainId}:${id}`],
    ["Network", network],
    ["Owner", a.owner ? link(`${a.owner.slice(0, 6)}…${a.owner.slice(-4)}`, `${EXPLORER}/address/${a.owner}`) : "unknown"],
    ["Registered", a.registeredBlock ? `block ${a.registeredBlock}` : "unknown"],
    ["Current key", a.currentKey?.keyHash ?? "none"],
  ]);

  const txOf = new Map(p.rotations.map((r) => [r.toKey.keyHash, r.txHash]));
  const history = h("ol", { class: "timeline" });
  for (const k of p.keys) {
    const tx = txOf.get(k.keyHash);
    history.append(
      h(
        "li",
        { class: k.active ? "active" : "" },
        h("div", { class: "row" }, h("strong", {}, "Key set"), k.active ? badge("pass", "Active") : badge("skipped", `Retired at ${k.retiredBlock}`)),
        h("p", {}, shortHash(k.keyHash), ` · block ${k.setBlock} · ${k.anchorCount} batch${k.anchorCount === 1 ? "" : "es"}`),
        tx ? link(`tx ${tx.slice(0, 10)}…`, `${EXPLORER}/tx/${tx}`) : null,
      ),
    );
  }

  const services = a.services?.length
    ? h("ul", { class: "endpoints" }, ...a.services.map((s) => h("li", {}, h("code", { class: "mono" }, s.name), link(s.endpoint, s.endpoint))))
    : h("p", { class: "hint" }, "The agent card lists no endpoints.");

  return h(
    "section",
    { class: "page host", "aria-labelledby": "page-title" },
    head,
    tiles,
    h(
      "div",
      { class: "receipt-grid" },
      h(
        "div",
        { class: "col" },
        card("Activity, last 14 days", h("div", { class: "row legend" }, chip("Batches", "violet"), chip("Receipts", "gold"), chip("Co-signs", "pink")), activityChart(p.activity), h("p", { class: "hint" }, "One group per UTC day, from HostActivity in the Envio indexer.")),
        h("div", { class: "host-batches" }, card("Batches", "Newest first", batches, h("p", { class: "hint" }, "Open a root to see its receipts. Onchain, a batch is only a root and a count."))),
        card("Grades by model", link("Open in Grades", `#grades?host=erc8004:${chainId}:${id}`), grades),
      ),
      h(
        "div",
        { class: "col" },
        card("Identity", null, identity),
        card("Key history", "From HostKey and KeyRotation", history, h("p", { class: "hint" }, "A new key never voids older batches.")),
        card("Endpoints", "From the agent card", services),
      ),
    ),
    h("p", { class: "hint source" }, "Everything on this page comes from one query to the Envio indexer."),
  );
}

export function mountHost(root: HTMLElement, route: Route, load: typeof hostProfile = hostProfile) {
  const agentId = BigInt(route.path[1]);
  const chainId = Number(route.params.get("chain") ?? CHAIN_ID);
  if (!CHAINS[chainId]) {
    root.append(emptyState({ title: `This app doesn't know chain ${chainId}`, text: "Open the host profile without ?chain=, or with a chain Assay is deployed on.", tone: "muted", action: link("Hosts", "#hosts") }));
    return;
  }
  showPageChain(chainId);
  const box = (height: number) => h("div", { class: "skeleton-row", style: `height:${height}px` });
  // Same shape as the profile: title, four tiles, then two columns.
  const slot = h(
    "div",
    { "aria-busy": "true" },
    h(
      "div",
      { class: "skeleton skeleton-page", "aria-hidden": "true" },
      box(150),
      h("div", { class: "tiles" }, box(110), box(110), box(110), box(110)),
      h("div", { class: "receipt-grid" }, h("div", { class: "col" }, box(260), box(220), box(200)), h("div", { class: "col" }, box(220), box(200), box(160))),
    ),
  );
  root.append(slot);
  // An agent id belongs to one chain. Without ?chain=, try the selected network first, then the others.
  const order = route.params.get("chain") ? [chainId] : [chainId, ...Object.keys(CHAINS).map(Number).filter((c) => c !== chainId)];
  const find = async () => {
    for (const c of order) {
      const p = await load(agentId, hostKeyForAgent(c, agentId), undefined, undefined, c);
      if (p) return { p, c };
    }
    return { p: null, c: chainId };
  };
  find()
    .then(({ p, c }) => {
      slot.removeAttribute("aria-busy");
      // Found on another chain than the one picked: the switch says so, never the picked one.
      showPageChain(c);
      slot.replaceChildren(
        p ? renderHost(p, c) : emptyState({ title: `No agent ${agentId} on ${chainConfig(chainId).name}`, text: "The indexer has no ERC-8004 agent with that id. Check the number, or open the hosts list.", tone: "muted", action: link("Hosts", "#hosts") }),
      );
    })
    .catch((e) => {
      slot.replaceChildren(emptyState({ title: "The host profile needs the indexer, and it didn't answer.", text: errorText(e), tone: "coral", action: link("Open Grades", "#grades") }));
    });
}
