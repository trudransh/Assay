---
description: Every export of @assay/receipts with its signature, what it throws, and a TypeScript example.
icon: code
---

# SDK reference

**Where:** `sdk/src/index.ts`, package `@assay/receipts` (ESM, TypeScript). Built on viem, jose, canonicalize and `@openzeppelin/merkle-tree`.

The SDK is the single source of truth for hashing, signing, Merkle trees and verification. The host, the web app and the contract test vectors all use it, so use it instead of re-implementing any formula.

## Exports at a glance

| Group | Exports |
|---|---|
| Canonical JSON and commits | `jcs`, `newSalt`, `commitRequest`, `commitResponse`, `assertBytes32` |
| Receipts | `buildReceipt`, `receiptHash`, `RECEIPT_VERSION` |
| P-256 helpers | `normalizeS`, `splitRawSignature`, `derToRaw`, `spkiToXY`, `rawPubToXY`, `P256_N` |
| Merkle | `leafHash`, `buildBatch`, `verifyProof` |
| Host signing | `createHostSigner`, `verifyReceiptJws`, `anchorMessage`, `ANCHOR_TAG` |
| Verification | `verifyReceipt`, `parseAgentId`, `receiptAnchorAbi` |
| Host keys for grades | `hostKeyForAgent`, `hostKeyForEndpoint`, `hostKeyForDirect` |
| WebAuthn | `findClientDataIndexes`, `assertionToWebAuthnAuth`, `checkOrigin`, `checkRpIdHash`, `requesterKeyHash`, `registerPasskey`, `cosignReceipt` |
| Client | `wrap` |
| Grades | `gradeOf`, `gradeStatus`, `verifierRegistryAbi`, `GRADE_MAX_AGE_SECONDS`, `GRADE_MIN_SAMPLES` |

## Canonical JSON and commits

### `jcs(value): string`

RFC 8785 canonical JSON. Throws `jcs: undefined at <path>` for any `undefined` value instead of silently dropping it.

```typescript
jcs({ b: 1, a: [true, null] }); // '{"a":[true,null],"b":1}'
```

### `newSalt(): Hex`

32 random bytes from `crypto.getRandomValues`, as `0x` hex.

```typescript
const salt = newSalt(); // send salt.slice(2) as X-Assay-Salt
```

### `commitRequest(salt, messages, params): Hex`

`sha256(salt ‖ utf8(JCS({messages, params})))`. Throws `salt must be 32 bytes of hex`.

```typescript
const reqCommit = commitRequest(salt, [{ role: "user", content: "Say OK" }], { temperature: 0 });
```

### `commitResponse(salt, outputText): Hex`

`sha256(salt ‖ utf8(outputText))`.

```typescript
const resCommit = commitResponse(salt, "OK");
```

### `assertBytes32(value, name): void`

Throws `<name> must be 32 bytes of hex` unless `value` is strict 32-byte hex.

```typescript
assertBytes32(cosigner, "cosigner");
```

## Receipts

### `buildReceipt(input): ReceiptBody`

Builds a receipt body with `v = RECEIPT_VERSION` (`"assay-receipt/0"`). Fills `t` with `Date.now()` and `nonce` with 16 random bytes when you omit them. Optional fields you leave out are left out of the body.

```typescript
const body = buildReceipt({
  model: "z-ai/glm-5.3",
  host: { agentId: "erc8004:10143:1962", keyId: "host-key-2026-09", alg: "ES256" },
  req: { commit: reqCommit, params: { temperature: 0 } },
  res: { commit: resCommit, tokensIn: 9, tokensOut: 1, finish: "stop" },
});
```

### `receiptHash(body): Hex`

`sha256(JCS(body))`. This is the value every signature and Merkle leaf refers to.

```typescript
const hash = receiptHash(body);
```

## P-256 helpers

### `normalizeS({ r, s }): { r, s, wasHighS }`

Sets `s = N - s` when `s > N/2`. OpenZeppelin `P256` rejects high `s`, and WebCrypto and passkeys return one about half the time.

```typescript
const { r, s } = normalizeS(splitRawSignature(rawSig));
```

### `splitRawSignature(raw): { r, s }`

Splits WebCrypto's 64-byte `r ‖ s`. Throws `raw signature must be 64 bytes, got <n>`.

```typescript
const sig = splitRawSignature(new Uint8Array(await crypto.subtle.sign(alg, key, data)));
```

### `derToRaw(der): Uint8Array`

Converts an ASN.1 DER ECDSA signature (what WebAuthn returns) to 64 raw bytes. Throws `invalid DER signature: <why>`.

