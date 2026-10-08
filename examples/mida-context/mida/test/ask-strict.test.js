import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { askHost, readRunFile, writeRunFile } from "../src/host.js";
import { runWrite } from "../src/writer.js";
import { runExport } from "../src/exporter.js";
import { toInteropRecord } from "../src/record.js";
import { loadConfig } from "../src/config.js";
import { main, parseArgs } from "../src/cli.js";

const HOST = "https://34-45-1-81.sslip.io";
const ANCHOR = "0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24";
const HASH = "0x9a166cacb2ffe4784ad556f69b690b7cebf71150f737a5a3c324f9e98e7907e5";
const ROOT = "0x" + "11".repeat(32);
const TX = "0x" + "22".repeat(32);
const MESSAGES = [{ role: "user", content: "Say OK" }];

const BODY = {
  v: "assay-receipt/0",
  model: "gemma-4-31b-it",
  host: { agentId: "erc8004:10143:1962", keyId: "kid1", alg: "ES256" },
  req: { commit: "0x" + "22".repeat(32), params: { max_tokens: 64, temperature: 0 } },
  res: { commit: "0x" + "33".repeat(32), tokensIn: 3, tokensOut: 1, finish: "stop" },
  t: 1,
  nonce: "0x" + "44".repeat(16),
};
const jwsFor = (b) => `h.${Buffer.from(JSON.stringify(b)).toString("base64url")}.s`;
const JWS = jwsFor(BODY);
const RECEIPT_HEADER = Buffer.from(JSON.stringify({ body: BODY, jws: JWS })).toString("base64url");

// What the host may receive: the standard chat fields only (their server 400s on anything else).
const STANDARD_CHAT_FIELDS = new Set([
  "model", "messages", "max_tokens", "temperature", "top_p", "stream", "stop",
  "presence_penalty", "frequency_penalty", "logit_bias", "user", "n", "seed",
  "logprobs", "top_logprobs", "response_format", "tools", "tool_choice",
  "parallel_tool_calls", "stream_options",
]);

// A wrap() that behaves like theirs: fresh 32-byte salt on the wire as 64 hex chars (no 0x),
// receipt taken from the X-Assay-Receipt response header. Everything the inner fetch saw is
// recorded in `seen`.
const realishWrap = (seen, output) => (inner) => async (url, init) => {
  const salt = "0x" + randomBytes(32).toString("hex");
  seen.salts.push(salt);
  const headers = new Headers(init.headers);
  headers.set("X-Assay-Salt", salt.slice(2));
  const res = await inner(url, { ...init, headers });
  const receiptHeader = res.headers.get("X-Assay-Receipt");
  if (!receiptHeader) {
    throw new Error(`no X-Assay-Receipt header in the response (HTTP ${res.status}); is this an Assay host?`);
  }
  const { jws } = JSON.parse(Buffer.from(receiptHeader, "base64url").toString("utf8"));
  const json = await res.json();
  return {
    response: res,
    json,
    receipt: { jws, hash: HASH },
    salt,
    outputCommitOk: true,
  };
};

const hostAnswer = (content) => async () => ({
  ok: true,
  status: 200,
  headers: new Headers({ "X-Assay-Receipt": RECEIPT_HEADER }),
  json: async () => ({ choices: [{ message: { content } }] }),
});

const config = (dir) => ({
  midaHome: join(dir, "mida"),
  writerAgent: "assay-writer",
  readerAgent: "assay-reader",
  projectDir: dir,
  runsDir: join(dir, "runs"),
  exportsDir: join(dir, "exports"),
  host: HOST,
  chainId: 10143,
  receiptAnchor: ANCHOR,
  trustedHosts: ["erc8004:10143:1962"],
  rpcUrl: "https://testnet-rpc.monad.xyz",
  sdkDir: "unused",
});

