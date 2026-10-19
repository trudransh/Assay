---
description: Every route of the reference host, with headers, request and response bodies, and status codes.
icon: server
---

# Host API

**Live:** https://34-45-1-81.sslip.io (agent 1962, Gemma 4 31B through Google AI Studio) · **Where:** `host/src/server.ts`, package `@assay/host` (Hono). Runs locally on `http://localhost:8787` with `pnpm --filter @assay/host dev`. To run your own on a VM, see `host/deploy/setup.sh` and `host/deploy/push-secrets.sh`.

The reference host is an OpenAI-compatible proxy in front of OpenRouter, or any OpenAI-compatible API set with `UPSTREAM_URL`. It signs a receipt for every response and anchors batches on Monad. Errors come back as `{"error": {"message": "…"}}`.

## Routes

| Method and path | What it does |
|---|---|
| `POST /v1/chat/completions` | Proxies a chat request and returns a signed receipt in headers |
| `GET /v1/receipts/:hash` | Returns `pending`, or the receipt with its proof and anchor |
| `POST /v1/cosign` | Relays `ReceiptAnchor.cosign` so the requester pays no gas |
| `GET /.well-known/jwks.json` | The host's public keys, current and retired |
| `GET /.well-known/agent-registration.json` | The ERC-8004 registration file |
| `GET /v1/grade` | The latest grade for a model and host from the verifiers you trust, as a status |
| `GET /health` | Model, key id and queue length |

## `POST /v1/chat/completions`

| Request header | Required | Value |
|---|---|---|
| `X-Assay-Salt` | yes | 32 random bytes as 64 hex characters, with or without `0x` |
| `X-Assay-Cosigner` | no | `0x` + 64 hex, the passkey key hash `keccak256(abi.encode(qx, qy))` |

The body is an OpenAI chat request with a `messages` array. The host sets `model`, `stream` and `provider` itself, so those fields are neither forwarded nor committed. If the request sets neither `max_tokens` nor `max_completion_tokens`, the host fills in `max_tokens: 1024` (some upstreams fail without a budget), and that value is what it forwards, commits and signs in `req.params`.

The output commit covers the assistant's text. When the model answers only with tool calls, it covers the JCS bytes of `tool_calls` exactly as returned, so tool-using agents get receipts too. `assistantOutput()` in the SDK implements the rule.

| Response header | Value |
|---|---|
| `X-Assay-Receipt` | base64url of the JSON `{body, jws}` |
| `X-Assay-Receipt-Hash` | `sha256(JCS(body))` |

| Status | Message | Cause |
|---|---|---|
| 200 | | Upstream JSON, unchanged, plus the receipt headers |
| 400 | `X-Assay-Salt header is required: 32 random bytes as 64 hex chars` | Missing or malformed salt |
| 400 | `X-Assay-Cosigner must be 0x + 64 hex (keccak256(abi.encode(qx, qy)))` | Malformed co-signer header |
| 400 | `body must be a JSON object with a messages array` | Bad JSON or no `messages` |
| 400 | `v0 is non-streaming: send stream false or omit it` | `stream: true` |
| upstream status | upstream JSON | OpenRouter returned a non-200. No receipt is signed |
| 502 | `upstream served by "<provider>", not the pinned provider <slug>; no receipt signed` | `UPSTREAM_PROVIDER` is set and OpenRouter served another provider |
| 502 | `upstream returned neither assistant text nor tool calls; no receipt signed` | `choices[0].message` has no text and no `tool_calls` |

```bash
SALT=$(openssl rand -hex 32)
curl -s https://34-45-1-81.sslip.io/v1/chat/completions -D - \
  -H "content-type: application/json" -H "X-Assay-Salt: $SALT" \
  -d '{"messages":[{"role":"user","content":"Say OK"}],"max_tokens":256,"temperature":0}'
```

## `GET /v1/receipts/:hash`

| Status | Body |
|---|---|
| 200 | `{"status": "pending"}` while the batch is not anchored |
| 200 | `{"status": "anchored", body, jws, root, proof, anchorTx, reproduce}` |
| 400 | `receipt hash must be 0x + 64 hex` |
| 404 | `unknown receipt` |

`reproduce` holds `chainId`, `contract`, `function` (`verifyReceipt(uint256,bytes32,bytes32[],bytes32)`), `args`, and a ready `cast` line:

```bash
cast call <ReceiptAnchor> "verifyReceipt(uint256,bytes32,bytes32[],bytes32)(bool)" 1962 <hash> "[<proof>]" <root> --rpc-url https://testnet-rpc.monad.xyz
```

## `POST /v1/cosign`

```json
{
  "receiptHash": "0x…",
  "qx": "0x…",
  "qy": "0x…",
  "auth": { "r": "0x…", "s": "0x…", "challengeIndex": "23", "typeIndex": "1", "authenticatorData": "0x…", "clientDataJSON": "{…}" }
}
```