```typescript
const raw = derToRaw(new Uint8Array(assertion.response.signature));
```

### `spkiToXY(spki): { x, y }`

Reads `qx`, `qy` from the 91-byte DER SubjectPublicKeyInfo that `getPublicKey()` returns. Throws `not a P-256 SPKI public key`.

```typescript
const { x: qx, y: qy } = spkiToXY(new Uint8Array(cred.response.getPublicKey()));
```

### `rawPubToXY(raw): { x, y }`

Reads `qx`, `qy` from WebCrypto's 65-byte `0x04 ‖ x ‖ y`. Throws `not an uncompressed P-256 point`.

```typescript
const { x, y } = rawPubToXY(new Uint8Array(await crypto.subtle.exportKey("raw", publicKey)));
```

### `P256_N`

The P-256 group order as a `bigint`.

```typescript
const isLow = BigInt(s) <= P256_N / 2n;
```

## Merkle

### `leafHash(receiptHash): Hex`

`keccak256(keccak256(abi.encode(receiptHash)))`, identical to `ReceiptAnchor.leafOf`.

```typescript
const leaf = leafHash(hash);
```

### `buildBatch(receiptHashes): { root, proofs }`

Builds a `StandardMerkleTree` with leaf type `["bytes32"]`. `proofs` is a `Map` from lowercase receipt hash to its proof. Throws `empty batch` and `duplicate receipt hash in batch`.

```typescript
const { root, proofs } = buildBatch([hashA, hashB]);
const proofA = proofs.get(hashA.toLowerCase());
```

### `verifyProof(receiptHash, proof, root): boolean`

Checks a proof offchain, the same way `MerkleProof` does onchain.

```typescript
verifyProof(hashA, proofA, root); // true
```

## Host signing

### `createHostSigner(privateJwk, kid): Promise<HostSigner>`

Takes a P-256 private JWK (as written by `host/scripts/keygen.ts`). Returns `kid`, `publicJwk`, `signReceipt(body)` and `signAnchor(params)`. Throws `expected a P-256 private JWK`.

```typescript
const signer = await createHostSigner(privateJwk, "host-key-2026-09");
const jws = await signer.signReceipt(body);
const { r, s } = await signer.signAnchor({ chainId: 10143n, anchor, agentId: 1962n, root, count: 2 });
```

`signAnchor` already returns low `s`, ready for `anchor`.

### `verifyReceiptJws(jws, jwks): Promise<{ body, kid }>`

Verifies an ES256 compact JWS against a JWKS and returns the signed body. Throws `receipt JWS payload is not canonical JSON` when the payload isn't JCS.

```typescript
const jwks = await (await fetch("http://localhost:8787/.well-known/jwks.json")).json();
const { body, kid } = await verifyReceiptJws(jws, jwks);
```

### `anchorMessage(params): Hex` and `ANCHOR_TAG`

The exact bytes `ReceiptAnchor.anchorMessage` returns. `ANCHOR_TAG` is `keccak256("assay-anchor/0")`.

```typescript
const msg = anchorMessage({ chainId: 10143n, anchor: "0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24", agentId: 1962n, root, count: 2 });
```

## Verification

### `verifyReceipt(input): Promise<VerifyResult>`

Runs every check it has inputs for and reports each one separately as `"pass"`, `"fail"` or `"skipped"`.

| Input | Unlocks |
|---|---|
| `body`, `jws`, `jwks` (required) | `jws`, `hash`, `kid` |
| `proof`, `root` | `merkle` |
| `onchain: { client, anchor }` plus `root` | `anchored` |
| `onchain` and `req.cosigner` in the body | `cosigned`: reads `cosignedK` when `req.cosigner` is a padded address, `cosigned` otherwise |
| `salt`, `output` | `outputCommit` |
| `salt`, `messages` (and optionally `params`) | `promptCommit` |

The result has `ok` (no check failed), `receiptHash`, `checks`, and `reproduce`. `reproduce` gives, for each check that ran, the exact computation or contract call that recomputes it without this SDK.

```typescript
import { createPublicClient, http } from "viem";

const client = createPublicClient({ transport: http("https://testnet-rpc.monad.xyz") });
const result = await verifyReceipt({
  body, jws, jwks, proof, root,
  onchain: { client, anchor: "0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24" },
  salt, output,
});
result.checks.anchored;   // "pass"
result.reproduce.anchored; // { kind: "contract-call", function: "anchors(uint256,bytes32)(uint32,uint64)", ... }
```

### `parseAgentId(agentId): bigint`

