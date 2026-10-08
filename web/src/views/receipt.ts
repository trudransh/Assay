import {
  cosignerForAddress,
  gradeOf,
  gradeStatus,
  hostKeyForAgent,
  jcs,
  parseAgentId,
  verifyReceipt,
  type Checks,
  type Grade,
  type GradeStatus,
  type ReceiptBody,
  type VerifyInput,
  type VerifyResult,
} from "@assay/receipts";
import type { Address, Hex } from "viem";
import { badge, banner, button, chip, copyButton, emptyState, errorText, h, kv, levelLadder, shortHash, skeleton, stamp, toast } from "../dom.js";
import { chainClient } from "../lib/chain.js";
import { CHAIN_ID, CHAINS, DEFAULT_HOST, EXTRA_HOSTS, chainConfig, chainOfAgentId } from "../lib/config.js";
import { loadTrusted, modelKey } from "../lib/grades.js";
import { fetchJwks, fetchReceiptStatus, httpStatus, type ReceiptStatus } from "../lib/host.js";
import { anchorInfo, type AnchorInfo, type AnchorReader } from "../lib/indexer.js";
import { heldReceipt, setVerifyPrefill } from "../lib/receipt.js";
import type { Route } from "../router.js";
import { CHECKS, NOT_YET_COSIGNED, notYetCosigned } from "./verify.js";
import { ASSAY_VERIFIER } from "./grades.js";
import { decode } from "../ui/motion.js";
import { showPageChain } from "../ui/network-switch.js";

type Found = { grade: Grade; by: Address } | null;

/// Reads that depend on the receipt's chain: its RPC, its ReceiptAnchor and its VerifierRegistry.
export interface ChainDeps {
  client: AnchorReader;
  anchor(o: { agentId: bigint; root: Hex; receiptHash: Hex; anchorTx?: Hex }): Promise<AnchorInfo>;
  grade(model: Hex, hostKey: Hex, trusted: Address[]): Promise<Found>;
}

export interface ReceiptDeps {
  status(hash: Hex): Promise<ReceiptStatus>;
  jwks(): Promise<VerifyInput["jwks"]>;
  chain(chainId: number): ChainDeps;
}

function chainDeps(chainId: number): ChainDeps {
  const c = chainConfig(chainId);
  const client = chainClient(c.rpc) as unknown as AnchorReader;
  return {
    client,
    anchor: (o) => anchorInfo({ ...o, client, anchor: c.receiptAnchor, chainId }),
    grade: (model, hostKey, trusted) => gradeOf(client, c.verifierRegistry, model, hostKey, trusted),
  };
}

/// Asks each host in turn; a 404 means "not mine", so the next one gets a try. Keys come from the one that knew it.
function defaultDeps(hosts: string[]): ReceiptDeps {
  let found = hosts[0];
  return {
    async status(hash) {
      for (const [i, host] of hosts.entries()) {
        try {
          const st = await fetchReceiptStatus(host, hash);
          found = host;
          return st;
        } catch (e) {
          if (httpStatus(e) !== 404 || i === hosts.length - 1) throw e;
        }
      }
      throw new Error("no host to ask");
    },
    jwks: () => fetchJwks(found),
    chain: chainDeps,
  };
}

/// ?host= pins one host. Otherwise the selected network's host first, then the others.
const hostsFor = (route: Route) => {
  const pinned = route.params.get("host");
  if (pinned) return [pinned];
  const all = [DEFAULT_HOST, ...Object.values(CHAINS).map((c) => c.host), ...EXTRA_HOSTS.map((x) => x.host)];
  return [...new Set(all)];
};

const link = (label: string, href: string, cls = "") => h("a", { href, class: cls, ...(href.startsWith("http") ? { target: "_blank", rel: "noopener" } : {}) }, label);
const card = (title: string, aside: Node | string | null, ...body: (Node | null)[]) =>
  h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, title), typeof aside === "string" ? h("span", { class: "hint" }, aside) : aside), ...body);

/// Check states on this page: the salt checks can't run here, so they say why.
function checkLabel(key: keyof Checks, state: VerifyResult["checks"][keyof Checks]): string {
  if (state === "pass") return "Pass";
  if (state === "fail") return "Fail";
  if (key === "outputCommit" || key === "promptCommit") return "Needs salt";
  return key === "cosigned" ? "None" : "Skipped";
}

