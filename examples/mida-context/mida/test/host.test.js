import { describe, expect, it } from "vitest";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HostError,
  RunFileError,
  askHost,
  fetchJwks,
  fetchReceipt,
  readRunFile,
  writeRunFile,
} from "../src/host.js";

const HOST = "https://34-45-1-81.sslip.io";
const HASH = "0x9a166cacb2ffe4784ad556f69b690b7cebf71150f737a5a3c324f9e98e7907e5";
const SALT = "0x" + "11".repeat(32);
const BODY = {
  v: "assay-receipt/0",
  model: "gemma-4-31b-it",
  host: { agentId: "erc8004:10143:1962", keyId: "kid1", alg: "ES256" },
  req: { commit: "0x" + "22".repeat(32), params: { max_tokens: 64, temperature: 0 } },
  res: { commit: "0x" + "33".repeat(32), tokensIn: 3, tokensOut: 1, finish: "stop" },
  t: 1790954324495,
  nonce: "0x" + "44".repeat(16),
};

const res = (status, json) => ({ ok: status < 400, status, json: async () => json });

const jwsFor = (b) => `h.${Buffer.from(JSON.stringify(b)).toString("base64url")}.s`;
const JWS = jwsFor(BODY);

async function problem(promise) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("did not reject");
}

describe("askHost", () => {
  it("posts the prompt through assay.wrap and returns the run fields — body read from the JWS, not the receipt's body", async () => {
    const seen = { wrapCalls: 0 };
    const wrongBody = { ...BODY, host: { ...BODY.host, agentId: "erc8004:9999:1" }, model: "wrong" };
    const assay = {
      wrap: () => {
        seen.wrapCalls += 1;
        return async (url, init) => {
          seen.url = url;
          seen.init = init;
          return {
            json: { choices: [{ message: { content: "OK" } }] },
            receipt: { body: wrongBody, jws: JWS, hash: HASH },
            salt: SALT,
            outputCommitOk: true,
          };
        };
      },
      assistantOutput: (m) => m.content,
    };
    const fetchImpl = async () => {
      throw new Error("the fake never reaches fetch: wrap returns first");
    };
    const run = await askHost({ assay, fetchImpl, host: HOST, prompt: "Say OK", now: () => 1790954324495 });
    expect(seen.wrapCalls).toBe(1);
    expect(seen.url).toBe(`${HOST}/v1/chat/completions`);
    expect(seen.init.method).toBe("POST");
    expect(seen.init.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(seen.init.body)).toEqual({
      messages: [{ role: "user", content: "Say OK" }],
      max_tokens: 64,
      temperature: 0,
    });
    expect(run).toEqual({
      receiptHash: HASH,
      chainId: 10143,
      jws: JWS,
      salt: SALT,
      output: "OK",
      messages: [{ role: "user", content: "Say OK" }],
      params: { max_tokens: 64, temperature: 0 },
      askedAt: "2026-10-02T15:18:44.495Z",
    });
    expect(Object.hasOwn(run, "body")).toBe(false);
  });

  it("refuses when the receipt's JWS payload is not decodable", async () => {
    const assay = {
      wrap: () => async () => ({
        json: { choices: [{ message: { content: "OK" } }] },
        receipt: { jws: "a.b.c", hash: HASH },
        salt: SALT,
        outputCommitOk: true,
      }),
      assistantOutput: (m) => m.content,
    };
    const e = await problem(askHost({ assay, fetchImpl: async () => ({}), host: HOST, prompt: "x" }));
    expect(e.exitCode).toBe(2);
    expect(e.message).toContain("JWS");
    expect(e.message).toContain("Nothing was saved.");
  });

  it("refuses when the host's res.commit does not open with the salt", async () => {
    const assay = {
      wrap: () => async () => ({
        json: { choices: [{ message: { content: "OK" } }] },
        receipt: { body: BODY, jws: "a.b.c", hash: HASH },
        salt: SALT,
        outputCommitOk: false,
      }),
      assistantOutput: (m) => m.content,
    };
    const e = await problem(askHost({ assay, fetchImpl: async () => ({}), host: HOST, prompt: "x" }));
    expect(e).toBeInstanceOf(HostError);
    expect(e.exitCode).toBe(2);
    expect(e.message).toBe(
      "assay: the host's res.commit does not match the output it returned. Nothing was saved.",
    );
  });

  it("refuses when the answer carried no receipt, without quoting the thrown text", async () => {
    const assay = {
      wrap: () => async () => {
        throw new Error("no X-Assay-Receipt header in the response (HTTP 200); is this an Assay host?");
      },
      assistantOutput: (m) => m.content,
    };
    const e = await problem(askHost({ assay, fetchImpl: async () => ({}), host: HOST, prompt: "x" }));
    expect(e).toBeInstanceOf(HostError);
    expect(e.exitCode).toBe(4);
    expect(e.message).toBe(
      "assay: the answer carried no receipt (is 34-45-1-81.sslip.io an ASSAY host?). Nothing was saved.",
    );
    expect(e.message).not.toContain("HTTP 200");
  });

  it("names only the error class when the host is unreachable", async () => {
    const assay = {
      wrap: (f) => async (url, init) => f(url, init),
      assistantOutput: (m) => m.content,
    };
    const fetchImpl = async () => {
      throw new TypeError("fetch failed: a body or path could leak here");
    };
    const e = await problem(askHost({ assay, fetchImpl, host: HOST, prompt: "x" }));
    expect(e).toBeInstanceOf(HostError);
    expect(e.exitCode).toBe(4);
    expect(e.message).toBe(
      "assay: could not reach the host at 34-45-1-81.sslip.io (TypeError). Nothing was saved.",
    );
  });

  it("prints the HTTP line and the host's error.message (120 chars) on a refusal", async () => {
    const long = "y".repeat(200);
    const assay = {
      wrap: (f) => async (url, init) => {
        const r = await f(url, init);
        const h = r.headers.get("X-Assay-Receipt");
        if (!h) throw new Error(`no X-Assay-Receipt header in the response (HTTP ${r.status})`);
        return {};
      },
      assistantOutput: (m) => m.content,
    };
    const fetchImpl = async () => res(429, { error: { message: long } });
    const e = await problem(askHost({ assay, fetchImpl, host: HOST, prompt: "x" }));
    expect(e).toBeInstanceOf(HostError);
    expect(e.exitCode).toBe(4);
    expect(e.message).toBe(
      `assay: the host answered HTTP 429 and signed no receipt. Nothing was saved.\n${"y".repeat(120)}`,
    );
  });
});