`"erc8004:<chainId>:<agentId>"` to the numeric id. Throws `bad host.agentId: <value>`.

```typescript
parseAgentId("erc8004:10143:1962"); // 1962n
```

### `receiptAnchorAbi`

The two view functions `verifyReceipt` reads: `anchors` and `cosigned`.

```typescript
await client.readContract({ address: anchor, abi: receiptAnchorAbi, functionName: "anchors", args: [1962n, root] });
```

## Host keys for grades

| Function | Formula |
|---|---|
| `hostKeyForAgent(chainId, agentId)` | `keccak256(utf8("erc8004:<chainId>:<agentId>"))` |
| `hostKeyForEndpoint(tag)` | `keccak256(utf8("openrouter:" + tag))` |
| `hostKeyForDirect(host)` | `keccak256(utf8("direct:" + host))` |

```typescript
const assayHost = hostKeyForAgent(10143, 1962);
const openRouterHost = hostKeyForEndpoint("deepinfra/fp8");
const labApi = hostKeyForDirect("api.example.com");
```

## WebAuthn

### `registerPasskey({ rpId, userName, credentials? }): Promise<Passkey>`

Creates an ES256 passkey with `userVerification: "required"`. Returns `credentialId`, `qx`, `qy` and `keyHash`. Throws `passkey creation was cancelled` or `passkey is not ES256 (P-256)`.

```typescript
const pk = await registerPasskey({ rpId: location.hostname, userName: "alice" });
```

### `cosignReceipt(receiptHash, { rpId, credentialId, credentials? }): Promise<WebAuthnAuth>`

Asks the passkey to sign the raw receipt hash and returns the `auth` struct for `ReceiptAnchor.cosign`. Throws `assertion rpIdHash does not match rpId`.

```typescript
const auth = await cosignReceipt(hash, { rpId: location.hostname, credentialId: pk.credentialId });
await fetch("/host/v1/cosign", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ receiptHash: hash, qx: pk.qx, qy: pk.qy, auth }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
});
```

### `assertionToWebAuthnAuth(response): WebAuthnAuth`

Turns a raw browser assertion into the contract's struct: DER to raw, low `s`, computed indexes.

```typescript
const auth = assertionToWebAuthnAuth(credential.response);
```

### `findClientDataIndexes(clientDataJSON): { typeIndex, challengeIndex }`

Byte offsets of `"type":"webauthn.get"` and `"challenge":"…"`, searched for and never assumed. Throws `clientDataJSON type is not webauthn.get`.

```typescript
const { typeIndex, challengeIndex } = findClientDataIndexes(clientDataJSON);
```

### `checkOrigin(clientDataJSON, expectedOrigin): boolean`

```typescript
if (!checkOrigin(auth.clientDataJSON, location.origin)) throw new Error("Assertion origin does not match this page.");
```

### `checkRpIdHash(authenticatorData, rpId): boolean`

```typescript
checkRpIdHash(auth.authenticatorData, "assay.example.com");
```

### `requesterKeyHash(qx, qy): Hex`

`keccak256(abi.encode(qx, qy))`, the value for `X-Assay-Cosigner`.

```typescript
const cosigner = requesterKeyHash(pk.qx, pk.qy);
```

### `cosignerForAddress(address)` and `cosignerAddress(cosigner)`

For a secp256k1 requester (a Mera per-app key that co-signs with `cosignK`), `req.cosigner` is the address left-padded to 32 bytes. `cosignerAddress` reads it back and returns `null` for a P-256 key hash.

```ts
import { cosignerAddress, cosignerForAddress } from "@assay/receipts";

const cosigner = cosignerForAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
// "0x00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8"
cosignerAddress(cosigner); // "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
```

## Client

### `wrap(fetch, { cosigner?, gate? })`

Returns a fetch-like function for an Assay host. It sends a fresh salt (and `X-Assay-Cosigner` if given), parses `X-Assay-Receipt`, checks `X-Assay-Receipt-Hash`, and checks `res.commit` against the text you received.

| Result field | Meaning |
|---|---|
| `response` | The raw `Response`. |
| `json` | The parsed chat completion. |
| `receipt` | `{ body, jws, hash }`. |
| `salt` | The salt that was sent. Keep it. |
| `outputCommitOk` | `true` when `res.commit` matches the assistant text you got. |

With `gate`, the host's grade is checked before anything is sent. If the status isn't in `gate.allow` (default `["pass"]`), `wrap` throws `GradeGateError` and sends nothing. If the check itself fails, nothing is sent either, unless you set `failOpen: true`. Even then, a grade that reads "unknown" or "fail" still blocks the request.

