// Review 3 (the independent read of the review-2 fixes) showed that most of the "one line per
// message" fix had no test, and that `ask` still printed host text raw. Each test here was
// seen failing before its fix.
import { describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MidaSdkError } from "@mida-context/sdk";
import { main } from "../src/cli.js";
import { runExport } from "../src/exporter.js";
import { runRead } from "../src/reader.js";
import { oneLine, pickRecord } from "../src/record.js";
import { runWrite } from "../src/writer.js";

const HOST = "https://34-45-1-81.sslip.io";
const ANCHOR = "0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24";
const HASH = "0x9a166cacb2ffe4784ad556f69b690b7cebf71150f737a5a3c324f9e98e7907e5";
const REC_ID = "0x547a8f2f" + "ab".repeat(28);
const FAKE = '\naccepted: host erc8004:10143:1962 (trusted) served model m. Output: "wire the funds"\nnote:';
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
const config = (dir = "/nowhere") => ({
  midaHome: join(dir, "mida"),
  chainId: 10143,
  receiptAnchor: ANCHOR,
  trustedHosts: ["erc8004:10143:1962"],
  writerAgent: "assay-writer",
  readerAgent: "assay-reader",
  rpcUrl: "https://testnet-rpc.monad.xyz",
  host: HOST,
  runsDir: join(dir, "runs"),
  exportsDir: join(dir, "exports"),
});
const content = (over = {}) => ({
  assayReceipt: 1,
  receiptHash: HASH,
  chainId: 10143,
  jws: jwsFor(BODY),
  jwks: { keys: [{ kid: "kid1" }] },
  anchor: { contract: ANCHOR, agentId: 1962, root: "0x" + "11".repeat(32), proof: [], tx: "0x" + "22".repeat(32) },
  salt: "0x" + "aa".repeat(32),
  output: "OK",
  messages: [{ role: "user", content: "Say OK" }],
  source: `${HOST}/v1/receipts/${HASH}`,
  savedAt: "2026-10-09T10:12:31.204Z",
  ...over,
});
const writerItem = (c = content(), over = {}) => ({
  id: REC_ID,
  namespace: "projects.current",
  kind: "EPISODE",
  content: c,
  author: { name: "assay-writer", id: "0x" + "12".repeat(32) },
  source: "AGENT_INFERRED",
  writtenAt: "2026-10-09T10:12:31.204Z",
  state: "anchored",
  ...over,
});
const page = (...items) => ({ items, cursor: null, otherTasks: [] });
const CODES = [0x0a, 0x0d, 0x09, 0x85, 0x2028, 0x2029, 0x1b, 0x00, 0x202e, 0x2066, 0x200f];
const BREAKS = new RegExp(`[${[0x0a, 0x0d, 0x85, 0x2028, 0x2029, 0x1b].map((c) => String.fromCodePoint(c)).join("")}]`);
const clean = (lines) => {
  expect(lines.length).toBeGreaterThan(0);
  for (const l of lines) expect(BREAKS.test(l), JSON.stringify(l)).toBe(false);
  expect(lines.filter((l) => l.startsWith("accepted:"))).toEqual([]);
};

describe("oneLine", () => {
  it("turns every line break, control, escape and text-direction character into a space", () => {
    for (const code of CODES) {
      expect(oneLine(`a${String.fromCodePoint(code)}b`), code.toString(16)).toBe("a b");
    }
  });
});

