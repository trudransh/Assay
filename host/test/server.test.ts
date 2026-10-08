import {
  assistantOutput,
  commitRequest,
  commitResponse,
  receiptHash,
  verifyProof,
  verifyReceipt,
  verifyReceiptJws,
  type HostSigner,
  type ReceiptBody,
} from "@assay/receipts";
import type { JWK } from "jose";
import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import { createBatcher } from "../src/batcher.js";
import { publicError } from "../src/errors.js";
import { createApp, DEFAULT_MAX_TOKENS, MAX_BODY_BYTES, MAX_TOKENS_CAP, type AppDeps } from "../src/server.js";
import { Store } from "../src/store.js";
import type { Upstream } from "../src/upstream.js";
import { mockClient, newSigner, quietLog, tempDir } from "./helpers.js";

const ANCHOR = "0x049A73755cA3508ef3Daa4752A3406f6e00CfB13" as Address;
const SALT = "ab".repeat(32);
const TEXT = "OK, here is the answer.";
const MODEL = "z-ai/glm-5.3";
const messages = [{ role: "user", content: "Say OK" }];

function fakeUpstream(over: Record<string, unknown> = {}, status = 200) {
  const calls: Record<string, unknown>[] = [];
  const up: Upstream = async (body) => {
    calls.push(body);
    return {
      status,
      json: {
        id: "gen-1",
        provider: "Z.AI",
        choices: [{ message: { role: "assistant", content: TEXT }, finish_reason: "stop" }],
        usage: { prompt_tokens: 12, completion_tokens: 5 },
        ...over,
      },
    };
  };
  return { up, calls };
}

async function setup(opts: { dir?: string; signer?: HostSigner; upstream?: Upstream; provider?: string; retiredJwks?: JWK[]; chatLimit?: number; chatLimitGlobal?: number; defaultMaxTokens?: number; maxTokensCap?: number } = {}) {
  const dir = opts.dir ?? tempDir();
  const store = new Store(dir);
  const signer = opts.signer ?? (await newSigner());
  const chain = mockClient();
  const batcher = createBatcher({
    store,
    signer,
    clients: [chain],
    anchor: ANCHOR,
    agentId: 1962n,
    relayer: "0x0000000000000000000000000000000000000001",
    batchSeconds: 300,
    batchMax: 64,
    log: quietLog(),
  });
  const relayed: (readonly unknown[])[] = [];
  const upstream = opts.upstream ?? fakeUpstream().up;
  const deps: AppDeps = {
    signer,
    retiredJwks: opts.retiredJwks,
    store,
    upstream,
    model: MODEL,
    provider: opts.provider,
    chatLimit: opts.chatLimit,
    chatLimitGlobal: opts.chatLimitGlobal,
    defaultMaxTokens: opts.defaultMaxTokens,
    maxTokensCap: opts.maxTokensCap,
    agentId: 1962n,
    anchor: ANCHOR,
    publicUrl: "https://host.example",
    batcher,
    relayCosign: async (args) => {
      relayed.push(args);
      return `0x${"cd".repeat(32)}`;
    },
  };
  return { app: createApp(deps), store, signer, batcher, relayed, dir };
}

type App = Awaited<ReturnType<typeof setup>>["app"];

const chat = (app: App, body: Record<string, unknown> = {}, headers: Record<string, string> = { "x-assay-salt": SALT }) =>
  app.request("/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ model: "anything", messages, max_tokens: 16, temperature: 0, ...body }),
  });

function receiptOf(res: Response): { body: ReceiptBody; jws: string } {
  return JSON.parse(Buffer.from(res.headers.get("x-assay-receipt")!, "base64url").toString());
}

const jwksOf = async (app: App) => (await (await app.request("/.well-known/jwks.json")).json()) as { keys: JWK[] };

