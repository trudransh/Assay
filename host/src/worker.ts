import { DurableObject } from "cloudflare:workers";
import type { Hono } from "hono";
import type { Batcher } from "./batcher.js";
import { loadConfig, parseJwk, scopedEnv } from "./config.js";
import { wireHost } from "./host.js";
import { sameSecret } from "./server.js";
import { SqlStore, type Sql, type StoredBatch, type StoredReceipt } from "./sql-store.js";

/// The hosts this Worker serves, by path prefix, as the VM's Caddy did: /mainnet/* and /kimi/*, everything else testnet.
/// Each runs in its own Durable Object with its own SQLite, named after the host.
const HOSTS = ["testnet", "mainnet", "kimi"] as const;
type HostName = (typeof HOSTS)[number];

interface Env {
  HOST: DurableObjectNamespace<Host>;
  /// Bearer token for POST /admin/import. Unset: the route is off.
  ADMIN_TOKEN?: string;
  [name: string]: unknown;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const first = url.pathname.split("/")[1] as HostName;
    const name: HostName = first === "mainnet" || first === "kimi" ? first : "testnet";
    if (name !== "testnet") url.pathname = url.pathname.slice(name.length + 1) || "/";
    const fwd = new Request(url, req);
    fwd.headers.set("x-assay-host-name", name);
    return env.HOST.get(env.HOST.idFromName(name)).fetch(fwd);
  },
} satisfies ExportedHandler<Env>;

export class Host extends DurableObject<Env> {
  private host?: Promise<{ app: Hono; batcher: Batcher; store: SqlStore; batchMs: number }>;
  /// When the alarm fires next, for /health. Undefined while nothing waits to be anchored.
  private nextAt?: number;

  async fetch(req: Request): Promise<Response> {
    const name = req.headers.get("x-assay-host-name") as HostName;
    if ((await this.ctx.storage.get("name")) !== name) await this.ctx.storage.put("name", name);
    const { app, store } = await this.open(name);
    if (new URL(req.url).pathname === "/admin/import" && req.method === "POST") return this.importRecords(req, store);
    return app.fetch(req);
  }

  /// Anchors what's pending, then comes back while anything is still waiting.
  async alarm(): Promise<void> {
    const name = (await this.ctx.storage.get("name")) as HostName | undefined;
    if (!name) return;
    const { batcher, store, batchMs } = await this.open(name);
    try {
      await batcher.tick();
    } catch (e) {
      console.error(`[batcher] anchor failed, receipts stay queued: ${(e as Error).message}`);
    }
    this.nextAt = store.pending().length ? Date.now() + batchMs : undefined;
    if (this.nextAt) await this.ctx.storage.setAlarm(this.nextAt);
  }

  private open(name: HostName) {
    this.host ??= (async () => {
      const env = scopedEnv(this.env, name);
      const cfg = loadConfig(env, { paths: false });
      if (!env.HOST_JWK) throw new Error(`host config:\n  - ${name.toUpperCase()}__HOST_JWK is required`);
      const jwk = await parseJwk(env.HOST_JWK, `${name.toUpperCase()}__HOST_JWK`);
      const store = new SqlStore(doSql(this.ctx));
      const batchMs = cfg.batchSeconds * 1000;
      this.nextAt = (await this.ctx.storage.getAlarm()) ?? undefined;
      const { app, batcher } = await wireHost(cfg, jwk, [], store, {
        // A new receipt starts the batch clock, or anchors at once when batchMax are waiting.
        notify: () => {
          const due = store.pending().length >= cfg.batchMax ? Date.now() : (this.nextAt ?? Date.now() + batchMs);
          if (due !== this.nextAt) {
            this.nextAt = due;
            void this.ctx.storage.setAlarm(due);
          }
        },
        schedule: () => (this.nextAt === undefined ? undefined : { batchSeconds: cfg.batchSeconds, nextBatchInMs: Math.max(0, this.nextAt - Date.now()) }),
      });
      return { app, batcher, store, batchMs };
    })();
    return this.host;
  }

  /// Moves a host's history in: {receipts, batches} as the Node host stored them. Safe to repeat.
  private async importRecords(req: Request, store: SqlStore): Promise<Response> {
    const token = this.env.ADMIN_TOKEN;
    if (!token || !sameSecret(req.headers.get("authorization") ?? "", `Bearer ${token}`)) return Response.json({ error: { message: "not found" } }, { status: 404 });
    const { receipts, batches } = (await req.json()) as { receipts: StoredReceipt[]; batches: StoredBatch[] };
    store.importRecords(receipts, batches);
    if (store.pending().length && this.nextAt === undefined) {
      this.nextAt = Date.now() + 60_000;
      await this.ctx.storage.setAlarm(this.nextAt);
    }
    return Response.json({ ok: true, ...store.counts(), pending: store.pending().length });
  }
}

function doSql(ctx: DurableObjectState): Sql {
  const s = ctx.storage.sql;
  return {
    exec: (ddl) => {
      for (const q of ddl.split(";").map((x) => x.trim()).filter(Boolean)) s.exec(q);
    },
    run: (q, ...args) => void s.exec(q, ...args),
    all: <T>(q: string, ...args: (string | number)[]) => s.exec(q, ...args).toArray() as T[],
    tx: (fn) => ctx.storage.transactionSync(fn),
  };
}
