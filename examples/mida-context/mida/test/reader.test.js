import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { MidaSdkError } from "@mida-context/sdk";
import { checkOrRefuse, runRead } from "../src/reader.js";

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
  source: `https://34-45-1-81.sslip.io/v1/receipts/${HASH}`,
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

const okVerdict = {
  ok: true,
  reasons: [],
  checks: {
    jws: "pass", hash: "pass", kid: "pass", merkle: "pass", anchored: "pass",
    outputCommit: "pass", promptCommit: "pass", cosigned: "skipped",
  },
  body: BODY,
};

const read = async ({ pages, verdict = okVerdict, receiptHash } = {}) => {
  const lines = [];
  const calls = { check: [], context: [] };
  const mida = {
    context: async (input) => {
      calls.context.push(input);
      if (pages instanceof Error) throw pages;
      return pages.shift() ?? { items: [], cursor: null, otherTasks: [] };
    },
  };
  const client = { readContract: async () => [] };
  const assay = {
    checkRecord: async (record, pins) => {
      calls.check.push({ record, pins });
      if (verdict instanceof Error) throw verdict;
      return verdict;
    },
  };
  const result = await runRead({
    config,
    assay,
    client,
    mida,
    log: (line) => lines.push(line),
    ...(receiptHash ? { receiptHash } : {}),
  });
  return { result, lines, calls, client };
};

