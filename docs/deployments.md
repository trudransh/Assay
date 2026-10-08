# Deployments

## Monad mainnet (chain 143)

Deployed 5 Oct 2026 with Foundry 1.7.1, solc 0.8.30 and `evm_version = "osaka"`, the same source as testnet. All three contracts are verified on Sourcify with an exact match. ReceiptAnchor uses `requireUV = true`. Both contracts point at the mainnet ERC-8004 IdentityRegistry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`. The deploy cost 0.426 MON.

| Contract | Address | Deploy tx | Block |
|---|---|---|---|
| ReceiptAnchor | [`0x049A73755cA3508ef3Daa4752A3406f6e00CfB13`](https://monadvision.com/address/0x049A73755cA3508ef3Daa4752A3406f6e00CfB13) | [`0x293c2684…`](https://monadvision.com/tx/0x293c2684a3fefd2ae2deec1a432eee78c591d41eed848efe02f5a5c1b89d1545) | 110678733 |
| VerifierRegistry | [`0x0C8603041E7d425c4DCa041680C7AF4581dDa9a1`](https://monadvision.com/address/0x0C8603041E7d425c4DCa041680C7AF4581dDa9a1) | [`0x8649c6ab…`](https://monadvision.com/tx/0x8649c6abab999a902feb4d8ba79b14b3b553dfd5374313ca8c6a88f8f6372dfe) | 110678737 |
| CreAttestor | [`0xAD9e30dcC63670E1e54f1f12468D16eC1bceDf7a`](https://monadvision.com/address/0xAD9e30dcC63670E1e54f1f12468D16eC1bceDf7a) | [`0x7949a60e…`](https://monadvision.com/tx/0x7949a60e38f42352079e082e8b85fa2337023dde5d181b3096856268be68219e) | 110678745 |
| AssayAccount (EIP-7702 delegate, 7 Oct) | [`0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91`](https://monadvision.com/address/0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91) | [`0x0ed03b80…`](https://monadvision.com/tx/0x0ed03b802f4b6a254445965401bd606d5ae0ed0ff4b98b41aab36b2c0ce057f2) | 111308700 |

| Identity or action | Tx | Block |
|---|---|---|
| Host agent **10278** registered (owner `0xF3CbD8aaf1f2350bFd8a3220Ab4E83FDd8fa18d9`) | [`0x5d0ae535…`](https://monadvision.com/tx/0x5d0ae5359f45b73b7b75596bb5cbb293ac0882f519b0efb2f74fa9621c8620ec) | 110682707 |
| Verifier agent **10279** registered (owner `0x4BaC2Be288B5931886EeC4c555895CE6BcAB19e7`) | [`0xd70e4728…`](https://monadvision.com/tx/0xd70e4728f598933eebaa574eea5ed5c4a764813417e992a3c58f604d0b1c4bd1) | 110682770 |
| `setHostKey(10278, …)`, key hash `0x6c73fb3e…a68e` (the same ES256 key as testnet host 1962) | [`0x332de53b…`](https://monadvision.com/tx/0x332de53b00e295d0a39619921728a0c9586679f7a89bf125ae4c4987e67fee69) | 110683264 |
| `registerVerifier(10279)` | [`0x16132ea7…`](https://monadvision.com/tx/0x16132ea7ff35e4b5bce957385670f03b3f991c2f3008e7f2c13c5e10497e8f15) | 110683320 |
| **First mainnet receipt anchored:** receipt `0x1b443b45…c5f2` from Gemma 4 31B through the host, root `0x406615dd…60cb`. `verifyReceipt` returns true | [`0x48bcf6ab…`](https://monadvision.com/tx/0x48bcf6abe5914a1a8aee3678a6f84eeb2773c4131bd670e995e44e34dd49a9a4) | 110684366 |
| **First mainnet grade:** verifier 10279 grades host 10278 (Gemma 4 31B), 38/38 tool cases, against Google's own API (39/39). This is a plumbing check: the host relays Google's API and is graded against it, so it shows the grading loop works on mainnet, not host quality | [`0x1e0b1d63…`](https://monadvision.com/tx/0x1e0b1d63984ff0140e675c116003fd36968816ffbc30d6040fb2c2defb980d50) · reference [`0x2b4d727e…`](https://monadvision.com/tx/0x2b4d727e481678e8fa3847a644ca2505ae4299015e882e90e0f0eda898d43d82) | 5 Oct |
| `CreAttestor.configure` for CRE simulations: the `MockKeystoneForwarder` `0x9eF6468C…784d` and the simulator's fixed workflow owner `0xaaaa…aaaa` and id `0x1111…1111` (read from the first broadcast's report header) | [`0xa5e81815…`](https://monadvision.com/tx/0xa5e8181547414df790dc6bd0faee730422a8538e608fbaab5f3035f98c90677c) | 111286605 |
| **First CRE re-check onchain:** `grade-recheck` triggered on the grade above, fetched its evidence, matched the sha256, recounted 38/38 and recomputed the interval, then wrote `GradeAttested(agree=true)` through the forwarder | [`0x8ecc907a…`](https://monadvision.com/tx/0x8ecc907a7e9e2807090a5787e4e92af617a0b890177652c00847344dda6e4938) | 111286783 |

`AssayAccount` is stateless and ownerless, verified on Sourcify (exact match) on both chains. A per-app requester key delegates to it with EIP-7702, and the host's relayer then pays the gas for its `cosignK` and its ERC-8004 feedback, so that address never holds MON. Its mainnet address equals the testnet VerifierRegistry address only because the same deployer was at the same nonce on both chains.

First sponsored run, testnet, 7 Oct: a fresh per-app address `0xBB14ffc0…Bc2f` with a balance of 0 co-signed receipt `0x401a4ec7…baae` through `POST /v1/sponsor/cosignk` ([`0x98ed7832…`](https://testnet.monadvision.com/tx/0x98ed7832321f1026d0dc3d80a0bf494cdc879dbda84824ee7a66581914321bea)), then filed ERC-8004 feedback citing it through `POST /v1/sponsor/feedback`, which installed the EIP-7702 delegation in the same transaction ([`0x30898fc9…`](https://testnet.monadvision.com/tx/0x30898fc98ed99382bf4e585b6450ee8dda696e7b11af4cdce30f5a97ce407147)). Its balance was still 0 afterwards, and the Envio indexer counts the feedback as receipt-backed.

### Kimi host (8 Oct)

A second mainnet host, ERC-8004 agent **10316** ("Assay Kimi host"), serves Kimi K2.6 through OpenRouter pinned to Moonshot's own endpoint (`moonshotai/int4`), with its own signing key (kid `F6V1sRvW…Wstls`). It runs at https://34-45-1-81.sslip.io/kimi, with reasoning turned off by the host (signed into every receipt's `req.params`) and tight request caps.

| Identity or action | Tx | Block |
|---|---|---|
| Agent **10316** registered | [`0x76d69bb6…`](https://monadvision.com/tx/0x76d69bb665c77a68df9d934dcab96922838993cfb9f3fa9475026f0769ca3aa6) | 111501003 |
| First Kimi receipt `0xf554e816…4b9e` anchored | [`0xc3891517…`](https://monadvision.com/tx/0xc3891517c41a0a8b022e21dad2e78d5c10e0fa732f3a2457f30ff1957180a482) | 8 Oct |
| **Kimi K2.6 grades:** verifier 10279 graded 16 OpenRouter endpoints (Moonshot's own included) and host 10316 against Moonshot's endpoint, 32 tool checks each. All 17 passed 32/32. `gmicloud/fp8` rate-limited every request and got no grade. Evidence `0xded48f9b…309b` (`docs/evidence/grades_20261008T033914Z.json`) | first [`0x3e1b2b20…`](https://monadvision.com/tx/0x3e1b2b2032eabe72305d752738664206b42e6bc20196bb03aaaf132b5c3c228e) · host 10316 [`0xc129015b…`](https://monadvision.com/tx/0xc129015b41d992206ea43444cef39095b148db4094ca50d0c1ff98b91dc6f2cc) | 8 Oct |
| **CRE re-check of host 10316's grade:** recounted 32/32 from the evidence, `GradeAttested(agree=true)` | [`0x7b7c9eeb…`](https://monadvision.com/tx/0x7b7c9eebd185972218932b5224da77cd8c68139ffb4c2ec3485cb6305e5af753) | 8 Oct |

What the CRE attestation means: every `cre workflow simulate --broadcast` stamps the same placeholder workflow owner and id, so this attestor accepts a simulated report from anyone running the workflow, and a later report for the same grade overwrites an earlier one. It shows that the workflow ran on this grade and that anyone can re-run it on the same transaction and get the same answer. It isn't a signature from a Chainlink DON; a deployed workflow would write to a new attestor pinned to its own owner.

The mainnet host runs at https://34-45-1-81.sslip.io/mainnet (the web app reaches it at `/host-mainnet`). Testnet stays live below as the place to experiment for free.

## Monad testnet (chain 10143)

Current deployment, 3 Oct 2026, with Foundry 1.7.1, solc 0.8.30 and `evm_version = "osaka"`. All three contracts are verified on Sourcify with an exact match. This version adds `cosignK` (secp256k1 requester co-signatures) to ReceiptAnchor. `CreAttestor` is owned by the `assay-host` address. Its `configure(forwarder, workflowOwner, workflowId)` call waits for the CRE workflow deploy, so it accepts no reports yet.

| Contract | Address | Deploy tx | Block |
|---|---|---|---|
| ReceiptAnchor | [`0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24`](https://testnet.monadvision.com/address/0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24) | [`0x32d12f86…`](https://testnet.monadvision.com/tx/0x32d12f86ec3dca22d7b25ec33985eeda69f94e7299592728b16b2896715a1022) | 67461080 |
| VerifierRegistry | [`0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91`](https://testnet.monadvision.com/address/0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91) | [`0x246d2ef1…`](https://testnet.monadvision.com/tx/0x246d2ef1d317d9ef4dc21318ef16a60f50bc1e4818685058228669f0b48abfd8) | 67461086 |
| CreAttestor | [`0xB4A1CB9e40aDa44570Ae790430C23876d460deDC`](https://testnet.monadvision.com/address/0xB4A1CB9e40aDa44570Ae790430C23876d460deDC) | [`0x0d2dc7b2…`](https://testnet.monadvision.com/tx/0x0d2dc7b2fc51c718226a28bc2b0027a94d74409b1060f47b795d9582ab6bb00a) | 67462996 |
| AssayAccount (EIP-7702 delegate, 7 Oct) | [`0x4eaDaC20fc6842F360884a31cfA11411C664a2A1`](https://testnet.monadvision.com/address/0x4eaDaC20fc6842F360884a31cfA11411C664a2A1) | [`0xf8844127…`](https://testnet.monadvision.com/tx/0xf8844127b363252cbefd3c867f3c8f6a68fdfea91db9bb543ee3ee6e213d1114) | 68954825 |

ReceiptAnchor was deployed with `requireUV = true`. Both contracts point at the ERC-8004 IdentityRegistry at `0x8004A818BFB912233c491871b3d84c89A494BD9e`.

### Earlier deployment (1 Oct 2026)

The first version, without `cosignK`. The first anchor and the evidence files from 1 Oct point at these addresses.

| Contract | Address | Deploy tx | Block |
|---|---|---|---|
| ReceiptAnchor | [`0x049A73755cA3508ef3Daa4752A3406f6e00CfB13`](https://testnet.monadvision.com/address/0x049A73755cA3508ef3Daa4752A3406f6e00CfB13) | [`0x663de8f9…`](https://testnet.monadvision.com/tx/0x663de8f94888355de6baf5cba9a5c4b10af5f02ddebc9e9a878b638430fa97b4) | 67269630 |
| VerifierRegistry | [`0x0C8603041E7d425c4DCa041680C7AF4581dDa9a1`](https://testnet.monadvision.com/address/0x0C8603041E7d425c4DCa041680C7AF4581dDa9a1) | [`0x835b8d6d…`](https://testnet.monadvision.com/tx/0x835b8d6d0039a3b383f1cd9d589727e3ac6a14a1b413217ad65cd2049ca8acb9) | 67269635 |

## Web app

Hosted on Vercel from the `web/` folder of `main`: https://assay-ten-xi.vercel.app (landing) and https://assay-ten-xi.vercel.app/app/ (verify, ask, grades, vault). Passkeys are bound to this domain, so a passkey made on localhost or on a later custom domain won't carry over.

## Host

The reference hosts run on a Google Cloud VM behind Caddy, one per network: testnet (agent 1962) at https://34-45-1-81.sslip.io and mainnet (agent 10278) at https://34-45-1-81.sslip.io/mainnet (`/health`, `/.well-known/jwks.json`, `/v1/receipts/:hash`, `/v1/grade`). The web app reaches it same-origin through a Vercel rewrite of `/host/*` (`web/vercel.json`). Setup is `host/deploy/setup.sh` plus `host/deploy/push-secrets.sh`.

## Indexer

Envio HyperIndex 3.12.1 on the Envio Cloud development plan, built from `indexer/` on the `envio` branch. Since 5 Oct (commit `38ed2ec`) one deployment indexes both Monad mainnet (143) and testnet (10143) over HyperSync. Ids are chain-prefixed, for example `143-10278` and `10143-1962`. The first deployment (`dfdb45d`, testnet only) synced in about a minute.

GraphQL endpoint (public, read-only): `https://indexer.dev.hyperindex.xyz/f15df95/v1/graphql`

It indexes ReceiptAnchor, VerifierRegistry and CreAttestor plus the ERC-8004 identity and reputation registries, on both networks. Example query:

```bash
curl -s https://indexer.dev.hyperindex.xyz/f15df95/v1/graphql -H 'content-type: application/json' \
  -d '{"query":"{ Agent(where:{agentId:{_eq:\"1962\"}}) { name anchorCount receiptCount currentKey { keyHash } } }"}'
```

## ERC-8004 identities

| Role | agentId | Owner | Registration tx | Agent card |
|---|---|---|---|---|
| Reference host | 1962 | `0xF3CbD8aaf1f2350bFd8a3220Ab4E83FDd8fa18d9` | [`0x4f164f1d…`](https://testnet.monadvision.com/tx/0x4f164f1db133dd9fba6af4433cb2b5af9869afdf08e11044fb0b4281f55b8c97) (block 67269809) | [host.json](agents/host.json) |
| Verifier | 1981 | `0x4BaC2Be288B5931886EeC4c555895CE6BcAB19e7` | [`0xfb3d22c2…`](https://testnet.monadvision.com/tx/0xfb3d22c27fb265d3ec4b8582d8a5ada650ea506c81b54e1cfd4ece9d1366f210) (block 67575374) | [verifier.json](agents/verifier.json) |

The full registration receipts are in [evidence/host-register.json](evidence/host-register.json) and [evidence/verifier-register.json](evidence/verifier-register.json). The verifier is a separate wallet because ERC-8004 doesn't let an agent's owner give feedback to its own agent.

## Onchain activity

| What | Tx | Notes |
|---|---|---|
| First real grade: `postGrade` by verifier 1981 for `google/gemma-4-31b-it` on `openrouter:google-ai-studio` (OpenRouter's free route), 6/6 tool cases, 95% interval 60.96%–100% | [`0xbae5c59e…88e0`](https://testnet.monadvision.com/tx/0xbae5c59e14a0f0653f41096323c6eae7f0e95533458027ef25b3823502ef88e0) (block 67590323) | 14 more requests were rate-limited by the free pool and count as errors, not results. Evidence sha256 `0x8518d211…b67a`, bundle and grades in [evidence/](evidence/evidence_20261002T153755Z.tar.gz) |
| Reference grade: same run, `direct:generativelanguage.googleapis.com` (Google's own API), 19/19, 95% interval 83.18%–100% | [`0x137f910d…16f6`](https://testnet.monadvision.com/tx/0x137f910d3e2181a9b2930170d47126370ae282e8dab7f8f91287b6aaa1dd16f6) (block 67590367) | Both grades read back through `gradeOf` and `/v1/grade`. Status is `warn` until a host has 30 samples |
| First real anchor (3 Oct ReceiptAnchor): a live request through the host to Gemma 4 31B on Google AI Studio, receipt `0x9a166cac…07e5` | [`0x41f73bca…a867`](https://testnet.monadvision.com/tx/0x41f73bcaa5270d16df2cbdafc920b0fa7f6e87890f968acece7f3c6a99a7a867) (block 67577033) | Relayer `0x4b49…9bf5` paid the gas. `verifyReceipt` returns true onchain and every SDK check passes |
| `registerVerifier(1981)` on the 3 Oct VerifierRegistry | [`0x752c6fe5…`](https://testnet.monadvision.com/tx/0x752c6fe566c60f390a79c449c812afc1fcd8b6802b1877da7bdc6231da52d178) (block 67575710) | Agent 1981 can now post grades |
| `setHostKey(1962, …)` with the real host key on the 3 Oct ReceiptAnchor, key hash `0x6c73fb3e…a68e` | [`0xcfd45e43…`](https://testnet.monadvision.com/tx/0xcfd45e4304e7de3c0337eb83288d657e978efc2a0df614c74cfb1a9adcc7b8b4) (block 67464463) | The host's ES256 key (kid `2Jc6WJSj…qg0`). The private key stays in the host's gitignored `.keys/` folder |
| `setHostKey(1962, …)` with a throwaway demo key, on the 1 Oct ReceiptAnchor | [`0x4ec112c6…`](https://testnet.monadvision.com/tx/0x4ec112c6017876122907af089417deed43ad01cb84a506fd6916aae94f8ba93c) (block 67273078) | Replaced by the real host key on Day 5 |
| First anchor (1 Oct ReceiptAnchor): 2-receipt demo batch, root `0x5594c31b…6e57` | [`0x663e126c…`](https://testnet.monadvision.com/tx/0x663e126c75016ee71ea7f3fc9a3f3daf291475ecf3c6a34c358e414db06a6c6e) (block 67273084) | Host signature checked by the P256 precompile in a real transaction |

Both demo receipts verify onchain under agent 1962 and fail under any other agent id. The calls are in [evidence/day3-anchor-verify.txt](evidence/day3-anchor-verify.txt).

## Redeploying

Testnet has been reset before (16 Dec 2025), so the deploy is scripted and repeatable:

```bash
cd contracts
export IDENTITY_REGISTRY=0x8004A818BFB912233c491871b3d84c89A494BD9e
forge script script/Deploy.s.sol --rpc-url monad_testnet --account assay-host \
  --sender $(cast wallet address --account assay-host) --broadcast --gas-estimate-multiplier 120
```

Always pass `--sender` with `--account`: without it, forge simulates the script as a different address, and any call that checks `msg.sender` (such as `setHostKey`) reverts before anything is broadcast.

The broadcast record for this deployment is in `contracts/broadcast/Deploy.s.sol/10143/`.
