# Mida Context × ASSAY

> assay proves which model and host produced a response, mida proves which agent saved what, for whom, and who may read it.

## What this is

One small Node program in this folder, `examples/mida-context/mida/`, with three roles. `ask` sends one prompt through ASSAY's testnet host with a fresh salt and keeps the salt and the output in a private run file. `write` runs as a Mida agent the owner approved and saves the receipt and its salt inside the encrypted body of one Mida record, in ASSAY's interop shape. `read` or `export` runs as a second, separately approved agent: `read` finds that record and hands it to ASSAY's own `checkRecord` — the check ASSAY's `check.mts` runs — and refuses the context if anything fails; `export` runs the same check and then writes the record to a file `check.mts` can check. Nothing in ASSAY's SDK, host, contracts, web app or CI is changed.

## How it works

`ask` prints the receipt it was given and where the private run file went:

```
asked: receipt 0x9a166cac… from host erc8004:10143:1962, model gemma-4-31b-it — output "OK" (3 tokens in, 1 out)
saved: runs/0x9a166cacb2ffe4784ad556f69b690b7cebf71150f737a5a3c324f9e98e7907e5.json holds the salt and the output (mode 600; never commit it). The host anchors every ~30 s; then run: write 0x9a166cacb2ffe4784ad556f69b690b7cebf71150f737a5a3c324f9e98e7907e5
```

`write` prints what the host reports about the receipt, that the writer is approved, the result of ASSAY's check (chain read on), and the record it saved:

```
assay: the host reports receipt 0x9a166cac… anchored under host 1962 — root 0x8c89bd8a…, tx 0x41f73bca…
mida: midad: answering — pid 4242, up since 2026-10-09T10:00:00Z, queue 0 — socket in .mida-assay assay-writer: approved for this folder
assay: check passed for receipt 0x9a166cac… — the record is one the reader will accept
recorded: Mida record 0x547a8f2f… (anchored) in projects.current, author assay-writer — receipt 0x9a166cac…, salt and output inside the encrypted body
```

`read` prints which record it took and the verdict of ASSAY's check — a refusal prints ASSAY's reasons on one line:

```
mida: record 0x547a8f2f… written by assay-writer (AGENT_INFERRED, 2026-10-09T10:12:31Z) holds receipt 0x9a166cac…
accepted: host erc8004:10143:1962 (trusted) served model gemma-4-31b-it; the salt opens the commitments. Output: "OK"
```

`export` runs the same check as `read` and, only if it passes, writes the record — ASSAY's field set, salt inside — to a file `check.mts` can read from the repository root:

```
node --env-file=.env src/cli.js export
# exported: <this folder>/exports/0x9a166cacb2ffe4784ad556f69b690b7cebf71150f737a5a3c324f9e98e7907e5.json — this file contains the salt; it must not be published unless the call was a test.
# then, from the repository root:
npx tsx examples/mida-context/check.mts examples/mida-context/mida/exports/<receiptHash>.json
```

## Setup for the owner

About twenty minutes, once, all on Monad testnet. You need Node 22 or newer and the `mida` command (`npm install -g mida-context`). Every `mida` command starts with `MIDA_HOME=$HOME/.mida-assay`: without it, `mida` uses the everyday home and the revoke later would land there.

0. **Install this folder's dependencies** — inside `examples/mida-context/mida/`:

   ```
   npm ci
   ```

1. **A Mida home just for this demo** (`~/.mida-assay`), so a revoke here cannot touch everyday agents:

   ```
   MIDA_HOME=$HOME/.mida-assay mida init
   MIDA_HOME=$HOME/.mida-assay mida batching off
   ```

2. **Two agent identities:**

   ```
   MIDA_HOME=$HOME/.mida-assay mida add-agent assay-writer
   MIDA_HOME=$HOME/.mida-assay mida add-agent assay-reader
   ```

3. **Approve both for this folder** — inside `examples/mida-context/mida/`, for each name:

   ```
   MIDA_HOME=$HOME/.mida-assay mida request assay-writer
   MIDA_HOME=$HOME/.mida-assay mida approve assay-writer      # type yes
   MIDA_HOME=$HOME/.mida-assay mida request assay-reader
   MIDA_HOME=$HOME/.mida-assay mida approve assay-reader      # type yes
   ```

   This creates `.mida/project.json` here; the folder's `.gitignore` keeps `.mida/` out of the repository.

4. **Build ASSAY's SDK once, with their own tools, at the repository root** (this is the one place pnpm is used, by the owner, for their package — this folder uses npm):

   ```
   cd <the repository root> && npx --yes pnpm@10.20.0 install --frozen-lockfile && npx --yes pnpm@10.20.0 --filter @assay/receipts build
   ```

   This writes `sdk/dist/` (gitignored) and nothing else; `git status` must stay clean.