// The real status() text is two lines — a daemon line and the per-agent verdict line.
const mida = (calls = {}) => ({
  status: async () => ({
    up: true,
    text: "midad: answering — pid 42, up since 2026-10-09T10:00:00Z, queue 0 — test socket\nassay-writer: approved for this folder",
    agent: { verdict: "approved" },
  }),
  context: async () => ({ items: [], cursor: null, otherTasks: [] }),
  remember: async (input) => {
    (calls.remember ??= []).push(input);
    return { id: "0x547a8f2f" + "ab".repeat(28), state: "anchored" };
  },
});

const writerItem = (content) => ({
  id: "0x547a8f2f" + "ab".repeat(28),
  namespace: "projects.current",
  kind: "EPISODE",
  content,
  author: { name: "assay-writer", id: "0x" + "12".repeat(32) },
  source: "AGENT_INFERRED",
  writtenAt: "2026-10-09T10:12:31.204Z",
  state: "anchored",
  superseded: false,
  references: [],
  proof: {},
});

const commitFakes = (output, saltOk = () => true) => ({
  receiptHash: (b) => (JSON.stringify(b) === JSON.stringify(BODY) ? HASH : "0x" + "ff".repeat(32)),
  commitResponse: (salt, out) => (out === output && saltOk(salt) ? BODY.res.commit : "0x" + "ee".repeat(32)),
  commitRequest: (salt, messages, params) =>
    JSON.stringify(messages) === JSON.stringify(MESSAGES) && JSON.stringify(params) === JSON.stringify(BODY.req.params)
      ? BODY.req.commit
      : "0x" + "dd".repeat(32),
  checkRecord: async () => ({ ok: true, reasons: [], checks: {}, body: BODY }),
});