describe("POST /v1/chat/completions", () => {
  it("rejects a missing salt, a short salt and stream: true with 400", async () => {
    const { app, store } = await setup();
    const noSalt = await chat(app, {}, {});
    expect(noSalt.status).toBe(400);
    expect(((await noSalt.json()) as any).error.message).toMatch(/X-Assay-Salt/);
    expect((await chat(app, {}, { "x-assay-salt": "ab".repeat(31) })).status).toBe(400);
    const streaming = await chat(app, { stream: true });
    expect(streaming.status).toBe(400);
    expect(((await streaming.json()) as any).error.message).toMatch(/v0 is non-streaming/);
    expect(store.pending()).toHaveLength(0);
  });

  it("signs a tool-call-only answer, committing to the JCS of tool_calls", async () => {
    const toolCalls = [{ type: "function", id: "c1", function: { name: "get_weather", arguments: '{"city":"Paris"}' } }];
    const { up } = fakeUpstream({ choices: [{ message: { role: "assistant", content: null, tool_calls: toolCalls }, finish_reason: "tool_calls" }] });
    const { app } = await setup({ upstream: up });
    const res = await chat(app);
    expect(res.status).toBe(200);
    const { body } = receiptOf(res);
    expect(body.res.commit).toBe(commitResponse(`0x${SALT}`, assistantOutput({ tool_calls: toolCalls })!));
    expect(body.res.finish).toBe("tool_calls");
  });

  it("limits chat requests per client and per host, reading the client through the local proxy", async () => {
    const { up } = fakeUpstream();
    const { app } = await setup({ upstream: up, chatLimit: 2, chatLimitGlobal: 3 });
    const send = (realIp: string) =>
      app.request(
        "/v1/chat/completions",
        { method: "POST", headers: { "content-type": "application/json", "x-assay-salt": SALT, "x-real-ip": realIp }, body: JSON.stringify({ messages, max_tokens: 16 }) },
        { incoming: { socket: { remoteAddress: "127.0.0.1" } } },
      );
    expect((await send("1.1.1.1")).status).toBe(200);
    expect((await send("1.1.1.1")).status).toBe(200);
    const third = await send("1.1.1.1");
    expect(third.status).toBe(429);
    expect(((await third.json()) as any).error.message).toMatch(/per hour per client/);
    expect((await send("2.2.2.2")).status).toBe(200); // another client still gets through
    expect((await send("3.3.3.3")).status).toBe(429); // the host-wide cap is the hard bound
  });

  it("fills max_tokens when the request has no budget, and signs what it forwarded", async () => {
    const { up, calls } = fakeUpstream();
    const { app } = await setup({ upstream: up });
    const res = await chat(app, { max_tokens: undefined });
    expect(res.status).toBe(200);
    const { body } = receiptOf(res);
    expect(body.req.params).toEqual({ temperature: 0, max_tokens: DEFAULT_MAX_TOKENS });
    expect(body.req.commit).toBe(commitRequest(`0x${SALT}`, messages, { temperature: 0, max_tokens: DEFAULT_MAX_TOKENS }));
    expect((calls[0] as Record<string, unknown>).max_tokens).toBe(DEFAULT_MAX_TOKENS);
  });

  it("commits to the bytes received and returned, and returns the upstream JSON with receipt headers", async () => {
    const { up, calls } = fakeUpstream();
    const { app, store } = await setup({ upstream: up });
    const res = await chat(app, { stream: false });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).choices[0].message.content).toBe(TEXT);

    const salt = `0x${SALT}` as Hex;
    const { body, jws } = receiptOf(res);
    expect(body.res.commit).toBe(commitResponse(salt, TEXT));
    expect(body.req.params).toEqual({ max_tokens: 16, temperature: 0 });
    expect(body.req.commit).toBe(commitRequest(salt, messages, { max_tokens: 16, temperature: 0 }));
    expect(body.model).toBe(MODEL);
    expect(body.host.agentId).toBe("erc8004:10143:1962");
    expect(body.res).toMatchObject({ tokensIn: 12, tokensOut: 5, finish: "stop" });
    expect(body.req.cosigner).toBeUndefined();
    expect(res.headers.get("x-assay-receipt-hash")).toBe(receiptHash(body));
    expect(store.getReceipt(receiptHash(body))?.jws).toBe(jws);
    // the host's model replaces the client's, and nothing unpinned is forwarded
    expect(calls[0]).toEqual({ messages, model: MODEL, max_tokens: 16, temperature: 0 });
  });

  it("accepts a 0x-prefixed salt", async () => {
    const { app } = await setup();
    expect((await chat(app, {}, { "x-assay-salt": `0x${SALT}` })).status).toBe(200);
  });

  it("signs X-Assay-Cosigner into req.cosigner and rejects a malformed one", async () => {
    const { app } = await setup();
    const cosigner = `0x${"Ef".repeat(32)}`;
    const res = await chat(app, {}, { "x-assay-salt": SALT, "x-assay-cosigner": cosigner });
    const { jws } = receiptOf(res);
    const { body } = await verifyReceiptJws(jws, await jwksOf(app));
    expect(body.req.cosigner).toBe(cosigner.toLowerCase());

    for (const bad of ["0x1234", "ef".repeat(32), `0x${"zz".repeat(32)}`]) {
      expect((await chat(app, {}, { "x-assay-salt": SALT, "x-assay-cosigner": bad })).status).toBe(400);
    }
  });

  it("returns 502 and signs nothing when the pinned provider did not serve the response", async () => {
    const { up, calls } = fakeUpstream({ provider: "Chutes" });
    const { app, store } = await setup({ upstream: up, provider: "z-ai" });
    const res = await chat(app);
    expect(res.status).toBe(502);
    expect(res.headers.get("x-assay-receipt")).toBeNull();
    expect(store.pending()).toHaveLength(0);
    expect(calls[0].provider).toEqual({ only: ["z-ai"], allow_fallbacks: false });
  });

  it("signs when the pinned provider matches", async () => {
    const { app } = await setup({ provider: "z-ai" });
    expect((await chat(app)).status).toBe(200);
  });

  it("passes upstream errors through without a receipt", async () => {
    const { app, store } = await setup({ upstream: fakeUpstream({ error: { message: "rate limited" } }, 429).up });
    const res = await chat(app);
    expect(res.status).toBe(429);
    expect(res.headers.get("x-assay-receipt")).toBeNull();
    expect(store.pending()).toHaveLength(0);
  });

  it("returns 502 when the upstream has no assistant text", async () => {
    const { app, store } = await setup({ upstream: fakeUpstream({ choices: [] }).up });
    expect((await chat(app)).status).toBe(502);
    expect(store.pending()).toHaveLength(0);
  });
});

