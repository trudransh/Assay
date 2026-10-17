import type { ContractReader } from "@assay/receipts";
import { keccak256, stringToBytes, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { hostKeyOf } from "@assay/receipts";
import { createApp } from "../src/server.js";
import { Store } from "../src/store.js";
import { newSigner, tempDir } from "./helpers.js";

const REGISTRY = "0x0C8603041E7d425c4DCa041680C7AF4581dDa9a1";
const VERIFIER = "0x1111111111111111111111111111111111111111";
const NOW = 1_790_900_000; // seconds
const model = "z-ai/glm-5.3";
const hostSpec = "erc8004:10143:1962";
const refSpec = "openrouter:z-ai/fp8";

type G = { passed: number; total: number; ciLowBps: number; ciHighBps: number; t: number };
const tuple = (host: Hex, g: G) => [
  { model: keccak256(stringToBytes(model)), hostKey: host, checks: `0x${"aa".repeat(32)}`, passed: g.passed, total: g.total, ciLowBps: g.ciLowBps, ciHighBps: g.ciHighBps, refModel: `0x${"bb".repeat(32)}`, evidence: `0x${"cc".repeat(32)}`, t: BigInt(g.t) },
  VERIFIER,
];
const empty = [{ model: `0x${"00".repeat(32)}`, hostKey: `0x${"00".repeat(32)}`, checks: `0x${"00".repeat(32)}`, passed: 0, total: 0, ciLowBps: 0, ciHighBps: 0, refModel: `0x${"00".repeat(32)}`, evidence: `0x${"00".repeat(32)}`, t: 0n }, "0x0000000000000000000000000000000000000000"];

function reader(grades: Record<string, G>): ContractReader & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    async readContract({ functionName, args }) {
      calls.push([functionName, ...args]);
      const g = grades[args[1] as string];
      return g ? tuple(args[1] as Hex, g) : empty;
    },
  };
}

async function app(grades: Record<string, G>) {
  const r = reader(grades);
  const a = createApp({
    signer: await newSigner(),
    store: new Store(tempDir()),
    upstream: async () => ({ status: 500, json: {} }),
    model: "m",
    agentId: 1962n,
    anchor: "0x049A73755cA3508ef3Daa4752A3406f6e00CfB13",
    publicUrl: "http://localhost",
    relayCosign: async () => "0x",
    grades: { reader: r, registry: REGISTRY, now: () => NOW * 1000 },
  });
  return { a, r };
}

const q = (o: Record<string, string>) => `/v1/grade?${new URLSearchParams(o)}`;
const hostKey = keccak256(stringToBytes(hostSpec));
const refKey = keccak256(stringToBytes(refSpec));
const fresh = NOW - 3600;

describe("GET /v1/grade", () => {
  it("maps every host-key convention to keccak256 of the spec (D21)", () => {
    expect(hostKeyOf(hostSpec)).toBe("0xbc6bc5b79f83de1bb4e63bacbdb8d82c8a38e1c9caa38043f8b6ba33ffb33e6c");
    expect(hostKeyOf(refSpec)).toBe("0xe62ef805f5e37ece31d01a1567ffc50f659d5abebce5dc9462568ff81241cc81");
    expect(hostKeyOf("direct:generativelanguage.googleapis.com")).toBe("0xd0fe1e8708e22bc3fe3b101f9ab21a41052eb11b27d4d994f91cccca881927c7");
    expect(hostKeyOf(`0x${"AB".repeat(32)}`)).toBe(`0x${"ab".repeat(32)}`);
    expect(hostKeyOf("1962")).toBeNull();
  });

  it("returns pass with the grade and the exact gradeOf call to reproduce it", async () => {
    const { a, r } = await app({ [hostKey]: { passed: 38, total: 40, ciLowBps: 8350, ciHighBps: 9860, t: fresh } });
    const res = await a.request(q({ model, host: hostSpec, verifiers: VERIFIER }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toMatchObject({ status: "pass", hostKey, verifier: VERIFIER, grade: { passed: 38, total: 40, ciLowBps: 8350, ciHighBps: 9860, t: fresh } });
    expect(j.reproduce).toEqual({ kind: "contract-call", address: REGISTRY, function: "gradeOf(bytes32,bytes32,address[])", args: [keccak256(stringToBytes(model)), hostKey, [VERIFIER]] });
    expect(r.calls).toEqual([["gradeOf", keccak256(stringToBytes(model)), hostKey, [VERIFIER]]]);
  });

  it("fails a host whose interval sits below the reference's", async () => {
    const { a } = await app({
      [hostKey]: { passed: 20, total: 40, ciLowBps: 3500, ciHighBps: 6500, t: fresh },
      [refKey]: { passed: 39, total: 40, ciLowBps: 8700, ciHighBps: 9950, t: fresh },
    });
    const j = await (await a.request(q({ model, host: hostSpec, reference: refSpec, verifiers: VERIFIER }))).json();
    expect(j.status).toBe("fail");
    expect(j.reference).toMatchObject({ hostKey: refKey, ciLowBps: 8700 });
  });

  it("warns under 30 samples and reports unknown when stale or missing", async () => {
    const small = await app({ [hostKey]: { passed: 9, total: 10, ciLowBps: 6000, ciHighBps: 9800, t: fresh } });
    expect((await (await small.a.request(q({ model, host: hostSpec, verifiers: VERIFIER }))).json()).status).toBe("warn");
    const stale = await app({ [hostKey]: { passed: 38, total: 40, ciLowBps: 8350, ciHighBps: 9860, t: NOW - 8 * 86400 } });
    expect((await (await stale.a.request(q({ model, host: hostSpec, verifiers: VERIFIER }))).json()).status).toBe("unknown");
    const none = await app({});
    const j = await (await none.a.request(q({ model, host: hostSpec, verifiers: VERIFIER }))).json();
    expect(j).toMatchObject({ status: "unknown", grade: null, verifier: null });
  });

  it.each([
    [{ host: hostSpec, verifiers: VERIFIER }, /model/],
    [{ model, host: "1962", verifiers: VERIFIER }, /host must be/],
    [{ model, host: hostSpec }, /verifiers/],
    [{ model, host: hostSpec, verifiers: "not-an-address" }, /verifiers/],
    [{ model, host: hostSpec, verifiers: VERIFIER, reference: "x" }, /reference/],
  ])("rejects %o with 400", async (params, msg) => {
    const { a } = await app({});
    const res = await a.request(q(params as Record<string, string>));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(msg);
  });

  it("returns 502 when the chain read fails", async () => {
    const r: ContractReader = { readContract: async () => { throw new Error("rpc down"); } };
    const a = createApp({
      signer: await newSigner(), store: new Store(tempDir()), upstream: async () => ({ status: 500, json: {} }),
      model: "m", agentId: 1962n, anchor: "0x049A73755cA3508ef3Daa4752A3406f6e00CfB13", publicUrl: "http://localhost",
      relayCosign: async () => "0x", grades: { reader: r, registry: REGISTRY },
    });
    const res = await a.request(q({ model, host: hostSpec, verifiers: VERIFIER }));
    expect(res.status).toBe(502);
  });
});
