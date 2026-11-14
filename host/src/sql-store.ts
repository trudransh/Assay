import type { ReceiptBody } from "@assay/receipts";
import type { Hex } from "viem";

export interface StoredReceipt {
  hash: Hex;
  body: ReceiptBody;
  jws: string;
}

export interface StoredBatch {
  root: Hex;
  count: number;
  anchorTx: Hex;
  proofs: Record<Hex, Hex[]>;
  anchoredAt: number;
}

/// The few SQLite calls the store needs, so the same code runs on node:sqlite (store.ts) and on a
/// Cloudflare Durable Object's storage.sql (worker.ts).
export interface Sql {
  exec(ddl: string): void;
  run(query: string, ...args: (string | number)[]): void;
  all<T>(query: string, ...args: (string | number)[]): T[];
  tx(fn: () => void): void;
}

/// A row per receipt (with its batch root and proof once anchored) and a row per batch.
export class SqlStore {
  constructor(protected readonly sql: Sql) {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS receipts (hash TEXT PRIMARY KEY, body TEXT NOT NULL, jws TEXT NOT NULL, root TEXT, proof TEXT);
      CREATE INDEX IF NOT EXISTS receipts_pending ON receipts (root) WHERE root IS NULL;
      CREATE TABLE IF NOT EXISTS batches (root TEXT PRIMARY KEY, count INTEGER NOT NULL, anchor_tx TEXT NOT NULL, anchored_at INTEGER NOT NULL);
    `);
  }

  addReceipt(r: StoredReceipt): void {
    // The answer is already paid for when this runs: a repeated hash (identical body) must not throw.
    this.sql.run("INSERT OR IGNORE INTO receipts (hash, body, jws) VALUES (?, ?, ?)", r.hash.toLowerCase(), JSON.stringify(r.body), r.jws);
  }

  addBatch(b: StoredBatch): void {
    this.sql.tx(() => this.insertBatch(b));
  }

  /// Bulk load, for moving a host's history between machines. Safe to repeat.
  importRecords(receipts: StoredReceipt[], batches: StoredBatch[]): void {
    this.sql.tx(() => {
      for (const r of receipts) this.addReceipt(r);
      for (const b of batches) this.insertBatch(b);
    });
  }

  getReceipt(hash: Hex): StoredReceipt | undefined {
    const [row] = this.sql.all<{ hash: Hex; body: string; jws: string }>("SELECT hash, body, jws FROM receipts WHERE hash = ?", hash.toLowerCase());
    return row && { hash: row.hash, body: JSON.parse(row.body) as ReceiptBody, jws: row.jws };
  }

  getBatch(hash: Hex): StoredBatch | undefined {
    const [row] = this.sql.all<{ root: Hex }>("SELECT root FROM receipts WHERE hash = ? AND root IS NOT NULL", hash.toLowerCase());
    return row && this.batchByRoot(row.root);
  }

  batchByRoot(root: Hex): StoredBatch | undefined {
    const [b] = this.sql.all<{ root: Hex; count: number; anchor_tx: Hex; anchored_at: number }>(
      "SELECT root, count, anchor_tx, anchored_at FROM batches WHERE root = ?",
      root.toLowerCase(),
    );
    if (!b) return undefined;
    const rows = this.sql.all<{ hash: Hex; proof: string }>("SELECT hash, proof FROM receipts WHERE root = ?", b.root);
    const proofs = Object.fromEntries(rows.map((r) => [r.hash, JSON.parse(r.proof) as Hex[]])) as Record<Hex, Hex[]>;
    return { root: b.root, count: b.count, anchorTx: b.anchor_tx, proofs, anchoredAt: b.anchored_at };
  }

  /// Receipt hashes not yet in an anchored batch, oldest first.
  pending(): Hex[] {
    return this.sql.all<{ hash: Hex }>("SELECT hash FROM receipts WHERE root IS NULL ORDER BY rowid").map((r) => r.hash);
  }

  counts(): { receipts: number; batches: number } {
    const [r] = this.sql.all<{ n: number }>("SELECT count(*) AS n FROM receipts");
    const [b] = this.sql.all<{ n: number }>("SELECT count(*) AS n FROM batches");
    return { receipts: r.n, batches: b.n };
  }

  protected insertBatch(b: StoredBatch): void {
    const root = b.root.toLowerCase();
    this.sql.run("INSERT OR REPLACE INTO batches (root, count, anchor_tx, anchored_at) VALUES (?, ?, ?, ?)", root, b.count, b.anchorTx, b.anchoredAt);
    for (const [h, proof] of Object.entries(b.proofs)) this.sql.run("UPDATE receipts SET root = ?, proof = ? WHERE hash = ?", root, JSON.stringify(proof), h.toLowerCase());
  }
}