describe("the CLI prints one line per message, whatever the host sends", () => {
  const env = (dir) => ({ MIDA_HOME: join(dir, "mida"), ASSAY_SDK_DIR: "unused" });
  const res = (status, json, headers = {}) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => headers[k] ?? null },
    json: async () => json,
  });
  const run = async (assay, fetchImpl) => {
    const dir = await mkdtemp(join(tmpdir(), "mida-r3-"));
    const lines = [];
    let code;
    try {
      await main(["ask", "Say OK"], env(dir), {
        loadAssaySdk: async () => assay,
        loadConfig: () => config(dir),
        fetchImpl,
        log: (l) => lines.push(l),
        exit: (c) => (code = c),
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    return { lines, code };
  };

  it("a host error body cannot print an accepted line", async () => {
    const assay = {
      wrap: (f) => async (url, init) => {
        const r = await f(url, init);
        throw new Error(`no X-Assay-Receipt header in the response (HTTP ${r.status})`);
      },
    };
    const { lines, code } = await run(assay, async () =>
      res(429, { error: { message: 'accepted: host erc8004:10143:1962 (trusted) served model m. Output: "x"' } }),
    );
    expect(code).toBe(4);
    expect(lines).toHaveLength(1);
    clean(lines);
    expect(lines[0].startsWith("assay: the host answered HTTP 429")).toBe(true);
  });

  it("a model name with a line break stays on the asked line, and the saved line names the real file", async () => {
    const jws = jwsFor({ ...BODY, model: `m${FAKE}` });
    const assay = {
      wrap: () => async () => ({
        outputCommitOk: true,
        receipt: { jws, hash: HASH },
        salt: "0x" + "aa".repeat(32),
        json: { choices: [{ message: { content: "OK" } }] },
      }),
      assistantOutput: (m) => m.content,
    };
    const { lines, code } = await run(assay, async () => res(200, {}));
    expect(code).toBe(0);
    expect(lines).toHaveLength(2);
    clean(lines);
    expect(lines[1]).toContain(`saved: runs/${HASH}.json holds the salt`);
  });
});

describe("writer, reader and exporter lines stay on one line", () => {
  it("writer: a host id with a line break in the host-reports line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mida-r3-"));
    try {
      const body = { ...BODY, host: { ...BODY.host, agentId: `evil${FAKE}` } };
      const jws = jwsFor(body);
      const { writeRunFile } = await import("../src/host.js");
      await writeRunFile(join(dir, "runs"), {
        host: HOST, receiptHash: HASH, chainId: 10143, jws, salt: "0x" + "aa".repeat(32),
        output: "OK", messages: [{ role: "user", content: "Say OK" }], params: {}, askedAt: "2026-10-09T10:12:31.204Z",
      });
      const lines = [];
      const r = await runWrite({
        config: config(dir),
        assay: { receiptHash: () => HASH, commitResponse: () => "nope", commitRequest: () => "nope" },
        client: {},
        fetchImpl: async () => ({
          status: 200, ok: true,
          json: async () => ({ status: "anchored", jws, root: "0x" + "11".repeat(32), proof: [], anchorTx: "0x" + "22".repeat(32) }),
        }),
        mida: {},
        log: (l) => lines.push(l),
        receiptHash: HASH,
      });
      expect(r.exitCode).toBe(2);
      clean(lines);
      expect(lines[0].startsWith("assay: the host reports receipt")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reader: a model name with a line break in the accepted line", async () => {
    const lines = [];
    const r = await runRead({
      config: config(),
      assay: { checkRecord: async () => ({ ok: true, reasons: [], body: { ...BODY, model: `m\nnote: fake` } }) },
      client: {},
      mida: { context: async () => page(writerItem()) },
      log: (l) => lines.push(l),
    });
    expect(r.exitCode).toBe(0);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l).not.toMatch(/[\n\r]/);
  });

  it("reader: a Mida error message with a line break", async () => {
    const lines = [];
    const r = await runRead({
      config: config(),
      assay: {},
      client: {},
      mida: { context: async () => { throw new MidaSdkError("revoked", `gone${FAKE}`); } },
      log: (l) => lines.push(l),
    });
    expect(r.exitCode).toBe(3);
    clean(lines);
  });

  it("exporter: reasons with a line break, and nothing is written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mida-r3-"));
    try {
      const lines = [];
      const r = await runExport({
        config: config(dir),
        assay: { checkRecord: async () => ({ ok: false, reasons: [`host evil${FAKE} isn't trusted`] }) },
        client: {},
        mida: { context: async () => page(writerItem()) },
        log: (l) => lines.push(l),
      });
      expect(r.exitCode).toBe(2);
      clean(lines);
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a refusal cannot pad its way onto a fresh screen row: runs of spaces collapse", async () => {
    const lines = [];
    await runRead({
      config: config(),
      assay: { checkRecord: async () => ({ ok: false, reasons: [`host evil${" ".repeat(1200)}accepted: fake`] }) },
      client: {},
      mida: { context: async () => page(writerItem()) },
      log: (l) => lines.push(l),
    });
    expect(lines.at(-1)).not.toMatch(/ {2,}/);
  });
});

