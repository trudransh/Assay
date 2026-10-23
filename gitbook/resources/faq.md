---
description: Short answers to the questions people ask first about receipts, grades, privacy and cost.
icon: circle-question
---

# FAQ

**Where:** answers point to the page that covers each topic in full.

## General

**Is Assay on mainnet?**
Yes. The contracts and two hosts have run on Monad mainnet since 5 Oct 2026. Testnet stays live for free experiments. See [Network and contracts](../getting-started/network-and-contracts.md).

**How do I install the SDK?**
`npm install assay-receipts`. See [SDK reference](../developers/sdk.md).

## Receipts

**Does a receipt prove which model ran?**
No. It proves which host served which bytes and which model the host claimed. Grades from verifiers test whether the host behaves like the lab's own endpoint. See [Verifiers and grades](../how-it-works/verifiers-and-grades.md).

**Does my prompt go onchain?**
No. Only the receipt hash goes onchain, inside a Merkle root. The prompt and output stay as salted commits that only the salt holder can open. See [Privacy](../how-it-works/privacy.md).

**What if I lose the salt?**
The receipt still proves the host signed something, but nobody can show which prompt or output it was. The web app's Vault keeps salts encrypted under your passkey.

**Why is my receipt `pending`?**
The host anchors every `BATCH_SECONDS` (default 300) or at `BATCH_MAX` receipts (default 64). Check `GET /v1/receipts/:hash` again after the next batch.

**Does the host support streaming?**
Not in v0. `stream: true` gets a 400 with "v0 is non-streaming: send stream false or omit it".

## Co-signing

**Do I need MON to co-sign?**
No. Post the assertion to the host's `POST /v1/cosign` and the host pays the gas, up to 10 times per hour per IP.

**Someone else co-signed my receipt. Is that a problem?**
No. The contract records one co-signature per key. Verifiers count only the key named in `req.cosigner`. See [Passkey co-signatures](../how-it-works/cosign.md).

## Grades

**Who can be a verifier?**
Anyone with an ERC-8004 identity. Call `registerVerifier(agentId)` from the owning address.

**Can fake verifiers spam grades?**
They can post, but their grades don't count for you unless you put their address in your `trusted` list for `gradeOf`.

**What does `warn` mean?**
The grade is recent but rests on fewer than 30 samples.

## Cost

**How much does anchoring cost?**
One `anchor` is about 61,000 gas, roughly 0.006 MON at the minimum base fee, or about 0.0001 MON per receipt in a 64-receipt batch.

**Is the grader free to run?**
The `--dry-run` flag prints an estimate and calls no model. The Gemma 4 31B route compares two free endpoints and costs nothing.

## Where else this shows up

| Topic | Page |
|---|---|
| Every term | [Glossary](glossary.md) |
| What can go wrong | [Threat model](../security/threat-model.md) |

{% hint style="warning" %}
`verifyReceipt` returns `ok: true` when checks are skipped. If your app needs the anchor or the output check, require that specific check to be `"pass"`.
{% endhint %}

Next: [Glossary](glossary.md)