describe("JWKS", () => {
  it("verifies the receipt JWS, and a JWKS with a different key fails", async () => {
    const { app } = await setup();
    const { jws } = receiptOf(await chat(app));
    await expect(verifyReceiptJws(jws, await jwksOf(app))).resolves.toBeDefined();

    const other = await setup();
    await expect(verifyReceiptJws(jws, await jwksOf(other.app))).rejects.toThrow();
  });

  it("publishes retired keys, marked, so receipts signed before a rotation still verify (D22)", async () => {
    const old = await setup();
    const { jws } = receiptOf(await chat(old.app));

    const rotated = await setup({ retiredJwks: [{ ...old.signer.publicJwk, d: "must-not-leak" }] });
    const jwks = await jwksOf(rotated.app);
    expect(jwks.keys).toHaveLength(2);
    expect(jwks.keys[0]).not.toHaveProperty("status");
    expect(jwks.keys[1]).toMatchObject({ kid: old.signer.kid, status: "retired" });
    expect(JSON.stringify(jwks)).not.toContain("must-not-leak");
    await expect(verifyReceiptJws(jws, jwks)).resolves.toMatchObject({ kid: old.signer.kid });
  });
});

describe("GET /v1/receipts/:hash", () => {
  it("is pending before a tick, then returns a proof the SDK accepts and the onchain call to reproduce it", async () => {
    const { app, batcher } = await setup();
    const res = await chat(app);
    const hash = res.headers.get("x-assay-receipt-hash") as Hex;
    await chat(app, {}, { "x-assay-salt": "cd".repeat(32) });

    expect(await (await app.request(`/v1/receipts/${hash}`)).json()).toEqual({ status: "pending" });
    await batcher.tick();

    const r = (await (await app.request(`/v1/receipts/${hash.toUpperCase().replace("0X", "0x")}`)).json()) as any;
    expect(r.status).toBe("anchored");
    expect(verifyProof(hash, r.proof, r.root)).toBe(true);
    expect(r.anchorTx).toMatch(/^0x[0-9a-f]{64}$/);
    const v = await verifyReceipt({ body: r.body, jws: r.jws, jwks: await jwksOf(app), proof: r.proof, root: r.root });
    expect(v.ok).toBe(true);
    expect(v.checks.merkle).toBe("pass");
    expect(r.reproduce).toMatchObject({
      chainId: 10143,
      contract: ANCHOR,
      function: "verifyReceipt(uint256,bytes32,bytes32[],bytes32)",
      args: ["1962", hash, r.proof, r.root],
    });
    expect(r.reproduce.cast).toContain(`cast call ${ANCHOR}`);
  });

  it("lists a batch's receipt hashes by root, and only hashes", async () => {
    const { app, batcher } = await setup();
    const hash = (await chat(app)).headers.get("x-assay-receipt-hash") as Hex;
    await batcher.tick();
    const { root } = (await (await app.request(`/v1/receipts/${hash}`)).json()) as any;
    const b = (await (await app.request(`/v1/batches/${root.toUpperCase().replace("0X", "0x")}`)).json()) as any;
    expect(b).toMatchObject({ root, count: 1, receipts: [hash] });
    expect(b).not.toHaveProperty("proofs");
    expect((await app.request(`/v1/batches/0x${"00".repeat(32)}`)).status).toBe(404);
    expect((await app.request("/v1/batches/0x12")).status).toBe(400);
  });

  it("404s an unknown hash and 400s a malformed one", async () => {
    const { app } = await setup();
    expect((await app.request(`/v1/receipts/0x${"00".repeat(32)}`)).status).toBe(404);
    expect((await app.request("/v1/receipts/0x12")).status).toBe(400);
  });

  it("reloads after a restart and old receipts still resolve", async () => {
    const first = await setup();
    const anchoredHash = (await chat(first.app)).headers.get("x-assay-receipt-hash") as Hex;
    await first.batcher.tick();
    const pendingHash = (await chat(first.app, {}, { "x-assay-salt": "cd".repeat(32) })).headers.get("x-assay-receipt-hash") as Hex;

    const second = await setup({ dir: first.dir, signer: first.signer });
    const r = (await (await second.app.request(`/v1/receipts/${anchoredHash}`)).json()) as any;
    expect(r.status).toBe("anchored");
    expect(verifyProof(anchoredHash, r.proof, r.root)).toBe(true);
    expect(await (await second.app.request(`/v1/receipts/${pendingHash}`)).json()).toEqual({ status: "pending" });
    expect(second.store.pending()).toEqual([pendingHash]);
  });
});