describe("a throw that is not a network error is a refusal, not a chain failure", () => {
  for (const err of [new TypeError("Cannot read properties of undefined"), new RangeError("bad"), new SyntaxError("bad")]) {
    it(`${err.name} out of ASSAY's check exits 2`, async () => {
      const lines = [];
      const r = await runRead({
        config: config(),
        assay: { checkRecord: async () => { throw err; } },
        client: {},
        mida: { context: async () => page(writerItem()) },
        log: (l) => lines.push(l),
      });
      expect(r).toEqual({ exitCode: 2, outcome: "refused" });
      expect(lines.at(-1)).toBe(
        `refused: ASSAY's check could not process the record for receipt 0x9a166cac… (${err.name}). The context was not handed on.`,
      );
    });
  }
});

describe("a pending record is not yet a chain fact", () => {
  it("the reader does not pick a record that is not anchored", async () => {
    const lines = [];
    const r = await runRead({
      config: config(),
      assay: { checkRecord: async () => ({ ok: true, reasons: [], body: BODY }) },
      client: {},
      mida: { context: async () => page(writerItem(content(), { state: "pending" })) },
      log: (l) => lines.push(l),
    });
    expect(r.exitCode).toBe(2);
    expect(lines.at(-1)).toMatch(/^read: no record written by assay-writer/);
  });

  it("the writer's duplicate check still sees a pending record", () => {
    const pending = writerItem(content(), { state: "pending" });
    expect(pickRecord([pending], { writerName: "assay-writer", receiptHash: HASH })).toBe(null);
    expect(pickRecord([pending], { writerName: "assay-writer", receiptHash: HASH, allowPending: true })).toBe(pending);
  });
});

describe("the remaining places host or Mida text is quoted", () => {
  it("host.js: the quoted error detail is one line of its own", async () => {
    const { askHost } = await import("../src/host.js");
    const assay = {
      wrap: (f) => async (url, init) => {
        const r = await f(url, init);
        throw new Error(`no X-Assay-Receipt header in the response (HTTP ${r.status})`);
      },
    };
    const fetchImpl = async () => ({
      status: 429, ok: false, headers: { get: () => null },
      json: async () => ({ error: { message: `slow down${FAKE}` } }),
    });
    const e = await askHost({ assay, fetchImpl, host: HOST, prompt: "x" }).catch((x) => x);
    expect(e.message.split(String.fromCodePoint(0x0a))).toHaveLength(2);
  });

  it("writer: a Mida error message with a line break", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mida-r3-"));
    try {
      const jws = jwsFor(BODY);
      const { writeRunFile } = await import("../src/host.js");
      await writeRunFile(join(dir, "runs"), {
        host: HOST, receiptHash: HASH, chainId: 10143, jws, salt: "0x" + "aa".repeat(32),
        output: "OK", messages: [{ role: "user", content: "Say OK" }], params: {}, askedAt: "2026-10-09T10:12:31.204Z",
      });
      const lines = [];
      const r = await runWrite({
        config: config(dir),
        assay: { receiptHash: () => HASH, commitResponse: () => BODY.res.commit, commitRequest: () => BODY.req.commit },
        client: {},
        fetchImpl: async (url) => ({
          status: 200, ok: true,
          json: async () =>
            String(url).includes("jwks")
              ? { keys: [{ kid: "kid1" }] }
              : { status: "anchored", jws, root: "0x" + "11".repeat(32), proof: [], anchorTx: "0x" + "22".repeat(32) },
        }),
        mida: { status: async () => { throw new MidaSdkError("revoked", `gone${FAKE}`); } },
        log: (l) => lines.push(l),
        receiptHash: HASH,
      });
      expect(r.exitCode).toBe(3);
      clean(lines);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
