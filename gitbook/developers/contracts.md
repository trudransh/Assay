---
description: Every function, event and error in ReceiptAnchor, VerifierRegistry and CreAttestor, with gas.
icon: file-contract
---

# Contracts reference

**Where:** `contracts/src/` (Solidity 0.8.30, Foundry, OpenZeppelin Contracts 5.7.0). Deployed addresses are on [Network and contracts](../getting-started/network-and-contracts.md).

Assay has three contracts. `ReceiptAnchor` holds host keys, batch anchors and co-signatures. `VerifierRegistry` holds grades. `CreAttestor` records Chainlink CRE re-checks of grades.

Gas numbers are the maximum from `forge test --gas-report` against a mock identity registry. On Monad the real ERC-8004 `ownerOf` call adds a little, so `setHostKey` lands around 75,000 to 80,000.

## ReceiptAnchor

Constructor: `ReceiptAnchor(IIdentityRegistry identity, bool requireUV)`. The live deployment uses `requireUV = true`.

### Functions

| Function | Who can call | Gas | What it does |
|---|---|---|---|
| `setHostKey(uint256 agentId, bytes32 qx, bytes32 qy)` | Owner of the ERC-8004 agent | ~75k | Sets or rotates the host's P-256 key. Emits `HostKeySet` |
| `anchor(uint256 agentId, bytes32 root, uint32 count, bytes32 r, bytes32 s)` | Anyone (signature decides) | ~61k | Stores a batch root signed by the host key. Emits `Anchored` |
| `verifyReceipt(uint256 agentId, bytes32 receiptHash, bytes32[] proof, bytes32 root) view returns (bool)` | Anyone | ~3.6k | `true` if the root is anchored under `agentId` and the proof matches |
| `cosign(uint256 agentId, bytes32 receiptHash, bytes32[] proof, bytes32 root, WebAuthnAuth auth, bytes32 qx, bytes32 qy)` | Anyone | ~73k | Records a passkey co-signature. Emits `Cosigned` |
| `cosignK(uint256 agentId, bytes32 receiptHash, bytes32[] proof, bytes32 root, bytes signature)` | Anyone | ~57k | Records a secp256k1 EIP-191 co-signature. Emits `CosignedK`. On mainnet and on the 3 Oct testnet deployment |
| `anchorMessage(uint256 agentId, bytes32 root, uint32 count) view returns (bytes)` | Anyone | | The bytes the host signs |
| `leafOf(bytes32 receiptHash) pure returns (bytes32)` | Anyone | | `keccak256(bytes.concat(keccak256(abi.encode(receiptHash))))` |
| `keyHashOf(bytes32 qx, bytes32 qy) pure returns (bytes32)` | Anyone | | `keccak256(abi.encode(qx, qy))` |
| `hostKeys(uint256 agentId) view returns (bytes32 qx, bytes32 qy)` | Anyone | | Current host key, `(0, 0)` if none |
| `anchors(uint256 agentId, bytes32 root) view returns (uint32 count, uint64 anchoredAt)` | Anyone | | The anchor record |
| `cosigned(bytes32 receiptHash, bytes32 requesterKey) view returns (bool)` | Anyone | | Passkey co-signature record |
| `cosignedK(bytes32 receiptHash, address signer) view returns (bool)` | Anyone | | secp256k1 co-signature record |
| `ANCHOR_TAG`, `identity`, `requireUV` | Anyone | | Constants and immutables |

`WebAuthnAuth` is OpenZeppelin's struct: `r`, `s`, `challengeIndex`, `typeIndex`, `authenticatorData`, `clientDataJSON`.

### Events

| Event | Emitted by |
|---|---|
| `HostKeySet(uint256 indexed agentId, bytes32 indexed keyHash, bytes32 qx, bytes32 qy)` | `setHostKey` |
| `Anchored(uint256 indexed agentId, bytes32 indexed root, uint32 count, bytes32 keyHash)` | `anchor` |
| `Cosigned(bytes32 indexed receiptHash, bytes32 indexed requesterKey, uint256 indexed agentId, bytes32 root)` | `cosign` |
| `CosignedK(bytes32 indexed receiptHash, address indexed signer, uint256 indexed agentId, bytes32 root)` | `cosignK` |

### Errors

| Error | Meaning |
|---|---|
| `NotAgentOwner()` | `msg.sender` doesn't own the ERC-8004 agent |
| `InvalidPublicKey()` | `(qx, qy)` is not on the P-256 curve, including `(0, 0)` |
| `UnknownHost()` | No key set for this agent |
| `EmptyBatch()` | `count == 0` |
| `RootAlreadyAnchored()` | Same host, same root, already anchored |
| `BadHostSignature()` | Host signature check failed |
| `ReceiptNotAnchored()` | `verifyReceipt` returned `false` inside `cosign` or `cosignK` |
| `AlreadyCosigned()` | Same key or signer already co-signed this receipt |
| `BadCosignature()` | WebAuthn or ECDSA check failed, including high `s` |

## VerifierRegistry

Constructor: `VerifierRegistry(IIdentityRegistry identity)`.

### Functions

