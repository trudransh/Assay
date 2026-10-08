import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MidaSdkError } from "@mida-context/sdk";
import { runExport } from "../src/exporter.js";

const HOST = "https://34-45-1-81.sslip.io";
const ANCHOR = "0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24";
const HASH = "0x9a166cacb2ffe4784ad556f69b690b7cebf71150f737a5a3c324f9e98e7907e5";
const HASH2 = "0x" + "bb".repeat(32);
const REC_ID = "0x547a8f2f" + "ab".repeat(28);
const SALT = "0x" + "aa".repeat(32);

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

const config = {
  chainId: 10143,
  receiptAnchor: ANCHOR,
  trustedHosts: ["erc8004:10143:1962"],
  writerAgent: "assay-writer",
  readerAgent: "assay-reader",
  rpcUrl: "https://testnet-rpc.monad.xyz",
  exportsDir: "", // set per test run — see exportRun
};

const content = (over = {}) => ({
  assayReceipt: 1,
  receiptHash: HASH,
  chainId: 10143,
  jws: JWS,
  jwks: { keys: [{ kid: "kid1" }] },
  anchor: { contract: ANCHOR, agentId: 1962, root: "0x" + "11".repeat(32), proof: [], tx: "0x" + "22".repeat(32) },
  salt: SALT,
  output: "OK",
  messages: [{ role: "user", content: "Say OK" }],
  source: `${HOST}/v1/receipts/${HASH}`,
  savedAt: "2026-10-09T10:12:31.204Z",
  ...over,
});

const writerItem = (c = content(), id = REC_ID) => ({
  id,
  namespace: "projects.current",
  kind: "EPISODE",
  content: c,
  author: { name: "assay-writer", id: "0x" + "12".repeat(32) },
  source: "AGENT_INFERRED",
  writtenAt: "2026-10-09T10:12:31.204Z",
  state: "anchored",
  superseded: false,
  references: [],
  proof: {},
});

let dir;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mida-export-"));
});
afterEach(async () => rm(dir, { recursive: true, force: true }));

const okVerdict = { ok: true, reasons: [], body: BODY };

const exportRun = async ({ pages, receiptHash, outFile, verdict = okVerdict } = {}) => {
  const lines = [];
  const checks = [];
  const assay = {
    checkRecord: async (record, pins) => {
      checks.push({ record, pins });
      if (verdict instanceof Error) throw verdict;
      return verdict;
    },
  };
  const client = { readContract: async () => [] };
  const mida = {
    context: async () =>
      pages instanceof Error ? Promise.reject(pages) : (pages.shift() ?? { items: [], cursor: null, otherTasks: [] }),
  };
  const result = await runExport({
    config: { ...config, exportsDir: join(dir, "exports") },
    assay,
    client,
    mida,
    log: (line) => lines.push(line),
    ...(receiptHash ? { receiptHash } : {}),
    ...(outFile !== undefined ? { outFile } : { outFile: join(dir, "record.json") }),
  });
  return { result, lines, checks, client };
};

