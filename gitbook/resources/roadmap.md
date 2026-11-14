---
description: What runs today, what changed since the Metropolis submission, and what comes next.
icon: map
---

# Roadmap

**Where:** status comes from the repo README, `docs/deployments.md` and the evidence in `docs/evidence/`. Updated 14 Nov 2026.

This page separates what runs today from what is next. Items move up when they ship, with a link to the evidence.

## Live on Monad mainnet

| Item | Evidence |
|---|---|
| `ReceiptAnchor`, `VerifierRegistry`, `CreAttestor` v2 and `AssayAccount`, verified on Sourcify | [Network and contracts](../getting-started/network-and-contracts.md) |
| Host 10278 (Gemma 4 31B through Google's API) and host 10316 (Kimi K2.6 through Moonshot's endpoint), signing and anchoring every response | `/health` on each host |
| Passkey co-signatures (`cosign`) and per-app secp256k1 co-signatures (`cosignK`), with gas paid by the host's relayer through EIP-7702 | [Passkey co-signatures](../how-it-works/cosign.md) |
| Grades from verifier 10279, each with an evidence bundle whose sha256 is onchain | [Verifiers and grades](../how-it-works/verifiers-and-grades.md) |
| CRE re-checks of grades from their evidence, `agree=true` on every one so far (simulator runs relayed by our key, not a DON) | [Chainlink CRE](../integrations/chainlink-cre.md) |
| Two paid jobs through Kanmani's escrow, settled on receipts from host 10278 | `docs/deployments.md` |
| Envio indexer over mainnet and testnet in one deployment | [Indexer and GraphQL](../developers/indexer.md) |

## Since the Metropolis submission (13 Oct)

| Item | Evidence |
|---|---|
| Grading runs on a schedule: both hosts are re-graded every Monday and Thursday, and an alert fires if any grade is more than 5 days old (grades expire after 7) | `.github/workflows/grade.yml` |
| Each evidence bundle carries a `provenance.json`: the grader's git commit, who ran it, and whether they vouch for the method or only ran the code | `harness/export_grade.py` |
| SDK `assay-receipts` 0.3.0 on npm. `wrap()` can check a host's grade before sending, `chainGradeCheck` reads it from the registry instead of asking the host, and `ReceiptError` hands back an answer that came without a usable receipt so you decide what to pay | [SDK reference](../developers/sdk.md) |
| Kimi K2.6 hosts on OpenRouter re-graded on 20 Oct: 15 passed 32/32, one was rate-limited and got no grade | [grades_20261020T135810Z.json](https://github.com/trudransh/Assay/blob/main/docs/evidence/grades_20261020T135810Z.json) |
| `max_tokens` test on every Kimi K2.6 host: the hosts that ignored the cap were sent their logs on 18 Oct, and the names and raw files are published on 25 Oct | [max_tokens evidence](https://github.com/trudransh/Assay/blob/main/docs/evidence/max-tokens-kimi-k2.6.md) |

## Since judging ended (14 Nov)

| Item | Evidence |
|---|---|
| The three hosts run on Cloudflare Workers, a Durable Object with its own SQLite per host, anchored by alarms. Every receipt from the old VM moved over with the same keys | [Network and contracts](../getting-started/network-and-contracts.md) |
| Receipts count thinking tokens: `tokensOut` includes reasoning that Google's API reports only in `total_tokens` | `host/src/server.ts` |
| Uptime and low-gas alerts for the hosts, the indexer and the wallets that pay gas, every 15 minutes | `.github/workflows/watch.yml` |
| Public grade feed at https://trudransh.github.io/Assay/feed.json, rebuilt hourly from the registry; SDK `feedStatuses` and `toOpenRouterIgnore` read it | `.github/workflows/feed.yml` |
| Kimi host 10316 re-graded 32/32 against Moonshot's endpoint, which OpenRouter now lists as `moonshotai` | `docs/evidence/grades_20261114T143548Z.json` |

## Built, not yet switched on

| Item | What it changes |
|---|---|
| Check suite v1 (`--checks v1`) | Adds a `max_tokens` billing check and a stop-sequence check to the grade |

## Next

| Item | Why |
|---|---|
| A signing gateway in front of any OpenAI-compatible router, with streaming | Receipts for traffic to hosts that don't run Assay's proxy |
| A second EVM chain with the RIP-7212 P-256 precompile | The same receipts and grades readable on another chain |
| x402 pay-after-check | An agent reads the grade onchain and pays per request only when it passes |
| A grade from an outside verifier, re-checked by CRE | Today every grade comes from Assay's own verifier |
| A real domain for the hosts and the app | Replaces the workers.dev and vercel.app hostnames |
| Monthly host report with every raw log | One place to compare every host for the models we cover |

## Later

| Item | Why |
|---|---|
| Hosts that sign from inside a TEE | A TEE quote that includes a model hash is the path to proving which weights ran |
| `anchorK` for secp256k1 hosts | Hosts whose node key is secp256k1 can anchor without a P-256 key |
| Keys in Cloud KMS, with a rotation runbook | The host key no longer lives in a Worker secret |
| CRE live spot checks | Nodes call a host directly on a schedule, so the DON becomes a verifier and not only a re-checker |
| ES384 support | NVIDIA attestation tokens use ES384. Monad has no P-384 precompile, so this needs offchain checks or a wrapper |

## Where else this shows up

| Place | What it covers |
|---|---|
| [Threat model](../security/threat-model.md) | Known limits that the roadmap addresses |
| [Welcome to Assay](../README.md) | Back to the start |

Next: [Welcome to Assay](../README.md)
