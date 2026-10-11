import { cosignerForAddress, parseAgentId, receiptHash } from "@assay/receipts";
import { recoverMessageAddress, type Hex } from "viem";
import { copyButton, errorText, field, h, input, liveRegion, mono, section, shortHash, textarea } from "../dom.js";
import { chainClient } from "../lib/chain.js";
import { CHAIN_ID, chainConfig } from "../lib/config.js";
import { fetchReceiptStatus, sponsorCosignK, sponsorFeedback } from "../lib/host.js";
import { addToVault, createVaultPasskey, loadSealed, meraCredential, meraMessage, storeSealed, unlockVault, withPrf } from "../mera.js";
import { parseReceipt, parseSalt, rememberReceipt, toBase64url } from "../lib/receipt.js";
import {
  openDisclosure,
  requesterAddress,
  requesterLabel,
  revealKey,
  revealLabel,
  sealDisclosure,
  signReceiptHash,
  signSponsoredFeedback,
  type Disclosure,
  type Sealed,
  type VaultEntry,
} from "../lib/vault.js";

function passkeyCard() {
  const status = liveRegion();
  const info = h("p", { class: "hint" });
  const show = () => (info.textContent = meraCredential() ? "This browser remembers a vault passkey. Any synced copy of it works on other devices." : "No vault passkey remembered here. Create one, or unlock with an existing synced passkey.");
  show();
  const create = h("button", { type: "button", class: "secondary" }, "Create a vault passkey");
  create.addEventListener("click", async () => {
    try {
      status.say("Waiting for the passkey prompt…");
      await createVaultPasskey();
      show();
      status.say("Vault passkey created.", "ok");
    } catch (e) {
      status.say(meraMessage(e), "error");
    }
  });
  return h("div", { class: "card" }, h("h2", {}, "Passkey"), info, create, status.el);
}

