---
description: How open verifiers test hosts against the lab's own endpoint, post grades onchain, and how you read them.
icon: scale-balanced
---

# Verifiers and grades

**Where:** `VerifierRegistry.registerVerifier`, `postGrade` and `gradeOf`. The grader in `harness/assay_probe.py` and `harness/export_grade.py`. SDK `gradeOf` and `gradeStatus`. The Grades tab in the web app.

A receipt proves who served the bytes, not which weights ran. Grades fill that gap: a verifier runs the same tests against a host and against the lab's own endpoint, then posts the result with a confidence interval and a hash of the raw logs.

## Grade fields

| Field | Meaning |
|---|---|
| `model` | `keccak256(utf8(model id))`, for example of `"z-ai/glm-5.3"`. |
| `hostKey` | Who was graded. See the table below. |
| `checks` | `keccak256(utf8("assay-checks/tool-calls-v0"))` for the current suite. |
| `passed`, `total` | Passing tool cases out of all cases that got HTTP 200. `total` must be above zero. |
| `ciLowBps`, `ciHighBps` | 95% Wilson interval in basis points. Low rounds down, high rounds up, both within `[0, 10000]`. |
| `refModel` | `keccak256(utf8(reference tag))`, the lab endpoint used as reference. |
| `evidence` | `0x` + sha256 of the evidence tarball (summary CSV, raw JSONL and `provenance.json`). |
| `t` | Grade time in Unix seconds. Must not be in the future, and must be newer than this verifier's last grade for the same pair. |

## Host keys

| Host | `hostKey` | SDK |
|---|---|---|
| Assay host with an ERC-8004 identity | `keccak256(utf8("erc8004:<chainId>:<agentId>"))` | `hostKeyForAgent(143, 10278)` |
| OpenRouter endpoint | `keccak256(utf8("openrouter:" + tag))` | `hostKeyForEndpoint("deepinfra/fp8")` |
| A lab's own API graded directly | `keccak256(utf8("direct:<host>"))` | `hostKeyForDirect("api.example.com")` |

Grades follow the host's identity and not its signing key, so rotating a key can't wipe a bad grade.

## Status

`gradeStatus(grade, { now, reference })` turns a grade into one word:

| Status | Rule | Web app text |
|---|---|---|
| `pass` | Recent, at least 30 samples, not below the reference. | "Graded recently with enough samples, and not below the reference." |
| `warn` | Recent, but `total < 30`. | "Graded recently, but on fewer than 30 samples." |
| `fail` | The host's `ciHighBps` is below the reference's `ciLowBps`. | "Below the reference: the host's best case is under the reference's worst case." |
| `unknown` | No grade, or older than 7 days. | "No recent grade from a verifier you trust (none, or older than 7 days)." |

## Steps for a verifier

1. Register an ERC-8004 identity, then call `registerVerifier(agentId)` from the owning address.
2. Dry run the grader first: `python3 harness/assay_probe.py --model z-ai/glm-5.3 --dry-run`.
3. Run it for real, then `python3 harness/export_grade.py` to get `grades_<stamp>.json` and the evidence bundle.
4. Publish the evidence bundle where readers can fetch it by its sha256.
5. Call `postGrade(grade)` for each endpoint. A first post costs about 196,000 gas.

## Assay's own grades

Verifier 10279 (`0x4BaC2Be288B5931886EeC4c555895CE6BcAB19e7`) grades on Monad mainnet. A job re-grades hosts 10278 and 10316 every Monday and Thursday and alerts if any grade is more than 5 days old, so a pass doesn't quietly turn into "unknown". Each run's evidence is in `docs/evidence/` in the repo, and its `provenance.json` names the grader's git commit, who ran it and their stance (`vouches` or `ran-grader`).

| Model | Host | Reference |
|---|---|---|
| `gemma-4-31b-it` | `erc8004:143:10278` | `direct:generativelanguage.googleapis.com` |
| `moonshotai/kimi-k2.6` | `erc8004:143:10316` and the Kimi K2.6 hosts on OpenRouter (`openrouter:<tag>`) | `openrouter:moonshotai/int4` |

## Steps for a reader

1. Pick the verifier addresses you trust.
2. Call `gradeOf(model, hostKey, trusted)`. The newest grade among them wins, and ties go to the verifier listed first.
3. Pass the result to `gradeStatus`, with the reference endpoint's grade if you have it. In an app, `chainGradeCheck` in the SDK does steps 2 and 3 and can gate `wrap()`.
4. Download the evidence, check its sha256 against `evidence`, and recount if you want to.

## Revert reasons

| Error | When |
|---|---|
| `NotAgentOwner()` | `registerVerifier` called by an address that doesn't own the agent. |
| `NotVerifier()` | Not registered, or the ERC-8004 identity has since moved to another owner. |
| `BadCounts()` | `total == 0` or `passed > total`. |
| `BadInterval()` | `ciLowBps > ciHighBps` or `ciHighBps > 10000`. |
| `FutureTimestamp()` | `t` is after the block time. |
| `StaleGrade()` | `t` is not newer than this verifier's stored grade for the pair. |

## Where else this shows up

| Place | What it does |
|---|---|
| [Contracts reference](../developers/contracts.md) | `VerifierRegistry` functions and events |
| [Indexer and GraphQL](../developers/indexer.md) | `HostModelStats`, `DriftEvent` and `ModelLeaderboard` |
| [Chainlink CRE](../integrations/chainlink-cre.md) | A DON re-checks posted grades |
| [Hosting report](../resources/hosting-report.md) | Why grades are needed |

{% hint style="warning" %}
The registry never filters out anyone. A grade only counts if you put its verifier in your `trusted` list. A host marked below the reference gets its logs and 7 days to reply before Assay posts that grade.
{% endhint %}

Next: [Privacy](privacy.md)
