import { toFunctionSelector, zeroAddress, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { gradeOf, gradeStatus, verifierRegistryAbi, type Grade } from "../src/grade.js";
import { hostKeyForAgent } from "../src/hostKey.js";
import type { ContractReader } from "../src/verify.js";

const REGISTRY: Address = "0x0C8603000000000000000000000000000000a9a1";
const V1: Address = "0x1111111111111111111111111111111111111111";
const V2: Address = "0x2222222222222222222222222222222222222222";
const MODEL = ("0x" + "aa".repeat(32)) as Hex;
const HOST = hostKeyForAgent(10143n, 1962n);
const NOW = 1_790_000_000n;
const DAY = 86_400n;

const grade = (over: Partial<Grade> = {}): Grade => ({
  model: MODEL,
  hostKey: HOST,
  checks: ("0x" + "cc".repeat(32)) as Hex,
  passed: 45,
  total: 50,
  ciLowBps: 8600,
  ciHighBps: 9600,
  refModel: MODEL,
  evidence: ("0x" + "ee".repeat(32)) as Hex,
  t: NOW - DAY,
  ...over,
});

// A registry where V2 holds the only grade.
function reader(calls: unknown[]): ContractReader {
  return {
    async readContract(args) {
      calls.push(args);
      const trusted = args.args[2] as Address[];
      return trusted.includes(V2) ? [grade(), V2] : [grade({ t: 0n, total: 0 }), zeroAddress];
    },
  };
}

describe("gradeOf", () => {
  it("calls VerifierRegistry.gradeOf with the trusted list and returns the grade and verifier", async () => {
    const calls: any[] = [];
    const out = await gradeOf(reader(calls), REGISTRY, MODEL, HOST, [V1, V2]);
    expect(out).toEqual({ grade: grade(), by: V2 });
    expect(calls[0]).toMatchObject({ address: REGISTRY, functionName: "gradeOf", args: [MODEL, HOST, [V1, V2]] });
  });

  it("uses the contract's selector (forge inspect VerifierRegistry methodIdentifiers)", () => {
    expect(toFunctionSelector(verifierRegistryAbi[0])).toBe("0x6b315814");
  });

  it("returns null when no trusted verifier graded the host", async () => {
    expect(await gradeOf(reader([]), REGISTRY, MODEL, HOST, [V1])).toBeNull();
  });
});

describe("gradeStatus", () => {
  it.each<[string, Grade | null, Grade | undefined, bigint, string]>([
    ["a fresh grade with enough samples", grade(), undefined, NOW, "pass"],
    ["no grade", null, undefined, NOW, "unknown"],
    ["a grade older than 7 days", grade({ t: NOW - 7n * DAY - 1n }), undefined, NOW, "unknown"],
    ["a grade exactly 7 days old", grade({ t: NOW - 7n * DAY }), undefined, NOW, "pass"],
    ["fewer than 30 samples", grade({ total: 29, passed: 29 }), undefined, NOW, "warn"],
    ["exactly 30 samples", grade({ total: 30, passed: 30 }), undefined, NOW, "pass"],
    ["a high bound below the reference's low bound", grade({ ciHighBps: 7000 }), grade({ ciLowBps: 7001 }), NOW, "fail"],
    ["a high bound equal to the reference's low bound", grade({ ciHighBps: 7000 }), grade({ ciLowBps: 7000 }), NOW, "pass"],
    ["a below-reference grade that is stale", grade({ ciHighBps: 7000, t: 1n }), grade({ ciLowBps: 9000 }), NOW, "unknown"],
    ["a below-reference grade with few samples", grade({ ciHighBps: 7000, total: 10 }), grade({ ciLowBps: 9000 }), NOW, "fail"],
    // Found by the 8 Oct council: without a reference, 0/32 used to read "pass".
    ["0/32 with no reference", grade({ passed: 0, total: 32, ciLowBps: 0, ciHighBps: 1072 }), undefined, NOW, "fail"],
    ["0/32 with a reference", grade({ passed: 0, total: 32, ciLowBps: 0, ciHighBps: 1072 }), grade({ ciLowBps: 8928 }), NOW, "fail"],
    ["no reference, worst case under the 80% floor", grade({ passed: 28, total: 32, ciLowBps: 7193, ciHighBps: 9504 }), undefined, NOW, "warn"],
    ["no reference, best case under the 80% floor", grade({ passed: 20, total: 32, ciLowBps: 4524, ciHighBps: 7812 }), undefined, NOW, "fail"],
  ])("%s → %s", (_, g, reference, now, expected) => {
    expect(gradeStatus(g, { now, reference })).toBe(expected);
  });

  it("accepts now as a number", () => {
    expect(gradeStatus(grade(), { now: Number(NOW) })).toBe("pass");
  });
});