| Function | Who can call | Gas | What it does |
|---|---|---|---|
| `registerVerifier(uint256 agentId)` | Owner of the agent | ~51k | Maps `msg.sender` to `agentId`. Emits `VerifierRegistered` |
| `postGrade(Grade g)` | A registered verifier that still owns its agent | ~196k first, less after | Stores the newest grade per `(verifier, model, hostKey)`. Emits `GradePosted` |
| `gradeOf(bytes32 model, bytes32 hostKey, address[] trusted) view returns (Grade g, address by)` | Anyone | ~1.4k plus ~16k per trusted verifier | Newest grade among `trusted`. Empty grade and `address(0)` if none. Ties go to the first listed |
| `latestGrade(address verifier, bytes32 model, bytes32 hostKey) view returns (Grade)` | Anyone | | One verifier's stored grade |
| `verifierAgentId(address) view returns (uint256)` | Anyone | | The verifier's agent id |

`Grade` is `(bytes32 model, bytes32 hostKey, bytes32 checks, uint32 passed, uint32 total, uint16 ciLowBps, uint16 ciHighBps, bytes32 refModel, bytes32 evidence, uint64 t)`.

### Events

| Event | Emitted by |
|---|---|
| `VerifierRegistered(address indexed verifier, uint256 indexed agentId)` | `registerVerifier` |
| `GradePosted(address indexed verifier, uint256 indexed verifierAgentId, bytes32 indexed model, bytes32 hostKey, uint32 passed, uint32 total, uint16 ciLowBps, uint16 ciHighBps, bytes32 checks, bytes32 refModel, bytes32 evidence, uint64 t)` | `postGrade` |

### Errors

| Error | Meaning |
|---|---|
| `NotAgentOwner()` | Caller doesn't own the agent |
| `NotVerifier()` | Not registered, or no longer owns its agent |
| `BadCounts()` | `total == 0` or `passed > total` |
| `BadInterval()` | `ciLowBps > ciHighBps` or `ciHighBps > 10000` |
| `FutureTimestamp()` | `t > block.timestamp` |
| `StaleGrade()` | `t` not newer than the stored grade |

## CreAttestor

Constructor: `CreAttestor(address owner, address relayer)`. Deployed by `script/Deploy.s.sol` only when `DEPLOY_CRE_ATTESTOR=true`. With a non-zero `relayer`, `onReport` only accepts transactions sent by that address. Live on mainnet as v2 at `0x71EDfF0bcd68ba2508C4B08a8606F76C5C26915E` (relayer `0x3F3c…a369`), configured for the CRE simulator's forwarder. See [Chainlink CRE](../integrations/chainlink-cre.md) for what its attestations mean.

### Functions

| Function | Who can call | Gas | What it does |
|---|---|---|---|
| `configure(address forwarder, address workflowOwner, bytes32 workflowId)` | `owner`, once | ~91k | Sets the CRE forwarder and pins reports to one workflow owner (and id, unless zero). Emits `Configured` |
| `onReport(bytes metadata, bytes report)` | The forwarder | ~61k | Decodes `(verifier, model, hostKey, t, passed, total, ciLowBps, ciHighBps, agree)` and stores the attestation. Emits `GradeAttested` |
| `attestations(address verifier, bytes32 model, bytes32 hostKey, uint64 t) view` | Anyone | | `(passed, total, ciLowBps, ciHighBps, agree)` |
| `supportsInterface(bytes4) pure returns (bool)` | Anyone | | `true` for IERC165 and the `onReport` selector |
| `owner`, `relayer`, `forwarder`, `workflowOwner`, `workflowId` | Anyone | | Configuration |

### Events

| Event | Emitted by |
|---|---|
| `Configured(address indexed forwarder, address indexed workflowOwner, bytes32 workflowId)` | `configure` |
| `GradeAttested(address indexed verifier, bytes32 indexed model, bytes32 indexed hostKey, uint64 t, bool agree, uint32 passed, uint32 total)` | `onReport` |

### Errors

| Error | Meaning |
|---|---|
| `NotOwner()` | `configure` from someone other than `owner` |
| `AlreadyConfigured()` | `configure` called a second time |
| `BadConfig()` | Zero forwarder or zero workflow owner |
| `NotForwarder()` | `onReport` from anyone but the forwarder |
| `BadMetadata()` | Metadata shorter than 64 bytes |
| `UnauthorizedWorkflow()` | Report from another workflow owner or id |
| `NotRelayer()` | `relayer` is set and the transaction wasn't sent by it |
| `AlreadyAttested()` | This grade already has an attestation |
| `BadReport()` | Wrong length (must be 288 bytes), or counts or interval out of range |

## Run the tests

```bash
cd contracts
forge test                     # 99 pass, 1 skipped (the fork suite is separate)
forge test --gas-report
forge test --match-path "test/fork/*" --fork-url monad_testnet -vv
```

## Where else this shows up

| Place | Uses |
|---|---|
| [SDK reference](sdk.md) | `receiptAnchorAbi`, `verifierRegistryAbi`, `anchorMessage`, `leafHash` |
| [Indexer and GraphQL](indexer.md) | Every event on this page |
| [Threat model](../security/threat-model.md) | The test behind each revert |

{% hint style="warning" %}
Keep `evm_version = "osaka"` in `foundry.toml`. Under `prague` the `0x0100` precompile is missing and OpenZeppelin silently falls back to about 250,000 gas per P-256 check. The tests `test_precompile_knownVector_returnsOne` and `test_valid_usesPrecompile_gasBound` exist to catch exactly that.
{% endhint %}

Next: [Indexer and GraphQL](indexer.md)
