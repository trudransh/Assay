---
description: How Assay uses Monad's P256 precompile and the ERC-8004 registries, and how to check both yourself.
icon: cube
---

# Monad

**Where:** `ReceiptAnchor` and `VerifierRegistry` on Monad mainnet (chain 143) since 5 Oct, and on testnet (chain 10143). The precompile is at `0x0100`. ERC-8004 IdentityRegistry is at `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` on mainnet and `0x8004A818BFB912233c491871b3d84c89A494BD9e` on testnet. Addresses: [Network and contracts](../getting-started/network-and-contracts.md).

Assay needs three things from a chain: cheap P-256 checks, a shared identity registry, and gas low enough to anchor small batches often. Monad has all three natively.

## Problem

Hosts sign with P-256 because that is what cloud KMS, HSMs, Intel TEEs and passkeys use. Without a precompile, OpenZeppelin's Solidity fallback costs about 250,000 gas per check, which makes every anchor and co-sign expensive. Hosts and verifiers also need an identity that isn't an account system Assay runs itself.

## Why Monad

| Feature | What it gives Assay |
|---|---|
| P256VERIFY at `0x0100` (EIP-7951) | A P-256 check for 6,900 gas. Host anchors and passkey co-signs are verified onchain directly |
| ERC-8004 IdentityRegistry | Every host and verifier is an ERC-8004 agent. The contracts call `ownerOf` on it |
| ERC-8004 ReputationRegistry (`0x8004B663056A597Dffe9eCcC1965A193B7388713`) | A place for verifier feedback. It blocks an agent's owner from rating itself, so the verifier uses a separate wallet |
| Low gas | One `anchor` is about 61,000 gas, about 0.006 MON at the minimum base fee. Over a 64-receipt batch that is about 0.0001 MON per receipt |

## What we built

| Piece | Detail |
|---|---|
| `ReceiptAnchor` | Host keys, anchors, `verifyReceipt`, `cosign`, `cosignK` |
| `VerifierRegistry` | Open verifiers, grades and `gradeOf` |
| Precompile canaries | `test_precompile_knownVector_returnsOne` and `test_valid_usesPrecompile_gasBound` fail if the precompile ever stops being used |
| Fork tests | Three tests against the real ERC-8004 registry on a fork of Monad testnet |
| Testnet evidence | `docs/evidence/day1-precompile-testnet.txt`: a valid vector returns `1`, a tampered one returns empty |

## How to try it

1. Call the precompile directly through the contract tests:

```bash
cd contracts && forge test --match-test test_precompile_knownVector_returnsOne -vv
```

2. Run the fork tests against the live registry:

```bash
forge test --match-path "test/fork/*" --fork-url monad_testnet -vv
```

3. Read the first anchor, whose host signature the precompile checked in a real transaction:

```bash
cast call 0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24 "anchors(uint256,bytes32)(uint32,uint64)" 1962 \
  0x5594c31b47c59350e82e11a4161b629c03ac85a36c02dc74c2630fde01086e57 --rpc-url https://testnet-rpc.monad.xyz
```

## Where else this shows up

| Place | What it covers |
|---|---|
| [Network and contracts](../getting-started/network-and-contracts.md) | Every address and transaction |
| [Contracts reference](../developers/contracts.md) | Gas per function |
| [Design decisions](../security/decisions.md) | Why `osaka` is pinned |

{% hint style="warning" %}
Monad bills the gas limit, not the gas used. Send transactions with `gas = estimate × 1.2`, as the host does, instead of a large fixed limit.
{% endhint %}

Next: [Envio](envio.md)
