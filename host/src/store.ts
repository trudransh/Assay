import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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

/// SQLite in `<dir>/assay.db`: a row per receipt (with its batch root and proof once anchored) and a row per batch.
/// One process owns the directory. Hosts before 19 Oct kept JSONL files: the first start imports them and renames
/// them to *.imported, so nothing is replayed on later starts.
export class Store {
  private readonly db: DatabaseSync;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(join(dir, "assay.db"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS receipts (hash TEXT PRIMARY KEY, body TEXT NOT NULL, jws TEXT NOT NULL, root TEXT, proof TEXT);
      CREATE INDEX IF NOT EXISTS receipts_pending ON receipts (root) WHERE root IS NULL;
      CREATE TABLE IF NOT EXISTS batches (root TEXT PRIMARY KEY, count INTEGER NOT NULL, anchor_tx TEXT NOT NULL, anchored_at INTEGER NOT NULL);
    `);
    this.importJsonl(dir);
  }

  addReceipt(r: StoredReceipt): void {
    // The answer is already paid for when this runs: a repeated hash (identical body) must not throw.
    this.db.prepare("INSERT OR IGNORE INTO receipts (hash, body, jws) VALUES (?, ?, ?)").run(r.hash.toLowerCase(), JSON.stringify(r.body), r.jws);
  }

  addBatch(b: StoredBatch): void {
    this.tx(() => this.insertBatch(b));
  }

  getReceipt(hash: Hex): StoredReceipt | undefined {
    const row = this.db.prepare("SELECT hash, body, jws FROM receipts WHERE hash = ?").get(hash.toLowerCase()) as
      | { hash: Hex; body: string; jws: string }
      | undefined;
    return row && { hash: row.hash, body: JSON.parse(row.body) as ReceiptBody, jws: row.jws };
  }

  getBatch(hash: Hex): StoredBatch | undefined {
    const row = this.db.prepare("SELECT root FROM receipts WHERE hash = ? AND root IS NOT NULL").get(hash.toLowerCase()) as { root: Hex } | undefined;
    return row && this.batchByRoot(row.root);
  }

  batchByRoot(root: Hex): StoredBatch | undefined {
    const b = this.db.prepare("SELECT root, count, anchor_tx, anchored_at FROM batches WHERE root = ?").get(root.toLowerCase()) as
      | { root: Hex; count: number; anchor_tx: Hex; anchored_at: number }
      | undefined;
    if (!b) return undefined;
    const rows = this.db.prepare("SELECT hash, proof FROM receipts WHERE root = ?").all(b.root) as { hash: Hex; proof: string }[];
    const proofs = Object.fromEntries(rows.map((r) => [r.hash, JSON.parse(r.proof) as Hex[]])) as Record<Hex, Hex[]>;
    return { root: b.root, count: b.count, anchorTx: b.anchor_tx, proofs, anchoredAt: b.anchored_at };
  }

  /// Receipt hashes not yet in an anchored batch, oldest first.
  pending(): Hex[] {
    return (this.db.prepare("SELECT hash FROM receipts WHERE root IS NULL ORDER BY rowid").all() as { hash: Hex }[]).map((r) => r.hash);
  }

  private insertBatch(b: StoredBatch): void {
    const root = b.root.toLowerCase();
    this.db.prepare("INSERT OR REPLACE INTO batches (root, count, anchor_tx, anchored_at) VALUES (?, ?, ?, ?)").run(root, b.count, b.anchorTx, b.anchoredAt);
    const setProof = this.db.prepare("UPDATE receipts SET root = ?, proof = ? WHERE hash = ?");
    for (const [h, proof] of Object.entries(b.proofs)) setProof.run(root, JSON.stringify(proof), h.toLowerCase());
  }

  private tx(fn: () => void): void {
    this.db.exec("BEGIN");
    try {
      fn();
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  // Safe to repeat: if the process dies between the commit and the renames, the next start imports the same rows again.
  private importJsonl(dir: string): void {
    const [rf, bf] = [join(dir, "receipts.jsonl"), join(dir, "batches.jsonl")];
    if (!existsSync(rf) && !existsSync(bf)) return;
    const receipts = readJsonl<StoredReceipt>(rf);
    const batches = readJsonl<StoredBatch>(bf);
    this.tx(() => {
      for (const r of receipts) this.addReceipt(r);
      for (const b of batches) this.insertBatch(b);
    });
    for (const f of [rf, bf]) if (existsSync(f)) renameSync(f, `${f}.imported`);
    console.info(`[store] imported ${receipts.length} receipts and ${batches.length} batches from JSONL`);
  }
}

function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf8").split("\n");
  // A crash mid-append leaves a partial last line with no newline. That request was never answered, so drop it.
  if (lines.pop()) console.warn(`[store] dropping partial last line in ${file}`);
  return lines.filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
}
