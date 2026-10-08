import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import {
  assistantOutput,
  buildReceipt,
  commitRequest,
  commitResponse,
  createHostSigner,
  receiptAnchorAbi,
  receiptHash,
  type ContractReader,
  type HostSigner,
} from "@assay/receipts";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { JWK } from "jose";
import { createPublicClient, http, isHex, type Address, type Hex, type PublicClient } from "viem";
import { createBatcher, type Batcher } from "./batcher.js";
import { anchorWriteAbi, makeClients, sendTx, type WriteRequest } from "./chain.js";
import { CHAIN_ID, loadConfig, NETWORKS, readJwk } from "./config.js";
import { mountGrades, type GradeDeps } from "./grades.js";
import { mountSponsor, type SponsorDeps } from "./sponsor.js";
import { publicError } from "./errors.js";
import { clientIp, overLimit } from "./limits.js";
import { Store } from "./store.js";
import { openRouter, providerMatches, providerPin, type Upstream } from "./upstream.js";

export const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
export const COSIGN_LIMIT = 10;
/// Chat requests per client per hour, and for the whole host per hour. Every receipt eventually costs an anchor.
export const CHAT_LIMIT = 120;
export const CHAT_LIMIT_GLOBAL = 1200;

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

export interface AppDeps {
  signer: HostSigner;
  /// The chain this host anchors on (named in every receipt). Default: testnet.
  chainId?: number;
  identityRegistry?: Address;
  /// Chat requests per client and per host per hour. Defaults: CHAT_LIMIT and CHAT_LIMIT_GLOBAL.
  chatLimit?: number;
  chatLimitGlobal?: number;
  /// Token budget filled in when a request names none, and the most a request may ask for.
  /// Defaults: DEFAULT_MAX_TOKENS and MAX_TOKENS_CAP. A paid upstream (Kimi) sets both lower.
  defaultMaxTokens?: number;
  maxTokensCap?: number;
  /// Name in the agent card. Default: "Assay reference host".
  hostName?: string;
  /// The host's reasoning setting for reasoning models (OpenRouter `reasoning`). Clients can't set it; it is
  /// forwarded and signed into req.params, so the receipt says how the answer was produced.
  reasoning?: Record<string, unknown>;
  /// RPC printed in the reproduce line. Default: testnet's public RPC.
  publicRpc?: string;
  /// Old public keys kept so receipts they signed still verify (D22).
  retiredJwks?: JWK[];
  store: Store;
  upstream: Upstream;
  model: string;
  provider?: string;
  agentId: bigint;
  anchor: Address;
  publicUrl: string;
  /// `schedule` adds batchSeconds and nextBatchInMs to /health, so the web app can count down to the batch.
  batcher?: Pick<Batcher, "notify"> & Partial<Pick<Batcher, "schedule">>;
  relayCosign: (args: readonly unknown[]) => Promise<Hex>;
  /// Enables GET /v1/grade, read straight from VerifierRegistry.
  grades?: GradeDeps;
  /// Enables POST /v1/sponsor/*: the relayer pays gas for per-app keys.
  sponsor?: Omit<SponsorDeps, "store" | "chainId" | "agentId" | "anchor" | "now">;
  now?: () => number;
}

const fail = (c: Context, status: ContentfulStatusCode, message: string) => c.json({ error: { message } }, status);
const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown) => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : 0);
const publicPart = ({ kty, crv, x, y, kid }: JWK): JWK => ({ kty, crv, x, y, kid, alg: "ES256", use: "sig" });

/// Used when a request sets neither max_tokens nor max_completion_tokens.
export const DEFAULT_MAX_TOKENS = 1024;
/// The most a client may ask for. Every token is paid by the host.
export const MAX_TOKENS_CAP = 4096;
/// Request bodies over this are refused before they're read.
export const MAX_BODY_BYTES = 64 * 1024;
/// The chat fields a client may set. Anything else is refused, not forwarded: OpenRouter's `models` and `route`
/// could serve another model than the receipt names, `plugins` adds paid features, `n` multiplies the cost.
export const ALLOWED_PARAMS = new Set([
  "max_tokens", "max_completion_tokens", "temperature", "top_p", "top_k", "stop", "seed",
  "presence_penalty", "frequency_penalty", "repetition_penalty", "tools", "tool_choice", "response_format",
]);

