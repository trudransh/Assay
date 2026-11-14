import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqlStore, type StoredBatch, type StoredReceipt } from "./sql-store.js";

export type { StoredBatch, StoredReceipt } from "./sql-store.js";

/// SqlStore on node:sqlite in `<dir>/assay.db`. One process owns the directory. Hosts before 19 Oct kept JSONL files:
/// the first start imports them and renames them to *.imported, so nothing is replayed on later starts.
export class Store extends SqlStore {
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(join(dir, "assay.db"));
    super({
      exec: (ddl) => db.exec(ddl),
      run: (q, ...args) => void db.prepare(q).run(...args),
      all: <T>(q: string, ...args: (string | number)[]) => db.prepare(q).all(...args) as T[],
      tx: (fn) => {
        db.exec("BEGIN");
        try {
          fn();
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      },
    });
    this.importJsonl(dir);
  }

  // Safe to repeat: if the process dies between the commit and the renames, the next start imports the same rows again.
  private importJsonl(dir: string): void {
    const [rf, bf] = [join(dir, "receipts.jsonl"), join(dir, "batches.jsonl")];
    if (!existsSync(rf) && !existsSync(bf)) return;
    const receipts = readJsonl<StoredReceipt>(rf);
    const batches = readJsonl<StoredBatch>(bf);
    this.importRecords(receipts, batches);
    for (const f of [rf, bf]) if (existsSync(f)) renameSync(f, `${f}.imported`);
    console.info(`[store] imported ${receipts.length} receipts and ${batches.length} batches from JSONL`);
  }
}

export function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf8").split("\n");
  // A crash mid-append leaves a partial last line with no newline. That request was never answered, so drop it.
  if (lines.pop()) console.warn(`[store] dropping partial last line in ${file}`);
  return lines.filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
}
