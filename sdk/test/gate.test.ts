import { zeroAddress, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { chainGradeCheck, type Grade, type GradeStatus } from "../src/grade.js";
import { hostKeyOf } from "../src/hostKey.js";
import type { ContractReader } from "../src/verify.js";
import { GradeGateError, hostGradeCheck, wrap } from "../src/wrap.js";

// A host fetch that records whether the request went out. It returns no receipt, so an allowed
// request ends in wrap's "no X-Assay-Receipt" error, which proves it was sent.
function host() {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const status = (s: GradeStatus) => async () => s;
const ASK = "https://host.example/v1/chat/completions";

describe("grade gate", () => {
  it("sends the request when the host passes", async () => {
    const h = host();
    await expect(wrap(h.fetchImpl, { gate: { check: status("pass") } })(ASK, { method: "POST" })).rejects.toThrow(/X-Assay-Receipt/);
    expect(h.calls).toEqual([ASK]);
  });

  it.each<GradeStatus>(["warn", "unknown", "fail"])("refuses a %s host by default and sends nothing", async (s) => {
    const h = host();
    const err = await wrap(h.fetchImpl, { gate: { check: status(s) } })(ASK).catch((e) => e);
    expect(err).toBeInstanceOf(GradeGateError);
    expect(err.status).toBe(s);
    expect(h.calls).toEqual([]);
  });

  it("lets the caller widen what is allowed", async () => {
    const h = host();
    const ask = wrap(h.fetchImpl, { gate: { check: status("warn"), allow: ["pass", "warn"] } });
    await expect(ask(ASK)).rejects.toThrow(/X-Assay-Receipt/);
    expect(h.calls).toHaveLength(1);
  });

  it("skips the check for calls the caller marks as cheap", async () => {
    const h = host();
    let checked = false;
    const ask = wrap(h.fetchImpl, {
      gate: { check: async () => ((checked = true), "fail"), skip: (init) => (init.headers as Record<string, string>)?.["x-cheap"] === "1" },
    });
    await expect(ask(ASK, { headers: { "x-cheap": "1" } })).rejects.toThrow(/X-Assay-Receipt/);
    expect(checked).toBe(false);
    expect(h.calls).toHaveLength(1);
  });

  it("fails closed when the grade can't be read", async () => {
    const h = host();
    const err = await wrap(h.fetchImpl, { gate: { check: async () => { throw new Error("rpc down"); } } })(ASK).catch((e) => e);
    expect(err).toBeInstanceOf(GradeGateError);
    expect(err.status).toBe("error");
    expect(err.message).toMatch(/rpc down/);
    expect(h.calls).toEqual([]);
  });
});

describe("hostGradeCheck", () => {
  it("queries GET /v1/grade with the model, host, verifiers and reference", async () => {
    let url = "";
    const fetchImpl = (async (u: string) => {
      url = u;
      return new Response(JSON.stringify({ status: "warn" }), { status: 200 });
    }) as unknown as typeof fetch;
    const check = hostGradeCheck("https://host.example/", { model: "z-ai/glm-5.3", host: "erc8004:10143:1962", verifiers: ["0xa", "0xb"], reference: "openrouter:z-ai/fp8" }, fetchImpl);
    expect(await check()).toBe("warn");
    const u = new URL(url);
    expect(u.pathname).toBe("/v1/grade");
    expect(Object.fromEntries(u.searchParams)).toEqual({ model: "z-ai/glm-5.3", host: "erc8004:10143:1962", verifiers: "0xa,0xb", reference: "openrouter:z-ai/fp8" });
  });

  it("throws on a non-200 so the gate fails closed", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 502 })) as unknown as typeof fetch;
    await expect(hostGradeCheck("https://h", { model: "m", host: "direct:x", verifiers: ["0xa"] }, fetchImpl)()).rejects.toThrow(/502/);
  });
});