/// Why a chat body can't be served, or undefined when it can.
export function chatBodyProblem(req: Record<string, unknown>, cap = MAX_TOKENS_CAP): string | undefined {
  for (const k of Object.keys(req)) {
    if (k !== "messages" && k !== "model" && k !== "stream" && k !== "provider" && !ALLOWED_PARAMS.has(k)) return `field ${JSON.stringify(k.slice(0, 40))} isn't supported by this host`;
  }
  const msgs = req.messages as unknown[];
  if (msgs.length === 0 || msgs.some((m) => !isObj(m) || typeof m.role !== "string")) return "messages must be a non-empty array of objects with a role";
  for (const k of ["max_tokens", "max_completion_tokens"]) {
    const v = req[k];
    if (v !== undefined && !(Number.isSafeInteger(v) && (v as number) > 0 && (v as number) <= cap)) return `${k} must be a whole number from 1 to ${cap}`;
  }
  return undefined;
}

export function createApp(d: AppDeps): Hono {
  const app = new Hono();
  app.use("*", secureHeaders());
  app.use("*", bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => fail(c, 413, `request bodies are limited to ${MAX_BODY_BYTES / 1024} KB`) }));
  const now = d.now ?? Date.now;
  const chainId = d.chainId ?? CHAIN_ID;
  const agentIdStr = `erc8004:${chainId}:${d.agentId}`;
  const cosignHits = new Map<string, number[]>();

  const chatHits = new Map<string, number[]>();
  app.post("/v1/chat/completions", async (c) => {
    const t0 = now();
    // Per client first, so a request it rejects doesn't use up the host-wide budget.
    if (overLimit(chatHits, clientIp(c), d.chatLimit ?? CHAT_LIMIT, t0)) return fail(c, 429, `requests are limited to ${d.chatLimit ?? CHAT_LIMIT} per hour per client`);
    if (overLimit(chatHits, "*", d.chatLimitGlobal ?? CHAT_LIMIT_GLOBAL, t0)) return fail(c, 429, "this host is at its hourly request limit; try again later");
    const saltHex = c.req.header("x-assay-salt")?.replace(/^0x/, "") ?? "";
    if (!/^[0-9a-fA-F]{64}$/.test(saltHex)) return fail(c, 400, "X-Assay-Salt header is required: 32 random bytes as 64 hex chars");
    const salt = `0x${saltHex.toLowerCase()}` as Hex;

    const cosigner = c.req.header("x-assay-cosigner");
    if (cosigner !== undefined && !BYTES32.test(cosigner)) return fail(c, 400, "X-Assay-Cosigner must be 0x + 64 hex (keccak256(abi.encode(qx, qy)))");

    const req: unknown = await c.req.json().catch(() => undefined);
    if (!isObj(req) || !Array.isArray(req.messages)) return fail(c, 400, "body must be a JSON object with a messages array");
    if (req.stream) return fail(c, 400, "v0 is non-streaming: send stream false or omit it");
    const problem = chatBodyProblem(req, d.maxTokensCap ?? MAX_TOKENS_CAP);
    if (problem) return fail(c, 400, problem);

    // `provider` is the host's choice, not the client's, so it is neither forwarded nor committed.
    const { messages, model: _model, stream: _stream, provider: _provider, ...rest } = req;
    // Some upstreams (Google's Gemma endpoint) return 500 without a token budget, so fill one in.
    // The filled value is what is forwarded, committed and signed, so the receipt matches the call.
    const filled = rest.max_tokens === undefined && rest.max_completion_tokens === undefined ? { ...rest, max_tokens: d.defaultMaxTokens ?? DEFAULT_MAX_TOKENS } : rest;
    const params = d.reasoning ? { ...filled, reasoning: d.reasoning } : filled;
    const up = await d.upstream({ ...params, messages, model: d.model, ...providerPin(d.provider) });
    if (up.status !== 200) return c.json(up.json as object, up.status as ContentfulStatusCode);

    const out = isObj(up.json) ? up.json : {};
    if (d.provider && !providerMatches(d.provider, out.provider)) {
      return fail(c, 502, `upstream served by ${JSON.stringify(out.provider)}, not the pinned provider ${d.provider}; no receipt signed`);
    }
    const choice = Array.isArray(out.choices) ? out.choices[0] : undefined;
    // Text, or the JCS of tool_calls for a tool-only answer (SPEC §1): the same rule wrap() checks.
    const text = assistantOutput(choice?.message);
    if (text === undefined) return fail(c, 502, "upstream returned neither assistant text nor tool calls; no receipt signed");

    const body = buildReceipt({
      model: d.model,
      host: { agentId: agentIdStr, keyId: d.signer.kid, alg: "ES256" },
      req: { commit: commitRequest(salt, messages, params), params, ...(cosigner ? { cosigner: cosigner.toLowerCase() as Hex } : {}) },
      res: {
        commit: commitResponse(salt, text),
        tokensIn: count(out.usage?.prompt_tokens),
        tokensOut: count(out.usage?.completion_tokens),
        finish: typeof choice.finish_reason === "string" ? choice.finish_reason : "unknown",
      },
    });
    const jws = await d.signer.signReceipt(body);
    const hash = receiptHash(body);
    d.store.addReceipt({ hash, body, jws });
    d.batcher?.notify();

    c.header("X-Assay-Receipt", Buffer.from(JSON.stringify({ body, jws })).toString("base64url"));
    c.header("X-Assay-Receipt-Hash", hash);
    return c.json(out);
  });

  app.get("/.well-known/jwks.json", (c) =>
    c.json({
      keys: [publicPart(d.signer.publicJwk), ...(d.retiredJwks ?? []).map((k) => ({ ...publicPart(k), status: "retired" }))],
    }),
  );

  app.get("/.well-known/agent-registration.json", (c) =>
    c.json({
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: d.hostName ?? "Assay reference host",
      description: `OpenAI-compatible proxy that signs an Assay receipt for every response and anchors receipt batches on Monad. Model: ${d.model}.`,
      services: [
        { name: "chat", endpoint: `${d.publicUrl}/v1/chat/completions` },
        { name: "jwks", endpoint: `${d.publicUrl}/.well-known/jwks.json` },
        { name: "receipts", endpoint: `${d.publicUrl}/v1/receipts/{receiptHash}` },
      ],
      registrations: [{ agentId: Number(d.agentId), agentRegistry: `eip155:${chainId}:${d.identityRegistry ?? IDENTITY_REGISTRY}` }],
      supportedTrust: [],
    }),
  );

  app.get("/v1/receipts/:hash", (c) => {
    const hash = c.req.param("hash").toLowerCase() as Hex;
    if (!BYTES32.test(hash)) return fail(c, 400, "receipt hash must be 0x + 64 hex");
    const rec = d.store.getReceipt(hash);
    if (!rec) return fail(c, 404, "unknown receipt");
    const batch = d.store.getBatch(hash);
    if (!batch) return c.json({ status: "pending" });
    const proof = batch.proofs[hash];
    const sig = "verifyReceipt(uint256,bytes32,bytes32[],bytes32)";
    return c.json({
      status: "anchored",
      body: rec.body,
      jws: rec.jws,
      root: batch.root,
      proof,
      anchorTx: batch.anchorTx,
      reproduce: {
        chainId,
        contract: d.anchor,
        function: sig,
        args: [d.agentId.toString(), hash, proof, batch.root],
        cast: `cast call ${d.anchor} "${sig}(bool)" ${d.agentId} ${hash} "[${proof.join(",")}]" ${batch.root} --rpc-url ${d.publicRpc ?? NETWORKS.testnet.publicRpc}`,
      },
    });
  });

  /// Which receipts a batch holds. Hashes only: they're public once anchored, the bodies stay behind /v1/receipts/:hash.
  app.get("/v1/batches/:root", (c) => {
    const root = c.req.param("root").toLowerCase() as Hex;
    if (!BYTES32.test(root)) return fail(c, 400, "batch root must be 0x + 64 hex");
    const b = d.store.batchByRoot(root);
    if (!b) return fail(c, 404, "unknown batch");
    return c.json({ root: b.root, count: b.count, anchorTx: b.anchorTx, anchoredAt: b.anchoredAt, receipts: Object.keys(b.proofs) });
  });

  app.post("/v1/cosign", async (c) => {
    if (overLimit(cosignHits, clientIp(c), COSIGN_LIMIT, now())) return fail(c, 429, `co-sign relay is limited to ${COSIGN_LIMIT} per hour per IP`);

    const b: unknown = await c.req.json().catch(() => undefined);
    const a = isObj(b) && isObj(b.auth) ? b.auth : undefined;
    const index = (v: unknown) => (typeof v === "number" || typeof v === "string") && /^\d+$/.test(String(v));
    if (
      !isObj(b) ||
      !a ||
      ![b.receiptHash, b.qx, b.qy, a.r, a.s].every((v) => typeof v === "string" && BYTES32.test(v)) ||
      !index(a.challengeIndex) ||
      !index(a.typeIndex) ||
      !(typeof a.authenticatorData === "string" && isHex(a.authenticatorData)) ||
      typeof a.clientDataJSON !== "string"
    ) {
      return fail(c, 400, "body must be {receiptHash, qx, qy, auth: {r, s, challengeIndex, typeIndex, authenticatorData, clientDataJSON}}");
    }

    const hash = (b.receiptHash as string).toLowerCase() as Hex;
    if (!d.store.getReceipt(hash)) return fail(c, 404, "unknown receipt: this host only relays co-signs for receipts it issued");
    const batch = d.store.getBatch(hash);
    if (!batch) return fail(c, 409, "receipt is not anchored yet; retry after the next batch");

    const auth = {
      r: a.r,
      s: a.s,
      challengeIndex: BigInt(a.challengeIndex),
      typeIndex: BigInt(a.typeIndex),
      authenticatorData: a.authenticatorData,
      clientDataJSON: a.clientDataJSON,
    };
    try {
      const txHash = await d.relayCosign([d.agentId, hash, batch.proofs[hash], batch.root, auth, b.qx, b.qy]);
      return c.json({ txHash });
    } catch (e) {
      return fail(c, 502, `co-sign relay failed: ${publicError(e)}`);
    }
  });

  app.get("/health", (c) => c.json({ ok: true, model: d.model, kid: d.signer.kid, pending: d.store.pending().length, ...d.batcher?.schedule?.() }));
  if (d.grades) mountGrades(app, d.grades);
  if (d.sponsor) mountSponsor(app, { ...d.sponsor, store: d.store, chainId, agentId: d.agentId, anchor: d.anchor, now });

  return app;
}

