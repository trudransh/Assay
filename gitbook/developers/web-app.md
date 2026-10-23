---
description: "The Assay web app, page by page: what each one shows, where its data comes from, and what each button does."
icon: window-maximize
---

# Web app

**Live:** https://assay-ten-xi.vercel.app/app/ · **Where:** `web/` (Vite, vanilla TypeScript). Run it locally with `pnpm --filter web dev` at `http://localhost:5173`. Every hash, signature and proof check goes through `@assay/receipts`.

The app talks to an Assay host at `/host`. On the live site, Vercel rewrites `/host/*` to the reference host (`web/vercel.json`), so it's the same origin and needs no CORS. In dev, Vite proxies `/host` to `HOST_TARGET` (default `http://localhost:8787`). Batch and host data come from the Envio indexer.

Each receipt names its chain in `host.agentId` (`erc8004:<chainId>:<agentId>`), and the app picks that chain's contracts, RPC, explorer and indexer ids from it, so receipts from every chain Assay is deployed on open in the same app.

## Verify

Paste a receipt and see every check on its own row, with pass, fail or skipped, a plain explanation, and a "Copy reproduce line" button.

| Field | Meaning |
|---|---|
| Receipt | The `X-Assay-Receipt` header value, or JSON `{body, jws}` |
| Salt (optional) | "The X-Assay-Salt sent with the request. Needed to open the commits." |
| Output text (optional) | "The assistant message exactly as received, whitespace included." |
| Messages JSON (optional) | The `messages` array you sent |
| Host base URL | "Used for /.well-known/jwks.json and /v1/receipts/:hash." |
| RPC URL, ReceiptAnchor | Under "Host and chain settings" |

| Row | `pass` means | Skipped text |
|---|---|---|
| Host signature | "The host's signature verifies against the keys it publishes at /.well-known/jwks.json." | |
| Body unchanged | "The receipt you hold is byte for byte the one the host signed." | "Needs a valid host signature first." |
| Signing key | "The key that signed is the one the receipt names in host.keyId." | "Needs a valid host signature first." |
| In the batch | "The Merkle proof places this receipt in the batch the host anchored." | "Needs the proof and root from the host. The receipt may not be anchored yet." |
| Anchored onchain | "ReceiptAnchor holds the batch root under the host's ERC-8004 agent id." | "Needs the batch root and a chain RPC." |
| Output matches | "Your salt and output text reproduce the output commit, so this is exactly the text the host served." | "Paste the salt and the output text to run it." |
| Prompt matches | "Your salt and messages reproduce the prompt commit, so this receipt answers that prompt." | "Paste the salt and the messages JSON to run it." |
| Requester co-signed | "The passkey named in req.cosigner co-signed this receipt onchain." | "The receipt names no co-signer, or no chain RPC was given." |

The summary reads "Done. No check failed." or "Done. At least one check failed." If the batch is still pending you see "The host has not anchored this receipt yet. Try again after the next batch."

## Ask & co-sign

Anyone can try this in the browser, with no wallet and no terminal: https://assay-ten-xi.vercel.app/app/#ask

