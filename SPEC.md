# Assay receipts: spec v0

An Assay receipt is a small signed record that travels with an AI response. Anyone holding one can later check four things:

1. Which host served the response. The host's signature is tied to its ERC-8004 identity.
2. Which model the host claimed to run. The model field is signed along with everything else.
3. Whether that host passed its last audit, according to verifiers the reader chooses to trust.
4. Who asked for the response, if the requester co-signed it with a passkey. This part is optional.

The prompt and the output never go onchain. Only salted hashes of them do, and the person holding the receipt decides what to reveal.

A receipt proves who served which bytes and what they claimed about it. It does not prove which weights actually ran, and AntSeed says the same about its own signed responses. The link to the real model comes from the grades in section 5, where verifiers test the host against the lab's own endpoint and publish results anyone can recompute.

## 1. Receipt body

The body is canonical JSON (RFC 8785, JCS). MonadGuard signs the same canonical form, so one verifier can handle both kinds of receipt.

```json
{
  "v": "assay-receipt/0",
  "model": "z-ai/glm-5.3",
  "host": {
    "agentId": "erc8004:10143:42",
    "keyId": "host-key-2026-09",
    "alg": "ES256"
  },
  "req": {
    "commit": "0x<sha256(salt || JCS(messages, params))>",
    "params": { "temperature": 0, "max_tokens": 512 }
  },
  "res": {
    "commit": "0x<sha256(salt || output_text)>",
    "tokensIn": 812,
    "tokensOut": 143,
    "finish": "stop"
  },
  "price": { "asset": "USDC", "amount": "0.00041" },
  "t": 1790500000000,
  "nonce": "0x<16 random bytes>"
}
```

The requester generates a fresh 32-byte salt for each request and sends it in the `X-Assay-Salt` header. Without a salt, short prompts like "yes" could be brute-forced from their hash.

The host computes both commits from the bytes it actually received and sent, so it can't sign for a request it didn't serve.

`output_text` is the assistant message's `content` when it has text. When the model answers only with tool calls, it's the JCS bytes of `tool_calls` exactly as returned, so tool-using agents get receipts too. The SDK's `assistantOutput()` implements this rule, and both the host and `wrap()` use it.

The receipt hash is `receiptHash = sha256(JCS(body))`, and it's the value every signature covers.

## 2. Signatures

| Signer | Scheme | Where the key lives | How Monad checks it |
|---|---|---|---|
| Host | `ES256` (ECDSA P-256) | Cloud KMS, an HSM, or a TEE. Intel's quoting enclave signs with NIST P-256. | P256VERIFY precompile at `0x0100` |
| Host (AntSeed-style) | `ES256K` (secp256k1, EIP-191 with a domain tag) | The node key. AntSeed peers use "a secp256k1 private key" and `personal_sign` | `ecrecover` |
| Requester | WebAuthn assertion (P-256), challenge = `receiptHash` | The user's passkey | Parse `authenticatorData` and `clientDataJSON`, then P256VERIFY |
| Requester (unlinkable) | secp256k1 key derived from the passkey's PRF output (Mera `getPasskeyPrfOutput`) with a per-app salt, signing an EIP-191 message over `receiptHash`. See section 7, note 3 | Nowhere. It's re-derived from the passkey each time | `ecrecover` in `ReceiptAnchor.cosignK` |

P256VERIFY takes 160 bytes (`hash ‖ r ‖ s ‖ x ‖ y`) and returns 1 on success.

Host signatures are published as JWS, with the host's keys at `/.well-known/jwks.json`. MonadGuard uses the same convention.

## 3. Anchoring

Hosts don't send a transaction per request. They batch receipts like this:

1. Every N seconds or M receipts, the host builds a Merkle tree of `receiptHash` values.
2. It signs the root and calls `ReceiptAnchor.anchor(root, count, sig)`.
3. The contract checks the signature against the host's registered key, so nobody can anchor a batch the host didn't sign.
4. Anyone can then check a single receipt with `verifyReceipt(agentId, receiptHash, proof, root)`, which takes a Merkle proof and the root that host anchored. Anchors are stored per host, so one host can't block or claim another host's batch by anchoring the same root first.

**What's checked when.** The contract checks one signature per batch, at write time: the host's P-256 signature over the root. Each individual receipt is checked on read, by whoever relies on it: the host's ES256 JWS against its published JWKS, plus the Merkle proof against an anchored root. Attestation registries that verify every record on the way in (MonadGuard's `ScanRegistry` does) give a stronger guarantee per row and pay for it per row. Assay amortises the onchain cost and moves the per-receipt check to the reader. A consumer should know which of the two models it's looking at.

## 4. Requester co-signature (optional)

The client calls `navigator.credentials.get` with `challenge = receiptHash`. The contract, or any offchain verifier, then does the following:

1. It checks that `clientDataJSON.type == "webauthn.get"` and `clientDataJSON.challenge == base64url(receiptHash)`.
2. It checks the user-present flag in `authenticatorData`.
3. It computes `h = sha256(authenticatorData ‖ sha256(clientDataJSON))`.
4. It calls P256VERIFY with `h, r, s` and the credential's public key `x, y`.

A requester with a secp256k1 key (for example a Mera per-app key) calls `cosignK(agentId, receiptHash, proof, root, signature)` instead. The signature is a 65-byte EIP-191 signature over `receiptHash`, and the contract recovers the signer with `ecrecover`. It rejects high `s` and any other length. Records are kept per signer address in `cosignedK[receiptHash][signer]`, for the same front-running reason as above. A secp256k1 requester names itself in `req.cosigner` as its address left-padded to 32 bytes (`bytes32(uint256(uint160(signer)))`). A verifier reads the top 12 bytes: if they are all zero, it checks `cosignedK(receiptHash, signer)`, and otherwise it checks `cosigned(receiptHash, req.cosigner)`. A P-256 key hash starts with 12 zero bytes with probability 2^-96, so the two forms don't collide in practice. The SDK's `cosignerForAddress` builds this value and `verifyReceipt` follows the same rule.

Receipts are keyed by `receiptHash` and not by signature bytes, so signature malleability can't produce a duplicate receipt.

A passkey can sign any challenge, so anyone who learns a receipt hash could co-sign it with their own key. The contract therefore records every valid co-signature, one per key, and doesn't decide which one belongs to the requester. That binding happens in the receipt itself. A requester who plans to co-sign sends `X-Assay-Cosigner: <keyHash>` with the request, where `keyHash = keccak256(abi.encode(qx, qy))`, and the host signs it into the body as `req.cosigner`. Verifiers accept only the co-signature whose key hash matches `req.cosigner`, and ignore the rest.

## 5. Grades from open verifiers

Anyone can be a verifier. A verifier registers an ERC-8004 identity and publishes grades to `VerifierRegistry`:

```
Grade {
  model        bytes32   // keccak256("z-ai/glm-5.3")
  hostKey      bytes32   // the host's identity, see the table below
  checks       bytes32   // hash of the check suite version
  passed       uint32
  total        uint32
  ciLowBps     uint16    // 95% Wilson interval, basis points
  ciHighBps    uint16
  refModel     bytes32   // reference endpoint used (the lab's own API)
  evidence     bytes32   // sha256 of the raw log bundle, published offchain
  t            uint64
}
```

The `hostKey` field names who was graded. Grades follow the host's identity, not its signing key, so a host can't shed a bad grade by rotating keys.

| Host kind | `hostKey` | Example preimage |
|---|---|---|
| Assay host with an ERC-8004 identity | `keccak256(utf8("erc8004:<chainId>:<agentId>"))` | `erc8004:10143:1962` |
| OpenRouter endpoint | `keccak256(utf8("openrouter:" + tag))` | `openrouter:z-ai` |
| A lab's own API, graded directly | `keccak256(utf8("direct:<host>"))` | `direct:api.z.ai` |