function vaultCard() {
  // Plaintext lives only in this closure while unlocked; Lock and navigation drop it.
  let entries: VaultEntry[] | null = null;
  const status = liveRegion();
  const list = h("div");
  const share = h("div");

  const render = () => {
    share.replaceChildren();
    if (!entries) return list.replaceChildren(h("p", { class: "hint" }, loadSealed() ? "Locked. The ciphertext is in this browser." : "Empty. Save a receipt from Ask, add one below, or import a vault."));
    if (entries.length === 0) return list.replaceChildren(h("p", { class: "hint" }, "Unlocked, no receipts yet."));
    const ul = h("ul", { class: "entries" });
    for (const e of entries) {
      const btn = h("button", { type: "button", class: "secondary" }, "Share this receipt");
      btn.addEventListener("click", () => disclose(e));
      rememberReceipt(e.receiptHash, { body: e.body, jws: e.jws, salt: e.salt, output: e.output, messages: e.messages });
      const verifyCopy = toBase64url(JSON.stringify({ body: e.body, jws: e.jws }));
      ul.append(
        h("li", {}, mono(e.receiptHash), h("span", { class: "hint" }, ` ${e.body.model} · ${new Date(e.savedAt).toISOString()}`), h("div", { class: "row" }, copyButton(verifyCopy, "Copy receipt"), copyButton(e.salt, "Copy salt"), btn)),
      );
    }
    list.replaceChildren(ul);
  };

  async function disclose(e: VaultEntry) {
    try {
      status.say("Waiting for the passkey prompt for this receipt's reveal key…");
      const key = await withPrf(revealLabel(e.receiptHash), (prf) => revealKey(prf, e.receiptHash));
      const blob = JSON.stringify(await sealDisclosure(key, e));
      share.replaceChildren(
        h("h3", {}, "Disclosure for one receipt"),
        h("p", { class: "hint" }, "Send both to the person who should see this receipt. The key opens this entry only, never the rest of the vault."),
        h("pre", {}, blob),
        copyButton(blob, "Copy disclosure"),
        " ",
        copyButton(key, "Copy key"),
      );
      status.say("Disclosure ready.", "ok");
    } catch (err) {
      status.say(meraMessage(err), "error");
    }
  }

  const unlock = h("button", { type: "button" }, "Unlock");
  unlock.addEventListener("click", async () => {
    try {
      status.say("Waiting for the passkey prompt…");
      entries = await unlockVault();
      render();
      status.say(`Unlocked: ${entries.length} receipt(s).`, "ok");
    } catch (e) {
      status.say(meraMessage(e), "error");
    }
  });
  const lock = h("button", { type: "button", class: "secondary" }, "Lock");
  lock.addEventListener("click", () => {
    entries = null;
    render();
    status.say("Locked.");
  });

  const receipt = field("Receipt", textarea({ rows: "3" }));
  const salt = field("Salt", input(""));
  const output = field("Output text (optional)", textarea({ rows: "2" }));
  const add = h("form", { class: "sub" }, h("h3", {}, "Add a receipt"), receipt.row, salt.row, output.row, h("button", { type: "submit" }, "Encrypt and add"));
  add.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      const held = parseReceipt(receipt.input.value);
      const entry: VaultEntry = { receiptHash: receiptHash(held.body), ...held, salt: parseSalt(salt.input.value), savedAt: Date.now() };
      if (output.input.value !== "") entry.output = output.input.value;
      status.say("Waiting for the passkey prompt…");
      entries = await addToVault(entry);
      render();
      add.reset();
      status.say("Added.", "ok");
    } catch (e) {
      status.say(meraMessage(e), "error");
    }
  });

  const blob = field("Vault ciphertext", textarea({ rows: "2" }), "Copy it to another device, paste it there, and unlock with the same synced passkey.");
  const copyOut = h("button", { type: "button", class: "secondary" }, "Show this browser's ciphertext");
  copyOut.addEventListener("click", () => (blob.input.value = JSON.stringify(loadSealed() ?? "")));
  const importBtn = h("button", { type: "button", class: "secondary" }, "Replace with pasted ciphertext");
  importBtn.addEventListener("click", () => {
    try {
      const s = JSON.parse(blob.input.value) as Sealed;
      if (typeof s?.iv !== "string" || typeof s?.ct !== "string") throw new Error("Not a vault ciphertext.");
      storeSealed(s);
      entries = null;
      render();
      status.say("Imported. Unlock to read it.", "ok");
    } catch (e) {
      status.say(errorText(e), "error");
    }
  });

  render();
  return h(
    "div",
    { class: "card" },
    h("h2", {}, "Receipt vault"),
    h("p", { class: "hint" }, "Namespace assay:vault:v1. PRF output, then HKDF, then an AES-256-GCM key. Only ciphertext is stored."),
    h("div", { class: "row" }, unlock, lock),
    status.el,
    list,
    share,
    add,
    h("details", {}, h("summary", {}, "Move the vault to another device"), blob.row, h("div", { class: "row" }, copyOut, importBtn)),
  );
}

function revealCard() {
  const status = liveRegion();
  const blob = field("Disclosure", textarea({ rows: "3" }));
  const key = field("Key", input("", { placeholder: "0x…" }));
  const out = h("div");
  const form = h("form", { class: "card" }, h("h2", {}, "Open a disclosure"), h("p", { class: "hint" }, "Namespace assay:reveal:<receiptHash>. No passkey needed on this side."), blob.row, key.row, h("button", { type: "submit" }, "Open"), status.el, out);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    out.replaceChildren();
    try {
      const d = JSON.parse(blob.input.value) as Disclosure;
      const e = await openDisclosure(key.input.value.trim() as Hex, d);
      const receipt = toBase64url(JSON.stringify({ body: e.body, jws: e.jws }));
      out.append(
        h("dl", { class: "kv" },
          h("dt", {}, "Receipt hash"), h("dd", {}, mono(e.receiptHash)),
          h("dt", {}, "Salt"), h("dd", {}, mono(e.salt), " ", copyButton(e.salt, "Copy salt", { iconOnly: true })),
          h("dt", {}, "Output"), h("dd", {}, e.output ?? ""),
        ),
        copyButton(receipt, "Copy receipt for Verify"),
      );
      status.say("Opened. Paste the receipt, salt and output on the Verify page to check them.", "ok");
    } catch (e) {
      status.say(errorText(e), "error");
    }
  });
  return form;
}