export function renderChecks(result: VerifyResult): HTMLElement {
  return h(
    "ul",
    { class: "checks compact" },
    ...CHECKS.map((c) => {
      if (c.key === "cosigned" && notYetCosigned(result)) return h("li", { class: "check skipped", "data-check": c.key, title: NOT_YET_COSIGNED }, h("strong", {}, c.name), badge("skipped", "Not yet"));
      const state = result.checks[c.key];
      return h("li", { class: `check ${state}`, "data-check": c.key }, h("strong", {}, c.name), badge(state, checkLabel(c.key, state)));
    }),
  );
}

function bodyCard(body: ReceiptBody): HTMLElement {
  const rows: [string, Node | string][] = [
    ["model", body.model],
    ["host.agentId", body.host.agentId],
    ["host.keyId", body.host.keyId],
    ["host.alg", body.host.alg],
    ["req.commit", body.req.commit],
    ["req.params", h("code", { class: "mono" }, JSON.stringify(body.req.params))],
    ["req.cosigner", body.req.cosigner ?? "none"],
    ["res.commit", body.res.commit],
    ["res.tokens", `${body.res.tokensIn} in · ${body.res.tokensOut} out · finish ${body.res.finish}`],
  ];
  if (body.price) rows.push(["price", `${body.price.amount} ${body.price.asset}`]);
  rows.push(["t", `${body.t} · ${new Date(body.t).toISOString()}`], ["nonce", h("code", { class: "mono" }, body.nonce)]);
  const list = kv(rows);
  list.classList.add("kv-mono");
  return card(
    "What the host signed",
    chip(body.v, "muted"),
    list,
    h("p", { class: "hint" }, "The prompt and output aren't here. Only their salted hashes are, and the person who asked holds the salt."),
  );
}

function cosignCard(body: ReceiptBody, info: AnchorInfo | null): HTMLElement {
  const aside = "From Cosigned events";
  if (!info?.cosigns) return card("Co-signatures", aside, h("p", { class: "hint" }, "The list of co-signatures comes from the indexer, which didn't answer. The Requester co-signed check reads the chain directly."));
  if (!info.cosigns.length) return card("Co-signatures", aside, h("p", { class: "hint" }, "Nobody has co-signed this receipt yet."));
  const list = h("ul", { class: "cosigns" });
  for (const c of info.cosigns) {
    const key = (c.kind === "K" ? cosignerForAddress(c.requester as Address) : c.requester).toLowerCase();
    const counts = key === body.req.cosigner?.toLowerCase();
    list.append(h("li", {}, shortHash(c.requester), chip(c.kind === "K" ? "secp256k1" : "P256", "muted"), counts ? chip("Counts: matches req.cosigner", "pink") : chip("Ignored", "muted")));
  }
  return card("Co-signatures", aside, list, h("p", { class: "hint" }, "Anyone can co-sign any receipt hash. Only the key the host signed into req.cosigner counts."));
}

function rawCard(body: ReceiptBody): HTMLElement {
  return h(
    "section",
    { class: "card" },
    h("div", { class: "card-head" }, h("h2", {}, "Raw receipt"), copyButton(jcs(body), "Copy JSON")),
    h("pre", { class: "raw" }, JSON.stringify(body, null, 2)),
    h("p", { class: "hint" }, "The host signs exactly the JCS bytes of this body. receiptHash = sha256(JCS(body))."),
  );
}