The SDK computes these with `hostKeyForAgent`, `hostKeyForEndpoint` and `hostKeyForDirect`. The harness export uses the same strings, and both test suites pin the same vectors. A host can still register a new identity to escape its history, so readers should also weigh identity age and grade count.

**Running a grader is not the same as vouching for a grade.** A verifier that posts a grade puts its identity behind the number. A party that only ran someone else's grader can honestly attest "I ran this grader at this commit against this host, and it produced this output", but not that it stands behind the methodology. v0 grades are the first kind. Since 17 Oct the evidence bundle says which kind it is: `provenance_<stamp>.json` holds the grader's commit, the operator's identity and a stance of `vouches` or `ran-grader`, and a reader can decide which one to trust. Thanks to MonadGuard's poteshniy for drawing this line.

Readers call `gradeOf(model, hostKey, trustedVerifiers[])` and choose whose grades count. ERC-8004 recommends the same pattern for reputation, because unfiltered feedback is easy to spam. Assay runs the first verifier, but the registry doesn't depend on Assay in any way.

**Check suites.** `checks` is `keccak256` of the suite's name. `assay-checks/tool-calls-v0` counts four tool-call cases per repeat and logs one capped reply without counting it. `assay-checks/v1` counts two more cases per repeat. A reply capped at `max_tokens` 16 passes only if the billed output tokens stay at 18 or under. A stop sequence passes only if the answer ends before it. A host and its reference are always graded with the same suite in the same run. Billed output is the larger of `completion_tokens` and `total_tokens` minus `prompt_tokens`, because Google's API counts thinking only in the total. Assay hosts sign the same number as `res.tokensOut`.

**Grade feed.** `harness/feed.py` writes one JSON file with the newest onchain grade of every graded host for each model, currently from Assay's verifier only. It carries the grade fields and a link to each evidence bundle, but no verdicts. The SDK's `feedStatuses` judges the numbers with `gradeStatus` when the feed is read, so an old copy can't show an expired grade as a pass, and `toOpenRouterIgnore` turns a feed into tags for OpenRouter's `provider.ignore`.

## 6. Out of scope for v0

A receipt can't prove which weights ran. That becomes possible when the host signs from inside a TEE whose attestation quote includes a model hash, and it's the likely next step after v0.

ES384 keys aren't supported. NVIDIA's attestation tokens use ES384, and Monad has no P-384 precompile, so those tokens have to be verified offchain or wrapped later.

Hosts get no privacy. They are public by design, and only requesters can stay private.

## 7. Implementation notes (v0.1)

These notes pin down details that the sections above leave open. They come from running the libraries and the Monad testnet precompile directly.

1. Signatures must use low `s`. WebCrypto and passkeys return a high `s` roughly half the time, and OpenZeppelin's `P256` rejects those. The SDK sets `s = N - s` before anything goes onchain.
2. User verification is required. OpenZeppelin's `WebAuthn.verify` defaults to `requireUV = true` and Mera's PRF always requires it, so test vectors use flags `0x05` (UP and UV).
3. Mera per-app requester keys are secp256k1, since Mera's signing sessions don't offer P-256. The key follows Mera's documented BIP-39/BIP-32 path from a per-app PRF salt `sha256("assay:requester:<appId>")`, and the contract checks it with `ecrecover` over an EIP-191 digest of `receiptHash`.
4. Merkle leaves use OpenZeppelin's `StandardMerkleTree` with leaf type `["bytes32"]`. Each leaf is `keccak256(bytes.concat(keccak256(abi.encode(receiptHash))))`, which matches OpenZeppelin's `MerkleProof`.
5. The anchor message is `abi.encode(keccak256("assay-anchor/0"), chainid, anchorContract, agentId, root, count)`. The host signs it with ES256, so the contract verifies against `sha256(message)`. Including the chain ID and contract address stops a signature from being replayed on another chain or deployment.
6. A grade's `hostKey` follows identity, as in the table in section 5. For an Assay host it is `keccak256("erc8004:<chainId>:<agentId>")`, so the grade survives a key rotation. OpenRouter endpoints use `keccak256(abi.encodePacked("openrouter:", tag))`. The signing key's hash, `keccak256(abi.encode(qx, qy))`, still appears in the `HostKeySet` and `Anchored` events. There it only identifies which key signed a batch.