async function main() {
  const cfg = loadConfig();
  const jwk = await readJwk(cfg.hostJwkPath);
  const signer = await createHostSigner(jwk, jwk.kid);
  const retiredJwks = await Promise.all(cfg.retiredJwkPaths.map(readJwk));
  const store = new Store(cfg.dataDir);
  const { clients, relayer } = makeClients(cfg.rpcUrls, cfg.relayerPrivateKey, cfg.network);
  const batcher = createBatcher({
    chainId: cfg.chainId,
    store,
    signer,
    clients,
    anchor: cfg.anchorAddress,
    agentId: cfg.hostAgentId,
    relayer,
    batchSeconds: cfg.batchSeconds,
    batchMax: cfg.batchMax,
  });
  const app = createApp({
    chainId: cfg.chainId,
    identityRegistry: cfg.identityRegistry,
    publicRpc: NETWORKS[cfg.network].publicRpc,
    signer,
    retiredJwks,
    store,
    upstream: openRouter(cfg.openrouterApiKey, fetch, cfg.upstreamUrl),
    model: cfg.upstreamModel,
    provider: cfg.upstreamProvider,
    chatLimit: cfg.chatLimit,
    chatLimitGlobal: cfg.chatLimitGlobal,
    defaultMaxTokens: cfg.defaultMaxTokens,
    maxTokensCap: cfg.maxTokensCap,
    hostName: cfg.hostName,
    reasoning: cfg.reasoning,
    agentId: cfg.hostAgentId,
    anchor: cfg.anchorAddress,
    publicUrl: cfg.publicUrl,
    batcher,
    relayCosign: (args) => sendTx(clients, { address: cfg.anchorAddress, abi: anchorWriteAbi, functionName: "cosign", args }),
    // The wallet clients extend publicActions, so they can read contracts too.
    grades: { reader: clients[0] as unknown as ContractReader, registry: cfg.verifierRegistry },
    sponsor: {
      reputation: cfg.reputationRegistry,
      accountImpl: cfg.accountImpl,
      code: (address) => (clients[0] as unknown as PublicClient).getCode({ address }),
      cosignedK: async (hash, signer) =>
        (await (clients[0] as unknown as ContractReader).readContract({ address: cfg.anchorAddress, abi: receiptAnchorAbi, functionName: "cosignedK", args: [hash, signer] })) as boolean,
      send: (req) => sendTx(clients, req as WriteRequest),
    },
  });

  // Refuse to start on the wrong chain: a mainnet host pointed at a testnet RPC would sign anchors nobody can verify.
  for (const url of cfg.rpcUrls) {
    const got = await createPublicClient({ transport: http(url) }).getChainId();
    if (got !== cfg.chainId) throw new Error(`RPC ${new URL(url).host} is chain ${got}, but ASSAY_NETWORK=${cfg.network} needs ${cfg.chainId}`);
  }
  await batcher.checkBalance();
  batcher.start();
  serve({ fetch: app.fetch, port: cfg.port }, () =>
    console.info(`[host] ${cfg.upstreamModel} on :${cfg.port}, kid ${signer.kid}, ${store.pending().length} receipts pending`),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}
