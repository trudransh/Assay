import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MidaSdkError } from "@mida-context/sdk";
import { writeRunFile } from "../src/host.js";
import { runWrite } from "../src/writer.js";

const HOST = "https://34-45-1-81.sslip.io";
const ANCHOR = "0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24";
const HASH = "0x9a166cacb2ffe4784ad556f69b690b7cebf71150f737a5a3c324f9e98e7907e5";
const SALT = "0x" + "aa".repeat(32);
const ROOT = "0x8c89bd8a6495777123457221aae3a0ecf237dd6bd057b404a034ae4acdabbab2";
const TX = "0x41f73bca0000000000000000000000000000000000000000000000000000000000aa";
const REC_ID = "0x547a8f2f" + "ab".repeat(28);
const NOW = 1790954324495;
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
const JWKS = { keys: [{ kid: "kid1", kty: "EC" }] };

const jwsFor = (b) => `h.${Buffer.from(JSON.stringify(b)).toString("base64url")}.s`;
const JWS = jwsFor(BODY);

const res = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});

// The fake host answers the four states the real one can be in: pending, anchored, a signed
// answer that never anchored, and an error (a thrown fetch or a non-ok HTTP status).
const anchoredFetch = ({ error, ...over } = {}) => async (url) => {
  if (url === `${HOST}/v1/receipts/${HASH}`) {
    if (error instanceof Error) throw error;
    if (typeof error === "number") return res(error, { error: { message: "the host is down" } });
    return res(200, { status: "anchored", body: BODY, jws: JWS, root: ROOT, proof: [], anchorTx: TX, ...over });
  }
  if (url === `${HOST}/.well-known/jwks.json`) return res(200, JWKS);
  throw new Error(`unexpected url ${url}`);
};

// The checkRecord stand-in emulates the real verdicts this test needs: a jwks that is not a
// key list fails the signature check, and a root the fake chain has never seen fails anchoring.
const assay = (calls = {}, over = {}) => ({
  receiptHash: (b) => (JSON.stringify(b) === JSON.stringify(over.jwsBody ?? BODY) ? HASH : "0x" + "ff".repeat(32)),
  commitResponse: (salt, output) => (salt === SALT && output === "OK" ? BODY.res.commit : "0x" + "ee".repeat(32)),
  commitRequest: (salt, messages, params) =>
    salt === SALT &&
    JSON.stringify(messages) === JSON.stringify(MESSAGES) &&
    JSON.stringify(params) === JSON.stringify(BODY.req.params)
      ? BODY.req.commit
      : "0x" + "dd".repeat(32),
  checkRecord: async (record, pins) => {
    (calls.check ??= []).push({ record, pins });
    if (over.checkThrows) throw over.checkThrows;
    if (over.checkVerdict) return over.checkVerdict;
    if (!Array.isArray(record.jwks?.keys)) {
      return { ok: false, reasons: ["jws: fail", "kid: skipped"] };
    }
    if (!(over.knownRoots ?? new Set([ROOT])).has(record.anchor?.root)) {
      return { ok: false, reasons: ["anchored: fail"] };
    }
    return { ok: true, reasons: [], checks: {}, body: BODY };
  },
});

const config = (dir) => ({
  midaHome: join(dir, "mida"),
  writerAgent: "assay-writer",
  readerAgent: "assay-reader",
  projectDir: join(dir, "elsewhere"),
  runsDir: join(dir, "runs"),
  exportsDir: join(dir, "exports"),
  host: HOST,
  chainId: 10143,
  receiptAnchor: ANCHOR,
  trustedHosts: ["erc8004:10143:1962"],
  rpcUrl: "https://testnet-rpc.monad.xyz",
  sdkDir: "unused",
});