describe("fetchReceipt", () => {
  it("returns pending as-is", async () => {
    const fetchImpl = async (url) => {
      expect(url).toBe(`${HOST}/v1/receipts/${HASH}`);
      return res(200, { status: "pending" });
    };
    expect(await fetchReceipt({ fetchImpl, host: HOST, receiptHash: HASH })).toEqual({ status: "pending" });
  });

  it("returns the anchored shape without a body field — the body is decoded from the JWS", async () => {
    const anchored = {
      status: "anchored",
      body: BODY,
      jws: JWS,
      root: "0x" + "ab".repeat(32),
      proof: ["0x" + "cd".repeat(32)],
      anchorTx: "0x" + "ef".repeat(32),
      reproduce: { cast: "cast call …" },
    };
    const fetchImpl = async () => res(200, anchored);
    const got = await fetchReceipt({ fetchImpl, host: HOST, receiptHash: HASH });
    expect(got).toEqual({
      status: "anchored",
      jws: JWS,
      root: "0x" + "ab".repeat(32),
      proof: ["0x" + "cd".repeat(32)],
      anchorTx: "0x" + "ef".repeat(32),
    });
    expect(Object.hasOwn(got, "body")).toBe(false);
  });

  for (const [name, body, detail] of [
    ["signed", { status: "signed" }, `status "signed", not "anchored"`],
    ["failed", { status: "failed" }, `status "failed", not "anchored"`],
    [
      "a missing status",
      { jws: JWS, root: "0x" + "ab".repeat(32), proof: [], anchorTx: "0x" + "ef".repeat(32) },
      `status null, not "anchored"`,
    ],
  ]) {
    it(`refuses ${name} with exit 2 — only "anchored" counts`, async () => {
      const fetchImpl = async () => res(200, body);
      const e = await problem(fetchReceipt({ fetchImpl, host: HOST, receiptHash: HASH }));
      expect(e).toBeInstanceOf(HostError);
      expect(e.exitCode).toBe(2);
      expect(e.message).toBe(
        `assay: the host's answer for receipt 0x9a166cac… is not usable (${detail}). Nothing was written.`,
      );
    });
  }

  for (const [name, over, detail] of [
    ["a non-hex root", { root: "not-hex" }, "no usable root"],
    ["a proof that is not an array", { proof: "0xabc" }, "no usable proof"],
    ["a missing anchorTx", { anchorTx: undefined }, "no usable anchorTx"],
    ["a missing jws", { jws: undefined }, "no usable jws"],
  ]) {
    it(`refuses "anchored" with ${name} with exit 2`, async () => {
      const body = { status: "anchored", jws: JWS, root: "0x" + "ab".repeat(32), proof: [], anchorTx: "0x" + "ef".repeat(32), ...over };
      const fetchImpl = async () => res(200, body);
      const e = await problem(fetchReceipt({ fetchImpl, host: HOST, receiptHash: HASH }));
      expect(e).toBeInstanceOf(HostError);
      expect(e.exitCode).toBe(2);
      expect(e.message).toBe(
        `assay: the host's answer for receipt 0x9a166cac… is not usable (${detail}). Nothing was written.`,
      );
    });
  }

  it("refuses a 404 with exit 2", async () => {
    const fetchImpl = async () => res(404, { error: { message: "unknown receipt" } });
    const e = await problem(fetchReceipt({ fetchImpl, host: HOST, receiptHash: HASH }));
    expect(e).toBeInstanceOf(HostError);
    expect(e.exitCode).toBe(2);
    expect(e.message).toBe(`assay: the host does not know receipt 0x9a166cac…. Nothing was written.`);
  });

  it("names only the error class on a network throw", async () => {
    const fetchImpl = async () => {
      throw new TypeError("connect ECONNREFUSED a path could leak");
    };
    const e = await problem(fetchReceipt({ fetchImpl, host: HOST, receiptHash: HASH }));
    expect(e).toBeInstanceOf(HostError);
    expect(e.exitCode).toBe(4);
    expect(e.message).toBe(
      "assay: could not reach the host at 34-45-1-81.sslip.io (TypeError). Nothing was written.",
    );
  });
});