5. **`.env` in this folder** from `.env.example`. `MIDA_HOME` must be an absolute path — Node's `--env-file` does not expand `$HOME`, so write `MIDA_HOME=/Users/you/.mida-assay`. A `MIDA_HOME` already exported in your shell wins over `.env`, so run from a shell where it is not exported. The rest can stay at defaults; they pin the hosts the reader trusts, the chain id, its ReceiptAnchor address and its RPC. Those four are one setting: the defaults are Monad testnet's, and any other chain id is refused unless the address, the RPC and the hosts are all given too. `MIDA_PROJECT` is only the folder Mida checks the approval in — `runs/` and `exports/` always live in THIS folder, and the `.gitignore` keeps them, `.env` and `.mida/` out of the repository.

## Run

```
node --env-file=.env src/cli.js ask "Say OK"
# wait about 30 s for the host to anchor the receipt
node --env-file=.env src/cli.js write 0x9a166cacb2ffe4784ad556f69b690b7cebf71150f737a5a3c324f9e98e7907e5   # the full hash `saved:` printed
node --env-file=.env src/cli.js read                     # or: read <the full receipt hash>
node --env-file=.env src/cli.js export                   # checks, then writes exports/<receiptHash>.json in this folder
# or: export <the full receipt hash> --out <file>        # --out with a directory part is used as given
```

Exit codes: 0 done · 1 a setup problem (config, usage, their SDK not built) · 2 a refusal by the ASSAY side or a bad input (the line says what to do) · 3 Mida refused or is unavailable · 4 a network problem (host or RPC). `write` again on the same receipt prints `already recorded …` and exits 0 — the same receipt is never saved twice. `export` refuses to overwrite an existing file.

## Revoke

```
MIDA_HOME=$HOME/.mida-assay mida revoke assay-reader     # type yes
node --env-file=.env src/cli.js read
```

The next `read` prints `mida: refused (revoked) …` and exits 3. Revocation is forward-only: it stops that agent's future reads; the record stays anchored and readable by the writer and the owner, and the receipt is as valid as before — the host's own reproduce line (`cast call 0x63e4… "verifyReceipt(uint256,bytes32,bytes32[],bytes32)(bool)" 1962 <hash> "[<proof>]" <root> --rpc-url https://testnet-rpc.monad.xyz`) still returns `true`.

## Decision rules

In this order, stopping at the first refusal; the reader is the half ASSAY's own check takes over unchanged.

| # | Rule | Source of truth | On failure |
|---|---|---|---|
| R1 | Config is valid, the reader and writer are different agent names, and every trusted host is on the configured chain. | `.env` | exit 1 |
| R2 | ASSAY's built SDK can be loaded. | `../../../sdk/dist/index.js` exists and imports | exit 1 |
| R3 | The Mida service answers and the reader is approved; every page of `projects.current` arrives whole (no `partial`). | `mida.context()` | exit 3 |
| R4 | A candidate exists: the newest anchored item with `content.assayReceipt === 1` whose chain facts say the writer wrote it (`source === "AGENT_INFERRED"`, non-zero `author.id`, `author.name === ASSAY_WRITER_AGENT`). With `read <hash>` or `export <hash>`, the newest such item with that `receiptHash`. | the chain's author and source, never the content | exit 2 |
| R5 | The record's fields are well-formed: `chainId` equals the configured chain, `anchor.contract` equals the configured `ReceiptAnchor` (case-insensitive), `receiptHash`, `root` and `salt` are 32-byte hex, `anchor.agentId` is a number, `proof` is an array of 32-byte hex, `jws` is a three-part string, `jwks.keys` is an array, `output` is a string, `messages` is an array. Only allow-listed fields are copied; a stray `body` key is dropped — the receipt body is always decoded from the signed JWS payload. | the record | exit 2 |
| R6 | ASSAY's `checkRecord(record, pins)`: their own verifier — signature, receipt hash, key id, the Merkle batch, the on-chain anchor, and that our salt opens both commits — run with pins built from this folder's `.env` only: `trustedHosts`, and `chains[chainId]` = the configured ReceiptAnchor address and RPC. The output is handed on only when `verdict.ok === true` **and** `verdict.reasons` is empty — `ok` alone is not consulted. A throw is never "ok": a chain or RPC failure exits 4, and a record the check cannot process exits 2. | `checkRecord` in their SDK | exit 2, ASSAY's reasons on one line; exit 4 on a chain/RPC failure |
| Accept | Print the accepted line with the output text. | | exit 0 |