| `gate` field | Meaning |
|---|---|
| `check` | Returns the status. Use `chainGradeCheck`, which reads the registry, not the graded host. |
| `allow` | Statuses that may proceed. Default `["pass"]`. |
| `skip(init)` | Return `true` to send without checking. |
| `failOpen` | Send anyway when the check throws, for example during an RPC outage. Default `false`. |

When the host answers without a usable receipt (none, one that can't be read, or a hash that doesn't match), `wrap` throws `ReceiptError`. The request was sent by then and may be billed, so the error carries `response` with its body unread: you keep the answer and decide what to pay. The receipt arrives with the answer, so `wrap` can't know about it before sending. If you pay after delivery, don't settle a request that ended in `ReceiptError`. If your payment goes with the request, it may already be settled, and the gate is your only check.

```typescript
const ask = wrap(fetch, { cosigner });
const { json, receipt, salt, outputCommitOk } = await ask("http://localhost:8787/v1/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", content: "Say OK" }], max_tokens: 16 }),
});
```

## Grades

### `gradeOf(client, registry, model, hostKey, trusted)`

Reads `VerifierRegistry.gradeOf`. Returns `{ grade, by }`, or `null` when none of the trusted verifiers graded the pair.

```typescript
import { keccak256, stringToBytes } from "viem";

const found = await gradeOf(
  client,
  "0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91",
  keccak256(stringToBytes("z-ai/glm-5.3")),
  hostKeyForAgent(10143, 1962),
  [trustedVerifier],
);
```

### `gradeStatus(grade, { now, reference? }): "pass" | "warn" | "unknown" | "fail"`

`now` is Unix seconds. `GRADE_MAX_AGE_SECONDS` is 7 days and `GRADE_MIN_SAMPLES` is 30.

```typescript
const status = gradeStatus(found?.grade, { now: Math.floor(Date.now() / 1000), reference: refGrade });
```

### `chainGradeCheck(client, { registry, model, host, verifiers, reference?, cacheMs? })`

A `gate.check` that reads `gradeOf` for `host` and `reference` from the chain and returns `gradeStatus`. `host` and `reference` take `erc8004:<chain>:<id>`, `openrouter:<tag>`, `direct:<host>` or a 0x host key. The status is reused for `cacheMs` (default 5 minutes), and a failed read isn't cached.

```typescript
const ask = wrap(fetch, {
  gate: {
    check: chainGradeCheck(client, {
      registry: "0x0C8603041E7d425c4DCa041680C7AF4581dDa9a1",
      model: "moonshotai/kimi-k2.6",
      host: "erc8004:143:10316",
      verifiers: ["0x4BaC2Be288B5931886EeC4c555895CE6BcAB19e7"],
      reference: "openrouter:moonshotai/int4",
    }),
  },
});
```

### `feedStatuses(feed, model, now?)` and `toOpenRouterIgnore(feed, model, { now?, block? })`

A grade feed is one JSON file with every graded host's newest onchain grade for each model, built by `harness/feed.py`. The feed carries the grade numbers and leaves the verdict to the reader: `feedStatuses` judges them with `gradeStatus` against the model's reference at the moment you call it, so an old copy of the feed can't show an expired grade as a pass. It returns a `Map` from host spec to status.

`toOpenRouterIgnore` turns that into OpenRouter provider tags for `provider: { ignore }`. By default it lists only failing providers; pass `block: ["fail", "unknown"]` to also skip providers whose grade has expired. Hosts that nobody has graded don't appear in the feed at all.

```typescript
const feed = await fetch(FEED_URL).then((r) => r.json());
const ignore = toOpenRouterIgnore(feed, "moonshotai/kimi-k2.6");
// body: { model: "moonshotai/kimi-k2.6", messages, provider: { ignore } }
```

### `verifierRegistryAbi`

The `gradeOf` ABI, for use with viem directly.

## Where else this shows up

| Place | Uses |
|---|---|
| [Host API](host-api.md) | `buildReceipt`, `createHostSigner`, `buildBatch` |
| [Web app](web-app.md) | `verifyReceipt`, `wrap`, `cosignReceipt`, `gradeOf` |
| [Contracts reference](contracts.md) | The onchain side of every formula |
| [Quickstart](../getting-started/quickstart.md) | A full round trip |

{% hint style="warning" %}
If you change anything about hashing, signing or Merkle trees, run `pnpm --filter @assay/receipts gen:vectors` and then `forge test`. The Solidity tests read those vectors, and a mismatch there means receipts from your SDK won't verify onchain.
{% endhint %}

Next: [Host API](host-api.md)
