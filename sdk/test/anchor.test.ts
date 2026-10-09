import { describe, expect, it } from "vitest";
import { AnchorTimeoutError, waitForAnchor } from "../src/wrap.js";

const HASH = `0x${"ab".repeat(32)}` as const;
const HOST = "https://host.example/mainnet/";

// A host whose receipt stays pending for `pendingFor` polls, then anchors. /health reports the next batch.
function host(pendingFor: number, receiptStatus = 200) {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/health")) return Response.json({ ok: true, nextBatchInMs: 41_500 });
    if (receiptStatus !== 200) return Response.json({ error: "unknown receipt" }, { status: receiptStatus });
    const polls = calls.filter((c) => c.includes("/v1/receipts/")).length;
    return Response.json(polls > pendingFor ? { status: "anchored", root: "0x01", proof: [] } : { status: "pending" });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("waitForAnchor", () => {
  it("polls until the receipt is anchored and returns the proof", async () => {
    const h = host(2);
    const r = await waitForAnchor(HOST, HASH, { pollMs: 1, fetchImpl: h.fetchImpl });
    expect(r.status).toBe("anchored");
    expect(h.calls).toEqual(Array(3).fill(`https://host.example/mainnet/v1/receipts/${HASH}`));
  });

  it("times out with the host's next batch time", async () => {
    const h = host(Infinity);
    const err = await waitForAnchor(HOST, HASH, { timeoutMs: 0, fetchImpl: h.fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(AnchorTimeoutError);
    expect(err.nextBatchInMs).toBe(41_500);
    expect(err.message).toMatch(/about 42 s/);
  });

  it("fails at once on an unknown receipt instead of waiting", async () => {
    const h = host(0, 404);
    await expect(waitForAnchor(HOST, HASH, { fetchImpl: h.fetchImpl })).rejects.toThrow(/404/);
    expect(h.calls).toHaveLength(1);
  });

  it("rejects a malformed hash before any request", async () => {
    const h = host(0);
    await expect(waitForAnchor(HOST, "0x12", { fetchImpl: h.fetchImpl })).rejects.toThrow(/32 bytes/);
    expect(h.calls).toHaveLength(0);
  });
});