The trusted-host list exists because anyone can register an ERC-8004 identity, set a host key and anchor their own receipts; such a receipt passes every cryptographic check `checkRecord` runs. The reader says which hosts it accepts in its own configuration — along with the contract address and the writer's name, which is why all three always come from config and never from the record.

## The record

One record in `projects.current`, kind `EPISODE`, written by `assay-writer`. Everything below lives inside the record's encrypted body — ciphertext off-chain; on Monad the record keeps its existence, author, time, source and a hash of the encrypted content:

- `assayReceipt: 1`, `receiptHash`, `chainId` — the marker this record is found by, and which receipt it holds.
- `jws`, `jwks` — the signed receipt and the host's keys, exactly as the host returned them. There is no `body` field: the receipt body (host id, model, the two commits) is decoded from the JWS payload by whoever needs it.
- `anchor` — the contract, the host's agent id, the Merkle `root`, the `proof`, and the anchor transaction.
- `salt`, `output`, `messages` — the private half of the receipt and what it produced.
- `source`, `savedAt` — where the receipt came from and when it was saved.

`export` writes all of this minus the two Mida-side fields (`assayReceipt`, `savedAt`) — exactly the field set of ASSAY's published fixture, so `check.mts` reads it as-is. Every message is printed on one line, whatever a record, a receipt or the host sent, so a refusal cannot print an `accepted:` line of its own. A script should still decide on the exit code, not on the text.

What ASSAY's team can see: that a record exists, who wrote it and when, and the receipt's hash on their own side. What they cannot see: the record's content — there is no public field in a Mida record, so linking the anchored record to the receipt it holds needs the encrypted body, which only approved agents and the owner can read.

## Limits

Monad testnet only, and Mida is not audited. A receipt proves which host served which bytes and what it claimed, not which weights ran; anyone can be a host, so the reader trusts only the hosts in its configuration (default `erc8004:10143:1962`). The record's JWKS is deliberately not compared with `hostKeys()` on chain: anchored plus the Merkle proof is enough, and it survives a host key rotation. Mida allows one write per minute per agent. The salt is the private half of the receipt: it lives in `runs/` (mode 600, gitignored) and in any file `export` writes — with it anyone can open the commitments of those answers; without it nobody can. Our code never passes `offline` to `checkRecord`, and `export` refuses a record the chain read does not confirm — skipping the chain read would let a forged record pass, so do not treat an `--offline` pass on its own as acceptance.

## Where their check plugs in

The check is ASSAY's `checkRecord` (`sdk/src/record.ts`, exported from `sdk/src/index.ts`); our local checker was removed with `src/check.js`. `src/reader.js` calls it on the picked record through `toInteropRecord`, with pins built by `chainPins(config, client)`: the trusted host list, and `chains[chainId]` = the configured ReceiptAnchor address and RPC — all from this folder's `.env`, never the record. `src/writer.js` runs the same check on the record before saving it. `src/exporter.js` runs it too, then writes that same interop record for `examples/mida-context/check.mts`. For reuse, `src/record.js` exports `readAssayRecord(mida, config)` — the allow-listed record plus the author and time the chain recorded.

## Files

- `src/cli.js` — the four commands and the wiring (config, their SDK, fetch, the viem client, the Mida handle).
- `src/config.js` — environment to config, validated; reader and writer must differ.
- `src/assay-sdk.js` — the bridge that loads `../../../sdk/dist/index.js`; nothing of theirs is re-typed.
- `src/host.js` — `ask` through their `wrap()`, fetching the anchored receipt and JWKS, and the private run file.
- `src/record.js` — the record shape, `bodyFromJws`, the allow-list, the chain-facts filter and the page-walk.
- `src/writer.js` — `write`: what the writer re-derives before it saves one record.
- `src/reader.js` — `read`: find the writer's record, run their `checkRecord`, hand the output on or refuse.
- `src/exporter.js` — `export`: the same pick and the same check, written out for their `check.mts`, mode 600, never overwritten.
- `test/` — unit tests against fakes, plus three testnet fixtures copied verbatim from `docs/interop/assay-receipts/`; the real-`checkRecord` tests read ASSAY's fixture from `docs/interop/mida-records/` and skip when `sdk/dist` is not built.
- `runs/` — created at run time; holds the salts, mode 600, gitignored, never committed. Always this folder's `runs/`, wherever `MIDA_PROJECT` points.
- `exports/` — where `export` writes by default (`exports/<receiptHash>.json`, or a bare `--out` name); gitignored, mode 600, never overwritten.

## Credits

ASSAY's team for the receipts, the host, the SDK and `checkRecord`; Mida for the record and the reader.