export function renderAnchorCard(info: AnchorInfo, root: Hex, cast?: string, chainId: number = CHAIN_ID): HTMLElement {
  const { explorer: EXPLORER, receiptAnchor: RECEIPT_ANCHOR, name } = chainConfig(chainId);
  const block = info.block !== undefined ? (info.txHash ? link(`${info.block}`, `${EXPLORER}/tx/${info.txHash}`) : String(info.block)) : "unknown";
  const key = info.keyHash ? h("span", { class: "kv-hash" }, shortHash(info.keyHash), info.source === "rpc" ? chip("Current key", "muted") : null) : "unknown";
  const rows: [string, Node | string][] = [
    ["Contract", link(`ReceiptAnchor ${RECEIPT_ANCHOR.slice(0, 7)}…${RECEIPT_ANCHOR.slice(-4)}`, `${EXPLORER}/address/${RECEIPT_ANCHOR}`)],
    ["Root", root],
    ["Batch size", `${info.count} receipt${info.count === 1 ? "" : "s"}`],
    ["Signed by key", key],
    ["Block", block],
  ];
  if (info.txHash) rows.push(["Tx", info.txHash]);
  const source =
    info.source === "indexer"
      ? "Batch details from the Envio indexer."
      : "The indexer didn't answer, so these come from the chain. The key shown is the host's current key, which may be newer than this batch.";
  return h(
    "section",
    { class: "card anchor-card" },
    h("div", { class: "card-head" }, h("h2", {}, "Anchor"), chip(`Anchored · ${name}`, "violet", { dot: true })),
    kv(rows),
    cast ? h("div", { class: "repro" }, h("pre", {}, cast), copyButton(cast, "Copy cast line")) : null,
    h("p", { class: "hint", "data-source": info.source }, source),
  );
}

function gradeCard(body: ReceiptBody, found: Found | undefined, status: GradeStatus, error?: string): HTMLElement {
  const agent = parseAgentId(body.host.agentId);
  const open = link("Open in Grades", `#grades?model=${encodeURIComponent(body.model)}&host=${encodeURIComponent(body.host.agentId)}`);
  if (found === undefined && !error) {
    const chainId = chainOfAgentId(body.host.agentId) ?? CHAIN_ID;
    const assay = `#grades?model=${encodeURIComponent(body.model)}&host=${encodeURIComponent(body.host.agentId)}&chain=${chainId}&v=${ASSAY_VERIFIER}`;
    return emptyState({ title: "No trusted verifiers saved", text: "Choose whose grades count. Assay runs the only verifier posting so far; the link below uses it, and you can change it there.", tone: "lime", action: link("See Assay's grade for this host", assay, "btn btn-secondary") });
  }
  const scope = `For ${body.model} on ${body.host.agentId}, from verifiers you trust. It grades the host, not this one response.`;
  if (error) return card("Host grade", badge("notchecked", "Not checked"), h("p", { class: "hint" }, `Couldn't read the grade (${error}).`));
  if (!found) return card("Host grade", badge("unknown", "unknown"), h("p", {}, "No grade yet. ", scope), open);
  const g = found.grade;
  const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
  return card("Host grade", badge(status, status), h("p", {}, scope), h("p", {}, `Passed ${g.passed} of ${g.total}, 95% interval ${pct(g.ciLowBps)} to ${pct(g.ciHighBps)}.`), open);
}

function head(hash: Hex, body: ReceiptBody | undefined, anchored: boolean | undefined, cosigned: boolean, actions: HTMLElement | null, settled = false): HTMLElement {
  const agent = body ? parseAgentId(body.host.agentId).toString() : undefined;
  const title = body ? `Served by agent ${agent}, claiming ${body.model}` : "Receipt";
  const hashEl = shortHash(hash);
  decode(hashEl);
  const lede = h("p", { class: "lede" }, "Receipt ", hashEl, " ", copyButton(hash, "Copy hash", { iconOnly: true }), " ", anchored === undefined ? "" : anchored ? "Anchored in a batch on Monad." : "Signed, not anchored yet.", cosigned ? " Co-signed by the requester." : "");
  const stamps = body
    ? h(
        "div",
        // A head rebuilt with new results shows its stamps settled: the punch-in plays once per page.
        { class: settled ? "stamps settled" : "stamps" },
        h("a", { href: `#hosts/${agent}?chain=${chainOfAgentId(body.host.agentId) ?? CHAIN_ID}`, class: "stamp-link", "aria-label": `Host agent ${agent}: open its profile` }, stamp("host", agent!, true, `Host mark: agent ${agent}`)),
        stamp("model", "claimed", true, `Model mark: claims ${body.model}`),
        stamp("anchor", anchored ? "monad" : "waiting", !!anchored, anchored ? "Anchor mark: anchored on Monad" : "Anchor mark: waiting for the batch"),
        stamp("you", "co-sign", cosigned, cosigned ? "Your mark: requester co-signed" : "Your mark: not co-signed"),
      )
    : null;
  return h(
    "header",
    { class: "receipt-head" },
    h("div", { class: "receipt-head-text" }, h("div", { class: "row" }, chip("Receipt", "gold")), h("h1", { id: "page-title" }, title), lede, actions),
    stamps,
  );
}

