<div align="center">

<img src="web/public/assay-mark.svg" alt="Assay" width="96" />

# Assay

### Signed receipts for AI responses, anchored on Monad

**The host signs what it served. Monad holds the proof. Open verifiers grade the host. You decide whose grades count.**

[![Live app](https://img.shields.io/badge/live%20app-assay--ten--xi.vercel.app-C9A227?style=for-the-badge&logo=googlechrome&logoColor=white)](https://assay-ten-xi.vercel.app)
[![Docs](https://img.shields.io/badge/docs-assay.gitbook.io-4FC3F7?style=for-the-badge&logo=gitbook&logoColor=white)](https://assay.gitbook.io/assay-docs)
[![Monad mainnet](https://img.shields.io/badge/Monad-mainnet%20143-8B73FF?style=for-the-badge)](https://monadvision.com/address/0x049A73755cA3508ef3Daa4752A3406f6e00CfB13)
[![Tests](https://img.shields.io/badge/tests-537-B8F03C?style=for-the-badge)](#security)
[![CI](https://img.shields.io/github/actions/workflow/status/trudransh/Assay/contracts.yml?branch=main&style=for-the-badge&label=contracts)](https://github.com/trudransh/Assay/actions)
[![License](https://img.shields.io/badge/license-MIT-EDE6D6?style=for-the-badge)](LICENSE)

<br />

| 💬 **Ask, get a receipt** | 🧾 **A live receipt** | 🖥️ **Host profile** | 📚 **Docs** | 📜 **Spec** | 📊 **Report** |
|:--:|:--:|:--:|:--:|:--:|:--:|
| [/app/#ask](https://assay-ten-xi.vercel.app/app/#ask) | [first on mainnet](https://assay-ten-xi.vercel.app/app/#r/0x1b443b455e55360cec874215c9d1ae3113794f6d3a6c2a0c480387b12e35c5f2) | [agent 10278](https://assay-ten-xi.vercel.app/app/#hosts/10278) | [gitbook](https://assay.gitbook.io/assay-docs) | [SPEC.md](SPEC.md) | [REPORT_v0](report/REPORT_v0.md) |

</div>

---

## Why

You call an open-weight model through someone else's host, and the text comes back with no proof of who served it.

The hosts don't all serve the same thing. On 26 Sep 2026, OpenRouter listed **735 open-weight endpoints**. **39% don't state their precision** and 15% declare 4-bit. GLM-5.3 alone has **37 endpoints**: 16 state no precision, and output prices run from **$1.19 to $8.80** per million tokens. The same weights score differently depending on who serves them. Olly measured DeepSeek V4 Flash at **90% on GPQA** through DeepSeek's own API and **75%** on another host. Cline measured GLM-5.2 at 74.2% on one host and 61.8% on default routing.

The checks that exist stay where they were made. A router's grades only work inside that router, and a lab's verifier only covers its own models. Nothing travels with the answer.

**Assay is the part that travels.** Every response gets a receipt. Hosts can't deny what they signed, verifiers grade hosts in public against the lab's own API, and anyone can check both without trusting us.

We measured one difference ourselves on 8 Oct. Sixteen hosts on OpenRouter answered our Kimi K2.6 checks, and on tool calling all of them matched Moonshot's own endpoint, 32 of 32. Then we capped the answer at 16 tokens. Three of those hosts ignored the cap in 59 of 60 trials, returned about 2,000 tokens, and were billed 70 to 126 times what Moonshot charged for the identical request. They ignored it even with OpenRouter's `require_parameters` on, so it's the provider and not the router. [Method, numbers and the sealed raw data](docs/evidence/max-tokens-kimi-k2.6.md); the hosts are named on 15 Oct, after their 7 days to reply.

### Where it stands (8 Oct)

| | What | Evidence |
|---|---|---|
| ✅ | Receipts signed by two hosts and anchored on Monad mainnet (Gemma 4 31B, and Kimi K2.6 from Moonshot's own endpoint) | [`docs/deployments.md`](docs/deployments.md) |
| ✅ | A requester's browser passkey co-sign, verified onchain by Monad's P256 precompile, and replayed byte for byte in CI | [tx `0x4377e096…`](https://monadvision.com/tx/0x4377e096251c19019852b6d5b29cef786e7dfc4a9101c3b055c2c7d1af96075c) · `MainnetReplayTest` |
| ✅ | Grades onchain against the lab's own endpoint: 19 on mainnet (17 of them Kimi K2.6), 43 on testnet (GLM-5.3 and Gemma) | [`docs/evidence/`](docs/evidence/) |
| ⚠️ | Every grade so far comes from Assay's own verifier. Anyone can register and post, and readers pick whose grades count, but nobody else has posted yet | `VerifierRegistry.registerVerifier` |
| ⚠️ | Chainlink CRE re-checks real mainnet grades, but as simulation broadcasts, not a deployed DON. The first attestor accepted any simulator broadcast; its replacement only accepts our relayer and writes each grade once | [`cre/`](cre/) · `CreAttestorTest` |
| ⚠️ | Per-app keys that never hold MON (EIP-7702 gas sponsorship) work end to end on testnet; there's no mainnet run yet | [`host/src/sponsor.ts`](host/src/sponsor.ts) |
| ⚠️ | The tool-calling checks are easy: every host we graded passed. The token-cap test is the first one that separates hosts | [`harness/`](harness/) |
| ❌ | Which weights ran. A receipt proves who served which bytes and what they claimed, not the model behind them | [roadmap](https://assay.gitbook.io/assay-docs/resources/roadmap) |
| ❌ | The SDK isn't on npm yet; it will be published as `assay-receipts` | [`sdk/`](sdk/) |

## What a receipt proves

| Mark | What it means | Checked by |
|---|---|---|
| 🟡 **HOST** | The host's ERC-8004 identity signed this exact response (ES256 over canonical JSON) | Your browser, against the host's published JWKS |
| ⚪ **MODEL** | The model the host claimed to serve | Signed into the receipt, so a false claim is a signed false claim |
| 🟣 **ANCHOR** | The receipt is in a batch whose Merkle root the host anchored on Monad | Monad: `ReceiptAnchor` checks the batch signature with the P256 precompile |
| 🩷 **YOU** | The person who asked co-signed the receipt with a passkey or a per-app key | Monad: WebAuthn through the P256 precompile, or `ecrecover` for per-app keys |

**What it doesn't prove: which weights actually ran.** A host can still sign a lie. With Assay that lie is signed, anchored and graded in public. Re-execution and TEE attestation are next on the [roadmap](https://assay.gitbook.io/assay-docs/resources/roadmap).

Your prompt and the answer never go onchain. The receipt holds salted hashes, and you keep the salt.

## How it fits together

```mermaid
flowchart LR
    subgraph You["👤 Requester"]
        APP["App or agent<br/>@assay/receipts · wrap(fetch)"]
        PK["Passkey<br/>Mera PRF vault + per-app keys"]
    end
    subgraph Host["🟡 Host"]
        H["OpenAI-compatible proxy<br/>signs every response"]
        UP["Upstream model"]
    end
    subgraph Monad["⛓️ Monad"]
        RA["ReceiptAnchor<br/>P256 · 0x0100"]
        VR["VerifierRegistry<br/>gradeOf(model, host, trusted[])"]
        CA["CreAttestor"]
        ID["ERC-8004<br/>Identity + Reputation"]
    end
    subgraph Trust["🛡️ Checking"]
        V["Open verifiers<br/>host vs lab's own API"]
        CRE["Chainlink CRE<br/>re-counts every grade"]
        IDX["Envio HyperIndex<br/>batches · keys · grades · drift"]
    end
    APP -->|"prompt + salt"| H --> UP
    H -->|"answer + signed receipt"| APP
    H -->|"Merkle root, one signature per batch"| RA
    PK -->|"co-sign"| RA
    V -->|"grade + evidence hash"| VR
    VR -. GradePosted .-> CRE -->|"agree / disagree"| CA
    RA -. events .-> IDX
    VR -. events .-> IDX
    ID -. ownerOf .-> RA
    ID -. ownerOf .-> VR
```

| Building block on Monad | What Assay does with it |
|---|---|
| **P256 precompile (`0x0100`)** | Host keys, cloud KMS keys and passkeys all sign with P-256. `ReceiptAnchor` checks the host's batch signature and the requester's WebAuthn co-signature onchain, at about 61k gas per anchor and 73k per co-sign. Two canary tests fail if the precompile ever goes missing and OpenZeppelin falls back to its ~250k-gas Solidity path. |
| **ERC-8004** | Every host and every verifier is an ERC-8004 agent. Grades follow the identity (`keccak256("erc8004:<chain>:<id>")`), not the signing key, so rotating a key can't wipe a bad grade. The indexer counts a complaint only if its sender co-signed the receipt it cites. |
| **Cheap, fast blocks** | One anchor per batch: about 0.0001 MON per receipt in a 64-receipt batch, so small batches can go onchain often (every 30 seconds on the reference host). |

## Thirty seconds of code

```ts
import { wrap, hostGradeCheck, verifyReceipt, GradeGateError } from "@assay/receipts";

// Refuse a host before sending (or paying) unless verifiers you trust grade it "pass"
const ask = wrap(fetch, {
  gate: {
    check: hostGradeCheck(HOST, { model: "z-ai/glm-5.3", host: "erc8004:10143:1962", verifiers: [MY_VERIFIER], reference: "openrouter:z-ai/fp8" }),
    allow: ["pass"],
  },
});

const { json, receipt, salt } = await ask(`${HOST}/v1/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ messages }),
}); // throws GradeGateError, and sends nothing, if the gate says no

// Anyone, later: every check on its own, each with the exact call that reproduces it
const result = await verifyReceipt({ body: receipt.body, jws: receipt.jws, jwks, proof, root, onchain: { client, anchor }, salt, output, messages });
result.checks;              // { jws, hash, kid, merkle, anchored, outputCommit, promptCommit, cosigned }
result.reproduce.anchored;  // { kind: "contract-call", address, function, args } → paste into cast
```

`@assay/receipts` is the `sdk/` workspace package. It isn't on npm yet; it will be published as `assay-receipts`, because the `@assay` scope belongs to someone else. [SDK reference](https://assay.gitbook.io/assay-docs/for-developers/sdk) · [Quickstart](https://assay.gitbook.io/assay-docs/getting-started/quickstart)

## Live on Monad mainnet (chain 143)

| Contract | Address | Deploy |
|---|---|---|
| **ReceiptAnchor** | [`0x049A73755cA3508ef3Daa4752A3406f6e00CfB13`](https://monadvision.com/address/0x049A73755cA3508ef3Daa4752A3406f6e00CfB13) | [tx](https://monadvision.com/tx/0x293c2684a3fefd2ae2deec1a432eee78c591d41eed848efe02f5a5c1b89d1545) |
| **VerifierRegistry** | [`0x0C8603041E7d425c4DCa041680C7AF4581dDa9a1`](https://monadvision.com/address/0x0C8603041E7d425c4DCa041680C7AF4581dDa9a1) | [tx](https://monadvision.com/tx/0x8649c6abab999a902feb4d8ba79b14b3b553dfd5374313ca8c6a88f8f6372dfe) |
| **CreAttestor** | [`0xAD9e30dcC63670E1e54f1f12468D16eC1bceDf7a`](https://monadvision.com/address/0xAD9e30dcC63670E1e54f1f12468D16eC1bceDf7a) | [tx](https://monadvision.com/tx/0x7949a60e38f42352079e082e8b85fa2337023dde5d181b3096856268be68219e) |
| **AssayAccount** (EIP-7702 delegate) | [`0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91`](https://monadvision.com/address/0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91) | [tx](https://monadvision.com/tx/0x0ed03b802f4b6a254445965401bd606d5ae0ed0ff4b98b41aab36b2c0ce057f2) |

Verified on Sourcify (exact match). Host agent **10278** and verifier agent **10279** are registered on the mainnet ERC-8004 registry. ⛓️ The [first mainnet receipt](https://monadvision.com/tx/0x48bcf6abe5914a1a8aee3678a6f84eeb2773c4131bd670e995e44e34dd49a9a4) is anchored, and `verifyReceipt` returns true onchain. The [first mainnet grade](https://monadvision.com/tx/0x1e0b1d63984ff0140e675c116003fd36968816ffbc30d6040fb2c2defb980d50) is posted too: host 10278 scored 38/38 against Google's own API. It's a plumbing check, because the host relays that same API, so it shows the loop works on mainnet rather than measuring host quality.

A second mainnet host, agent **10316**, serves Kimi K2.6 from Moonshot's own endpoint. Its grade is 32/32 against Moonshot's endpoint, and a Chainlink CRE re-check of that grade [agrees onchain](https://monadvision.com/tx/0x7b7c9eebd185972218932b5224da77cd8c68139ffb4c2ec3485cb6305e5af753) (a simulation broadcast, not a DON).

## Also on Monad testnet (chain 10143)

Testnet stays live as the free place to try things. The app has a network switch in the top bar.

| Contract | Address | Deploy |
|---|---|---|
| **ReceiptAnchor** | [`0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24`](https://testnet.monadvision.com/address/0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24) | [tx](https://testnet.monadvision.com/tx/0x32d12f86ec3dca22d7b25ec33985eeda69f94e7299592728b16b2896715a1022) |
| **VerifierRegistry** | [`0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91`](https://testnet.monadvision.com/address/0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91) | [tx](https://testnet.monadvision.com/tx/0x246d2ef1d317d9ef4dc21318ef16a60f50bc1e4818685058228669f0b48abfd8) |
| **CreAttestor** | [`0xB4A1CB9e40aDa44570Ae790430C23876d460deDC`](https://testnet.monadvision.com/address/0xB4A1CB9e40aDa44570Ae790430C23876d460deDC) | [tx](https://testnet.monadvision.com/tx/0x0d2dc7b2fc51c718226a28bc2b0027a94d74409b1060f47b795d9582ab6bb00a) |

All three are verified on Sourcify (exact match).

| Onchain so far | Proof |
|---|---|
| ⛓️ First real receipt anchored: Gemma 4 31B through the reference host (agent 1962). `verifyReceipt` returns true | [tx `0x41f73bca…`](https://testnet.monadvision.com/tx/0x41f73bcaa5270d16df2cbdafc920b0fa7f6e87890f968acece7f3c6a99a7a867) |
| 📈 First grade: Gemma 4 31B on OpenRouter's Google AI Studio route, 6/6, 95% interval 60.96% to 100% | [tx `0xbae5c59e…`](https://testnet.monadvision.com/tx/0xbae5c59e14a0f0653f41096323c6eae7f0e95533458027ef25b3823502ef88e0) |
| 🎯 Reference grade: same model on Google's own API, 19/19, 83.18% to 100% | [tx `0x137f910d…`](https://testnet.monadvision.com/tx/0x137f910d3e2181a9b2930170d47126370ae282e8dab7f8f91287b6aaa1dd16f6) |
| 🪪 Host agent 1962 key set · verifier agent 1981 registered | [`0xcfd45e43…`](https://testnet.monadvision.com/tx/0xcfd45e4304e7de3c0337eb83288d657e978efc2a0df614c74cfb1a9adcc7b8b4) · [`0x752c6fe5…`](https://testnet.monadvision.com/tx/0x752c6fe566c60f390a79c449c812afc1fcd8b6802b1877da7bdc6231da52d178) |

Both grades read `warn` until a host has 30 samples. The reference hosts run at https://34-45-1-81.sslip.io (testnet) and https://34-45-1-81.sslip.io/mainnet (mainnet), and anchor each batch within seconds. Every address and tx is in [`docs/deployments.md`](docs/deployments.md).

## Integrations

<table>
<tr>
<td width="50%" valign="top">

### 🔎 Envio HyperIndex
**Live on Envio Cloud**

Indexes every Assay contract plus ERC-8004 identity and reputation. Drift events, per-model leaderboards and key rotations are computed in handlers. The receipt page reads the batch, **the key that signed that batch** and the co-signs in one GraphQL query. The contract only stores a host's current key, so the indexer is the only place the old signing key lives.

Proof: [`indexer/`](indexer/) · [endpoint](https://indexer.dev.hyperindex.xyz/f15df95/v1/graphql) · 24 handler tests

</td>
<td width="50%" valign="top">

### 🔗 Chainlink CRE
**`grade-recheck` workflow**

One verifier could lie about a grade. On every `GradePosted` (finalized), the workflow downloads the evidence, checks its sha256, recounts pass and total, and recomputes the Wilson interval, and every node must agree on the result byte for byte. Before writing, it reads `VerifierRegistry` and `CreAttestor` at the finalized block, so it never attests a claim the registry doesn't hold, or the same grade twice. On mainnet it [re-checked two real grades](docs/deployments.md) and wrote **`agree=true`**. These are simulation broadcasts: no DON ran, our key relayed the simulator's output, and anyone can re-run the same check. An inflated replay (claims 10/10, the logs say 8/10) returns **`agree=false`**.

Proof: [`docs/evidence/cre-simulate-mainnet.txt`](docs/evidence/cre-simulate-mainnet.txt) · [`cre/`](cre/) · 31 tests

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🗝️ Mera PRF
**One passkey, many keys**

The passkey's PRF output derives an AES-GCM key for a vault that keeps your receipts and salts as ciphertext only, per-receipt reveal keys for showing one answer to one person, and per-app secp256k1 requester keys that can't be linked across apps. Nothing derived is stored, and a second device with the same passkey re-derives it all. Per-app keys co-sign onchain with `cosignK`, and the host pays the gas, so a per-app address never needs funding. So far that has run on testnet; there is no mainnet `cosignK` yet.

Proof: [`web/src/lib/vault.ts`](web/src/lib/vault.ts) · [`web/src/mera.ts`](web/src/mera.ts) · [docs](https://assay.gitbook.io/assay-docs/integrations/mera)

</td>
<td width="50%" valign="top">

### 🪪 ERC-8004
**Identity, reputation, receipts**

Hosts and verifiers are ERC-8004 agents, and `VerifierRegistry` re-checks ownership on every grade, because an identity can be sold. The indexer counts feedback against a host only if the sender co-signed the receipt it cites, so complaints come from people who were actually served.

Proof: `test_post_afterIdentityTransferred_reverts` · 3 fork tests against the real registry

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🛡️ MonadGuard
**Same receipt format, verified both ways**

MonadGuard checks the tool, Assay checks the model host that answered. Both sign ES256 over JCS with keys in a JWKS. Assay's verifier passes MonadGuard's mainnet receipts, and MonadGuard's `verify-foreign.mjs` passes six of ours (three on mainnet, one co-signed) with 10 of 10 checks, including a byte-for-byte JCS match. Each side pins the other's receipts as offline CI fixtures and checks that a copy with one byte flipped is rejected.

Proof: [`docs/interop/`](docs/interop/) · `sdk/test/interop.test.ts`

</td>
<td width="50%" valign="top">

### 📜 Mandate
**Only pay for inference from graded hosts**

A mandate bounds how much an agent spends. [PR #12](https://github.com/aliveevie/mandate/pull/12) adds `@ibxlab/mandate/assay`, so an agent under a mandate only pays inference hosts that verifiers it trusts grade `pass`. One view call to `gradeOf`, fails closed, no new dependencies, 10 tests.

Proof: [aliveevie/mandate#12](https://github.com/aliveevie/mandate/pull/12)

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🧠 Mida
**Context that carries its own receipt**

Mida keeps what one agent learned, encrypted under the user's keys, so the next agent the user approves can pick it up. A Mida record now carries the Assay receipt of the call that produced it, with its salt inside the encrypted body. Before using the context, the next agent runs `checkRecord`: the host must be pinned, the receipt anchored, and the salt must open both commits. The Mida team built their side and merged it into this repo. Their test run saved a receipt with one agent, read it with a second, then revoked the reader. They also found a gap in our offline mode, now fixed.

Proof: [PR #6](https://github.com/trudransh/Assay/pull/6) · [`examples/mida-context/`](examples/mida-context/) · `sdk/test/record.test.ts`

</td>
<td width="50%" valign="top">

### 🌙 Kimi K2.6
**A Kimi host, and every Kimi host graded**

Host agent 10316 serves Kimi K2.6 on mainnet from Moonshot's own endpoint, and every answer gets a receipt. We graded all 17 OpenRouter endpoints for Kimi K2.6, plus our host, against Moonshot's endpoint: 16 graded hosts and ours passed 32/32 tool-calling checks, whatever precision they claim (int4, fp4, fp8, bf16 or none). Three of them ignored the token limit set in the request. One rate-limited every request, so it got no grade.

Proof: [17 grades onchain](docs/deployments.md) · [`docs/evidence/grades_20261008T033914Z.json`](docs/evidence/grades_20261008T033914Z.json)

</td>
</tr>
<tr>
<td width="50%" valign="top">

### ⛽ Gas sponsorship (EIP-7702)
**Per-app keys that never hold MON**

A per-app address delegates to `AssayAccount` with EIP-7702, and the host's relayer pays the gas for its co-sign and for its ERC-8004 feedback. The relayer only pays for feedback about its own host that cites a receipt the sender co-signed, so it can't be drained for anything else. A fresh address with zero MON co-signed and filed feedback on testnet, and still had zero afterwards.

Proof: [`contracts/src/AssayAccount.sol`](contracts/src/AssayAccount.sol) · a fork test against the real ReputationRegistry · [`host/src/sponsor.ts`](host/src/sponsor.ts)

</td>
<td width="50%" valign="top">

### 💸 Kanmani escrow
**Proposed: pay a host per verified receipt**

Kanmani runs an escrow on Monad mainnet that settles metered jobs in USDC. They proposed buying responses from our host and settling one unit per receipt that verifies against our anchored batches. We agreed on the terms, but the first paid job hasn't run yet.

Proof: [issue #4](https://github.com/trudransh/Assay/issues/4)

</td>
</tr>
</table>

## Security

The threat model maps every attack to the test that blocks it: [docs](https://assay.gitbook.io/assay-docs/security/threat-model).

| Property | Proof (Foundry) |
|---|---|
| A host can't anchor with a key that isn't its own, or replay a batch | `test_anchor_wrongKey_reverts` · `test_anchor_replay_reverts` |
| A signature can't move to another chain or deployment, and the count can't be changed | `test_anchor_otherDeployment_reverts` · `test_anchor_countTampered_reverts` |
| One host can't front-run another host's root | `test_anchor_otherHostSameRoot_doesNotBlock` |
| A receipt only verifies under the host that anchored it | `test_verifyReceipt_otherHostsAnchor_false` |
| A stranger co-signing first can't block or impersonate the requester | `test_cosign_otherKeyFirst_doesNotBlock` · `test_cosignK_otherSignerFirst_doesNotBlock` |
| A passkey co-sign needs user verification and low-s | `test_cosign_missingUV_reverts` · `test_cosign_highS_reverts` |
| Key rotation keeps old anchors valid, and grades don't follow the key | `test_setHostKey_rotation_keepsOldAnchors` · `test_gradeOf_otherHostKeyIsSeparate` |
| Stale grades and sold identities can't post | `test_post_staleGrade_reverts` · `test_post_afterIdentityTransferred_reverts` |
| An attestor only accepts reports from its configured forwarder and workflow. The mainnet v1 instance is configured for the CRE simulator, whose forwarder and workflow ids are public, so anyone can write to it: its attestations show the check ran and can be re-run, not that our workflow alone wrote them | `test_onReport_nonForwarder_reverts` · `test_onReport_wrongWorkflowId_reverts` |
| The P256 precompile is live, never the 250k-gas fallback | `test_precompile_knownVector_returnsOne` · `test_valid_usesPrecompile_gasBound` |
| A real browser passkey co-sign from mainnet verifies, and changing any byte of it fails | `MainnetReplayTest` (replays the real anchor and co-sign transactions) |
| Only a host's own signature anchors, never twice, and a receipt verifies only under a host that anchored it | `ReceiptAnchorInvariantTest` (3 invariants, random call sequences) |
| A sponsored call only runs if the per-app key signed it, once, on this chain, before its deadline | `AssayAccountTest` (12 tests, including a fuzz test) |

| Package | Tests |
|---|---|
| Contracts (Foundry) | 121, plus fork tests against the real ERC-8004 registries |
| SDK `@assay/receipts` | 148, including cross-implementation checks of MonadGuard's receipts |
| Host | 74, plus a 16/16 end-to-end run on a local chain in CI |
| Web app | 96 |
| Grader (Python) | 43 |
| Envio indexer | 24, plus the HyperSync stats script |
| Chainlink CRE workflow | 31 |
| **Total** | **537**, across 6 CI workflows |

TypeScript and Solidity check each other: the SDK generates the signatures and Merkle proofs that the Foundry tests verify.

## Repository

| Path | Contents |
|---|---|
| [`contracts/`](contracts/) | Foundry: `ReceiptAnchor`, `VerifierRegistry`, `CreAttestor`, tests, fork tests, deploy scripts |
| [`sdk/`](sdk/) | `@assay/receipts`: receipts, salted commits, ES256 signing, Merkle batches, `verifyReceipt`, passkeys, `wrap(fetch)` with the grade gate, `gradeOf` |
| [`host/`](host/) | `@assay/host`: OpenAI-compatible proxy (Hono) that signs, batches and anchors, relays co-signs, serves `/v1/grade` |
| [`web/`](web/) | Landing page plus app: verify, receipt pages, ask and co-sign, grades, Mera vault (Vite, plain TypeScript) |
| [`indexer/`](indexer/) | Envio HyperIndex: anchors, keys, co-signs, grades, drift, leaderboards, ERC-8004 feedback |
| [`cre/`](cre/) | Chainlink CRE `grade-recheck` workflow and its simulations |
| [`harness/`](harness/) | The grader (Python, stdlib only): probes hosts against the lab's API, exports grades and evidence |
| [`report/`](report/) | Who's actually serving your model? Report v0 |
| [`docs/`](docs/) · [`gitbook/`](gitbook/) | Deployments, evidence, threat model; the GitBook site |

## Run it locally

You need Node 22+, pnpm (`corepack enable`) and Foundry 1.7+.

```bash
git clone --recurse-submodules https://github.com/trudransh/Assay.git && cd Assay && pnpm install
cd contracts && forge test -vv && cd ..          # contracts
pnpm -r test                                      # sdk, host, web
pnpm --filter @assay/host dev                     # host on :8787 (copy .env.example to .env first)
pnpm --filter web dev                             # app on :5173
```

Try the grader. The dry run needs no key and prints the cost first:

```bash
python3 harness/assay_probe.py --model z-ai/glm-5.3 --dry-run
```

After changing hashing, signing or Merkle code, run `pnpm --filter @assay/receipts gen:vectors`, then `forge test`, so both sides stay in step. Fork tests: `forge test --match-path "test/fork/*" --fork-url monad_testnet -vv`.

## Docs

[Welcome](https://assay.gitbook.io/assay-docs) · [Quickstart](https://assay.gitbook.io/assay-docs/getting-started/quickstart) · [Core concepts](https://assay.gitbook.io/assay-docs/getting-started/core-concepts) · [Receipts](https://assay.gitbook.io/assay-docs/how-it-works/receipts) · [Passkey co-signatures](https://assay.gitbook.io/assay-docs/how-it-works/cosign) · [Verifiers and grades](https://assay.gitbook.io/assay-docs/how-it-works/verifiers-and-grades) · [Privacy](https://assay.gitbook.io/assay-docs/how-it-works/privacy) · [SDK](https://assay.gitbook.io/assay-docs/for-developers/sdk) · [Threat model](https://assay.gitbook.io/assay-docs/security/threat-model) · [Roadmap](https://assay.gitbook.io/assay-docs/resources/roadmap)

## How this was built

Everything here was written during Monad Metropolis. The grader in `harness/` and report v0 were written in the last week of September, just before the first commit. Everything else, the contracts, SDK, host, indexer, CRE workflow and web app, was built from 30 September onward, and the commit history shows it day by day.

## Credits

Built on [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) 5.7.0 (`P256`, `WebAuthn`, `MerkleProof`), [Foundry](https://github.com/foundry-rs/foundry), [viem](https://github.com/wevm/viem), [jose](https://github.com/panva/jose), [canonicalize](https://github.com/erdtman/canonicalize) (RFC 8785), [@openzeppelin/merkle-tree](https://github.com/OpenZeppelin/merkle-tree), [Hono](https://github.com/honojs/hono), [Envio HyperIndex](https://envio.dev), [Chainlink CRE](https://chain.link) and [Mera](https://github.com/category-labs/mera). The ERC-8004 registries are the official deployments from [erc-8004/erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts). Third-party measurements are credited in the [report](report/REPORT_v0.md).

<div align="center">

**Assay** · MIT License · built for Monad Metropolis, Track 4

</div>
