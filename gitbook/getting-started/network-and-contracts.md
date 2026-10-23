---
description: Chain details, contract addresses, deploy transactions and ERC-8004 ids on Monad mainnet and testnet.
icon: network-wired
---

# Network and contracts

**Where:** `docs/deployments.md` in the repo, and the broadcast records in `contracts/broadcast/Deploy.s.sol/`.

Assay runs on Monad mainnet (chain 143) since 5 Oct 2026. The same contracts stay live on Monad testnet (chain 10143) as the place to try things for free. Every contract on this page is verified on Sourcify with an exact match.

## Networks

| Field | Mainnet | Testnet |
|---|---|---|
| Chain id | `143` | `10143` |
| RPC | `https://rpc.monad.xyz` | `https://testnet-rpc.monad.xyz` (alias `monad_testnet` in `foundry.toml`) |
| Explorer | [monadvision.com](https://monadvision.com) | [testnet.monadvision.com](https://testnet.monadvision.com) |
| P256VERIFY precompile | `0x0100` (EIP-7951) | `0x0100` |
| Compiler | solc 0.8.30, `evm_version = "osaka"`, Foundry 1.7.1 | same |

## Mainnet contracts

Deployed 5 Oct 2026 from the same source as testnet. `ReceiptAnchor` uses `requireUV = true`.

| Contract | Address | Deploy tx | Block |
|---|---|---|---|
| ReceiptAnchor | [`0x049A73755cA3508ef3Daa4752A3406f6e00CfB13`](https://monadvision.com/address/0x049A73755cA3508ef3Daa4752A3406f6e00CfB13) | [`0x293c2684…`](https://monadvision.com/tx/0x293c2684a3fefd2ae2deec1a432eee78c591d41eed848efe02f5a5c1b89d1545) | 110678733 |
| VerifierRegistry | [`0x0C8603041E7d425c4DCa041680C7AF4581dDa9a1`](https://monadvision.com/address/0x0C8603041E7d425c4DCa041680C7AF4581dDa9a1) | [`0x8649c6ab…`](https://monadvision.com/tx/0x8649c6abab999a902feb4d8ba79b14b3b553dfd5374313ca8c6a88f8f6372dfe) | 110678737 |
| CreAttestor v2 | [`0x71EDfF0bcd68ba2508C4B08a8606F76C5C26915E`](https://monadvision.com/address/0x71EDfF0bcd68ba2508C4B08a8606F76C5C26915E) | [`0x3d477d63…`](https://monadvision.com/tx/0x3d477d634db1a72bd58d215733ee96e14f3a8be0df70fc10761c265e92344bcd) | 111604847 |
| AssayAccount (EIP-7702 delegate) | [`0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91`](https://monadvision.com/address/0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91) | [`0x0ed03b80…`](https://monadvision.com/tx/0x0ed03b802f4b6a254445965401bd606d5ae0ed0ff4b98b41aab36b2c0ce057f2) | 111308700 |

CreAttestor v1 (`0xAD9e30dcC63670E1e54f1f12468D16eC1bceDf7a`) was retired on 8 Oct: anyone could write to it through the CRE simulator's shared forwarder. v2 also requires that our relayer sent the transaction and accepts one report per grade. See [Chainlink CRE](../integrations/chainlink-cre.md).

## Mainnet agents

| Role | agentId | Owner | In receipts and grades |
|---|---|---|---|
| Gemma 4 31B host (Google's API) | 10278 | `0xF3CbD8aaf1f2350bFd8a3220Ab4E83FDd8fa18d9` | `erc8004:143:10278` |
| Kimi K2.6 host (Moonshot's endpoint through OpenRouter) | 10316 | `0xF3CbD8aaf1f2350bFd8a3220Ab4E83FDd8fa18d9` | `erc8004:143:10316` |
| Verifier | 10279 | `0x4BaC2Be288B5931886EeC4c555895CE6BcAB19e7` | posts every Assay grade |

| Host | URL |
|---|---|
| 10278 | https://34-45-1-81.sslip.io/mainnet |
| 10316 | https://34-45-1-81.sslip.io/kimi |

## Testnet contracts

The current testnet deployment is from 3 Oct 2026.

| Contract | Address | Deploy tx | Block |
|---|---|---|---|
| ReceiptAnchor | [`0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24`](https://testnet.monadvision.com/address/0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24) | [`0x32d12f86…`](https://testnet.monadvision.com/tx/0x32d12f86ec3dca22d7b25ec33985eeda69f94e7299592728b16b2896715a1022) | 67461080 |
| VerifierRegistry | [`0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91`](https://testnet.monadvision.com/address/0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91) | [`0x246d2ef1…`](https://testnet.monadvision.com/tx/0x246d2ef1d317d9ef4dc21318ef16a60f50bc1e4818685058228669f0b48abfd8) | 67461086 |
| CreAttestor | [`0xB4A1CB9e40aDa44570Ae790430C23876d460deDC`](https://testnet.monadvision.com/address/0xB4A1CB9e40aDa44570Ae790430C23876d460deDC) | [`0x0d2dc7b2…`](https://testnet.monadvision.com/tx/0x0d2dc7b2fc51c718226a28bc2b0027a94d74409b1060f47b795d9582ab6bb00a) | 67462996 |
| AssayAccount (EIP-7702 delegate) | [`0x4eaDaC20fc6842F360884a31cfA11411C664a2A1`](https://testnet.monadvision.com/address/0x4eaDaC20fc6842F360884a31cfA11411C664a2A1) | [`0xf8844127…`](https://testnet.monadvision.com/tx/0xf8844127b363252cbefd3c867f3c8f6a68fdfea91db9bb543ee3ee6e213d1114) | 68954825 |

Testnet agents: host **1962** (`erc8004:10143:1962`, https://34-45-1-81.sslip.io) and verifier **1981**. The first version from 1 Oct (no `cosignK`) is listed in `docs/deployments.md`; its addresses happen to equal the mainnet ReceiptAnchor and VerifierRegistry addresses because the same deployer was at the same nonce.

## ERC-8004 registries

| Registry | Mainnet | Testnet |
|---|---|---|
| IdentityRegistry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ReputationRegistry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

These are the official deployments from `erc-8004/erc-8004-contracts`.

## Milestones on mainnet

| What | Tx |
|---|---|
| First receipt anchored (Gemma 4 31B through host 10278), `verifyReceipt` returns true | [`0x48bcf6ab…`](https://monadvision.com/tx/0x48bcf6abe5914a1a8aee3678a6f84eeb2773c4131bd670e995e44e34dd49a9a4) |
| First grade: host 10278 against Google's own API | [`0x1e0b1d63…`](https://monadvision.com/tx/0x1e0b1d63984ff0140e675c116003fd36968816ffbc30d6040fb2c2defb980d50) |
| First CRE re-check on CreAttestor v2, `agree=true` | [`0x05c7641a…`](https://monadvision.com/tx/0x05c7641ad17ec675b602e4676ff7edfb2b33c7b5c70f7722ca51137775410a57) |
| First paid job: Kanmani's escrow settled 5 receipts from host 10278 | [`0x69aef08c…`](https://monadvision.com/tx/0x69aef08cc9f2afcde92f80ab9b367c9e23b11ca55c0a18ee08071feabadc2ec3) |

## How to check an address yourself

1. Open the address on the explorer and confirm the Sourcify verification badge.
2. Read a value with `cast`, for example the anchor tag:

```bash
cast call 0x049A73755cA3508ef3Daa4752A3406f6e00CfB13 "ANCHOR_TAG()(bytes32)" \
  --rpc-url https://rpc.monad.xyz
```

3. Compare it with `cast keccak "assay-anchor/0"`. They must match.

## Where else this shows up

| Place | Uses |
|---|---|
| [Host API](../developers/host-api.md) | `ANCHOR_ADDRESS` and `HOST_AGENT_ID` in the host's environment |
| [Indexer and GraphQL](../developers/indexer.md) | One deployment indexes both chains |
| [Contracts reference](../developers/contracts.md) | Every function on these addresses |

{% hint style="warning" %}
Testnet has been reset before (16 Dec 2025). If it resets again the testnet addresses change; mainnet addresses don't.
{% endhint %}

Next: [Receipts](../how-it-works/receipts.md)