function actions(hash: Hex, held: { body: ReceiptBody; jws: string }, extra: Record<string, unknown>): HTMLElement {
  // This browser asked (or unlocked it from the vault): it holds the salt, so the commits open in one click.
  const opening = heldReceipt(hash);
  const verify = button(opening?.salt ? "Check with your salt" : "Verify with your salt", { variant: "primary" });
  verify.addEventListener("click", () => {
    const { salt, output, messages } = opening ?? {};
    setVerifyPrefill({ receipt: JSON.stringify({ body: held.body, jws: held.jws }), ...(salt ? { salt, output, messages } : {}) });
    location.hash = "#verify";
  });
  const copy = button("Copy link");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast("Link copied");
    } catch {
      copy.textContent = "Copy failed";
    }
  });
  const download = button("Download bundle");
  download.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ receiptHash: hash, ...held, ...extra }, null, 2)], { type: "application/json" }));
    h("a", { href: url, download: `assay-receipt-${hash.slice(2, 10)}.json` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });
  const where = opening?.salt
    ? "You asked this in this browser, so its salt is still in memory. Checking with it proves this output answered your prompt."
    : "The salt opens the prompt and output commits. Only the person who asked has it: in the bundle they downloaded or in their vault. Anyone else can still check the signature and the anchor.";
  return h("div", {}, h("div", { class: "row actions" }, verify, copy, download), h("p", { class: "hint salt-where" }, where));
}

const limits = () =>
  h("p", { class: "limits" }, "This receipt proves who served these bytes and what they claimed. It doesn't prove which weights ran.");

const box = (height: number) => h("div", { class: "skeleton-row", style: `height:${height}px` });

/// Same shape as the loaded page (ladder, then two columns), so nothing jumps when data arrives.
function receiptSkeleton(): HTMLElement {
  return h(
    "div",
    { class: "skeleton skeleton-page", "aria-hidden": "true" },
    h("div", { class: "ladder" }, box(132), box(132), box(132), box(132)),
    h("div", { class: "receipt-grid" }, h("div", { class: "col" }, box(440), box(110), box(320)), h("div", { class: "col" }, box(470), box(270), box(160))),
  );
}

