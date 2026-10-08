# Assay on Chainlink CRE

This folder holds a Chainlink CRE workflow that re-checks every grade posted to `VerifierRegistry` and writes the result to `CreAttestor` on Monad testnet.

## Problem

A grade in Assay comes from one verifier. That verifier ran the harness on one machine and posted the numbers. It could lie, pick its best run, or go offline. Readers can choose which verifiers to trust, but each grade still rests on one party.

## Why CRE

| Need | What CRE gives |
|---|---|
| Many independent parties recompute the grade | Every node in a DON runs the same workflow and the results go through consensus |
| The result lands onchain with proof of who produced it | Reports are signed by the DON and delivered by the `KeystoneForwarder` |
| Runs on our chain | Monad testnet is supported (`monad-testnet`, CLI v1.30.0+) |
| No need to trust the Assay team | A multisig of our own servers would still be us. A dispute game needs a bond token and weeks of challenge windows |

## What `grade-recheck` does

1. Trigger: An EVM log trigger fires on `GradePosted` from `VerifierRegistry` (`0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91`) once the block is finalized.
2. Fetch: Each node downloads `<evidenceBaseUrl>/<evidence>.tar.gz`, where `<evidence>` is the event's `evidence` field without `0x`. Bundles are content-addressed, so any static host works.
3. Check the hash: `sha256(bundle)` must equal `evidence`.
4. Recount: The node unpacks the bundle (gzip + ustar, as `harness/export_grade.py` writes it), reads `raw_<stamp>.jsonl` and recounts `passed/total` per endpoint with the harness rules: skip `max_tokens_16` rows and rows whose `http` is not 200.
5. Find the host: It picks the endpoint whose D21 host key equals the event's `hostKey`: `openrouter:<tag>`, `direct:<host>`, or `erc8004:<chain>:<agent>` for Assay hosts listed in `assayHosts`.
6. Recompute the interval: 95% Wilson interval in basis points, low rounded down and high rounded up, with the same rounding rules as `export_grade.to_bps`.
7. Consensus: Steps 2 to 6 run on every node. The results are compared with identical aggregation, since the computation is deterministic.
8. Write: The DON signs the report and the EVM write capability sends it to `CreAttestor.onReport`.

The report is `abi.encode(address verifier, bytes32 model, bytes32 hostKey, uint64 t, uint32 passed, uint32 total, uint16 ciLowBps, uint16 ciHighBps, bool agree)`, 288 bytes, the layout `CreAttestor` decodes.

| Case | `passed`, `total`, `ciLowBps`, `ciHighBps` in the report | `agree` |
|---|---|---|
| Recount, interval and timestamp match the event | Recomputed (equal to the event) | `true` |
| Recount differs | Recomputed | `false` |
| Hash mismatch, unknown host, or nothing to count | As posted | `false` |
| Bundle not reachable (non-200) | Nothing is written. The run fails and no attestation is made | |

`t` must also match the bundle's stamp (`raw_20261005T101500Z.jsonl` gives `1791195300`). The workflow does not re-check `model`, `checks` or `refModel`.

### Replay trigger

`config.staging.json` also turns on an HTTP trigger (trigger index 1). It takes one grade as JSON, in the same shape as an entry of `grades_<stamp>.json` plus `verifier`. It exists so the workflow can be simulated before any grade is onchain. The production config leaves it off. A deployed HTTP trigger needs at least one address in `replay.authorizedEvmAddresses`.

## Files

| Path | What |
|---|---|
| `project.yaml` | CRE targets and the Monad testnet RPC |
| `grade-recheck/workflow.ts` | Triggers, HTTP fetch, consensus, report, write |
| `grade-recheck/recheck.ts` | Pure logic: tar, recount, Wilson, host keys, report encoding |
| `grade-recheck/config.*.json` | Addresses and the evidence URL |
| `grade-recheck/fixtures/make_fixture.py` | Builds the fixtures with the real harness code |
| `grade-recheck/fixtures/wilson_vectors.json` | 5,156 `(k, n, lowBps, highBps)` vectors from `export_grade.py` |
| `grade-recheck/fixtures/run/` | A small probe run and its `export_grade.py` output |
| `grade-recheck/fixtures/evidence/` | The same bundle under its sha256 name |
| `grade-recheck/fixtures/replay-*.json` | Replay payloads: an honest grade and an inflated one |

## Tests

```bash
cd cre/grade-recheck
bun install
bun test           # 31 tests
bunx tsc --noEmit
bunx cre-compile main.ts /tmp/grade-recheck.wasm   # builds the WASM, no account needed
```

The tests cover:

- Wilson bps against every vector from the Python code, and the float-noise cases.
- The recount against `export_grade.py` output for all three endpoints, including the Assay host keyed by ERC-8004 identity.
- The report against viem `decodeAbiParameters` and `cast abi-decode` (the second runs only when `cast` is on PATH).
- The handlers end to end with the SDK's mocked HTTP and EVM capabilities.

Regenerate the fixtures with `python3 cre/grade-recheck/fixtures/make_fixture.py`. The output is deterministic.

## Simulate (owner)

Every CRE CLI command needs a CRE account, `cre workflow simulate` included. Without one the CLI stops at "Authentication required". The attempt is recorded in `docs/evidence/cre-simulate-grade-recheck.txt`.

