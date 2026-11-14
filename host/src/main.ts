import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { checkChain, wireHost } from "./host.js";
import { readJwk } from "./jwk-file.js";
import { Store } from "./store.js";

/// The Node entry: one host per process, storage in DATA_DIR, the batcher on its own timer.
const cfg = loadConfig();
const jwk = await readJwk(cfg.hostJwkPath);
const retiredJwks = await Promise.all(cfg.retiredJwkPaths.map(readJwk));
const store = new Store(cfg.dataDir);
const { app, batcher } = await wireHost(cfg, jwk, retiredJwks, store);
try {
  await checkChain(cfg);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
await batcher.checkBalance();
batcher.start();
serve({ fetch: app.fetch, port: cfg.port }, () =>
  console.info(`[host] ${cfg.upstreamModel} on :${cfg.port}, kid ${jwk.kid}, ${store.pending().length} receipts pending`),
);