describe("failOpen", () => {
  it("sends the request when the grade can't be read", async () => {
    const h = host();
    const ask = wrap(h.fetchImpl, { gate: { check: async () => { throw new Error("rpc down"); }, failOpen: true } });
    await expect(ask(ASK)).rejects.toThrow(/X-Assay-Receipt/);
    expect(h.calls).toEqual([ASK]);
  });

  it("still refuses a grade it could read", async () => {
    const h = host();
    const err = await wrap(h.fetchImpl, { gate: { check: status("unknown"), failOpen: true } })(ASK).catch((e) => e);
    expect(err.status).toBe("unknown");
    expect(h.calls).toEqual([]);
  });
});

describe("chainGradeCheck", () => {
  const REGISTRY: Address = "0x0C8603041E7d425c4DCa041680C7AF4581dDa9a1";
  const V: Address = "0x1111111111111111111111111111111111111111";
  const HOST = "erc8004:143:10278";
  const REF = "direct:generativelanguage.googleapis.com";
  const T = 1_790_000_000;
  const g = (ciLowBps: number, ciHighBps: number, total = 40): Grade => ({
    model: `0x${"00".repeat(32)}`, hostKey: `0x${"00".repeat(32)}`, checks: `0x${"00".repeat(32)}`, passed: total, total, ciLowBps, ciHighBps,
    refModel: `0x${"00".repeat(32)}`, evidence: `0x${"00".repeat(32)}`, t: BigInt(T - 3600),
  });
  // A registry holding one grade per host key; counts reads so the cache is visible.
  function registry(grades: Record<string, Grade>, fail = false) {
    const reads: Hex[] = [];
    const client: ContractReader = {
      async readContract(args) {
        if (fail) throw new Error("rpc down");
        const key = args.args[1] as Hex;
        reads.push(key);
        return grades[key] ? [grades[key], V] : [g(0, 0, 0), zeroAddress];
      },
    };
    return { client, reads };
  }
  const q = { registry: REGISTRY, model: "gemma-4-31b-it", host: HOST, verifiers: [V], reference: REF, now: () => T * 1000 };

  it("reads the host's and the reference's grades from the registry, not from the host", async () => {
    const r = registry({ [hostKeyOf(HOST)!]: g(9060, 10000), [hostKeyOf(REF)!]: g(9120, 10000) });
    expect(await chainGradeCheck(r.client, q)()).toBe("pass");
    expect(r.reads).toEqual([hostKeyOf(HOST), hostKeyOf(REF)]);
  });

  it("fails a host whose best case is under the reference's worst case", async () => {
    const r = registry({ [hostKeyOf(HOST)!]: g(5000, 8000), [hostKeyOf(REF)!]: g(9120, 10000) });
    expect(await chainGradeCheck(r.client, q)()).toBe("fail");
  });

  it("reuses a status within cacheMs and reads again after", async () => {
    const r = registry({ [hostKeyOf(HOST)!]: g(9060, 10000) });
    let now = T * 1000;
    const check = chainGradeCheck(r.client, { ...q, reference: undefined, cacheMs: 1000, now: () => now });
    await check();
    await check();
    expect(r.reads).toHaveLength(1);
    now += 1000;
    await check();
    expect(r.reads).toHaveLength(2);
  });

  it("doesn't cache a failed read, so wrap fails closed each time", async () => {
    const r = registry({}, true);
    const check = chainGradeCheck(r.client, q);
    await expect(check()).rejects.toThrow("rpc down");
    const h = host();
    expect((await wrap(h.fetchImpl, { gate: { check } })(ASK).catch((e) => e)).status).toBe("error");
    expect(h.calls).toEqual([]);
  });

  it("rejects a host spec it can't turn into a host key", () => {
    expect(() => chainGradeCheck(registry({}).client, { ...q, host: "10278" })).toThrow(/host and reference/);
    expect(() => chainGradeCheck(registry({}).client, { ...q, reference: "moonshotai/int4" })).toThrow(/host and reference/);
  });
});
