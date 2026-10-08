# Mida context check: was this context produced by a verified call?

[Mida](https://midacontext.xyz) saves what one agent learned (a decision, a changed plan) encrypted under the user's keys, so the next agent the user approves can pick it up. Assay proves which model and host produced a response. Together: a Mida record can carry the Assay receipt of the call that produced it, and the next agent checks it before using the context.

- **Mida proves** which agent saved what, for whom, and who may read it.
- **Assay proves** which host served this output to this prompt, and that the host anchored it on Monad.

## What the record carries

Inside Mida's encrypted body, so outsiders can't see which host a record came from:

```json
{
  "receiptHash": "0x…", "chainId": 10143,
  "jws": "…", "jwks": { "keys": [] },
  "anchor": { "agentId": 1962, "root": "0x…", "proof": [], "tx": "0x…" },
  "salt": "0x…", "output": "…", "messages": [{ "role": "user", "content": "…" }]
}
```

The first part is the same shape as `docs/interop/assay-receipts/`. The salt, output and messages are the opening: only the asker has them, which is why they live in the encrypted body.

## Run it

```bash
npx tsx examples/mida-context/check.mts record.json            # reads the anchor on Monad
npx tsx examples/mida-context/check.mts record.json --offline  # CI: every check except the chain read
```

`check.mts` holds the reader's pins: the hosts it trusts, and per chain the ReceiptAnchor address and RPC. The logic is `checkRecord` in the SDK (`sdk/src/record.ts`). It refuses the context unless all of these hold:

1. The body is decoded from the signed JWS payload, and `receiptHash` is sha256 of those bytes. A separate `body` field is never trusted.
2. The receipt names a pinned host, and the record's `chainId` and `agentId` match it.
3. The JWS verifies, its `kid` matches the body, and the Merkle proof puts the receipt under `root`.
4. ReceiptAnchor, at the address the reader pinned (never the record's), says that host anchored `root`. The batch signature was checked onchain when it was anchored.

Offline (`--offline`, for CI) step 4 is skipped, and that step is what ties the signing key to the host: the record carries its own JWKS. So offline, the signing key must also match a key the reader pinned by its RFC 7638 thumbprint (`pinnedKeys`), and the output says "not checked on chain". Without pinned keys, offline mode refuses. Thanks to Mida for finding this.
5. The salt opens both commits: this exact output answered these exact messages.

A co-signature is reported but not required.

## What this does not claim

- A receipt proves who served which bytes and what they claimed, not which weights ran.
- It doesn't say the output is correct. For how well a host does on a model, look up its grade from verifiers you trust (see `examples/agent-trust-check/`).

## Fixture

`docs/interop/mida-records/0x401a4ec7…baae.json` is a real testnet receipt ("Say OK", 64 tokens) with its salt and output published on purpose, so `sdk/test/record.test.ts` runs offline in CI. Never publish the salt of a real receipt.

## Producing a record (Mida's side)

`mida/` is the small Node program that produces one: `ask` calls the host, `write` saves the receipt and its opening inside a Mida record, `read` (or `export`) hands one to this check. See [mida/README.md](mida/README.md).