1. Install the CLI: `curl -sSL https://app.chain.link/cre/install.sh | bash`, or take `cre_linux_amd64.tar.gz` from the [releases](https://github.com/smartcontractkit/cre-cli/releases). Tested with v1.36.0. Bun 1.2.21+ is required.
2. Create an account at [app.chain.link/cre](https://app.chain.link/cre/discover) and run `cre login`.
3. Install dependencies: `cd cre/grade-recheck && bun install && cd ..`
4. Make sure the fixture bundle is reachable. The staging config reads it from GitHub (`main` branch), so push first. Or serve `grade-recheck/fixtures/evidence/` yourself and change `evidenceBaseUrl`.
5. Run the replay trigger from `cre/`, once honest and once inflated:

   ```bash
   cre workflow simulate grade-recheck -T staging-settings --non-interactive \
     --trigger-index 1 --http-payload grade-recheck/fixtures/replay-honest.json
   cre workflow simulate grade-recheck -T staging-settings --non-interactive \
     --trigger-index 1 --http-payload grade-recheck/fixtures/replay-inflated.json
   ```

   Expected logs: `recheck hashOk=true tag=direct:assay.example.com 8/10 ci=[4901,9434] agree=true`, then `agree=false` for the inflated grade.
6. Once a real grade is posted, run the log trigger with its transaction. Its bundle must be under `evidenceBaseUrl`:

   ```bash
   cre workflow simulate grade-recheck -T staging-settings --non-interactive \
     --trigger-index 0 --evm-tx-hash <postGrade tx> --evm-event-index 0
   ```

7. Save the output: `... 2>&1 | tee ../docs/evidence/cre-simulate-grade-recheck.txt`

Without `--broadcast` the write is a dry run and the log shows a zero tx hash. `creAttestor` is `0x0` in both configs until `CreAttestor` is deployed.

## Deploy (owner)

1. Deploy `CreAttestor(owner)` on Monad testnet from `contracts/`.
2. Request deploy access: `cre account access` (CRE deployment is Early Access).
3. Put the attestor address in `config.production.json` (`creAttestor`). Set `evidenceBaseUrl` to where verifiers publish bundles.
4. Deploy: `cre workflow deploy grade-recheck -T production-settings`. Note the Workflow ID and Owner Address it prints.
5. Configure the attestor once (it cannot be changed later):

   ```bash
   cast send <CreAttestor> "configure(address,address,bytes32)" \
     0xF8344CFd5c43616a4366C34E3EEE75af79a74482 <workflow owner> <workflow id or 0x00..00> \
     --rpc-url monad_testnet --account assay-host
   ```

| Argument | Value |
|---|---|
| `forwarder` | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482`, the Monad testnet `KeystoneForwarder` for deployed workflows |
| `workflowOwner` | The owner address from the deploy output |
| `workflowId` | The 32-byte ID from the deploy output, or zero to accept any workflow from that owner |

The workflow ID changes when the workflow is redeployed with new code or config. `configure` runs only once, so a pinned ID means a new `CreAttestor` after every redeploy. Zero avoids that and still limits writers to our workflow owner.

Monad mainnet is supported too (`-T mainnet-settings`, `config.mainnet.json`). It re-checks grades posted to the mainnet VerifierRegistry and writes to the mainnet `CreAttestor` `0xAD9e30dcC63670E1e54f1f12468D16eC1bceDf7a`. A dry run on host 10278's real mainnet grade (tx `0x1e0b1d63…0d50`) recounts 38/38 and agrees: `docs/evidence/cre-simulate-mainnet.txt`.

```bash
cre workflow simulate grade-recheck -T mainnet-settings --non-interactive \
  --trigger-index 0 --evm-tx-hash 0x1e0b1d63984ff0140e675c116003fd36968816ffbc30d6040fb2c2defb980d50 --evm-event-index 0
```

Before writing, the workflow reads the chain at the finalized block (EVM read capability): `VerifierRegistry.gradeOf` must return exactly the claimed grade as that verifier's latest, and `CreAttestor.attestations` must be empty for it. So it never attests a claim the registry doesn't hold (a forged log or replay payload), a grade a newer one replaced, or a grade it already attested. A rerun on an attested grade logs `not writing: already attested` and spends no gas.

Forwarders, from `cre workflow supported-chains` (7 Oct):

| Chain | KeystoneForwarder (deployed workflows) | MockKeystoneForwarder (`simulate --broadcast`) |
|---|---|---|
| monad-testnet | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` | `0xB9F79d863261869B234c481D1f9A7af84AeAd192` |
| monad-mainnet | `0x76c9cf548b4179F8901cda1f8623568b58215E62` | `0x9eF6468C5f37b976E57d52054c693269479A784d` |

The simulator uses a different forwarder: `MockKeystoneForwarder` `0xB9F79d863261869B234c481D1f9A7af84AeAd192` on Monad testnet. A `CreAttestor` configured for production rejects reports from it (`NotForwarder`). To show a broadcast simulation onchain, deploy a second attestor configured with the mock forwarder.

## Limits

| Limit | Effect |
|---|---|
| HTTP response body 100 KB | Evidence bundles above 100 KB (gzip) cannot be fetched. Large runs need splitting |
| One raw log per bundle | A bundle with zero or two `raw_*.jsonl` files makes the run fail |
| `assayHosts` is config | A new Assay host needs its `tag` to `erc8004:<chain>:<agent>` mapping added and the workflow redeployed |
