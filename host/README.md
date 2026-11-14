# @assay/host

The reference Assay host. It is an OpenAI-compatible proxy in front of OpenRouter. For every response it signs a receipt, then it anchors batches of receipt hashes on Monad testnet through `ReceiptAnchor`.

v0 is non-streaming. A request with `stream: true` gets a 400.

The host's P-256 signing key lives in a local JWK file (`host/.keys/host.jwk.json`, gitignored). There is no KMS or HSM in v0. Anyone who can read that file can sign receipts as this host.

## Run

```bash
corepack pnpm install
corepack pnpm --filter @assay/host keygen      # writes .keys/host.jwk.json, prints qx, qy, kid
corepack pnpm --filter @assay/host register    # setHostKey on ReceiptAnchor (sends transactions)
corepack pnpm --filter @assay/host dev         # http://localhost:8787
corepack pnpm --filter @assay/host e2e         # one real request, waits for the anchor, checks onchain
corepack pnpm --filter @assay/host test
```

The host reads the repo root `.env`. See `.env.example`. Relative paths resolve against `host/`.

## Environment

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `OPENROUTER_API_KEY` | yes, unless `UPSTREAM_URL` is set | | OpenRouter key |
| `UPSTREAM_MODEL` | yes | | Model sent upstream and named in every receipt |
| `UPSTREAM_PROVIDER` | no | | Provider slug to pin, with `allow_fallbacks: false` |
| `UPSTREAM_URL` | no | OpenRouter | A direct OpenAI-compatible chat completions URL, for example a lab's own API |
| `UPSTREAM_API_KEY` | with `UPSTREAM_URL` | | Key for `UPSTREAM_URL`. `OPENROUTER_API_KEY` is then not needed |
| `MONAD_RPC_URL` | yes | | Primary RPC |
| `MONAD_RPC_URL_2` | no | | Fallback RPC, tried once when the primary fails |
| `ANCHOR_ADDRESS` | yes | | `ReceiptAnchor` address |
| `VERIFIER_REGISTRY` | no | `0x7755…5C91` (testnet) | `VerifierRegistry` read by `GET /v1/grade` |
| `HOST_AGENT_ID` | yes | | The host's ERC-8004 agentId |
| `RELAYER_PRIVATE_KEY` | yes | | Wallet that pays anchor and co-sign gas |
| `HOST_JWK_PATH` | no | `.keys/host.jwk.json` | Current signing key |
| `RETIRED_JWK_PATHS` | no | | Comma list of old keys, still published in the JWKS |
| `BATCH_SECONDS` | no | `300` | Anchor interval. Empty queues are never anchored |
| `BATCH_MAX` | no | `64` | Anchor at once when this many receipts wait |
| `PORT` | no | `8787` | HTTP port |
| `PUBLIC_URL` | no | `http://localhost:<PORT>` | Base URL in the agent registration file |
| `DATA_DIR` | no | `data` | Where the JSONL files live |

## Routes

| Method and path | What it does |
|---|---|
| `POST /v1/chat/completions` | Proxies the request. Needs `X-Assay-Salt` (64 hex). Optional `X-Assay-Cosigner` (0x + 64 hex) is signed in as `req.cosigner`. Returns the upstream JSON plus `X-Assay-Receipt` and `X-Assay-Receipt-Hash` |
| `GET /v1/receipts/:hash` | `{status: "pending"}`, or `{body, jws, root, proof, anchorTx, reproduce}` once anchored |
| `POST /v1/cosign` | Relays `ReceiptAnchor.cosign` for an anchored receipt this host issued. 10 per IP per hour |
| `GET /.well-known/jwks.json` | Current key, plus retired keys marked `"status": "retired"` |
| `GET /.well-known/agent-registration.json` | ERC-8004 registration file |
| `GET /v1/grade?model=&host=&verifiers=[&reference=]` | Latest grade from the verifiers you trust, read from `VerifierRegistry`, as `pass`, `warn`, `unknown` or `fail`, with the `gradeOf` call that reproduces it. `host` is `erc8004:<chain>:<id>`, `openrouter:<tag>`, `direct:<host>` or a raw host key |
| `GET /health` | Model, key id and queue length |

`X-Assay-Receipt` is base64url of the JSON `{body, jws}`. The JWS payload is the JCS bytes of `body`, and the receipt hash is `sha256` of those bytes.

The request commit covers `messages` plus every other request field except `model`, `stream` and `provider`. Those three are set by the host. The response commit covers `choices[0].message.content` exactly as returned.

When `UPSTREAM_PROVIDER` is set and OpenRouter reports a different provider, the host returns 502 and signs nothing.

`reproduce` gives the exact `verifyReceipt(agentId, receiptHash, proof, root)` call, including a ready `cast call` line.

## Example

```bash
SALT=$(openssl rand -hex 32)
curl -s localhost:8787/v1/chat/completions -D - \
  -H "content-type: application/json" -H "X-Assay-Salt: $SALT" \
  -d '{"messages":[{"role":"user","content":"Say OK"}],"max_tokens":16,"temperature":0}'

curl -s localhost:8787/v1/receipts/<X-Assay-Receipt-Hash>
```

## Storage and anchoring

Receipts and batches live in SQLite at `data/assay.db`, using Node's built-in `node:sqlite` (Node 22.13 or later). A restart reads no history back, and pending receipts stay queued. Hosts that still have the older `receipts.jsonl` and `batches.jsonl` import them on their first start and keep the files as `*.imported`.

Each anchor signs the batch root with the host key, then sends `anchor()` with `gas = estimate × 1.2`, because Monad bills the gas limit. On an RPC error it retries once on `MONAD_RPC_URL_2`. A reverted transaction is treated as a failure and the receipts stay queued. The host logs a warning when the relayer balance is below 1 MON.

## Rotating the key

1. Move the old JWK file somewhere under `.keys/` and add that path to `RETIRED_JWK_PATHS`.
2. Run `keygen` and `register` again.
3. Restart. Old receipts still verify against the JWKS.
