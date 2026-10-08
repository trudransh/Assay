---
description: Why Assay's read layer runs on Envio HyperIndex, what the handlers compute, and how to run or deploy it.
icon: magnifying-glass-chart
---

# Envio

**Where:** `indexer/` (Envio HyperIndex for `monad-testnet`). The entity reference is on [Indexer and GraphQL](../developers/indexer.md).

Envio is Assay's read layer. Every trust question an app asks, like which key signed this batch or whether a host is drifting, is answered from entities the handlers compute at index time.

## Problem

Assay's data is spread across events in its own contracts and the ERC-8004 registry, and it only means something when joined. A grade is useless without the host's identity, and an anchor is useless without the key that signed it. Answering "can I trust host X for model Y right now?" from raw RPC means scanning every log on every request.

## Why Envio

| Need | What HyperIndex gives |
|---|---|
| Several contracts in one place | Typed handlers over many contracts and chains in one `config.yaml` |
| Fast backfill | HyperSync, much faster than RPC log scans |
| Reorg safety | Handled by the framework, so handlers hold no rollback logic |
| A query API | GraphQL out of the box |
| External data | The Effect API, used here to load ERC-8004 agent cards |

## What we built

| Piece | Detail |
|---|---|
| Sources | ReceiptAnchor, VerifierRegistry, CreAttestor, and the ERC-8004 Identity and Reputation registries, synced through HyperSync with no RPC |
| 12 entities | Including `HostModelStats`, `DriftEvent`, `ModelLeaderboard`, `KeyRotation` and `HostActivity` |
| Derived at index time | Drift, per-verifier leaderboards, daily activity, key history |
| Agent cards | Fetched from `agentURI` through the Effect API, with timeouts and size limits |
| Chain-prefixed ids | `10143-…`, so a second chain is a config change and not a migration |
| Handler tests | 22, on simulated events with no network |
| Live | Envio Cloud dev plan, synced to the chain head: `https://indexer.dev.hyperindex.xyz/557d70c/v1/graphql` |

## How to try it

1. `cd indexer && corepack pnpm install && corepack pnpm codegen && corepack pnpm test`
2. With Docker running and `ENVIO_API_TOKEN` set: `corepack pnpm dev`, then open `http://localhost:8080`.
3. Paste the "Activity" query from [Indexer and GraphQL](../developers/indexer.md).

It's deployed on Envio Cloud's free development plan from the `indexer/` folder (dashboard "Indexer Directory" `./indexer`) and redeploys on every push to the `envio` branch.

## What it drives

| Page | From the indexer |
|---|---|
| [Receipt page](https://assay-ten-xi.vercel.app/app/#r/0x9a166cacb2ffe4784ad556f69b690b7cebf71150f737a5a3c324f9e98e7907e5) | One query by batch root: batch size, block, transaction, **the key that signed this batch**, and every co-signature of the receipt. The contract only stores the current key, so after a rotation this card can't be built from the chain |
| [Host profile](https://assay-ten-xi.vercel.app/app/#hosts/1962) | One query for the whole page: counts, 14 days of activity, batches with their signing keys, key history, identity and endpoints |

A new receipt goes from the request to an anchor on Monad in a few seconds, and to the indexer and these pages in under a minute.

## HyperSync analytics

`indexer/scripts/hypersync_stats.py` asks HyperSync directly, with no RPC and no indexer, for every `Anchored` event and its transaction's gas, then reports per host: batches, receipts, gas per batch, MON spent and MON per receipt.

```bash
ENVIO_API_TOKEN=... python3 indexer/scripts/hypersync_stats.py
```

On Monad testnet (4 Oct 2026), host 1962 had 6 batches of 1 receipt each, at 86,581 gas billed per batch (Monad bills the gas limit). That's about 0.0088 MON per receipt at one receipt per batch, or about 0.00014 MON per receipt at 64 per batch.

Next: [Chainlink CRE](chainlink-cre.md)
