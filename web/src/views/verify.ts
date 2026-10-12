import { receiptHash, verifyReceipt, type Checks, type Reproduce, type VerifyInput, type VerifyResult } from "@assay/receipts";
import { copyButton, errorText, field, h, input, liveRegion, mono, section, shortHash, textarea } from "../dom.js";
import { CHAIN_ID, DEFAULT_HOST, DEFAULT_RPC, RECEIPT_ANCHOR, chainConfig } from "../lib/config.js";
import { chainClient } from "../lib/chain.js";
import { fetchJwks, fetchReceiptStatus } from "../lib/host.js";
import { myReceipts, parseBundle, parseReceipt, parseSalt, takeVerifyPrefill, type VerifyPrefill } from "../lib/receipt.js";
import type { Address } from "viem";
import { receiptPaper, type PaperState } from "../ui/receipt-paper.js";
import { stepLoader } from "../ui/step-loader.js";

/// Order shown on the page, with what a pass means and what a skip is waiting for.
export const CHECKS: { key: keyof Checks; name: string; means: string; skipped: string }[] = [
  { key: "jws", name: "Host signature", means: "The host's signature verifies against the keys it publishes at /.well-known/jwks.json.", skipped: "" },
  { key: "hash", name: "Body unchanged", means: "The receipt you hold is byte for byte the one the host signed.", skipped: "Needs a valid host signature first." },
  { key: "kid", name: "Signing key", means: "The key that signed is the one the receipt names in host.keyId.", skipped: "Needs a valid host signature first." },
  { key: "merkle", name: "In the batch", means: "The Merkle proof places this receipt in the batch the host anchored.", skipped: "Needs the proof and root from the host. The receipt may not be anchored yet." },
  { key: "anchored", name: "Anchored onchain", means: "ReceiptAnchor holds the batch root under the host's ERC-8004 agent id.", skipped: "Needs the batch root and a chain RPC." },
  { key: "outputCommit", name: "Output matches", means: "Your salt and output text reproduce the output commit, so this is exactly the text the host served.", skipped: "Paste the salt and the output text to run it." },
  { key: "promptCommit", name: "Prompt matches", means: "Your salt and messages reproduce the prompt commit, so this receipt answers that prompt.", skipped: "Paste the salt and the messages JSON to run it." },
  { key: "cosigned", name: "Requester co-signed", means: "The key named in req.cosigner co-signed this receipt onchain: a passkey (cosign) or a per-app address (cosignK).", skipped: "The receipt names no co-signer, or no chain RPC was given." },
];

export function formatReproduce(r: Reproduce, rpc: string): string {
  switch (r.kind) {
    case "jws":
      return `Verify the compact JWS with ${r.alg} using JWKS key "${r.kid}"; the payload must equal ${r.payload}.`;
    case "compute":
      return `${r.what}\ninputs: ${JSON.stringify(r.inputs)}\nexpect: ${r.expect}`;
    case "contract-call":
      return `cast call ${r.address} "${r.function}" ${r.args.join(" ")} --rpc-url ${rpc}\n# expect ${r.expect}`;
  }
}

const LABEL = { pass: "Pass", fail: "Fail", skipped: "Skipped" } as const;

/// A named co-signer who hasn't co-signed yet is the requester's step still to take, not a fault in the receipt.
export const notYetCosigned = (r: VerifyResult) => r.checks.cosigned === "fail";
export const NOT_YET_COSIGNED = "The receipt names a co-signer, but that key hasn't co-signed onchain yet. Co-signing is the requester's step, after the batch is anchored.";
/// The verdict: every check except a co-signature still to come.
export const noFault = (r: VerifyResult) => (Object.keys(r.checks) as (keyof Checks)[]).every((k) => r.checks[k] !== "fail" || k === "cosigned");

/// Receipts asked for in this browser, so a receipt is never lost after leaving Ask.
export function myReceiptsCard(): HTMLElement | null {
  const mine = myReceipts();
  if (!mine.length) return null;
  return h(
    "section",
    { class: "card my-receipts", "aria-labelledby": "mine-title" },
    h("div", { class: "card-head" }, h("h2", { id: "mine-title" }, "Your receipts"), h("span", { class: "hint" }, "Asked in this browser")),
    h(
      "ul",
      { class: "entries" },
      ...mine.map((r) => h("li", {}, h("a", { href: `#r/${r.hash}` }, shortHash(r.hash)), h("span", { class: "hint" }, ` ${r.model} · ${chainConfig(r.chainId).name} · ${new Date(r.t).toLocaleString()}`))),
    ),
    h("p", { class: "hint" }, "Only the hashes are kept here. The salts stay in your vault or in the bundles you downloaded."),
  );
}