| Status | Body or message | Cause |
|---|---|---|
| 200 | `{"txHash": "0x…"}` | The relay sent the transaction |
| 400 | `body must be {receiptHash, qx, qy, auth: {r, s, challengeIndex, typeIndex, authenticatorData, clientDataJSON}}` | Missing or malformed field |
| 404 | `unknown receipt: this host only relays co-signs for receipts it issued` | Receipt not in this host's store |
| 409 | `receipt is not anchored yet; retry after the next batch` | Batch still pending |
| 429 | `co-sign relay is limited to 10 per hour per IP` | Rate limit hit |
| 502 | `co-sign relay failed: <reason>` | The transaction failed, for example `BadCosignature` |

## `GET /.well-known/jwks.json`

```json
{ "keys": [
  { "kty": "EC", "crv": "P-256", "x": "…", "y": "…", "kid": "host-key-2026-10", "alg": "ES256", "use": "sig" },
  { "kty": "EC", "crv": "P-256", "x": "…", "y": "…", "kid": "host-key-2026-09", "alg": "ES256", "use": "sig", "status": "retired" }
] }
```

Retired keys stay published so receipts they signed still verify.

## `GET /.well-known/agent-registration.json`

The ERC-8004 registration file: `name` "Assay reference host", `services` for `chat`, `jwks` and `receipts`, and `registrations` with the agent id and `eip155:10143:0x8004A818BFB912233c491871b3d84c89A494BD9e`.

## `GET /v1/grade`

Answers "can I trust this host for this model right now" in one call. It reads `VerifierRegistry.gradeOf` and applies the same rules as the SDK's `gradeStatus`.

| Query parameter | Meaning |
|---|---|
| `model` | Model id, for example `z-ai/glm-5.3`. Hashed with keccak256 |
| `host` | `erc8004:<chain>:<agentId>`, `openrouter:<tag>`, `direct:<host>`, or a raw 0x host key |
| `verifiers` | Comma-separated addresses of the verifiers you trust |
| `reference` | Optional. Same format as `host`. With it, a host whose interval sits below the reference's gets `fail` |

| Status | Meaning |
|---|---|
| `pass` | A trusted, fresh grade with at least 30 samples |
| `warn` | Fewer than 30 samples |
| `unknown` | No grade from your verifiers, or the newest is older than 7 days |
| `fail` | The host's upper bound is below the reference's lower bound |

The response includes `reproduce` with the exact `gradeOf(bytes32,bytes32,address[])` call, so you can check the answer without trusting the host.

| Status code | When |
|---|---|
| `400` | Missing `model`, a malformed `host` or `reference`, or no valid verifier address |
| `502` | The chain read failed |

## `GET /health`

```json
{ "ok": true, "model": "z-ai/glm-5.3", "kid": "host-key-2026-10", "pending": 3 }
```

## Environment

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `OPENROUTER_API_KEY` | yes | | OpenRouter key |
| `UPSTREAM_MODEL` | yes | | Model sent upstream and named in every receipt |
| `UPSTREAM_PROVIDER` | no | | Provider slug to pin, with `allow_fallbacks: false` |
| `MONAD_RPC_URL` | yes | | Primary RPC |
| `MONAD_RPC_URL_2` | no | | Fallback RPC, tried once |
| `ANCHOR_ADDRESS` | yes | | `ReceiptAnchor` address |
| `HOST_AGENT_ID` | yes | | The host's ERC-8004 agentId |
| `RELAYER_PRIVATE_KEY` | yes | | Wallet that pays anchor and co-sign gas |
| `HOST_JWK_PATH` | no | `.keys/host.jwk.json` | Current signing key |
| `RETIRED_JWK_PATHS` | no | | Comma list of old keys, still published in the JWKS |
| `BATCH_SECONDS` | no | `300` | Anchor interval |
| `BATCH_MAX` | no | `64` | Anchor at once when this many receipts wait |
| `PORT` | no | `8787` | HTTP port |
| `PUBLIC_URL` | no | `http://localhost:<PORT>` | Base URL in the registration file |
| `DATA_DIR` | no | `data` | Where the SQLite store `assay.db` lives |

## Run your own host

1. `pnpm --filter @assay/host keygen` writes `.keys/host.jwk.json` and prints `qx`, `qy` and `kid`. It refuses to overwrite an existing key.
2. `pnpm --filter @assay/host register` calls `setHostKey` on `ReceiptAnchor`. This sends transactions.
3. `pnpm --filter @assay/host dev` starts the server.
4. `pnpm --filter @assay/host e2e` sends one real request, waits for the anchor and checks it onchain.

To rotate the key, move the old JWK under `.keys/`, add its path to `RETIRED_JWK_PATHS`, run `keygen` and `register` again, and restart.

## Where else this shows up

| Place | Uses |
|---|---|
| [SDK reference](sdk.md) | `wrap` calls `POST /v1/chat/completions` |
| [Web app](web-app.md) | Verify fetches the JWKS and receipt, Ask uses the relay |
| [Anchoring batches](../how-it-works/anchoring.md) | What the batcher does |

{% hint style="warning" %}
The signing key is a local JWK file in v0, with no KMS or HSM. Anyone who can read `host/.keys/host.jwk.json` can sign receipts as this host. The co-sign rate limit is kept in memory and resets when the host restarts.
{% endhint %}

Next: [Contracts reference](contracts.md)