1. Type a question, or click one of the examples, then click **Ask**. The app sends it with `wrap(fetch)`, which adds a fresh salt and checks the receipt that comes back.
2. The answer shows with a gold "Signed by host" chip naming the host's agent id (10278 on mainnet, 1962 on testnet). If the model wrapped its reasoning in `<thought>…</thought>`, the page hides it behind a toggle. It's still part of the signed output.
3. "Where your receipt is" tracks the receipt live: signed by the host, waiting for the batch (with the time waited and how many receipts are in the host's queue), then anchored onchain with a link to the transaction. On the reference host this takes a few seconds.
4. **Open receipt page** shows the receipt's own page. **Copy receipt link** copies a link that works anywhere. **Download bundle** saves `{ body, jws, salt, output, messages }`, plus the Merkle root and proof once anchored.

**Passkeys are optional.** "Send without a passkey" is on by default if you don't have one. The receipt is still signed and anchored, but nobody can co-sign it later. With a passkey, the receipt names your key as co-signer, and once the batch is anchored you can click **Co-sign with passkey**. The app checks the assertion's origin, relays it through `POST /v1/cosign`, and shows the transaction. If the batch isn't anchored yet you'll see a banner saying so (HTTP 409). The relay is rate-limited per IP (HTTP 429). Registering a new passkey asks for confirmation first, because receipts that already name your old key can only be co-signed with that key.

**Save to vault** keeps the receipt, salt and output encrypted under your passkey.

## Receipt page (`#r/<receiptHash>`)

Every receipt has its own page, for example [the first live receipt](https://assay-ten-xi.vercel.app/app/#r/0x9a166cacb2ffe4784ad556f69b690b7cebf71150f737a5a3c324f9e98e7907e5).

- **The four marks:** the host's identity, the model it claimed, the anchor on Monad, and whether you co-signed. Each stamp is lit or unlit.
- **How far it was checked:** Level 0 (signed and anchored) and Level 1 (the host is graded by a verifier you trust). Levels 2 and 3 are on the roadmap.
- **What the host signed:** every field of the receipt body. The raw JSON is there too, and Copy JSON copies the exact JCS bytes.
- **Checks,** run in your browser: host signature, body unchanged, signing key, in the batch, anchored onchain, and requester co-signed. Output and prompt show "Needs salt".
- **Anchor:** batch size, block, transaction, and the key that signed this batch. These come from one GraphQL query to the Envio indexer. The contract only stores a host's current key, so after a key rotation the indexer is the only place that still knows which key signed an older batch. If the indexer doesn't answer, the page reads the chain instead and labels the key "current key". The card also shows the host's `cast call` line, so you can check the anchor yourself.
- **Host grade,** from the verifiers you trust (saved on the Grades tab).

A receipt that isn't anchored yet shows "Waiting for batch" with **Check again**. A hash the host doesn't know shows "This host doesn't know that receipt". A malformed hash shows "A receipt hash is 0x followed by 64 hex characters."

## Host profile (`#hosts/<agentId>`)

[Host 10278](https://assay-ten-xi.vercel.app/app/#hosts/10278?chain=143) is the mainnet reference host, and [host 10316](https://assay-ten-xi.vercel.app/app/#hosts/10316?chain=143) serves Kimi K2.6. The whole page comes from one query to the Envio indexer:

- batches anchored, receipts anchored, co-signatures and signing keys
- activity for the last 14 days, one group per UTC day
- every batch, newest first, with the key that signed it
- grades by model for this host's identity, `erc8004:<chainId>:<agentId>`
- the identity (owner, registration block, current key), the key history with each key's transaction, and the endpoints from the agent card

Add `?chain=<chainId>` to open a host on another chain.

## Grades

| Field | Meaning |
|---|---|
| Model | "Hashed as keccak256(model)." |
| Host | "An ERC-8004 agent id for an Assay host, or an OpenRouter provider tag such as deepinfra/fp8." |
| Trusted verifiers | "Grades count only from these addresses. Ties go to the one listed first." |
| Reference endpoint (optional) | "OpenRouter tag of the lab's own endpoint. With it, a host clearly below the reference shows as fail." |
| Evidence base URL (optional) | "Where the verifier publishes its log bundles, named by sha256." |

A link such as `#grades?model=google/gemma-4-31b-it&host=google-ai-studio&ref=direct:generativelanguage.googleapis.com&v=0x4BaC2Be288B5931886EeC4c555895CE6BcAB19e7` fills the form and runs the lookup straight away. The trusted verifiers you enter are remembered in this browser, and the receipt page uses them for its grade card.

Click "Look up grade". The result shows status, pass count, the 95% interval, samples (n), the verifier, the evidence sha256 and an "Open evidence" link. Empty state: "None of the verifiers you trust has graded this model on this host. Add another verifier or check the host input."

## Vault

One passkey, three namespaces. Each uses its own PRF salt, `sha256(label)`, and each PRF output is used once and zeroed.

| Label | Primitive | Used for |
|---|---|---|
| `assay:vault:v1` | HKDF-SHA256, then AES-256-GCM | Encrypts your receipts, salts and outputs. Only ciphertext sits in `localStorage` |
| `assay:requester:<appId>` | BIP-39 entropy, BIP-32 `m/44'/60'/0'/0/0`, secp256k1 | One signing identity per app, for `cosignK`. The key lives for one signature, then `session.end()` wipes it |
| `assay:reveal:<receiptHash>` | HKDF-SHA256, then AES-256-GCM | A disclosure key that opens one receipt's entry and nothing else |

| Button | What it does |
|---|---|
| "Create a vault passkey" | Makes a PRF passkey for the vault |
| "Encrypt and add" | Adds a receipt you paste |
| "Share this receipt" | Derives the reveal key: "The key opens this entry only, never the rest of the vault." |
| "Show this browser's ciphertext" / "Replace with pasted ciphertext" | Moves the vault to another device. Unlock there with the same synced passkey |
| "Open a disclosure" | Opens one shared receipt. "No passkey needed on this side." |

## Where else this shows up

| Place | What it does |
|---|---|
| [SDK reference](sdk.md) | `verifyReceipt`, `wrap`, `cosignReceipt`, `gradeOf` |
| [Host API](host-api.md) | The routes each tab calls |
| [Mera](../integrations/mera.md) | Why the vault uses passkey PRF |

{% hint style="warning" %}
Passkeys are bound to the domain (rpId). A passkey made on `localhost` does not work on the deployed site, and the vault and requester keys change with it. On desktop Chrome, a passkey saved to the local profile returns `PRF_UNAVAILABLE`. Save it to Google Password Manager, iCloud Keychain or 1Password.
{% endhint %}

Next: [Monad](../integrations/monad.md)