export function mountReceipt(root: HTMLElement, route: Route, deps: ReceiptDeps = defaultDeps(hostsFor(route))) {
  const hash = route.path[1] as Hex;
  const page = h("section", { class: "page receipt", "aria-labelledby": "page-title" });
  root.append(page);

  const again = () => {
    const b = button("Check again", { size: "sm" });
    b.addEventListener("click", load);
    return b;
  };

  async function load() {
    page.replaceChildren(head(hash, undefined, undefined, false, null), receiptSkeleton());
    let st: ReceiptStatus;
    try {
      st = await deps.status(hash);
    } catch (e) {
      const code = httpStatus(e);
      page.replaceChildren(head(hash, undefined, undefined, false, null));
      if (code === 404 || code === 400) {
        page.append(emptyState({ title: "This host doesn't know that receipt", text: "It may come from another host, or the host's store was reset. Paste the receipt on Verify to check it against any host.", tone: "coral", action: link("Open Verify", "#verify", "btn btn-secondary") }));
      } else {
        page.append(banner("coral", `Couldn't reach the host (${errorText(e)}).`, again()));
      }
      return;
    }
    if (st.status === "pending") return pending();
    return anchored(st);
  }

  async function pending() {
    const held = heldReceipt(hash);
    page.replaceChildren(head(hash, held?.body, false, false, held ? actions(hash, held, {}) : null), levelLadder([false, false]), banner("sky", "Waiting for batch. The host anchors receipts in batches; this one isn't onchain yet.", again()));
    if (!held) return;
    const jwks = await deps.jwks().catch(() => ({ keys: [] }));
    const result = await verifyReceipt({ ...held, jwks });
    page.append(h("div", { class: "receipt-grid" }, h("div", { class: "col" }, bodyCard(held.body), rawCard(held.body)), h("div", { class: "col" }, card("Checks", "Run in your browser", renderChecks(result)), limits())));
  }

  async function anchored(st: Extract<ReceiptStatus, { status: "anchored" }>) {
    const { body, jws, root: batchRoot, proof, anchorTx } = st;
    const agentId = parseAgentId(body.host.agentId);
    const chainId = chainOfAgentId(body.host.agentId) ?? CHAIN_ID;
    if (!CHAINS[chainId]) {
      page.replaceChildren(head(hash, body, undefined, false, null), banner("coral", `This receipt was anchored on chain ${chainId}, which this app doesn't know yet, so it can't be checked here.`));
      return;
    }
    showPageChain(chainId);
    const chain = deps.chain(chainId);
    const acts = actions(hash, { body, jws }, { root: batchRoot, proof, anchorTx });

    // Show everything the host returned right away; each check fills in when its own read finishes.
    const headSlot = h("div", {}, head(hash, body, undefined, false, acts));
    const levels: [boolean, boolean] = [false, false];
    const ladder = h("div", {}, levelLadder(levels));
    const checksSlot = h("div", {}, card("Checks", "Run in your browser", skeleton(8, 44)));
    const anchorSlot = h("div", {}, skeleton(1, 260));
    const cosignSlot = h("div", {}, skeleton(1, 120));
    const gradeSlot = h("div", {}, skeleton(1, 160));
    page.replaceChildren(
      headSlot,
      h("div", { class: "ladder-head" }, h("h2", {}, "How far this receipt was checked"), h("span", { class: "hint" }, "Levels 2 and 3 are on the roadmap, not built")),
      ladder,
      h("div", { class: "receipt-grid" }, h("div", { class: "col" }, bodyCard(body), cosignSlot, rawCard(body)), h("div", { class: "col" }, checksSlot, anchorSlot, gradeSlot, limits())),
    );

    const checks = deps
      .jwks()
      .catch(() => ({ keys: [] }))
      .then((jwks) => verifyReceipt({ body, jws, jwks, proof, root: batchRoot, onchain: { client: chain.client, anchor: chainConfig(chainId).receiptAnchor } }))
      .then((result) => {
        levels[0] = result.checks.anchored === "pass";
        ladder.replaceChildren(levelLadder(levels));
        headSlot.replaceChildren(head(hash, body, levels[0], result.checks.cosigned === "pass", acts, true));
        checksSlot.replaceChildren(card("Checks", "Run in your browser", renderChecks(result)));
      })
      .catch((e) => checksSlot.replaceChildren(banner("coral", `Couldn't run the checks (${errorText(e)}).`, again())));

    const batch = chain
      .anchor({ agentId, root: batchRoot, receiptHash: hash, anchorTx })
      .catch(() => null)
      .then((info) => {
        anchorSlot.replaceChildren(info ? renderAnchorCard(info, batchRoot, st.reproduce?.cast, chainId) : banner("coral", "Couldn't read the batch from the indexer or the chain.", again()));
        cosignSlot.replaceChildren(cosignCard(body, info));
      });

    const grade = (async () => {
      const trusted = loadTrusted();
      if (!trusted.length) return gradeSlot.replaceChildren(gradeCard(body, undefined, "unknown"));
      try {
        const found = await chain.grade(modelKey(body.model), hostKeyForAgent(chainId, agentId), trusted);
        const status = gradeStatus(found?.grade, { now: BigInt(Math.floor(Date.now() / 1000)) });
        gradeSlot.replaceChildren(gradeCard(body, found, status));
        levels[1] = !!found && status !== "unknown";
        ladder.replaceChildren(levelLadder(levels));
      } catch (e) {
        gradeSlot.replaceChildren(gradeCard(body, null, "unknown", errorText(e)));
      }
    })();

    await Promise.all([checks, batch, grade]);
  }

  void load();
}
