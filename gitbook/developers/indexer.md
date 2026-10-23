---
description: The Envio indexer's entities, what each one answers, and GraphQL queries you can paste.
icon: database
---

# Indexer and GraphQL

**Where:** `indexer/` (Envio HyperIndex, its own install, outside the pnpm workspace). `schema.graphql` defines the entities and `src/` holds the handlers. Live endpoint (public, read-only): `https://indexer.dev.hyperindex.xyz/557d70c/v1/graphql`. Locally the API is at `http://localhost:8080`.

The indexer joins Assay's contracts with the ERC-8004 identity registry and the CRE attestor. Handlers compute drift, leaderboards, activity and key history at index time, so GraphQL only reads.

## Sources

One deployment indexes Monad mainnet (143) and testnet (10143) over HyperSync. Mainnet sources:

| Contract | Address | Start block |
|---|---|---|
| ReceiptAnchor | `0x049A73755cA3508ef3Daa4752A3406f6e00CfB13` | 110678733 |
| VerifierRegistry | `0x0C8603041E7d425c4DCa041680C7AF4581dDa9a1` | 110678737 |
| CreAttestor v2 | `0x71EDfF0bcd68ba2508C4B08a8606F76C5C26915E` | 110678745 |
| ERC-8004 IdentityRegistry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | 110678733 |
| ERC-8004 ReputationRegistry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | 110678733 |

Testnet sources, with the events each contract emits:

| Contract | Address | Start block | Events |
|---|---|---|---|
| ReceiptAnchor | `0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24` | 67461080 | `HostKeySet`, `Anchored`, `Cosigned`, `CosignedK` |
| VerifierRegistry | `0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91` | 67461086 | `VerifierRegistered`, `GradePosted` |
| ERC-8004 IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | 67269800 | `Registered` |
| CreAttestor | `0xB4A1CB9e40aDa44570Ae790430C23876d460deDC` | 67462996 | `GradeAttested` |

## Entities

Every id starts with the chain id: `143-…` on mainnet, `10143-…` on testnet. The examples below use testnet ids; swap in `143-10278` or `143-10316` for the mainnet hosts.

| Entity | Id | Answers |
|---|---|---|
| `Agent` | `10143-<agentId>` | Who is this agent? Owner, card name, services, current key, lifetime counts |
| `HostKey` | `10143-<agentId>-<keyHash>` | Which key does a host sign with, is it active, how many anchors did it sign? |
| `KeyRotation` | `10143-<agentId>-<block>-<logIndex>` | When did a host change keys, and how many anchors did the old key sign? |
| `Anchor` | `10143-<agentId>-<root>` | Was this root anchored, by which key, with how many receipts and co-signs? |
| `Cosign` | `10143-<receiptHash>-<requester>` | Who co-signed this receipt? `kind` is `P256` or `K` |
| `HostActivity` | `10143-<agentId>-<YYYY-MM-DD>` | Anchors, receipts and co-signs per host per UTC day |
| `Verifier` | `10143-<address>` | Which agent a verifier belongs to, and its grade count |
| `Grade` | `10143-<verifier>-<model>-<hostKey>-<t>` | One posted grade with any CRE attestations |
| `HostModelStats` | `10143-<verifier>-<model>-<hostKey>` | Latest grade, count, pass rate, drift count and rank |
| `DriftEvent` | same as the new grade | Did the host get worse? Written when the new `ciHighBps` is below the previous `ciLowBps` |
| `ModelLeaderboard` | `10143-<verifier>-<model>` | Which host leads a model for this verifier? |
| `GradeAttestation` | `10143-<attestor>-<verifier>-<model>-<hostKey>-<t>` | Did the Chainlink DON agree with a grade? |

## Rules the handlers follow

| Rule | Detail |
|---|---|
| Leaderboards are per verifier | Readers choose verifiers, so there is no global ranking |
| Ranking order | Higher `ciLowBps`, then higher `ciHighBps`, then `hostKey` |
| `passRateBps` | Sum of `passed` over sum of `total` across every grade for that host, model and verifier |
| Drift | The whole new interval must sit below the old one. An overlapping drop does not count |
| Agent cards | Loaded with the Effect API from `agentURI`: `data:` decoded locally, `https://` fetched (10 s, 64 KiB), `ipfs://` through `ipfs.io`. Status is `OK`, `ERROR` or `UNSUPPORTED` |

## Example queries

Host trust check:

```graphql
query HostTrust {
  HostModelStats(where: {id: {_eq: "10143-<verifier>-<model>-<hostKey>"}}) {
    rank
    latestCiLowBps
    latestCiHighBps
    gradeCount
    passRateBps
    driftCount
    latest { passed total t evidence attestations { agree attestor } }
    leaderboard { hostCount leaderHostKey leaderCiLowBps }
  }
}
```

Drift feed:

```graphql
query DriftFeed {
  DriftEvent(order_by: {timestamp: desc}, limit: 20) {
    model
    hostKey
    previousCiLowBps
    ciHighBps
    dropBps
    timestamp
    verifier { address agentId }
    grade { evidence txHash }
  }
}
```

Leaderboard for one model and verifier:

```graphql
query Leaderboard {
  HostModelStats(
    where: {leaderboard_id: {_eq: "10143-<verifier>-<model>"}}
    order_by: {rank: asc}
  ) {
    rank
    hostKey
    latestCiLowBps
    latestCiHighBps
    gradeCount
  }
}
```

Activity for the reference host:

```graphql
query Activity {
  HostActivity(where: {agent_id: {_eq: "10143-1962"}}, order_by: {day: desc}, limit: 30) {
    day
    anchors
    receipts
    cosigns
  }
}
```

Agent profile with key history:

```graphql
query AgentProfile {
  Agent(where: {id: {_eq: "10143-1962"}}) {
    name
    cardStatus
    anchorCount
    receiptCount
    currentKey { keyHash setBlock }
    rotations(order_by: {block: asc}) { fromKey { keyHash } toKey { keyHash } anchorsUnderFromKey txHash }
  }
}
```

## Run it locally

1. `cd indexer && corepack pnpm install`
2. `corepack pnpm codegen` writes the types from `config.yaml` and `schema.graphql`.
3. `corepack pnpm test` runs the handler tests with simulated events. No network needed.
4. For live data, copy `.env.example` to `.env`, set `ENVIO_API_TOKEN`, start Docker, then `corepack pnpm dev`. The local console password is `testing`.

## Where else this shows up

| Place | Uses |
|---|---|
| [Envio](../integrations/envio.md) | Why Envio, and the hosted deploy |
| [Contracts reference](contracts.md) | The events behind each entity |
| [Verifiers and grades](../how-it-works/verifiers-and-grades.md) | What a grade means |

{% hint style="warning" %}
`hostKey` in these entities is the grade key (for an Assay host, `keccak256("erc8004:10143:<agentId>")`), not the P-256 key hash. The signing key's hash lives in `HostKey.keyHash` and in `Anchor.hostKey`. Mixing the two up returns empty results.
{% endhint %}

Next: [Web app](web-app.md)
