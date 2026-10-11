// The receipt as a paper till slip, the same object the landing page prints.
// One component for the receipt page header and the Verify preview, so the two always match.
// Everything on it is text from the receipt itself: the host's signed body, plus what the
// page learned about the batch (root, tx) and the co-signature. A stamp lights only when earned.
// With no receipt yet (Verify, empty form) it is a ghost slip that says what will appear.

import type { ReceiptBody } from "@assay/receipts";
import { h } from "../dom.js";
import { CHAINS, chainOfAgentId } from "../lib/config.js";

export interface PaperState {
  hash?: string;
  body?: ReceiptBody;
  /// undefined while the page is still checking.
  anchored?: boolean;
  cosigned?: boolean;
  root?: string;
  tx?: string;
  /// Stamps already shown once on this page: draw them without the punch.
  settled?: boolean;
}

const NS = "http://www.w3.org/2000/svg";
const OCT = "29,4 71,4 96,29 96,71 71,96 29,96 4,71 4,29";
const RING = "32,14 68,14 86,32 86,68 68,86 32,86 14,68 14,32";
const MARK_A =
  "M42.52 98.0V92.64L50.84 92.0H52.52L60.28 92.64V98.0ZM46.36 98.0 64.6 45.6H75.96L94.44 98.0H78.6L64.76 54.96H65.08L63.48 63.2L52.44 98.0ZM55.24 83.52V78.24H80.84V83.52ZM70.6 98.0V92.72L79.96 92.16H87.4L97.48 92.72V98.0Z";

const svg = (tag: string, attrs: Record<string, string>, text?: string) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text) el.textContent = text;
  return el;
};

const short = (hex: string | undefined, a = 6, b = 4) => (!hex ? "" : hex.length > a + b + 1 ? `${hex.slice(0, a)}…${hex.slice(-b)}` : hex);

function mark(): SVGSVGElement {
  const s = svg("svg", { viewBox: "6 6 128 148", "aria-hidden": "true", class: "rp-mark" }) as SVGSVGElement;
  s.append(
    svg("polygon", { fill: "none", stroke: "currentColor", "stroke-width": "8", points: "38,14 102,14 126,38 126,122 102,146 38,146 14,122 14,38" }),
    svg("polygon", { fill: "none", stroke: "currentColor", "stroke-width": "2.6", points: "42,24 98,24 116,42 116,118 98,136 42,136 24,118 24,42" }),
    svg("path", { fill: "currentColor", d: MARK_A }),
  );
  return s;
}

function stamp(kind: "host" | "model" | "anchor" | "you", word: string, sub: string, lit: boolean, label: string): HTMLElement {
  const s = svg("svg", { viewBox: "0 0 100 100", role: "img", "aria-label": label });
  s.append(
    svg("polygon", { class: "rp-sf", points: OCT }),
    svg("polygon", { class: "rp-sr", points: RING }),
    svg("text", { class: "rp-t1", x: "50", y: "50", style: `font-size:${word.length > 5 ? 12.5 : word.length > 4 ? 14 : 17}px` }, word),
    svg("text", { class: "rp-t2", x: "50", y: "66" }, sub.length > 9 ? `${sub.slice(0, 8)}…` : sub),
  );
  return h("span", { class: `rp-stamp rp-${kind}${lit ? " on" : ""}` }, s as unknown as HTMLElement);
}

function barcode(hash: string): SVGSVGElement {
  const s = svg("svg", { viewBox: "0 0 300 40", preserveAspectRatio: "none", "aria-hidden": "true" }) as SVGSVGElement;
  const ns = [...hash.replace(/^0x/, "")].map((c) => parseInt(c, 16)).filter((n) => !Number.isNaN(n));
  const total = ns.reduce((acc, n) => acc + (n & 3) + 1 + ((n >> 2) & 1) + 1, 0) || 1;
  const k = 300 / total;
  let x = 0;
  for (const n of ns) {
    const w = ((n & 3) + 1) * k;
    s.append(svg("rect", { x: x.toFixed(2), y: "0", width: w.toFixed(2), height: "40" }));
    x += w + (((n >> 2) & 1) + 1) * k;
  }
  return s;
}

const row = (key: string, value: string, line?: string, sub?: string) =>
  h("div", line ? { "data-line": line } : {}, h("dt", {}, key), h("dd", {}, value, sub ? h("small", {}, sub) : ""));