describe("runExport", () => {
  // review 2 M1: export hands a file to ASSAY's check.mts, so it must not hand on a record the
  // reader would refuse — the same check, chain read on, runs before a byte is written.
  it("runs ASSAY's check with our pins before writing", async () => {
    const { result, checks, client } = await exportRun({
      pages: [{ items: [writerItem()], cursor: null, otherTasks: [] }],
    });
    expect(result.exitCode).toBe(0);
    expect(checks).toHaveLength(1);
    expect(checks[0].pins).toEqual({
      trustedHosts: config.trustedHosts,
      chains: { 10143: { anchor: ANCHOR, rpc: config.rpcUrl } },
      client,
    });
    expect(Object.hasOwn(checks[0].pins, "offline")).toBe(false);
  });

  it("a record ASSAY's check refuses is not exported", async () => {
    const out = join(dir, "record.json");
    const { result, lines } = await exportRun({
      pages: [{ items: [writerItem()], cursor: null, otherTasks: [] }],
      outFile: out,
      verdict: { ok: false, reasons: ["anchored: fail"], body: BODY },
    });
    expect(result).toEqual({ exitCode: 2, outcome: "refused" });
    expect(lines.at(-1)).toBe(
      "refused: ASSAY's check did not pass for receipt 0x9a166cac… — anchored: fail. Nothing was exported.",
    );
    expect(await readdir(dir)).toEqual([]);
  });

  it("a chain failure during the check exports nothing and exits 4", async () => {
    const boom = Object.assign(new Error("secret-url-and-body"), { name: "HttpRequestError" });
    const { result, lines } = await exportRun({
      pages: [{ items: [writerItem()], cursor: null, otherTasks: [] }],
      verdict: boom,
    });
    expect(result).toEqual({ exitCode: 4, outcome: "chain" });
    expect(lines.join("\n")).not.toMatch(/secret/);
    expect(await readdir(dir)).toEqual([]);
  });

  it("writes exactly ASSAY's fixture field set, mode 600, and prints the salt warning", async () => {
    const out = join(dir, "record.json");
    const { result, lines } = await exportRun({
      pages: [{ items: [writerItem()], cursor: null, otherTasks: [] }],
      outFile: out,
    });
    expect(result).toEqual({ exitCode: 0, outcome: "exported", file: out });
    expect(lines).toEqual([
      "mida: record 0x547a8f2f… written by assay-writer (AGENT_INFERRED, 2026-10-09T10:12:31Z) holds receipt 0x9a166cac…",
      `exported: ${out} — this file contains the salt; it must not be published unless the call was a test.`,
    ]);
    const st = await stat(out);
    expect(st.mode & 0o777).toBe(0o600);
    const written = JSON.parse(await readFile(out, "utf8"));
    expect(Object.keys(written)).toEqual([
      "receiptHash", "chainId", "jws", "jwks", "anchor", "salt", "output", "messages", "source",
    ]);
    expect(Object.keys(written.anchor)).toEqual(["contract", "agentId", "root", "proof", "tx"]);
    expect(written).toEqual({
      receiptHash: HASH,
      chainId: 10143,
      jws: JWS,
      jwks: { keys: [{ kid: "kid1" }] },
      anchor: { contract: ANCHOR, agentId: 1962, root: "0x" + "11".repeat(32), proof: [], tx: "0x" + "22".repeat(32) },
      salt: SALT,
      output: "OK",
      messages: [{ role: "user", content: "Say OK" }],
      source: `${HOST}/v1/receipts/${HASH}`,
    });
    expect(Object.hasOwn(written, "assayReceipt")).toBe(false);
    expect(Object.hasOwn(written, "savedAt")).toBe(false);
    expect(Object.hasOwn(written, "type")).toBe(false);
    expect(await readdir(dir)).toEqual(["record.json"]); // no temp file lingers
  });

  it("refuses to overwrite an existing file and leaves it untouched", async () => {
    const out = join(dir, "record.json");
    await exportRun({ pages: [{ items: [writerItem()], cursor: null, otherTasks: [] }], outFile: out });
    const before = await readFile(out, "utf8");
    const { result, lines } = await exportRun({
      pages: [{ items: [writerItem(content({ output: "CHANGED" }))], cursor: null, otherTasks: [] }],
      outFile: out,
    });
    expect(result).toEqual({ exitCode: 2, outcome: "refused" });
    expect(lines.at(-1)).toBe(
      `export: ${out} already exists — the file is never overwritten. Nothing was exported.`,
    );
    expect(await readFile(out, "utf8")).toBe(before);
    expect(await readdir(dir)).toEqual(["record.json"]);
  });

  it("refuses a path whose directory does not exist", async () => {
    const { result, lines } = await exportRun({
      pages: [{ items: [writerItem()], cursor: null, otherTasks: [] }],
      outFile: join(dir, "no-such-dir", "record.json"),
    });
    expect(result).toEqual({ exitCode: 2, outcome: "refused" });
    expect(lines.at(-1)).toContain("could not write");
    expect(lines.at(-1)).toContain("Nothing was exported.");
  });

  it("no matching record exits 2", async () => {
    const { result, lines } = await exportRun({ pages: [{ items: [], cursor: null, otherTasks: [] }] });
    expect(result).toEqual({ exitCode: 2, outcome: "refused" });
    expect(lines.at(-1)).toBe(
      "export: no record written by assay-writer with assayReceipt 1 in projects.current. Nothing was exported.",
    );
  });

  it("a revoked reader stops on the context call", async () => {
    const err = new MidaSdkError("revoked", "Mida: assay-reader's access was revoked by the owner — nothing was read.");
    const { result, lines } = await exportRun({ pages: err });
    expect(result).toEqual({ exitCode: 3, outcome: "mida" });
    expect(lines.at(-1)).toBe(
      "mida: refused (revoked) — Mida: assay-reader's access was revoked by the owner — nothing was read. Nothing was exported.",
    );
  });

  it("a partial page stops the run", async () => {
    const { result, lines } = await exportRun({
      pages: [{ items: [writerItem()], cursor: null, otherTasks: [], partial: true }],
    });
    expect(result).toEqual({ exitCode: 3, outcome: "partial" });
    expect(lines.at(-1)).toBe(
      "mida: the record list came back incomplete (the store has not verified its newest rows yet). Nothing was exported. Run again in a minute.",
    );
  });

  it("export <hash> selects the matching record, not the newest unrelated one", async () => {
    const newest = writerItem(content({ receiptHash: HASH2 }), "0x" + "55".repeat(32));
    const wanted = writerItem(content(), REC_ID);
    const out = join(dir, "by-hash.json");
    const { result } = await exportRun({
      pages: [{ items: [newest, wanted], cursor: null, otherTasks: [] }],
      receiptHash: HASH,
      outFile: out,
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(await readFile(out, "utf8")).receiptHash).toBe(HASH);
  });

  it("a malformed record exits 2 with the record line", async () => {
    const bad = writerItem(content({ salt: "0x1234" }));
    const { result, lines } = await exportRun({ pages: [{ items: [bad], cursor: null, otherTasks: [] }] });
    expect(result.exitCode).toBe(2);
    expect(lines.at(-1)).toContain("is not a usable receipt record (salt:");
  });

  it("no --out writes exports/<receiptHash>.json under the configured folder, creating it", async () => {
    const { result, lines } = await exportRun({
      pages: [{ items: [writerItem()], cursor: null, otherTasks: [] }],
      outFile: null,
    });
    const out = join(dir, "exports", `${HASH}.json`);
    expect(result).toEqual({ exitCode: 0, outcome: "exported", file: out });
    expect(lines.at(-1)).toBe(
      `exported: ${out} — this file contains the salt; it must not be published unless the call was a test.`,
    );
    expect(JSON.parse(await readFile(out, "utf8")).receiptHash).toBe(HASH);
  });

  it("a bare --out name lands in the exports folder", async () => {
    const { result } = await exportRun({
      pages: [{ items: [writerItem()], cursor: null, otherTasks: [] }],
      outFile: "record.json",
    });
    expect(result.exitCode).toBe(0);
    expect(result.file).toBe(join(dir, "exports", "record.json"));
    expect(JSON.parse(await readFile(result.file, "utf8")).receiptHash).toBe(HASH);
  });
});
