// Moves a Node host's history (receipts.jsonl and batches.jsonl in its DATA_DIR) into a Worker-hosted host.
//   ADMIN_TOKEN=... tsx scripts/import-history.ts https://<worker>/mainnet ./data-mainnet
// Safe to repeat: rows already there are kept as they are.
import { join } from "node:path";
import type { StoredBatch, StoredReceipt } from "../src/sql-store.js";
import { readJsonl } from "../src/store.js";

const [base, dir] = process.argv.slice(2);
const token = process.env.ADMIN_TOKEN;
if (!base || !dir || !token) {
  console.error("usage: ADMIN_TOKEN=... tsx scripts/import-history.ts <host base URL> <data dir>");
  process.exit(1);
}
const receipts = readJsonl<StoredReceipt>(join(dir, "receipts.jsonl"));
const batches = readJsonl<StoredBatch>(join(dir, "batches.jsonl"));
const res = await fetch(`${base.replace(/\/$/, "")}/admin/import`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ receipts, batches }),
});
const out = (await res.json()) as { receipts?: number; batches?: number; pending?: number };
console.info(`sent ${receipts.length} receipts and ${batches.length} batches; host now has`, out);
if (!res.ok || (out.receipts ?? 0) < receipts.length || (out.batches ?? 0) < batches.length) process.exit(1);