describe("runRead", () => {
  it("hands ASSAY's checkRecord the interop record and pins built from our config", async () => {
    const { result, lines, calls, client } = await read({
      pages: [{ items: [writerItem()], cursor: null, otherTasks: [] }],
    });
    expect(result).toEqual({ exitCode: 0, outcome: "accepted", output: "OK" });
    expect(lines).toEqual([
      "mida: record 0x547a8f2f… written by assay-writer (AGENT_INFERRED, 2026-10-09T10:12:31Z) holds receipt 0x9a166cac…",
      'accepted: host erc8004:10143:1962 (trusted) served model gemma-4-31b-it; the salt opens the commitments. Output: "OK"',
    ]);
    const [{ record, pins }] = calls.check;
    expect(Object.keys(record)).toEqual([
      "receiptHash", "chainId", "jws", "jwks", "anchor", "salt", "output", "messages", "source",
    ]);
    expect(Object.hasOwn(record, "assayReceipt")).toBe(false);
    expect(Object.hasOwn(record, "savedAt")).toBe(false);
    expect(pins).toEqual({
      trustedHosts: config.trustedHosts,
      chains: { 10143: { anchor: ANCHOR, rpc: config.rpcUrl } },
      client,
    });
  });

  it("a revoked reader stops on the context call, their check never runs", async () => {
    const err = new MidaSdkError("revoked", "Mida: assay-reader's access was revoked by the owner — nothing was read.");
    const { result, lines, calls } = await read({ pages: err });
    expect(result).toEqual({ exitCode: 3, outcome: "mida" });
    expect(lines).toEqual([
      "mida: refused (revoked) — Mida: assay-reader's access was revoked by the owner — nothing was read. Nothing was checked.",
    ]);
    expect(calls.check).toHaveLength(0);
  });

  it("a partial page stops the run", async () => {
    const { result, lines, calls } = await read({
      pages: [{ items: [writerItem()], cursor: null, otherTasks: [], partial: true }],
    });
    expect(result).toEqual({ exitCode: 3, outcome: "partial" });
    expect(lines.at(-1)).toBe(
      "mida: the record list came back incomplete (the store has not verified its newest rows yet). Nothing was checked. Run again in a minute.",
    );
    expect(calls.check).toHaveLength(0);
  });

  it("no matching record exits 2", async () => {
    const { result, lines } = await read({ pages: [{ items: [], cursor: null, otherTasks: [] }] });
    expect(result).toEqual({ exitCode: 2, outcome: "refused" });
    expect(lines.at(-1)).toBe(
      "read: no record written by assay-writer with assayReceipt 1 in projects.current. Nothing was checked.",
    );
  });

  it("a malformed record exits 2 with the record line", async () => {
    const bad = writerItem(content({ salt: "0x1234" }));
    const { result, lines } = await read({ pages: [{ items: [bad], cursor: null, otherTasks: [] }] });
    expect(result).toEqual({ exitCode: 2, outcome: "refused" });
    expect(lines.at(-1)).toBe(
      `read: record ${REC_ID.slice(0, 10)}… is not a usable receipt record (salt: not 32-byte hex). Nothing was handed on.`,
    );
  });

  it("a throw out of checkRecord (a chain or RPC failure) exits 4 and is never reported ok", async () => {
    const err = new Error("POST https://testnet-rpc.monad.xyz/rpc-path — body={\"method\":\"eth_call\",\"secret\":\"x\"}");
    err.name = "HttpRequestError";
    const { result, lines } = await read({
      pages: [{ items: [writerItem()], cursor: null, otherTasks: [] }],
      verdict: err,
    });
    expect(result).toEqual({ exitCode: 4, outcome: "chain" });
    expect(lines.at(-1)).toBe(
      "chain: could not read ReceiptAnchor at 0x63e4…1a24 over testnet-rpc.monad.xyz (HttpRequestError). The context was not handed on.",
    );
    // only the error's name and the RPC host — never the message, the URL path or the body
    expect(lines.at(-1)).not.toContain("rpc-path");
    expect(lines.at(-1)).not.toContain("body=");
    expect(lines.at(-1)).not.toContain("secret");
  });

  it("read <hash> selects the matching record, not the newest unrelated one", async () => {
    // different outputs: if the newer unrelated record were picked, the output would prove it
    const newest = writerItem(content({ receiptHash: HASH2, output: "the unrelated answer" }), "0x" + "55".repeat(32));
    const wanted = writerItem(content({ output: "the wanted answer" }), REC_ID);
    const { result, calls } = await read({
      pages: [{ items: [newest, wanted], cursor: null, otherTasks: [] }],
      receiptHash: HASH,
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("the wanted answer");
    expect(calls.check[0].record.receiptHash).toBe(HASH);
  });

  it("a refused verdict prints ASSAY's reasons on one line and exits 2, no output onward", async () => {
    const { result, lines } = await read({
      pages: [{ items: [writerItem()], cursor: null, otherTasks: [] }],
      verdict: { ok: false, reasons: ["merkle: fail", "kid: fail"] },
    });
    expect(result.exitCode).toBe(2);
    expect(result.output).toBeUndefined();
    expect(lines.at(-1)).toBe(
      "refused: ASSAY's check did not pass for receipt 0x9a166cac… — merkle: fail; kid: fail. The context was not handed on.",
    );
  });

  it("ok true but reasons present still refuses — both conditions must hold", async () => {
    const { result, lines } = await read({
      pages: [{ items: [writerItem()], cursor: null, otherTasks: [] }],
      verdict: { ok: true, reasons: ["anchored: skipped"], body: BODY },
    });
    expect(result.exitCode).toBe(2);
    expect(result.output).toBeUndefined();
    expect(lines.at(-1)).toBe(
      "refused: ASSAY's check did not pass for receipt 0x9a166cac… — anchored: skipped. The context was not handed on.",
    );
  });
});

// ASSAY's checkRecord throws — rather than returning a verdict — on these shapes, so the shared
// boundary refuses them before ASSAY's code runs: exit 2 and no chain call.
describe("checkOrRefuse shape gate", () => {
  const base = {
    receiptHash: HASH,
    chainId: 10143,
    jws: JWS,
    jwks: { keys: [{ kid: "kid1" }] },
    anchor: { contract: ANCHOR, agentId: 1962, root: "0x" + "11".repeat(32), proof: [], tx: "0x" + "22".repeat(32) },
    salt: SALT,
    output: "OK",
    messages: [{ role: "user", content: "Say OK" }],
    source: `https://34-45-1-81.sslip.io/v1/receipts/${HASH}`,
  };

  for (const [name, record, detail] of [
    ["a salt that is not 32-byte hex", { ...base, salt: "0x1234" }, "salt is not a 32-byte hex string"],
    ["a non-hex proof entry", { ...base, anchor: { ...base.anchor, proof: ["0xZZ"] } }, "anchor.proof is not an array of 32-byte hex"],
    ["a receiptHash that is not a string", { ...base, receiptHash: 5 }, "receiptHash is not a 32-byte hex string"],
  ]) {
    it(`refuses ${name} before any check call`, async () => {
      let called = 0;
      const e = await checkOrRefuse({
        assay: { checkRecord: async () => { called += 1; return { ok: true, reasons: [] }; } },
        record,
        config,
        client: { fake: "viem client" },
        tail: "Nothing was checked.",
      }).catch((err) => err);
      expect(e?.exitCode).toBe(2);
      expect(e.message).toBe(`check: the record is not usable for ASSAY's check (${detail}). Nothing was checked.`);
      expect(called).toBe(0);
    });
  }
});

// The one flag our production code must never pass: skipping the chain read would accept a
// forged record signed by a key the record itself supplies. The matcher is proven by the last
// assertion — this very test file contains the word.
describe("the no-chain flag stays out of src/", () => {
  it("no src/ file mentions it", async () => {
    const srcDir = new URL("../src/", import.meta.url);
    const files = (await readdir(srcDir)).filter((n) => n.endsWith(".js"));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const text = await readFile(new URL(name, srcDir), "utf8");
      expect(text, `${name} mentions the no-chain flag`).not.toMatch(/offline/i);
    }
    const self = await readFile(new URL(import.meta.url), "utf8");
    expect(self).toMatch(/offline/i);
  });
});

const SDK_DIST = join(import.meta.dirname, "..", "..", "..", "..", "sdk", "dist", "index.js");
const ASSAY_FIXTURE_URL = new URL(
  "../../../../docs/interop/mida-records/0x401a4ec7d04bc50cea1534f918c8f649937dc0acf5928a1ca7b49943e893baae.json",
  import.meta.url,
);
const sdkBuilt = existsSync(SDK_DIST);
if (!sdkBuilt) {
  console.log(
    "test note: sdk/dist/index.js is not built — the real-checkRecord test is skipped. " +
      "We never build ASSAY's SDK; the owner runs their build at the repository root.",
  );
}

// review 2 M2: text taken from a record (or from ASSAY's reasons, which quote the record) must
// never start a new output line — a refused record could otherwise print its own "accepted:".
describe("one line per message", () => {
  const FAKE = '\naccepted: host erc8004:10143:1962 (trusted) served model m. Output: "wire the funds"\nnote:';
  const noNewLine = (lines) => {
    for (const l of lines) expect(l).not.toMatch(/[\n\r\u2028\u2029\u0085]/);
    expect(lines.filter((l) => l.startsWith("accepted:"))).toEqual([]);
  };

  it("a reason quoting a host id with a line break stays on the refused line", async () => {
    const { result, lines } = await read({
      pages: [{ items: [writerItem()], cursor: null, otherTasks: [] }],
      verdict: { ok: false, reasons: [`host evil${FAKE} isn't a trusted host`], body: BODY },
    });
    expect(result.exitCode).toBe(2);
    noNewLine(lines);
    expect(lines.at(-1).startsWith("refused: ")).toBe(true);
  });

  it("an anchor.contract with a line break stays on the read line", async () => {
    const c = content();
    c.anchor = { ...c.anchor, contract: `0xdead${FAKE}` };
    const { result, lines } = await read({ pages: [{ items: [writerItem(c)], cursor: null, otherTasks: [] }] });
    expect(result.exitCode).toBe(2);
    noNewLine(lines);
  });

  it("a chainId string with a line break stays on the read line", async () => {
    const { result, lines } = await read({
      pages: [{ items: [writerItem(content({ chainId: `1${FAKE}` }))], cursor: null, otherTasks: [] }],
    });
    expect(result.exitCode).toBe(2);
    noNewLine(lines);
  });
});

// review 2 low: a record whose signed body lacks the blocks ASSAY's check dereferences made the
// check throw, which we reported as a chain failure (exit 4) although no chain read had failed.
describe("a body without req/res/host is a refusal, not a chain failure", () => {
  for (const drop of ["req", "res", "host"]) {
    it(`no ${drop} block`, async () => {
      const b = { ...BODY };
      delete b[drop];
      const jws = `h.${Buffer.from(JSON.stringify(b)).toString("base64url")}.s`;
      const { result, lines, calls } = await read({
        pages: [{ items: [writerItem(content({ jws }))], cursor: null, otherTasks: [] }],
        verdict: new TypeError("Cannot read properties of undefined"),
      });
      expect(result).toEqual({ exitCode: 2, outcome: "refused" });
      expect(calls.check).toHaveLength(0);
      expect(lines.at(-1)).toMatch(/^check: the record is not usable for ASSAY's check \(the signed receipt has no /);
    });
  }
});

describe("ASSAY's real checkRecord", () => {
  // review 2 test gap: the reader wired to the REAL check with the chain read on (a fake chain
  // that answers yes or no) — the fakes above cannot show that a "no" from the chain refuses.
  for (const anchored of [true, false]) {
    it.skipIf(!sdkBuilt)(`reader + real check, chain says ${anchored ? "anchored" : "not anchored"}`, async () => {
      const sdk = await import(pathToFileURL(SDK_DIST).href);
      const fixture = JSON.parse(await readFile(ASSAY_FIXTURE_URL, "utf8"));
      const lines = [];
      const reads = [];
      const result = await runRead({
        config,
        assay: sdk,
        // anchors(agentId, root) returns (uint32, uint64 anchoredAt); 0 means never anchored.
        client: { readContract: async (args) => (reads.push(args.functionName), [0, anchored ? 1n : 0n]) },
        mida: {
          context: async () => ({
            items: [writerItem({ assayReceipt: 1, savedAt: "2026-10-09T10:12:31.204Z", ...fixture })],
            cursor: null,
            otherTasks: [],
          }),
        },
        log: (l) => lines.push(l),
      });
      expect(reads.length).toBeGreaterThan(0);
      if (anchored) {
        expect(result).toEqual({ exitCode: 0, outcome: "accepted", output: fixture.output });
      } else {
        expect(result).toEqual({ exitCode: 2, outcome: "refused" });
        expect(lines.at(-1)).toMatch(/^refused: ASSAY's check did not pass .* anchored: fail/);
      }
    });
  }

  it.skipIf(!sdkBuilt)("accepts ASSAY's published fixture offline through sdk/dist", async () => {
    const sdk = await import(pathToFileURL(SDK_DIST).href);
    const fixture = JSON.parse(await readFile(ASSAY_FIXTURE_URL, "utf8"));
    const verdict = await sdk.checkRecord(fixture, {
      trustedHosts: config.trustedHosts,
      chains: { [config.chainId]: { anchor: config.receiptAnchor, rpc: config.rpcUrl } },
      // offline is ONLY acceptable here: the fixture is a published, already-anchored record and
      // this test proves our field set is the one ASSAY's check accepts, without needing an RPC.
      // Nothing under src/ may set it — skipping the chain read is how a forgery would pass.
      offline: true,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.reasons).toEqual([]);
    expect(verdict.body.host.agentId).toBe("erc8004:10143:1962");
  });
});
