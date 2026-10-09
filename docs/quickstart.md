# Quickstart

This page takes you from a clean clone to a receipt you have verified yourself. Steps 1 to 6 cost nothing and send no transactions. Step 7 anchors on Monad testnet and needs a funded wallet.

## What you need

| Tool | Version | Used for |
|---|---|---|
| Node | 22 or newer | SDK, host, web app |
| pnpm | through `corepack` (ships with Node) | Workspace install |
| Foundry | 1.7 or newer | Contract tests, `cast` |
| Python | 3, standard library only | Grader tests |
| OpenRouter account | free tier is enough | Upstream model for the host (step 4 onward) |

## 1. Clone and install

```bash
git clone --recurse-submodules https://github.com/trudransh/Assay.git
cd Assay
corepack pnpm install --frozen-lockfile
```

If you cloned without `--recurse-submodules`, run `git submodule update --init --recursive` before the contract tests. They need forge-std and OpenZeppelin 5.7.0.

## 2. Run the tests

```bash
(cd contracts && forge test)
corepack pnpm -r test
python3 -m unittest harness/test_export_grade.py harness/test_assay_probe.py
```

On 2 Oct these suites gave the following results.

| Suite | Result |
|---|---|
| Contracts | 99 passed, 1 skipped (the fork tests need `--fork-url`) |
| SDK (`@assay/receipts`) | 110 passed |
| Host (`@assay/host`) | 35 passed |
| Harness | 32 passed |

The indexer has its own install and tests. See [indexer/README.md](../indexer/README.md).

## 3. Generate a host key

```bash
corepack pnpm --filter @assay/host keygen
```

This writes `host/.keys/host.jwk.json` (gitignored) and prints the key id, `qx`, `qy` and the key hash. It refuses to overwrite an existing key, because old receipts would then become unverifiable.

## 4. Configure the host

The host reads `.env` at the repo root. Create a throwaway relayer key first:

```bash
cast wallet new
```

Then write `.env`:

```bash
OPENROUTER_API_KEY=sk-or-...              # your own key from openrouter.ai
UPSTREAM_MODEL=google/gemma-4-31b-it:free # any free model works
UPSTREAM_PROVIDER=
MONAD_RPC_URL=https://testnet-rpc.monad.xyz
ANCHOR_ADDRESS=0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24
HOST_AGENT_ID=1962
RELAYER_PRIVATE_KEY=0x...                 # the private key from cast wallet new
BATCH_SECONDS=86400                       # no anchoring during the local run
```

Your new key is not registered for agent 1962, so an anchor attempt would revert. A long `BATCH_SECONDS` keeps the receipts queued and the log quiet. Free models change often, so check OpenRouter's list if the one above is gone.

Start the host:

```bash
corepack pnpm --filter @assay/host start
```

It prints the model, the port (8787) and the key id. A warning about the relayer balance is expected, since the new wallet holds no MON.

## 5. Ask through the SDK

Save this as `host/try.ts`. It lives in `host/` so that `@assay/receipts` resolves from the workspace.

```ts
import { verifyReceipt, wrap } from "@assay/receipts";

const HOST = process.env.HOST ?? "http://localhost:8787";
const messages = [{ role: "user", content: "Say OK" }];

// wrap(fetch) sends a fresh X-Assay-Salt and parses the X-Assay-Receipt header.
const assayFetch = wrap(fetch);
const out = await assayFetch(`${HOST}/v1/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ messages, max_tokens: 32, temperature: 0 }),
});
const text = (out.json as any).choices[0].message.content as string;
console.log("output       ", JSON.stringify(text));
console.log("receipt hash ", out.receipt.hash);
console.log("salt         ", out.salt);
console.log("output commit", out.outputCommitOk ? "matches" : "MISMATCH");

// Offline: the host's signature against its JWKS, and both commits opened with your salt.
const jwks = await (await fetch(`${HOST}/.well-known/jwks.json`)).json();
const result = await verifyReceipt({ body: out.receipt.body, jws: out.receipt.jws, jwks, salt: out.salt, output: text, messages });
console.log("ok", result.ok, result.checks);
```

Run it in a second terminal:

```bash
corepack pnpm --filter @assay/host exec tsx try.ts
```

## 6. Read the result

You should see `output commit matches` and `ok true` with these checks:

| Check | Expected | Meaning |
|---|---|---|
| `jws` | `pass` | The host's ES256 signature verifies against `/.well-known/jwks.json` |
| `hash` | `pass` | The body you hold is the body the host signed |
| `kid` | `pass` | The signing key id matches `host.keyId` in the body |
| `outputCommit` | `pass` | Your salt and the output reproduce `res.commit` |
| `promptCommit` | `pass` | Your salt and the messages reproduce `req.commit` |
| `merkle`, `anchored` | `skipped` | Nothing is anchored yet |
| `cosigned` | `skipped` | The request named no co-signer |

Keep the salt. Without it you can't open the commits later. `result.reproduce` gives the exact computation behind each check, so you can redo any of them without the SDK.

The host also keeps the receipt:

```bash
curl -s localhost:8787/v1/receipts/<receipt hash>
# {"status":"pending"}
```

## 7. Anchor on Monad testnet (optional)

This step sends transactions. You need testnet MON from the Monad faucet in two wallets: the identity owner and the relayer.

| Step | Command | Needs |
|---|---|---|
| Register your own host identity and set its key | `OWNER_PRIVATE_KEY=0x... corepack pnpm --filter @assay/host register` with `HOST_AGENT_ID` left empty | A funded owner wallet. Prints the new agentId |
| Point the host at it | Set `HOST_AGENT_ID` to the new id, set `BATCH_SECONDS=60`, restart the host | |
| Fund the relayer | Send testnet MON to the `cast wallet new` address | About 0.006 MON per anchor at the minimum base fee |
| Run one request end to end | `corepack pnpm --filter @assay/host e2e` | Waits for the anchor, then checks `verifyReceipt` onchain |

Once the batch is anchored, `GET /v1/receipts/<hash>` returns the proof, the root, the anchor transaction and a `cast call` line. Pass `proof`, `root` and `onchain: { client, anchor }` to `verifyReceipt` and the `merkle` and `anchored` checks run too.

Using the reference host identity (agent 1962) instead needs the owner's keystore. That step is for the project owner only.

## Next

| To learn | Read |
|---|---|
| Which hosts to trust, and how to pin them | [Choosing and pinning hosts](../sdk/README.md#choosing-and-pinning-hosts) |
| How the pieces fit | [architecture.md](architecture.md) |
| What the receipt contains | [SPEC.md](../SPEC.md) |
| What each defence protects against | [threat-model.md](threat-model.md) |
| Every host route and setting | [host/README.md](../host/README.md) |