describe("fetchJwks", () => {
  it("returns the keys", async () => {
    const fetchImpl = async (url) => {
      expect(url).toBe(`${HOST}/.well-known/jwks.json`);
      return res(200, { keys: [{ kty: "EC", kid: "k1" }] });
    };
    expect(await fetchJwks({ fetchImpl, host: HOST })).toEqual({ keys: [{ kty: "EC", kid: "k1" }] });
  });
});

describe("run files", () => {
  const run = {
    host: HOST,
    receiptHash: HASH,
    chainId: 10143,
    jws: JWS,
    salt: SALT,
    output: "OK",
    messages: [{ role: "user", content: "Say OK" }],
    params: { max_tokens: 64, temperature: 0 },
    askedAt: "2026-10-02T15:18:44.495Z",
  };

  it("round-trips with mode 0600", async () => {
    const dir = await mkdtemp(join(tmpdir(), "assay-runs-"));
    const path = await writeRunFile(dir, run);
    const st = await stat(path);
    expect(st.mode & 0o777).toBe(0o600);
    expect(await readRunFile(path)).toEqual({ assayRun: 1, ...run });
  });

  it("refuses a file that is not an assayRun 1 run file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "assay-runs-"));
    const path = join(dir, `${HASH}.json`);
    await writeFile(path, JSON.stringify({ assayRun: 2, receiptHash: HASH }));
    const e = await problem(readRunFile(path));
    expect(e).toBeInstanceOf(RunFileError);
    expect(e.exitCode).toBe(2);
  });
});