function requesterCard() {
  const status = liveRegion();
  const apps = [field("App id A", input("chat.example")), field("App id B", input("code.example"))];
  const outs = apps.map(() => h("dd", {}, "not derived"));
  const derive = h("button", { type: "button" }, "Derive both addresses");
  derive.addEventListener("click", async () => {
    try {
      for (const [i, app] of apps.entries()) {
        status.say(`Passkey prompt ${i + 1} of 2…`);
        const addr = await withPrf(requesterLabel(app.input.value.trim()), requesterAddress);
        outs[i].replaceChildren(mono(addr));
      }
      status.say("Two apps, two unrelated addresses, one passkey.", "ok");
    } catch (e) {
      status.say(meraMessage(e), "error");
    }
  });

  const hash = field("Receipt hash to sign as app A", input("", { placeholder: "0x + 64 hex" }));
  const sigOut = h("div");
  const chain = chainConfig(CHAIN_ID);
  let lastSigned: { receiptHash: Hex; signature: Hex } | undefined;

  // Sponsored: the host's relayer pays the gas, so app A's address never needs MON from a wallet that would link to you.
  const submit = h("button", { type: "button", class: "secondary", disabled: true }, "Co-sign onchain (the host pays the gas)");
  submit.addEventListener("click", async () => {
    if (!lastSigned) return;
    try {
      status.say("Sending through the host's relayer…", "pending");
      const { txHash } = await sponsorCosignK(chain.host, lastSigned.receiptHash, lastSigned.signature);
      sigOut.append(h("p", {}, "Co-signed onchain: ", h("a", { href: `${chain.explorer}/tx/${txHash}`, target: "_blank", rel: "noopener" }, shortHash(txHash))));
      status.say("Co-signed. App A's address paid nothing and holds nothing.", "ok");
    } catch (e) {
      status.say(errorText(e), "error");
    }
  });

  const verdict = h("select", { id: "fb-value" }, h("option", { value: "-1" }, "Complaint: the answer was wrong or bad"), h("option", { value: "1" }, "Praise: the answer was good"));
  const verdictRow = h("div", { class: "field" }, h("label", { for: "fb-value" }, "Feedback about the host that served this receipt"), verdict);
  const note = field("Note (optional, public, 200 characters)", input("", { maxlength: "200" }));
  const fileIt = h("button", { type: "button", class: "secondary" }, "File it from app A (the host pays the gas)");
  fileIt.addEventListener("click", async () => {
    try {
      const rh = hash.input.value.trim() as Hex;
      if (!/^0x[0-9a-fA-F]{64}$/.test(rh)) throw new Error("Receipt hash must be 0x + 64 hex.");
      if (!chain.assayAccount) throw new Error(`Sponsored feedback isn't live on ${chain.name} yet.`);
      const st = await fetchReceiptStatus(chain.host, rh);
      if (st.status !== "anchored") throw new Error("The receipt isn't anchored yet. Try after the next batch.");
      const label = requesterLabel(apps[0].input.value.trim());
      const client = chainClient(chain.rpc);
      status.say("Passkey prompt: deriving app A's address…", "pending");
      const account = await withPrf(label, requesterAddress);
      const code = await client.getCode({ address: account });
      const delegationNonce = code && code !== "0x" ? undefined : await client.getTransactionCount({ address: account });
      status.say("Passkey prompt: signing the feedback…", "pending");
      const body = await withPrf(label, (prf) =>
        signSponsoredFeedback(prf, {
          chainId: CHAIN_ID,
          accountImpl: chain.assayAccount!,
          reputation: chain.reputationRegistry,
          agentId: parseAgentId(st.body.host.agentId),
          receiptHash: rh,
          value: verdict.value === "1" ? 1 : -1,
          note: note.input.value,
          nowSeconds: Math.floor(Date.now() / 1000),
          delegationNonce,
        }),
      );
      const { txHash } = await sponsorFeedback(chain.host, body);
      sigOut.append(h("p", {}, "Feedback filed on the ERC-8004 Reputation registry from ", mono(body.account), ": ", h("a", { href: `${chain.explorer}/tx/${txHash}`, target: "_blank", rel: "noopener" }, shortHash(txHash))));
      status.say("Filed. It counts as receipt-backed because app A co-signed this receipt.", "ok");
    } catch (e) {
      status.say(meraMessage(e), "error");
    }
  });
  const sign = h("button", { type: "button", class: "secondary" }, "Sign for cosignK");
  sign.addEventListener("click", async () => {
    sigOut.replaceChildren();
    try {
      const rh = hash.input.value.trim() as Hex;
      if (!/^0x[0-9a-fA-F]{64}$/.test(rh)) throw new Error("Receipt hash must be 0x + 64 hex.");
      status.say("Waiting for the passkey prompt…");
      const { address, signature } = await withPrf(requesterLabel(apps[0].input.value.trim()), (prf) => signReceiptHash(prf, rh));
      const recovered = await recoverMessageAddress({ message: { raw: rh }, signature });
      sigOut.append(
        h("dl", { class: "kv" },
          h("dt", {}, "Signer"), h("dd", {}, mono(address)),
          h("dt", {}, "X-Assay-Cosigner"), h("dd", {}, mono(cosignerForAddress(address)), " ", copyButton(cosignerForAddress(address), "Copy cosigner", { iconOnly: true })),
          h("dt", {}, "Signature"), h("dd", {}, mono(signature), " ", copyButton(signature, "Copy signature", { iconOnly: true })),
          h("dt", {}, "ecrecover"), h("dd", {}, recovered === address ? "recovers to the signer" : "MISMATCH"),
        ),
      );
      lastSigned = { receiptHash: rh, signature };
      submit.disabled = false;
      status.say("Signed. The key existed only for this one signature.", "ok");
    } catch (e) {
      status.say(meraMessage(e), "error");
    }
  });

  return h(
    "div",
    { class: "card" },
    h("h2", {}, "Per-app requester identity"),
    h("p", { class: "hint" }, "Namespace assay:requester:<appId>. PRF output, then BIP-39 and BIP-32 m/44'/60'/0'/0/0, a secp256k1 key per app. Apps can't link your activity through one public key."),
    apps[0].row,
    apps[1].row,
    derive,
    h("dl", { class: "kv" }, h("dt", {}, "App A"), outs[0], h("dt", {}, "App B"), outs[1]),
    hash.row,
    h("div", { class: "row" }, sign, submit),
    h("h3", {}, "Complain about the host, from app A"),
    h("p", { class: "hint" }, "ERC-8004 feedback sent from app A's own address, citing this receipt. It only counts as receipt-backed when app A co-signed the receipt first. The host pays the gas through an EIP-7702 account, so the address never needs funding."),
    verdictRow,
    note.row,
    fileIt,
    status.el,
    sigOut,
  );
}

export function mountVault(root: HTMLElement) {
  root.append(
    section(
      "Vault",
      "One passkey, three separate keys. Each comes from the passkey's PRF output with its own salt, sha256 of the label, and none is ever stored.",
      // Two columns: your passkey and its vault on the left, what other apps and people see on the right.
      h("div", { class: "vault-grid" }, h("div", { class: "col" }, passkeyCard(), requesterCard()), h("div", { class: "col" }, vaultCard(), revealCard())),
    ),
  );
}