describe("POST /v1/cosign", () => {
  const auth = {
    r: `0x${"11".repeat(32)}`,
    s: `0x${"22".repeat(32)}`,
    challengeIndex: 23,
    typeIndex: "1",
    authenticatorData: `0x${"00".repeat(37)}`,
    clientDataJSON: '{"type":"webauthn.get","challenge":"x"}',
  };
  const xy = { qx: `0x${"33".repeat(32)}`, qy: `0x${"44".repeat(32)}` };
  const cosign = (app: App, body: unknown, ip = "10.0.0.1") =>
    app.request(
      "/v1/cosign",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      { incoming: { socket: { remoteAddress: ip } } },
    );

  it("relays only anchored receipts this host issued", async () => {
    const { app, batcher, relayed } = await setup();
    const hash = (await chat(app)).headers.get("x-assay-receipt-hash") as Hex;

    expect((await cosign(app, { receiptHash: `0x${"99".repeat(32)}`, ...xy, auth })).status).toBe(404);
    expect((await cosign(app, { receiptHash: hash, ...xy, auth })).status).toBe(409);
    expect((await cosign(app, { receiptHash: hash, ...xy, auth: { ...auth, r: "0x12" } })).status).toBe(400);
    expect(relayed).toHaveLength(0);

    await batcher.tick();
    const res = await cosign(app, { receiptHash: hash, ...xy, auth });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).txHash).toBe(`0x${"cd".repeat(32)}`);
    const r = (await (await app.request(`/v1/receipts/${hash}`)).json()) as any;
    expect(relayed[0]).toEqual([1962n, hash, r.proof, r.root, { ...auth, challengeIndex: 23n, typeIndex: 1n }, xy.qx, xy.qy]);
  });

  it("limits each IP to 10 relays per hour", async () => {
    const { app } = await setup();
    for (let i = 0; i < 10; i++) expect((await cosign(app, {})).status).toBe(400);
    expect((await cosign(app, {})).status).toBe(429);
    expect((await cosign(app, {}, "10.0.0.2")).status).toBe(400);
  });
});