export function renderResult(result: VerifyResult, opts: { rpc: string; notes?: string[] }): HTMLElement {
  const ok = noFault(result);
  const verdict = ok ? "No check failed." : "At least one check failed. Do not rely on this receipt.";
  const out = h(
    "div",
    { class: "result" },
    h("p", { class: `verdict ${ok ? "ok" : "bad"}` }, verdict),
    h("p", {}, "Receipt hash ", mono(result.receiptHash), " ", copyButton(result.receiptHash, "Copy receipt hash", { iconOnly: true }), " ", h("a", { href: `#r/${result.receiptHash}` }, "Open its receipt page")),
  );
  for (const note of opts.notes ?? []) out.append(h("p", { class: "hint" }, note));
  const list = h("ul", { class: "checks" });
  for (const c of CHECKS) {
    const raw = result.checks[c.key];
    const waiting = c.key === "cosigned" && notYetCosigned(result);
    const state = waiting ? "skipped" : raw;
    const repro = result.reproduce[c.key];
    const li = h(
      "li",
      { class: `check ${state}`, "data-check": c.key },
      h("div", { class: "check-head" }, h("span", { class: `badge ${state}` }, waiting ? "Not yet" : LABEL[state]), h("strong", {}, c.name)),
      h("p", {}, waiting ? NOT_YET_COSIGNED : state === "skipped" ? c.skipped : c.means),
    );
    if (repro) {
      const line = formatReproduce(repro, opts.rpc);
      li.append(h("div", { class: "repro" }, h("pre", {}, line), copyButton(line, "Copy reproduce line")));
    }
    list.append(li);
  }
  out.append(list);
  return out;
}