// The real status() joins a daemon line and the per-agent verdict line into one text —
// the fake keeps that two-line shape so a consumer that prints it is exercised for real.
const mida = (pages = [{ items: [], cursor: null, otherTasks: [] }], calls = {}) => ({
  status: async () => ({
    up: true,
    text: "midad: answering — pid 42, up since 2026-10-09T10:00:00Z, queue 0 — test socket\nassay-writer: approved for this folder",
    agent: { verdict: "approved" },
  }),
  context: async (input) => {
    (calls.context ??= []).push(input);
    if (pages instanceof Error) throw pages;
    return pages.shift() ?? { items: [], cursor: null, otherTasks: [] };
  },
  remember: async (input) => {
    (calls.remember ??= []).push(input);
    if (calls.rememberThrows) throw calls.rememberThrows;
    return calls.rememberResult ?? { id: REC_ID, state: "anchored" };
  },
});

const item = (content, author, source, id) => ({
  id,
  namespace: "projects.current",
  kind: "EPISODE",
  content,
  author,
  source,
  writtenAt: "2026-10-09T10:12:31.204Z",
  state: "anchored",
  superseded: false,
  references: [],
  proof: { manifestHash: "0x" + "99".repeat(32), recordId: id },
});

const run = {
  receiptHash: HASH,
  chainId: 10143,
  jws: JWS,
  salt: SALT,
  output: "OK",
  messages: MESSAGES,
  params: { max_tokens: 64, temperature: 0 },
  askedAt: "2026-10-09T10:12:31.204Z",
};

const write = async (dir, over = {}) => {
  const calls = {};
  const lines = [];
  const client = over.client ?? { fake: "viem client" };
  const result = await runWrite({
    config: config(dir),
    assay: over.assay ?? assay(calls, over),
    client,
    fetchImpl: over.fetchImpl ?? anchoredFetch(over.anchored ?? {}),
    mida: over.mida ?? mida(over.pages, calls),
    log: (line) => lines.push(line),
    now: () => NOW,
    receiptHash: over.receiptHash ?? HASH,
    ...(over.runFile ? { runFile: over.runFile } : {}),
  });
  return { result, calls, lines, client };
};

let dir;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mida-writer-"));
  await writeRunFile(join(dir, "runs"), { host: HOST, ...run });
});
afterEach(async () => rm(dir, { recursive: true, force: true }));