export function receiptPaper(st: PaperState): HTMLElement {
  const b = st.body;
  const ghost = !b;
  const dash = "· · ·";
  const chainId = b ? chainOfAgentId(b.host.agentId) : undefined;
  const chain = chainId !== undefined ? CHAINS[chainId] : undefined;
  const agent = b ? (b.host.agentId.split(":").pop() ?? "") : "";
  const when = b ? new Date(b.t).toISOString().replace("T", " ").slice(0, 19) + " UTC" : dash;
  const params = (b?.req.params ?? {}) as Record<string, unknown>;
  const maxTokens = typeof params.max_tokens === "number" ? String(params.max_tokens) : undefined;
  const cosign = !b ? dash : st.cosigned ? "co-signed" : b.req.cosigner ? "named, not yet" : "not co-signed";

  const head = h(
    "div",
    { class: "rp-head" },
    mark() as unknown as HTMLElement,
    h("span", { class: "rp-title" }, "ASSAY RECEIPT"),
    h("span", { class: "rp-no" }, st.hash ? `No. ${short(st.hash)}` : "No. 0x····…····"),
    h("span", {}, chain ? `${chain.name}, chain ${chainId}` : b ? `chain ${chainId ?? "unknown"}` : "Monad"),
    h("span", {}, when),
  );
  const stamps = h(
    "div",
    { class: `rp-stamps${st.settled ? " settled" : ""}` },
    stamp("host", "HOST", agent || "host", !ghost, ghost ? "Host stamp, empty" : `Host stamp: agent ${agent} signed this`),
    stamp("model", "MODEL", "claimed", !ghost, ghost ? "Model stamp, empty" : `Model stamp: claims ${b.model}`),
    stamp("anchor", "ANCHOR", st.anchored ? "monad" : "waiting", !!st.anchored, st.anchored ? "Anchor stamp: anchored on Monad" : "Anchor stamp: not anchored yet"),
    stamp("you", "YOU", st.cosigned ? "co-signed" : "not yet", !!st.cosigned, st.cosigned ? "Your stamp: the requester co-signed" : "Your stamp, empty: not co-signed"),
  );
  const rows1 = h(
    "dl",
    { class: "rp-rows" },
    row("MODEL", b?.model ?? dash, "model"),
    row("HOST", b?.host.agentId ?? dash, "host"),
    row("SIGNED", b ? `${b.host.alg}, key ${short(b.host.keyId, 4, 3)}` : dash, "host"),
    row("PROMPT", b ? short(b.req.commit) : dash, undefined, "sha256(salt ‖ prompt)"),
    row("ANSWER", b ? short(b.res.commit) : dash, undefined, "sha256(salt ‖ output)"),
    row("TOKENS", b ? `in ${b.res.tokensIn}, out ${b.res.tokensOut}, ${b.res.finish}` : dash),
    ...(maxTokens ? [row("MAX TOKENS", maxTokens)] : []),
  );
  const rows2 = h(
    "dl",
    { class: "rp-rows" },
    row("BATCH ROOT", st.root ? short(st.root) : ghost ? dash : "waiting", "anchor"),
    row("ANCHORED", st.anchored ? "yes" : st.anchored === false ? "not yet" : ghost ? dash : "checking", "anchor"),
    ...(st.tx ? [row("TX", short(st.tx), "anchor")] : []),
    row("CO-SIGNED", cosign, "you"),
  );
  const bar = st.hash
    ? h("a", { class: "rp-bar", href: `#r/${st.hash}`, "aria-label": "Open this receipt's page" }, barcode(st.hash) as unknown as HTMLElement, h("span", {}, short(st.hash, 10, 8)))
    : h("div", { class: "rp-bar" }, barcode("0".repeat(64)) as unknown as HTMLElement, h("span", {}, "0x··········…········"));
  return h(
    "figure",
    { class: `rp${ghost ? " rp-ghost" : ""}`, "aria-label": ghost ? "Receipt preview, empty" : `Receipt ${short(st.hash)}` },
    head,
    stamps,
    h("hr", { class: "rp-rule" }),
    rows1,
    h("hr", { class: "rp-rule" }),
    rows2,
    h("hr", { class: "rp-rule rp-rule-2" }),
    bar,
    h(
      "div",
      { class: "rp-terms" },
      h("b", {}, "TERMS"),
      h("p", {}, "This receipt proves which host served these bytes and what it claimed. It does not prove which weights ran. The prompt and answer never go onchain. Only salted hashes do."),
    ),
    h("p", { class: "rp-foot" }, h("b", {}, "KEEP YOUR SALT")),
    ghost ? h("figcaption", { class: "rp-empty" }, "Paste a receipt to see it here") : "",
  );
}
