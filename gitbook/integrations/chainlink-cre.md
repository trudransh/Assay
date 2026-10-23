---
description: How a Chainlink CRE workflow re-counts a posted grade from its evidence and records the result on Monad, and what that attestation does and doesn't mean.
icon: link
---

# Chainlink CRE

**Where:** `CreAttestor` in `contracts/src/CreAttestor.sol`, deployed on mainnet as v2 at `0x71EDfF0bcd68ba2508C4B08a8606F76C5C26915E`. The workflow lives in `cre/grade-recheck/`; run steps are in `cre/README.md`.

{% hint style="info" %}
Running on Monad mainnet since 8 Oct, through `cre workflow simulate --broadcast`. Every re-check so far agrees with the posted grade: host 10278 38/38 ([`0x05c7641a…`](https://monadvision.com/tx/0x05c7641ad17ec675b602e4676ff7edfb2b33c7b5c70f7722ca51137775410a57)), host 10316 32/32 ([`0x2a3bc90d…`](https://monadvision.com/tx/0x2a3bc90d2007ed6d5c45e658ef8edec1fd8e5ba0863681ff6f8967d4f35c4bff)) and Google's endpoint 39/39 ([`0x78b82c53…`](https://monadvision.com/tx/0x78b82c530ca3c4c827a0840ee8b2ac7f7f04b813476f65d351cf91ff52b074bf)). These are simulator runs relayed by our key, not a DON. See "What an attestation means" below.
{% endhint %}

## Problem

The weakest trust assumption in Assay is the verifier. One verifier runs the grader on one machine and posts a grade. Readers can choose verifiers, but each grade still comes from a single party who could lie, cherry-pick runs or go offline.

## Why CRE

A CRE workflow runs on a decentralized oracle network. Every node runs the same steps on its own, the results go through consensus, and the DON writes the result onchain. "A verifier says host X passed" becomes "a quorum of independent nodes recomputed it". A multisig of Assay's own servers would still be Assay, and an optimistic dispute game needs long challenge windows and a bond.

## What the workflow does

1. Trigger: an EVM log trigger on `GradePosted` from `VerifierRegistry` on Monad mainnet (or testnet).
2. Each node fetches the evidence bundle over HTTP.
3. Each node checks `sha256(bundle) == evidence` from the event.
4. Each node recounts `passed` and `total` from the raw log and recomputes the 95% Wilson interval.
5. Consensus on the identical result.
6. The DON writes a report to `CreAttestor.onReport`, which stores it and emits `GradeAttested(verifier, model, hostKey, t, agree, passed, total)`.

## What `CreAttestor` checks

| Check | Error |
|---|---|
| Caller is the configured forwarder | `NotForwarder()` |
| The transaction was sent by the configured relayer (v2) | `NotRelayer()` |
| Metadata is at least 64 bytes | `BadMetadata()` |
| Workflow owner matches, and workflow id matches if set | `UnauthorizedWorkflow()` |
| Report is exactly 288 bytes, counts and interval in range | `BadReport()` |
| No earlier report for the same grade (v2) | `AlreadyAttested()` |
| `configure` runs once, from the owner, with non-zero addresses | `NotOwner()`, `AlreadyConfigured()`, `BadConfig()` |

`onReport` costs up to about 61,000 gas.

## What an attestation means

Every `cre workflow simulate --broadcast` stamps the same placeholder workflow owner and id, and goes through the simulator's shared forwarder. So v2 also requires that our relayer sent the transaction, and each grade can be attested once. An attestation shows that the workflow ran on this grade, from its evidence, and that anyone can re-run it on the same transaction and get the same answer. It isn't a signature from a Chainlink DON: no DON ran, and our key relayed the simulator's output. A deployed workflow would write to a new attestor pinned to its own owner.

CreAttestor v1 (`0xAD9e30dcC63670E1e54f1f12468D16eC1bceDf7a`) trusted only the shared forwarder and ids, so anyone could write to it. It was retired on 8 Oct. The indexer and the app read v2 only.

## How to try it

1. Run the contract tests: `cd contracts && forge test --match-contract CreAttestor -vv`.
2. Re-run the re-check of host 10278's first mainnet grade yourself (needs a CRE account; without `--broadcast` nothing is written):

```bash
cd cre
cre workflow simulate grade-recheck -T mainnet-settings --non-interactive \
  --trigger-index 0 --evm-tx-hash 0x1e0b1d63984ff0140e675c116003fd36968816ffbc30d6040fb2c2defb980d50 --evm-event-index 0
```

The saved output is in `docs/evidence/cre-simulate-mainnet.txt`.

## Where else this shows up

| Place | Uses |
|---|---|
| [Contracts reference](../developers/contracts.md) | Full `CreAttestor` interface |
| [Indexer and GraphQL](../developers/indexer.md) | The `GradeAttestation` entity |
| [Verifiers and grades](../how-it-works/verifiers-and-grades.md) | The grades being re-checked |

{% hint style="warning" %}
The CRE forwarder is shared by every workflow on the network. That is why `CreAttestor` also pins reports to one workflow owner. Without that check, any workflow could write attestations.
{% endhint %}

Next: [Mera](mera.md)
