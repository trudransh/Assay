# assay-receipts

Signed receipts for AI responses, anchored on Monad. This is the TypeScript SDK for [Assay](https://github.com/trudransh/Assay): it gets a receipt for every response from an Assay host, verifies receipts anywhere, and refuses hosts that the verifiers you trust don't grade well.

```bash
npm install assay-receipts
```

A receipt proves who served which bytes and what they claimed. It doesn't prove which weights ran.

## Ask a host and keep the receipt

```ts
import { wrap, hostGradeCheck } from "assay-receipts";

const HOST = "https://34-45-1-81.sslip.io/mainnet"; // Assay host 10278 on Monad mainnet
const VERIFIER = "0x4BaC2Be288B5931886EeC4c555895CE6BcAB19e7"; // a verifier you choose to trust

// Refuse the host before sending (or paying) unless your verifiers grade it "pass".
const ask = wrap(fetch, {
  gate: {
    check: hostGradeCheck(HOST, { model: "gemma-4-31b-it", host: "erc8004:143:10278", verifiers: [VERIFIER], reference: "direct:generativelanguage.googleapis.com" }),
    allow: ["pass"],
  },
});

const messages = [{ role: "user", content: "Say OK" }];
const { json, receipt, salt } = await ask(`${HOST}/v1/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ messages }),
});
// Keep `salt`: it's the only way to prove later that this output answered this prompt.
```

`reference` is the lab's own endpoint for the model: the host is judged against it. Without one, a grade must clear an absolute floor (its 95% lower bound at least 80%) to pass. `wrap` sends a fresh 32-byte salt with the request, reads the receipt from the response headers, and checks that the output commit matches the bytes you received. If the gate says no, it throws `GradeGateError` and sends nothing.

## Verify a receipt

```ts
import { verifyReceipt, waitForAnchor } from "assay-receipts";
import { createPublicClient, http } from "viem";

// Waits until the host has anchored the receipt's batch (about every 2 minutes on mainnet), then returns proof and root.
// If it isn't anchored within timeoutMs (default 3 minutes), it throws AnchorTimeoutError with the host's next batch time.
const status = await waitForAnchor(HOST, receipt.hash);
const jwks = await fetch(`${HOST}/.well-known/jwks.json`).then((r) => r.json());

const result = await verifyReceipt({
  body: receipt.body,
  jws: receipt.jws,
  jwks,
  proof: status.proof,
  root: status.root,
  onchain: { client: createPublicClient({ transport: http("https://rpc.monad.xyz") }), anchor: "0x049A73755cA3508ef3Daa4752A3406f6e00CfB13" },
  salt,
  output: json.choices[0].message.content,
  messages,
});

result.checks;             // { jws, hash, kid, merkle, anchored, outputCommit, promptCommit, cosigned }: pass, fail or skipped
result.reproduce.anchored; // the exact contract call that reproduces the check, ready for cast
```

Each check runs on its own, and each comes with the call that reproduces it, so you never have to trust this library either.

## Choosing and pinning hosts

Anyone can register an ERC-8004 agent and run an Assay host. A valid receipt proves that agent served those bytes. It doesn't make the agent one you should trust. So a reader decides up front which hosts it accepts and pins them:

- **Pin the host by its ERC-8004 id**, written `erc8004:<chainId>:<agentId>`, for example `erc8004:143:10278`. Refuse receipts from any other host. `checkRecord` does this with `trustedHosts`.
- **Pin the ReceiptAnchor address and chain yourself.** Never take them from the receipt or the record: a forged record can name any contract.
- **Before you pin a host, look it up.** `ownerOf(agentId)` on the ERC-8004 IdentityRegistry gives its owner, and its agent card (`/.well-known/agent-registration.json` on the host) should list the URL you call. Then check its grade from verifiers you trust with `hostGradeCheck` or `gradeOf`.
- **Offline (CI, no RPC), also pin the signing key.** Without the chain read nothing ties a key to the host, so pass the key's RFC 7638 thumbprint (the host's `kid`) in `pinnedKeys`. `checkRecord` refuses offline checks without it.

```ts
const pins = {
  trustedHosts: ["erc8004:143:10278"],
  chains: { 143: { anchor: "0x049A73755cA3508ef3Daa4752A3406f6e00CfB13", rpc: "https://rpc.monad.xyz" } },
  pinnedKeys: ["2Jc6WJSjvNSL7jid_XaVkG4iVOIBr7HSqhk1KiF5qg0"], // only needed offline
};
const verdict = await checkRecord(record, pins);
```

A host can rotate its key. Onchain checks follow the rotation; pinned offline keys need updating when it happens.

## Other exports

| Export | What it does |
|---|---|
| `waitForAnchor(host, hash)` | Waits until a receipt is anchored and returns its proof and root, or throws `AnchorTimeoutError` saying when the host's next batch is |
| `checkRecord(record, pins)` | Checks the receipt carried with a piece of context (for example a Mida record) before an agent uses it. Fails closed |
| `gradeOf`, `gradeStatus` | Read a host's grade from VerifierRegistry for the verifiers you trust, and turn it into pass, warn, fail or unknown |
| `hostKeyForAgent`, `hostKeyForEndpoint`, `hostKeyForDirect` | The host keys grades are stored under: an ERC-8004 identity, an OpenRouter endpoint or a lab's own API |
| `registerPasskey`, `cosignReceipt` | Co-sign a receipt with a passkey (WebAuthn, checked onchain by Monad's P256 precompile) |
| `sponsoredCallTypedData`, `assayAccountAbi` | Sign a call for an EIP-7702 per-app account, so a relayer can pay its gas |
| `buildReceipt`, `receiptHash`, `jcs`, `buildBatch`, `verifyProof` | The receipt format itself: JCS canonical JSON, sha256, and the Merkle tree ReceiptAnchor uses |

## Addresses

| Contract | Monad mainnet (143) | Monad testnet (10143) |
|---|---|---|
| ReceiptAnchor | `0x049A73755cA3508ef3Daa4752A3406f6e00CfB13` | `0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24` |
| VerifierRegistry | `0x0C8603041E7d425c4DCa041680C7AF4581dDa9a1` | `0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91` |

Docs: https://assay.gitbook.io/assay-docs · Spec: https://github.com/trudransh/Assay/blob/main/SPEC.md · License: MIT