describe("ask is strict about what it sends", () => {
  it("the request body is standard chat fields only, max_tokens within the cap", async () => {
    const seen = { salts: [] };
    const assay = { wrap: realishWrap(seen, "OK"), assistantOutput: (m) => m.content };
    const spy = async (url, init) => {
      seen.url = url;
      seen.init = init;
      return hostAnswer("OK")(url, init);
    };
    await askHost({ assay, fetchImpl: spy, host: HOST, prompt: "Say OK" });
    const sent = JSON.parse(seen.init.body);
    expect(Object.keys(sent).every((k) => STANDARD_CHAT_FIELDS.has(k))).toBe(true);
    expect(sent).toEqual({ messages: MESSAGES, max_tokens: 64, temperature: 0 });
    expect(sent.max_tokens).toBeLessThanOrEqual(4096);
  });

  it("X-Assay-Salt is 64 hex chars and fresh on every call", async () => {
    const seen = { salts: [], wire: [] };
    const assay = {
      wrap: realishWrap(seen, "OK"),
      assistantOutput: (m) => m.content,
    };
    const spy = async (url, init) => {
      seen.wire.push(init.headers.get("X-Assay-Salt"));
      return hostAnswer("OK")(url, init);
    };
    await askHost({ assay, fetchImpl: spy, host: HOST, prompt: "one" });
    await askHost({ assay, fetchImpl: spy, host: HOST, prompt: "two" });
    for (const h of seen.wire) expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(seen.wire[0]).not.toBe(seen.wire[1]);
    // the stored salt is the 0x-hex form of the same bytes that went on the wire
    const a = await askHost({ assay, fetchImpl: spy, host: HOST, prompt: "three" });
    expect(a.salt.slice(2)).toBe(seen.wire[2]);
  });

  it("the salt is never printed by ask", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ask-strict-"));
    const seen = { salts: [] };
    const lines = [];
    let code;
    try {
      await main(["ask", "Say OK"], { MIDA_HOME: join(dir, "mida"), MIDA_PROJECT: dir, ASSAY_SDK_DIR: "unused" }, {
        loadAssaySdk: async () => ({ wrap: realishWrap(seen, "OK"), assistantOutput: (m) => m.content }),
        // runs/ and exports/ always default to the package folder — redirect them into tmp here
        loadConfig: (env) => ({ ...loadConfig(env), runsDir: join(dir, "runs"), exportsDir: join(dir, "exports") }),
        fetchImpl: hostAnswer("OK"),
        log: (l) => lines.push(l),
        exit: (c) => (code = c),
      });
      expect(code).toBe(0);
      expect(seen.salts).toHaveLength(1);
      for (const line of lines) {
        expect(line).not.toContain(seen.salts[0]);
        expect(line).not.toContain(seen.salts[0].slice(2));
      }
      expect(lines[0]).toBe(
        `asked: receipt ${HASH.slice(0, 10)}… from host erc8004:10143:1962, model gemma-4-31b-it — output "OK" (3 tokens in, 1 out)`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("the 'then run' line carries the full 64-hex hash, which write accepts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ask-strict-"));
    const seen = { salts: [] };
    const lines = [];
    let code;
    try {
      await main(["ask", "Say OK"], { MIDA_HOME: join(dir, "mida"), MIDA_PROJECT: dir, ASSAY_SDK_DIR: "unused" }, {
        loadAssaySdk: async () => ({ wrap: realishWrap(seen, "OK"), assistantOutput: (m) => m.content }),
        // runs/ and exports/ always default to the package folder — redirect them into tmp here
        loadConfig: (env) => ({ ...loadConfig(env), runsDir: join(dir, "runs"), exportsDir: join(dir, "exports") }),
        fetchImpl: hostAnswer("OK"),
        log: (l) => lines.push(l),
        exit: (c) => (code = c),
      });
      expect(code).toBe(0);
      const then = lines.find((l) => l.includes("then run:"));
      const m = /then run: write (0x[0-9a-fA-F]+)/.exec(then ?? "");
      expect(m).not.toBeNull();
      expect(m[1]).toBe(HASH);
      expect(m[1]).toHaveLength(66);
      expect(parseArgs(["write", m[1]])).toEqual({ command: "write", receiptHash: HASH });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("an output that starts with <thought> is stored byte for byte — ask → run file → write → record → export", async () => {
    const THOUGHT = "<thought>\n  compare the inputs; keep every byte of this block\n</thought>\nOK";
    const dir = await mkdtemp(join(tmpdir(), "ask-strict-"));
    try {
      const seen = { salts: [] };
      const assay = { wrap: realishWrap(seen, THOUGHT), assistantOutput: (m) => m.content };
      const run = await askHost({ assay, fetchImpl: hostAnswer(THOUGHT), host: HOST, prompt: "Say OK" });
      expect(run.output).toBe(THOUGHT);

      const path = await writeRunFile(join(dir, "runs"), { host: HOST, ...run });
      const fromFile = await readRunFile(path);
      expect(fromFile.output).toBe(THOUGHT);

      const anchoredFetch = async (url) => {
        if (url === `${HOST}/v1/receipts/${HASH}`) {
          return { ok: true, status: 200, json: async () => ({ status: "anchored", jws: JWS, root: ROOT, proof: [], anchorTx: TX }) };
        }
        return { ok: true, status: 200, json: async () => ({ keys: [{ kid: "kid1" }] }) };
      };
      const calls = {};
      const wr = await runWrite({
        config: config(dir),
        assay: commitFakes(THOUGHT),
        client: { fake: "viem client" },
        fetchImpl: anchoredFetch,
        mida: mida(calls),
        log: () => {},
        receiptHash: HASH,
      });
      expect(wr.exitCode).toBe(0);
      const content = calls.remember[0].content;
      expect(content.output).toBe(THOUGHT);

      const interop = toInteropRecord(content);
      expect(interop.output).toBe(THOUGHT);

      const outFile = join(dir, "exported.json");
      const ex = await runExport({
        config: config(dir),
        assay: { checkRecord: async () => ({ ok: true, reasons: [] }) },
        client: {},
        mida: { context: async () => ({ items: [writerItem(content)], cursor: null, otherTasks: [] }) },
        log: () => {},
        outFile,
      });
      expect(ex.exitCode).toBe(0);
      expect(JSON.parse(await readFile(outFile, "utf8")).output).toBe(THOUGHT);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