export function mountVerify(root: HTMLElement) {
  const receipt = field("Receipt", textarea({ rows: "5", placeholder: "X-Assay-Receipt header value, or JSON {body, jws}" }), "Base64url header or JSON. Nothing you paste leaves this page except the receipt hash, sent to the host to fetch the proof.");
  const salt = field("Salt (optional)", input("", { placeholder: "64 hex characters" }), "Only the person who asked has it: Ask shows it once, and it's in the bundle you downloaded and in your vault. Needed to open the commits.");
  const output = field("Output text (optional)", textarea({ rows: "3" }), "The assistant message exactly as received, whitespace included.");
  const messages = field("Messages JSON (optional)", textarea({ rows: "3", placeholder: '[{"role":"user","content":"..."}]' }));
  const host = field("Host base URL", input(DEFAULT_HOST), "Used for /.well-known/jwks.json and /v1/receipts/:hash.");
  const rpc = field("RPC URL", input(DEFAULT_RPC));
  const anchor = field("ReceiptAnchor", input(RECEIPT_ANCHOR));
  const status = liveRegion();
  const results = h("div");
  // The receipt as paper, beside the form: a ghost slip until something parses, then the real one.
  const preview = h("aside", { class: "verify-preview", "aria-live": "polite" }, receiptPaper({}));
  let shown: PaperState = {};
  const show = (st: PaperState) => {
    shown = st;
    preview.replaceChildren(receiptPaper(st));
  };
  const previewFromInput = () => {
    try {
      const held = parseReceipt(receipt.input.value);
      const hash = receiptHash(held.body);
      if (hash !== shown.hash) show({ hash, body: held.body });
    } catch {
      if (shown.body) show({});
    }
  };
  let previewTimer = 0;
  receipt.input.addEventListener("input", () => {
    clearTimeout(previewTimer);
    previewTimer = window.setTimeout(previewFromInput, 150);
  });
  const fill = (p: VerifyPrefill) => {
    receipt.input.value = p.receipt;
    if (p.salt) salt.input.value = p.salt;
    if (p.output !== undefined) output.input.value = p.output;
    if (p.messages !== undefined) messages.input.value = JSON.stringify(p.messages);
    previewFromInput();
  };
  const bundle = field("Bundle file (optional)", h("input", { type: "file", accept: "application/json,.json" }) as HTMLInputElement, "The bundle from Ask or a receipt page fills every field. It's read here and never uploaded.");
  bundle.input.addEventListener("change", async () => {
    const file = bundle.input.files?.[0];
    if (!file) return;
    try {
      const b = parseBundle(await file.text());
      fill({ receipt: JSON.stringify({ body: b.body, jws: b.jws }), ...b });
      status.say(b.salt ? "Bundle loaded with its salt. Press Verify receipt." : "Bundle loaded. It has no salt, so the prompt and output checks will be skipped.", "ok");
    } catch (e) {
      status.say(`That file isn't a receipt bundle (${errorText(e)}).`, "error");
    }
  });
  // The bundle row doubles as a drop zone: drop a .json bundle anywhere on it.
  bundle.row.classList.add("dropzone");
  bundle.row.addEventListener("dragover", (e) => {
    e.preventDefault();
    bundle.row.classList.add("drag");
  });
  bundle.row.addEventListener("dragleave", () => bundle.row.classList.remove("drag"));
  bundle.row.addEventListener("drop", (e) => {
    e.preventDefault();
    bundle.row.classList.remove("drag");
    if (!e.dataTransfer?.files.length) return;
    bundle.input.files = e.dataTransfer.files;
    bundle.input.dispatchEvent(new Event("change"));
  });
  const form = h(
    "form",
    { class: "card" },
    bundle.row,
    receipt.row,
    salt.row,
    output.row,
    messages.row,
    h("details", {}, h("summary", {}, "Host and chain settings"), host.row, rpc.row, anchor.row),
    h("button", { type: "submit" }, "Verify receipt"),
    status.el,
  );

  const grid = h("div", { class: "verify-grid" }, h("div", { class: "verify-main" }, form, results), preview);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    results.replaceChildren();
    grid.querySelector(".sl")?.remove();
    // Each step lights when the code reaches it, not on a timer.
    const steps = stepLoader("Checking the receipt", ["Reading the receipt", "Fetching the host's keys", "Fetching the batch proof", "Checking signatures and the chain"]);
    grid.append(steps.el);
    try {
      const held = parseReceipt(receipt.input.value);
      const input: VerifyInput = { body: held.body, jws: held.jws, jwks: { keys: [] } };
      if (salt.input.value.trim()) input.salt = parseSalt(salt.input.value);
      // Never trim the output: one changed byte changes the commit.
      if (output.input.value !== "") input.output = output.input.value;
      if (messages.input.value.trim()) {
        try {
          input.messages = JSON.parse(messages.input.value);
        } catch {
          throw new Error("Messages must be valid JSON.");
        }
      }
      const notes: string[] = [];
      status.say("Fetching keys and proof from the host…");
      steps.go(1);
      try {
        input.jwks = await fetchJwks(host.input.value);
      } catch (e) {
        notes.push(`Could not fetch the host's JWKS (${errorText(e)}), so the signature check fails.`);
      }
      steps.go(2);
      try {
        const st = await fetchReceiptStatus(host.input.value, receiptHash(held.body));
        if (st.status === "anchored") Object.assign(input, { proof: st.proof, root: st.root });
        else notes.push("The host has not anchored this receipt yet. Try again after the next batch.");
      } catch (e) {
        notes.push(`Could not fetch the proof (${errorText(e)}).`);
      }
      if (rpc.input.value.trim()) input.onchain = { client: chainClient(rpc.input.value), anchor: anchor.input.value.trim() as Address };
      status.say("Checking…");
      steps.go(3);
      const result = await verifyReceipt(input);
      await steps.finish(true);
      show({ hash: result.receiptHash, body: held.body, anchored: result.checks.anchored === "pass", cosigned: result.checks.cosigned === "pass", root: input.root });
      results.append(renderResult(result, { rpc: rpc.input.value.trim(), notes }));
      status.say(noFault(result) ? "Done. No check failed." : "Done. At least one check failed.", noFault(result) ? "ok" : "error");
    } catch (e) {
      void steps.finish(false);
      status.say(errorText(e), "error");
    }
  });

  // Nobody arrives holding a receipt, so offer a real one first.
  const sample = chainConfig(CHAIN_ID);
  const live = h(
    "div",
    { class: "banner banner-sky live-sample", role: "note" },
    h("p", {}, `No receipt to hand? Open a real one, anchored on ${sample.name}, and see every check run in your browser.`),
    h("a", { class: "btn btn-primary btn-sm", href: `#r/${sample.sampleReceipt}` }, "Open a live receipt"),
  );
  root.append(
    section(
      "Verify a receipt",
      "Check a receipt yourself: the host's signature, the onchain anchor, and, if you kept the salt, that the output and prompt match.",
      live,
      myReceiptsCard() ?? "",
      grid,
    ),
  );
  // Arriving from a receipt page: fill the form and wait for the reader to press Verify, so the
  // checks run on their click, not on page load.
  const pre = takeVerifyPrefill();
  if (pre) {
    fill(pre);
    form.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus();
  }
}