## 8. Rules for consumers

A receipt proves where a response came from. It is not a bearer ticket, and anything that acts on one has to follow these rules.

| Rule | Who | Why |
|---|---|---|
| A contract that pays, credits or unlocks something on a receipt stores `receiptHash` as spent and rejects it the second time. | Consumer contracts | `ReceiptAnchor` lets anyone check the same receipt any number of times. Without a nullifier, one receipt can be claimed twice. |
| A host keeps every retired key in `/.well-known/jwks.json` with `"status": "retired"`. | Hosts | Old receipts carry the old `kid`. If the key disappears from the JWKS, their signatures can no longer be checked. |
| Only the co-signature whose key matches `req.cosigner` counts as the requester's. | Verifiers and readers | The contract records every valid co-signature, one per key. Anyone who sees a receipt hash can co-sign it with their own passkey. |
| Check the WebAuthn `origin` and `rpIdHash` offchain. | Verifiers | OpenZeppelin's `WebAuthn.verify` does not check them. The SDK has `checkOrigin` and `checkRpIdHash`. |
| Treat a grade older than 7 days as unknown, and one with fewer than 30 samples as a warning. | Readers of grades | A stale grade says nothing about the host today. The SDK's `gradeStatus` applies both limits. |
| Count ERC-8004 feedback about a host only when it is receipt-backed: its `feedbackHash` is a receipt hash, and the sender co-signed that receipt with `cosignK` (`cosignedK[receiptHash][sender]` is true). | Readers of reputation | Anyone can file feedback. A co-signed receipt shows the complaint comes from the person who asked, about a response the host anchored. |
| Before paying a host, check its grade in the payment path, and refuse below your threshold. | Paying clients | Nobody checks by choice. The SDK's `wrap(fetch, { gate })` refuses before the request is sent. |

## 9. CRE attestations

A grade comes from one verifier. A Chainlink CRE workflow can re-check it on a decentralized oracle network and record the result onchain.

The workflow fires on `GradePosted`. Each node fetches the evidence bundle and checks its sha256 against the grade's `evidence` field. It then recomputes `passed`, `total` and the Wilson interval from the raw logs. The nodes agree on one report, and the CRE forwarder delivers it to `CreAttestor.onReport(metadata, report)`.

`CreAttestor` stores one attestation per `(verifier, model, hostKey, t)` and emits `GradeAttested`.

| Report field | Type | Meaning |
|---|---|---|
| `verifier` | `address` | The verifier whose grade was re-checked |
| `model`, `hostKey`, `t` | `bytes32`, `bytes32`, `uint64` | Which grade it was |
| `passed`, `total` | `uint32` | The recomputed counts |
| `ciLowBps`, `ciHighBps` | `uint16` | The recomputed 95% Wilson interval |
| `agree` | `bool` | Whether the recomputed values match the posted grade |

The report is the `abi.encode` of these 9 fields, 288 bytes. The contract rejects any other length, `total == 0`, `passed > total`, an inverted interval or a bound above 10000.

The forwarder is shared by every CRE workflow, so checking `msg.sender` alone would let any workflow write here. The owner calls `configure(forwarder, workflowOwner, workflowId)` once. After that, `onReport` reads the workflow owner and id from the forwarder's metadata and rejects reports from any other workflow. A zero `workflowId` accepts any workflow from the pinned owner.
