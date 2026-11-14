import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import { feedStatuses, toOpenRouterIgnore, type Feed, type FeedHost } from "../src/feed.js";

const NOW = 1_790_000_000;
const DAY = 86_400;
const h32 = (b: string) => ("0x" + b.repeat(32)) as Hex;

const host = (spec: string, over: Partial<FeedHost> = {}): FeedHost => ({
  host: spec,
  hostKey: h32("11"),
  passed: 32,
  total: 32,
  ciLowBps: 8928,
  ciHighBps: 10000,
  checks: h32("cc"),
  refModel: h32("aa"),
  evidence: h32("ee"),
  evidenceUrl: null,
  t: NOW - DAY,
  verifier: "0x4BaC2Be288B5931886EeC4c555895CE6BcAB19e7" as Address,
  ...over,
});

const feed = (hosts: FeedHost[], reference: string | null = "openrouter:lab/int4"): Feed => ({
  version: 1,
  chainId: 143,
  registry: "0x0C8603041E7d425c4DCa041680C7AF4581dDa9a1",
  verifiers: ["0x4BaC2Be288B5931886EeC4c555895CE6BcAB19e7"],
  generatedAt: NOW - DAY,
  models: [{ model: "lab/model", modelHash: h32("aa"), reference, hosts }],
});

describe("feedStatuses", () => {
  const f = feed([
    host("openrouter:lab/int4"),
    host("openrouter:good/fp8"),
    host("openrouter:bad/fp8", { passed: 10, total: 32, ciLowBps: 1800, ciHighBps: 4800 }),
    host("openrouter:old/fp8", { t: NOW - 8 * DAY }),
    host("erc8004:143:1", { passed: 20, total: 20, ciLowBps: 8389, ciHighBps: 10000 }),
  ]);

  it("judges each host against the reference's grade in the feed, at read time", () => {
    expect(Object.fromEntries(feedStatuses(f, "lab/model", NOW))).toEqual({
      "openrouter:lab/int4": "pass",
      "openrouter:good/fp8": "pass",
      "openrouter:bad/fp8": "fail",
      "openrouter:old/fp8": "unknown",
      "erc8004:143:1": "warn",
    });
  });

  it("falls back to the absolute floor when the reference has no grade in the feed", () => {
    const s = feedStatuses(feed([host("openrouter:x/fp8", { ciLowBps: 7000, ciHighBps: 9000 })]), "lab/model", NOW);
    expect(s.get("openrouter:x/fp8")).toBe("warn");
  });

  it("gives an empty map for a model the feed doesn't cover, and rejects anything that isn't a feed", () => {
    expect(feedStatuses(f, "other/model", NOW).size).toBe(0);
    expect(() => feedStatuses({ version: 2 } as unknown as Feed, "lab/model", NOW)).toThrow(/grade feed/);
  });

  it("toOpenRouterIgnore lists failing OpenRouter tags, and expired ones only when asked", () => {
    expect(toOpenRouterIgnore(f, "lab/model", { now: NOW })).toEqual(["bad/fp8"]);
    expect(toOpenRouterIgnore(f, "lab/model", { now: NOW, block: ["fail", "unknown"] })).toEqual(["bad/fp8", "old/fp8"]);
  });
});