describe("well-known and health", () => {
  it("serves an ERC-8004 registration file", async () => {
    const { app } = await setup();
    const reg = (await (await app.request("/.well-known/agent-registration.json")).json()) as any;
    expect(reg.type).toBe("https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
    expect(reg.services).toContainEqual({ name: "chat", endpoint: "https://host.example/v1/chat/completions" });
    expect(reg.registrations).toEqual([{ agentId: 1962, agentRegistry: "eip155:10143:0x8004A818BFB912233c491871b3d84c89A494BD9e" }]);
    expect(reg.supportedTrust).toEqual([]);
  });

  it("reports health", async () => {
    const { app, signer } = await setup();
    await chat(app);
    expect(await (await app.request("/health")).json()).toEqual({ ok: true, model: MODEL, kid: signer.kid, pending: 1 });
  });

  it("adds the batch clock to health while the batcher runs", async () => {
    const { app, batcher } = await setup();
    batcher.start();
    const body = (await (await app.request("/health")).json()) as { batchSeconds: number; nextBatchInMs: number };
    batcher.stop();
    expect(body.batchSeconds).toBe(300);
    expect(body.nextBatchInMs).toBeGreaterThan(299_000);
  });
});

describe("request limits", () => {
  it("refuses fields that could change the model or the cost, before calling upstream", async () => {
    const { app } = await setup();
    for (const extra of [{ models: ["other/model"] }, { plugins: [{ id: "web" }] }, { n: 5 }, { route: "fallback" }]) {
      const res = await chat(app, extra);
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).error.message).toMatch(/isn't supported/);
    }
  });

  it("caps max_tokens and needs real messages", async () => {
    const { app } = await setup();
    expect((await chat(app, { max_tokens: MAX_TOKENS_CAP + 1 })).status).toBe(400);
    expect((await chat(app, { max_completion_tokens: 0 })).status).toBe(400);
    expect((await chat(app, { messages: [] })).status).toBe(400);
    expect((await chat(app, { messages: ["hi"] })).status).toBe(400);
    expect((await chat(app, { max_tokens: MAX_TOKENS_CAP })).status).toBe(200);
  });

  it("a host with its own caps fills and enforces them", async () => {
    const { up, calls } = fakeUpstream();
    const { app } = await setup({ upstream: up, defaultMaxTokens: 256, maxTokensCap: 512 });
    expect((await chat(app, { max_tokens: undefined })).status).toBe(200);
    expect(calls[0].max_tokens).toBe(256);
    expect((await chat(app, { max_tokens: 513 })).status).toBe(400);
  });

  it("refuses a body over the size limit with 413", async () => {
    const { app } = await setup();
    const res = await chat(app, { messages: [{ role: "user", content: "x".repeat(MAX_BODY_BYTES) }] });
    expect(res.status).toBe(413);
  });

  it("sends security headers", async () => {
    const { app } = await setup();
    const res = await app.request("/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("publicError", () => {
  it("strips URLs (our RPC URLs carry a token) and keeps one short line", () => {
    const e = Object.assign(new Error("HTTP request failed.\n\nURL: https://rpc.example/key-abc123\nDetails: 401"), { shortMessage: "HTTP request failed. URL: https://rpc.example/key-abc123" });
    const text = publicError(e, { error: () => {} });
    expect(text).not.toContain("key-abc123");
    expect(text).toBe("HTTP request failed. URL: <url>");
  });
});