describe("runWrite", () => {
  it("saves one record and prints the spec section-3.3 lines", async () => {
    const { result, calls, lines, client } = await write(dir);
    expect(result).toEqual({ exitCode: 0, outcome: "recorded" });
    expect(lines).toEqual([
      `assay: the host reports receipt 0x9a166cac… anchored under host 1962 — root 0x8c89bd8a…, tx 0x41f73bca…`,
      "mida: midad: answering — pid 42, up since 2026-10-09T10:00:00Z, queue 0 — test socket\nassay-writer: approved for this folder",
      `assay: check passed for receipt 0x9a166cac… — the record is one the reader will accept`,
      `recorded: Mida record 0x547a8f2f… (anchored) in projects.current, author assay-writer — receipt 0x9a166cac…, salt and output inside the encrypted body`,
    ]);
    expect(calls.context).toHaveLength(1);
    // ASSAY's checkRecord ran on the interop record with chain-enabled pins from our config
    expect(calls.check).toHaveLength(1);
    const [{ record: checked, pins }] = calls.check;
    expect(Object.keys(checked)).toEqual([
      "receiptHash", "chainId", "jws", "jwks", "anchor", "salt", "output", "messages", "source",
    ]);
    expect(Object.hasOwn(checked, "assayReceipt")).toBe(false);
    expect(Object.hasOwn(checked, "savedAt")).toBe(false);
    expect(pins).toEqual({
      trustedHosts: ["erc8004:10143:1962"],
      chains: { 10143: { anchor: ANCHOR, rpc: "https://testnet-rpc.monad.xyz" } },
      client,
    });
    expect(Object.hasOwn(pins, "offline")).toBe(false);
    expect(calls.remember).toHaveLength(1);
    const [{ namespace, kind, content }] = calls.remember;
    expect(namespace).toBe("projects.current");
    expect(kind).toBe("EPISODE");
    expect(Object.keys(content)).toEqual([
      "assayReceipt", "receiptHash", "chainId", "jws", "jwks",
      "anchor", "salt", "output", "messages", "source", "savedAt",
    ]);
    expect(content).toEqual({
      assayReceipt: 1,
      receiptHash: HASH,
      chainId: 10143,
      jws: JWS,
      jwks: JWKS,
      anchor: { contract: ANCHOR, agentId: 1962, root: ROOT, proof: [], tx: TX },
      salt: SALT,
      output: "OK",
      messages: MESSAGES,
      source: `${HOST}/v1/receipts/${HASH}`,
      savedAt: new Date(NOW).toISOString(),
    });
    expect(Object.hasOwn(content, "body")).toBe(false);
    expect(Object.hasOwn(content, "type")).toBe(false);
  });

  it("refuses a run file without messages before any host call", async () => {
    const { messages, ...noMsgs } = run;
    await writeRunFile(join(dir, "runs"), { host: HOST, ...noMsgs });
    let fetches = 0;
    const { result, lines } = await write(dir, {
      fetchImpl: async () => { fetches += 1; throw new Error("must not fetch"); },
    });
    expect(result.exitCode).toBe(2);
    expect(fetches).toBe(0);
    expect(lines.at(-1)).toBe(
      `write: the run file for 0x9a166cac… carries no messages; ASSAY's check cannot open req.commit without them. Nothing was written.`,
    );
  });

  it("refuses a pending anchor before touching Mida", async () => {
    const { result, calls, lines } = await write(dir, { anchored: { status: "pending" } });
    expect(result.exitCode).toBe(2);
    expect(lines.at(-1)).toBe(
      `assay: receipt 0x9a166cac… is not anchored yet (the host says pending). Nothing was written. Try again in about 30 s.`,
    );
    expect(calls.context).toBeUndefined();
    expect(calls.remember).toBeUndefined();
  });

  for (const status of ["signed", "failed", undefined]) {
    it(`refuses a ${status ?? "missing"}-status receipt before Mida and the check`, async () => {
      const { result, calls, lines } = await write(dir, { anchored: { status } });
      expect(result.exitCode).toBe(2);
      expect(lines.at(-1)).toBe(
        `assay: the host's answer for receipt 0x9a166cac… is not usable (status ${status === undefined ? "null" : JSON.stringify(status)}, not "anchored"). Nothing was written.`,
      );
      expect(calls.context).toBeUndefined();
      expect(calls.check).toBeUndefined();
      expect(calls.remember).toBeUndefined();
    });
  }

  it("a junk JWKS fails ASSAY's check — refused, nothing saved", async () => {
    const fetchImpl = async (url) =>
      url === `${HOST}/.well-known/jwks.json` ? res(200, { keys: "junk" }) : anchoredFetch()(url);
    const { result, calls, lines } = await write(dir, { fetchImpl });
    expect(result.exitCode).toBe(2);
    expect(lines.at(-1)).toBe(
      `refused: ASSAY's check did not pass for receipt 0x9a166cac… — jws: fail; kid: skipped. Nothing was written.`,
    );
    expect(calls.check).toHaveLength(1);
    expect(calls.remember).toBeUndefined();
  });

  it("a root the chain does not know fails ASSAY's check — refused, nothing saved", async () => {
    const { result, calls, lines } = await write(dir, { anchored: { root: "0x" + "77".repeat(32) } });
    expect(result.exitCode).toBe(2);
    expect(lines.at(-1)).toBe(
      `refused: ASSAY's check did not pass for receipt 0x9a166cac… — anchored: fail. Nothing was written.`,
    );
    expect(calls.check).toHaveLength(1);
    expect(calls.remember).toBeUndefined();
  });

  it("an ok verdict with non-empty reasons still refuses — nothing saved", async () => {
    const { result, calls, lines } = await write(dir, {
      checkVerdict: { ok: true, reasons: ["anchored: skipped"], body: BODY },
    });
    expect(result.exitCode).toBe(2);
    expect(lines.at(-1)).toBe(
      `refused: ASSAY's check did not pass for receipt 0x9a166cac… — anchored: skipped. Nothing was written.`,
    );
    expect(calls.remember).toBeUndefined();
  });

  it("a non-hex proof entry refuses at the check boundary — no check call, nothing saved", async () => {
    const { result, calls, lines } = await write(dir, { anchored: { proof: ["not-hex"] } });
    expect(result.exitCode).toBe(2);
    expect(lines.at(-1)).toBe(
      "check: the record is not usable for ASSAY's check (anchor.proof is not an array of 32-byte hex). Nothing was written.",
    );
    expect(calls.check).toBeUndefined();
    expect(calls.remember).toBeUndefined();
  });

  it("a throw out of checkRecord (a chain or RPC failure) exits 4 and saves nothing", async () => {
    const err = new Error("POST https://testnet-rpc.monad.xyz/hidden-path — body={\"secret\":\"x\"}");
    err.name = "ContractFunctionExecutionError";
    const { result, calls, lines } = await write(dir, { checkThrows: err });
    expect(result.exitCode).toBe(4);
    expect(result.outcome).toBe("chain");
    expect(lines.at(-1)).toBe(
      "chain: could not read ReceiptAnchor at 0x63e4…1a24 over testnet-rpc.monad.xyz (ContractFunctionExecutionError). Nothing was written.",
    );
    // only the error's name and the RPC host — never the message, the URL path or the body
    expect(lines.at(-1)).not.toContain("hidden-path");
    expect(lines.at(-1)).not.toContain("body=");
    expect(lines.at(-1)).not.toContain("secret");
    expect(calls.remember).toBeUndefined();
  });

  it("refuses a run file whose salt is not 32-byte hex — before any host call", async () => {
    await writeRunFile(join(dir, "runs"), { host: HOST, ...run, salt: "0x1234" });
    let fetches = 0;
    const { result, calls, lines } = await write(dir, {
      fetchImpl: async () => {
        fetches += 1;
        throw new Error("must not fetch");
      },
    });
    expect(result.exitCode).toBe(2);
    expect(fetches).toBe(0);
    expect(lines.at(-1)).toBe(
      "write: the salt in the run file for 0x9a166cac… is not 32-byte hex. Nothing was written.",
    );
    expect(calls.check).toBeUndefined();
    expect(calls.remember).toBeUndefined();
  });

  it("refuses when the salt does not open res.commit, before touching Mida", async () => {
    const bad = assay();
    bad.commitResponse = () => "0x" + "dd".repeat(32);
    const { result, calls, lines } = await write(dir, { assay: bad });
    expect(result.exitCode).toBe(2);
    expect(lines.at(-1)).toBe(
      `assay: the salt in the run file does not open res.commit for receipt 0x9a166cac…. Nothing was written.`,
    );
    expect(calls.context).toBeUndefined();
    expect(calls.remember).toBeUndefined();
  });

  it("finds the run file in runsDir, never under projectDir (MIDA_PROJECT)", async () => {
    // config(dir) puts projectDir at <dir>/elsewhere while the run file sits in <dir>/runs —
    // write finding it proves run files do not follow MIDA_PROJECT.
    expect(await readdir(join(dir, "runs"))).toContain(`${HASH}.json`);
    const { result } = await write(dir);
    expect(result.exitCode).toBe(0);
  });

  it("refuses when the signed JWS names a chain the run file does not", async () => {
    const BODY143 = { ...BODY, host: { ...BODY.host, agentId: "erc8004:143:1962" } };
    const { result, calls, lines } = await write(dir, {
      anchored: { jws: jwsFor(BODY143) },
      jwsBody: BODY143,
    });
    expect(result.exitCode).toBe(2);
    expect(lines.at(-1)).toBe(
      "assay: the receipt's host id names chain 143, but the run file says chain 10143. Nothing was written.",
    );
    expect(calls.check).toBeUndefined();
    expect(calls.remember).toBeUndefined();
  });

  it("refuses a run file from another chain", async () => {
    await writeRunFile(join(dir, "runs"), { host: HOST, ...run, receiptHash: HASH, chainId: 143 });
    const { result, lines } = await write(dir);
    expect(result.exitCode).toBe(2);
    expect(lines.at(-1)).toBe(
      `write: receipt 0x9a166cac… is from chain 143; this folder is configured for chain 10143. Nothing was written.`,
    );
  });

  it("reports Mida refusals on the context call", async () => {
    const err = new MidaSdkError("revoked", "Mida: assay-writer's access was revoked by the owner — nothing was read.");
    const { result, calls, lines } = await write(dir, { pages: err });
    expect(result.exitCode).toBe(3);
    expect(lines.at(-1)).toBe(
      `mida: refused (revoked) — Mida: assay-writer's access was revoked by the owner — nothing was read. Nothing was written.`,
    );
    expect(calls.remember).toBeUndefined();
  });

  it("reports an unavailable service", async () => {
    const err = new MidaSdkError("service-unavailable", "the Mida service is not answering");
    const { result, lines } = await write(dir, { pages: err });
    expect(result.exitCode).toBe(3);
    expect(lines.at(-1)).toBe(
      `mida: unavailable (service-unavailable) — the Mida service is not answering. Nothing was written.`,
    );
  });

  it("stops on a partial page", async () => {
    const { result, calls, lines } = await write(dir, {
      pages: [{ items: [], cursor: null, otherTasks: [], partial: true }],
    });
    expect(result.exitCode).toBe(3);
    expect(lines.at(-1)).toBe(
      `mida: the record list came back incomplete (the store has not verified its newest rows yet). Nothing was written. Run again in a minute.`,
    );
    expect(calls.remember).toBeUndefined();
  });

  it("does not write twice: a matching record on page two exits 0", async () => {
    const dup = item(
      { assayReceipt: 1, receiptHash: HASH },
      { name: "assay-writer", id: "0x" + "12".repeat(32) },
      "AGENT_INFERRED",
      "0x" + "77".repeat(32),
    );
    const pages = [
      { items: [], cursor: "c1", otherTasks: [] },
      { items: [dup], cursor: null, otherTasks: [] },
    ];
    const { result, calls, lines } = await write(dir, { pages });
    expect(result).toEqual({ exitCode: 0, outcome: "already-recorded" });
    expect(calls.context).toHaveLength(2);
    expect(calls.remember).toBeUndefined();
    expect(lines.at(-1)).toBe(
      `already recorded: Mida record 0x77777777… holds receipt 0x9a166cac…. Nothing was written.`,
    );
  });

  it("appends the one-write-per-minute sentence on rate-limited", async () => {
    const calls = { rememberThrows: new MidaSdkError("rate-limited", "Mida: one save per minute on the direct lane") };
    const { result, lines } = await write(dir, { mida: mida(undefined, calls) });
    expect(result.exitCode).toBe(3);
    expect(lines.at(-1)).toBe(
      `mida: refused (rate-limited) — Mida: one save per minute on the direct lane. Nothing was written. One write per minute per agent: wait and run again.`,
    );
  });

  it("accepts a pending save", async () => {
    const calls = { rememberResult: { id: REC_ID, state: "pending" } };
    const { result, lines } = await write(dir, { mida: mida(undefined, calls) });
    expect(result.exitCode).toBe(0);
    expect(lines.at(-1)).toBe(
      `recorded: Mida record 0x547a8f2f… (pending) in projects.current — it anchors with the next batch.`,
    );
  });

  it("an HTTP error out of the fake host exits 4 — nothing saved", async () => {
    const { result, calls, lines } = await write(dir, { anchored: { error: 503 } });
    expect(result.exitCode).toBe(4);
    expect(lines.at(-1)).toBe(
      "assay: could not reach the host at 34-45-1-81.sslip.io (HTTP 503). Nothing was written.",
    );
    expect(calls.context).toBeUndefined();
    expect(calls.check).toBeUndefined();
    expect(calls.remember).toBeUndefined();
  });

  it("names only the host when it cannot be reached", async () => {
    const { result, lines } = await write(dir, { fetchImpl: async () => { throw new TypeError("fetch failed: sslip.io refused"); } });
    expect(result.exitCode).toBe(4);
    expect(lines.at(-1)).toBe(
      `assay: could not reach the host at 34-45-1-81.sslip.io (TypeError). Nothing was written.`,
    );
  });
});
