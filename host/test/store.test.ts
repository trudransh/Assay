import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ReceiptBody } from "@assay/receipts";
import type { Hex } from "viem";
import { Store } from "../src/store.js";

const h = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const rec = (n: number) => ({ hash: h(n), body: { t: n } as unknown as ReceiptBody, jws: `jws${n}` });

describe("Store", () => {
  it("queues receipts until a batch covers them, and survives a restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "assay-store-"));
    const s = new Store(dir);
    s.addReceipt(rec(1));
    s.addReceipt(rec(2));
    s.addReceipt(rec(3));
    s.addBatch({ root: h(9), count: 2, anchorTx: h(8), proofs: { [h(1)]: [h(2)], [h(2)]: [h(1)] }, anchoredAt: 1 });
    expect(s.pending()).toEqual([h(3)]);

    const again = new Store(dir);
    expect(again.pending()).toEqual([h(3)]);
    expect(again.getReceipt(h(1))?.jws).toBe("jws1");
    expect(again.getBatch(h(2))?.root).toBe(h(9));
    expect(again.getBatch(h(3))).toBeUndefined();
  });

  it("imports an older host's JSONL once, keeps the files as *.imported, and drops a partial last line", () => {
    const dir = mkdtempSync(join(tmpdir(), "assay-store-"));
    const line = (o: unknown) => JSON.stringify(o) + "\n";
    writeFileSync(join(dir, "receipts.jsonl"), line(rec(1)) + line(rec(2)) + line(rec(3)) + '{"hash":"0x');
    writeFileSync(join(dir, "batches.jsonl"), line({ root: h(9), count: 2, anchorTx: h(8), proofs: { [h(1)]: [h(2)], [h(2)]: [h(1)] }, anchoredAt: 1 }));
    const s = new Store(dir);
    expect(s.pending()).toEqual([h(3)]);
    expect(s.getBatch(h(1))).toEqual({ root: h(9), count: 2, anchorTx: h(8), proofs: { [h(1)]: [h(2)], [h(2)]: [h(1)] }, anchoredAt: 1 });
    expect(existsSync(join(dir, "receipts.jsonl"))).toBe(false);
    expect(existsSync(join(dir, "receipts.jsonl.imported"))).toBe(true);
    expect(existsSync(join(dir, "batches.jsonl.imported"))).toBe(true);

    const again = new Store(dir);
    expect(again.pending()).toEqual([h(3)]);
    expect(again.getReceipt(h(2))?.body).toEqual({ t: 2 });
  });

  it("looks hashes up in any case and doesn't throw on a repeated receipt", () => {
    const s = new Store(mkdtempSync(join(tmpdir(), "assay-store-")));
    s.addReceipt(rec(10));
    s.addReceipt(rec(10));
    expect(s.pending()).toEqual([h(10)]);
    expect(s.getReceipt(h(10).toUpperCase().replace("0X", "0x") as Hex)?.jws).toBe("jws10");
    expect(s.batchByRoot(h(99))).toBeUndefined();
  });
});
