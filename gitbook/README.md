---
description: What Assay is, the problem it answers, and where to start reading.
icon: house
---

# Welcome to Assay

**Where:** the code is at [github.com/trudransh/Assay](https://github.com/trudransh/Assay). The contracts run on Monad mainnet (chain 143), with a copy on testnet (chain 10143) for free experiments.

Assay gives every AI response a signed receipt. The host signs it, you can co-sign it with a passkey, and Monad checks both signatures onchain. Open verifiers grade hosts against the lab's own endpoint, and you choose which verifiers you trust.

## The problem in numbers

On 26 Sep 2026 OpenRouter's public API listed the following for open-weight models. Every number comes from the [hosting report](resources/hosting-report.md).

| Measure | Value |
|---|---|
| Distinct endpoints for 140 open-weight models | 735, from 56 providers |
| Endpoints whose precision field reads `unknown` | 289 (39%) |
| Endpoints that declare a 4-bit format | 107 (15%) |
| GLM-5.3 endpoints | 37, of which 16 state no precision and 8 declare 4-bit |
| GLM-5.3 output price range | $1.19 to $8.80 per million tokens |
| DeepSeek V4 Flash on GPQA, lab API vs. one host (measured by Olly) | 90% vs. 75% |

The text you get back carries no proof of who served it. The checks that exist today stay inside the platform that ran them.

## What a receipt proves

| Question | How Assay answers it |
|---|---|
| Which host served this response? | The host's ES256 signature, tied to its ERC-8004 identity. |
| Which model did the host claim? | The `model` field is inside the signed body. |
| Was this receipt in a batch the host committed to? | A Merkle proof against a root anchored in `ReceiptAnchor`. |
| Did the host pass its last audit? | `gradeOf` in `VerifierRegistry`, filtered by the verifiers you trust. |
| Who asked? | An optional passkey co-signature, checked onchain. |

A receipt proves who served which bytes and what they claimed. It does not prove which weights ran. Grades from verifiers cover that gap.

## Where to start

| You want to | Read |
|---|---|
| Verify a receipt on your machine in a few minutes | [Quickstart](getting-started/quickstart.md) |
| Learn the five ideas everything else uses | [Core concepts](getting-started/core-concepts.md) |
| Find a contract address or an ERC-8004 id | [Network and contracts](getting-started/network-and-contracts.md) |
| Call the SDK, the host or the contracts | [For developers](developers/sdk.md) |
| See what can go wrong and which test covers it | [Threat model](security/threat-model.md) |

## Live today

| What | Where |
|---|---|
| Two hosts on Monad mainnet: Gemma 4 31B (agent 10278) and Kimi K2.6 (agent 10316), every response signed and anchored | [Network and contracts](getting-started/network-and-contracts.md) |
| Grades from verifier 10279 against the lab's own endpoint. Both hosts are re-graded twice a week | [Verifiers and grades](how-it-works/verifiers-and-grades.md) |
| The Kimi K2.6 hosts on OpenRouter graded against Moonshot's endpoint (20 Oct: 15 passed 32/32, one was rate-limited) | [grades_20261020T135810Z.json](https://github.com/trudransh/Assay/blob/dev/docs/evidence/grades_20261020T135810Z.json) |
| The SDK on npm: `npm install assay-receipts` | [SDK reference](developers/sdk.md) |
| The web app: ask, verify, grades | [assay-ten-xi.vercel.app/app](https://assay-ten-xi.vercel.app/app/) |

What changed since the Metropolis submission and what comes next is on the [roadmap](resources/roadmap.md).

Next: [Quickstart](getting-started/quickstart.md)
