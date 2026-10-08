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
    check: hostGradeCheck(`${HOST}/v1/grade`, { model: "gemma-4-31b-it", host: "erc8004:143:10278", verifiers: [VERIFIER] }),
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

`wrap` sends a fresh 32-byte salt with the request, reads the receipt from the response headers, and checks that the output commit matches the bytes you received. If the gate says no, it throws `GradeGateError` and sends nothing.

## Verify a receipt

```ts
import { verifyReceipt } from "assay-receipts";
import { createPublicClient, http } from "viem";

const status = await fetch(`${HOST}/v1/receipts/${receipt.hash}`).then((r) => r.json()); // proof and root, once anchored
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

## Other exports

| Export | What it does |
|---|---|
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
