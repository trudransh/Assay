---
description: Every term used in these docs, with its exact meaning in Assay.
icon: book-open
---

# Glossary

**Where:** the terms come from `SPEC.md`, the contracts and the SDK.

## Terms

| Term | Meaning |
|---|---|
| `agentId` | An ERC-8004 identity number. In receipts it is written `"erc8004:<chainId>:<agentId>"` |
| Anchor | The onchain record of one batch root, `anchors[agentId][root]` |
| Anchor message | `abi.encode(keccak256("assay-anchor/0"), chainid, anchorContract, agentId, root, count)`, which the host signs |
| `ANCHOR_TAG` | `keccak256("assay-anchor/0")` |
| bps | Basis points. 10000 bps is 100% |
| Commit | A salted sha256 of the prompt (`req.commit`) or the output (`res.commit`) |
| Co-sign | A requester's signature over `receiptHash`, recorded onchain |
| CRE | Chainlink Runtime Environment. Runs workflows on a decentralized oracle network |
| DON | Decentralized oracle network |
| Drift | A new grade whose whole interval sits below the previous one |
| ERC-8004 | The agent identity and reputation standard. Assay uses its IdentityRegistry for hosts and verifiers |
| ES256 | ECDSA on P-256 with SHA-256 |
| ES256K | ECDSA on secp256k1. Reserved for secp256k1 hosts |
| Evidence | The tarball of a grader run (summary CSV and raw JSONL). Its sha256 goes in the grade |
| Grade | A verifier's result for one model on one host |
| `hostKey` | The id a grade is filed under. For an Assay host, `keccak256("erc8004:<chainId>:<agentId>")` |
| JCS | JSON Canonicalization Scheme, RFC 8785 |
| JWKS | The host's public keys at `/.well-known/jwks.json` |
| JWS | The compact signature the host returns with each receipt |
| `keyHash` | `keccak256(abi.encode(qx, qy))` of a P-256 public key |
| Leaf | `keccak256(bytes.concat(keccak256(abi.encode(receiptHash))))` |
| Low `s` | An ECDSA signature with `s ≤ N/2`. OpenZeppelin rejects the other half |
| Nonce | 16 random bytes in every receipt body |
| P256VERIFY | Monad's precompile at `0x0100` (EIP-7951) |
| PRF | A passkey extension that returns deterministic secret bytes for a given salt |
| `qx`, `qy` | The coordinates of a P-256 public key |
| Receipt | The signed JSON body the host returns for every response |
| `receiptHash` | `sha256(JCS(body))` |
| Reference | The lab's own endpoint that a host is graded against |
| `req.cosigner` | The key hash allowed to co-sign, signed into the body |
| Relayer | Any wallet that sends `anchor` or `cosign`. It has no authority of its own |
| Retired key | An old host key still published in the JWKS with `"status": "retired"` |
| Root | The Merkle root of one batch |
| rpId | The domain a passkey is bound to |
| Salt | 32 random bytes per request, sent as `X-Assay-Salt` |
| Trusted verifiers | The addresses a reader passes to `gradeOf` |
| UP, UV | WebAuthn flags for user present and user verified |
| Verifier | An ERC-8004 agent that posts grades |
| Wilson interval | The 95% confidence interval used for every grade |

## Where else this shows up

| Place | What it covers |
|---|---|
| [Core concepts](../getting-started/core-concepts.md) | The five ideas these terms build on |
| [FAQ](faq.md) | Short answers |

{% hint style="warning" %}
`hostKey` and `keyHash` are different things. `keyHash` names a signing key. `hostKey` names who a grade is about, and for Assay hosts it does not change when the key does.
{% endhint %}

Next: [Roadmap](roadmap.md)
