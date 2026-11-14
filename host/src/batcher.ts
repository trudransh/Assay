import { buildBatch, type HostSigner } from "@assay/receipts";
import { parseEther, type Address, type Hex } from "viem";
import { anchorWriteAbi, sendTx, type ChainClient } from "./chain.js";
import { CHAIN_ID } from "./config.js";
import type { SqlStore as Store } from "./sql-store.js";

export const LOW_BALANCE = parseEther("1");

export interface BatcherDeps {
  /// Signed into every anchor message; must be the chain the anchor contract lives on. Default: testnet.
  chainId?: number;
  store: Store;
  signer: HostSigner;
  clients: ChainClient[];
  anchor: Address;
  agentId: bigint;
  relayer: Address;
  batchSeconds: number;
  batchMax: number;
  log?: Pick<Console, "info" | "warn" | "error">;
}

export interface Batcher {
  /// Anchors up to batchMax pending receipts. Returns the anchored root, or null when there was nothing to do.
  tick(): Promise<Hex | null>;
  /// Called after each new receipt: anchors right away once batchMax receipts are waiting.
  notify(): void;
  checkBalance(): Promise<void>;
  start(): void;
  stop(): void;
  /// When the timer fires next, for /health. Relative, so a reader's clock skew doesn't matter. Undefined until start().
  schedule(): { batchSeconds: number; nextBatchInMs: number } | undefined;
}

export function createBatcher(d: BatcherDeps): Batcher {
  const log = d.log ?? console;
  let running: Promise<Hex | null> | undefined;
  let timer: NodeJS.Timeout | undefined;
  let nextAt: number | undefined;

  async function anchorOnce(): Promise<Hex | null> {
    const hashes = d.store.pending().slice(0, d.batchMax);
    if (hashes.length === 0) return null;

    const { root, proofs } = buildBatch(hashes);
    const { r, s } = await d.signer.signAnchor({ chainId: BigInt(d.chainId ?? CHAIN_ID), anchor: d.anchor, agentId: d.agentId, root, count: hashes.length });
    const anchorTx = await sendTx(
      d.clients,
      { address: d.anchor, abi: anchorWriteAbi, functionName: "anchor", args: [d.agentId, root, hashes.length, r, s] },
      log,
    );
    d.store.addBatch({ root, count: hashes.length, anchorTx, proofs: Object.fromEntries(proofs), anchoredAt: Date.now() });
    log.info(`[batcher] anchored ${hashes.length} receipts, root ${root}, tx ${anchorTx}`);
    await checkBalance();
    return root;
  }

  async function checkBalance(): Promise<void> {
    try {
      const bal = await d.clients[0].getBalance({ address: d.relayer });
      if (bal < LOW_BALANCE) log.warn(`[batcher] relayer ${d.relayer} balance below 1 MON, top up from the faucet`);
    } catch (e) {
      log.warn(`[batcher] balance check failed: ${(e as Error).message}`);
    }
  }

  // One anchor in flight at a time, so two ticks never sign the same pending receipts.
  function tick(): Promise<Hex | null> {
    running ??= anchorOnce().finally(() => (running = undefined));
    return running;
  }

  const safeTick = () =>
    tick().catch((e) => {
      log.error(`[batcher] anchor failed, receipts stay queued: ${(e as Error).message}`);
      return null;
    });

  return {
    tick,
    checkBalance,
    notify: () => {
      if (d.store.pending().length >= d.batchMax) void safeTick();
    },
    start: () => {
      if (timer) return;
      nextAt = Date.now() + d.batchSeconds * 1000;
      timer = setInterval(() => {
        nextAt = Date.now() + d.batchSeconds * 1000;
        void safeTick();
      }, d.batchSeconds * 1000);
    },
    stop: () => {
      clearInterval(timer);
      timer = undefined;
      nextAt = undefined;
    },
    schedule: () => (nextAt === undefined ? undefined : { batchSeconds: d.batchSeconds, nextBatchInMs: Math.max(0, nextAt - Date.now()) }),
  };
}
