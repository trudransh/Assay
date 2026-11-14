import { createHostSigner, receiptAnchorAbi, type ContractReader } from "@assay/receipts";
import type { Hono } from "hono";
import type { JWK } from "jose";
import { createPublicClient, http, type PublicClient } from "viem";
import { createBatcher, type Batcher } from "./batcher.js";
import { anchorWriteAbi, makeClients, sendTx, type WriteRequest } from "./chain.js";
import { NETWORKS, type Config } from "./config.js";
import { createApp, type AppDeps } from "./server.js";
import type { SqlStore } from "./sql-store.js";
import { openRouter } from "./upstream.js";

/// Builds one host from its config: the signer, the chain clients, the batcher and the app. Shared by the Node
/// entry (main.ts) and the Cloudflare Worker (worker.ts), which differ only in storage and in what drives the batcher.
export async function wireHost(
  cfg: Config,
  jwk: JWK & { kid: string },
  retiredJwks: JWK[],
  store: SqlStore,
  /// Replaces the batcher's own timer hooks, for a runtime that schedules anchoring itself (a Durable Object alarm).
  batcherHooks?: AppDeps["batcher"],
): Promise<{ app: Hono; batcher: Batcher }> {
  const signer = await createHostSigner(jwk, jwk.kid);
  const { clients, relayer } = makeClients(cfg.rpcUrls, cfg.relayerPrivateKey, cfg.network);
  const batcher = createBatcher({
    chainId: cfg.chainId,
    store,
    signer,
    clients,
    anchor: cfg.anchorAddress,
    agentId: cfg.hostAgentId,
    relayer,
    batchSeconds: cfg.batchSeconds,
    batchMax: cfg.batchMax,
  });
  const app = createApp({
    chainId: cfg.chainId,
    identityRegistry: cfg.identityRegistry,
    publicRpc: NETWORKS[cfg.network].publicRpc,
    signer,
    retiredJwks,
    store,
    upstream: openRouter(cfg.openrouterApiKey, fetch, cfg.upstreamUrl),
    model: cfg.upstreamModel,
    provider: cfg.upstreamProvider,
    chatLimit: cfg.chatLimit,
    chatLimitGlobal: cfg.chatLimitGlobal,
    graderToken: cfg.graderToken,
    defaultMaxTokens: cfg.defaultMaxTokens,
    maxTokensCap: cfg.maxTokensCap,
    hostName: cfg.hostName,
    reasoning: cfg.reasoning,
    agentId: cfg.hostAgentId,
    anchor: cfg.anchorAddress,
    publicUrl: cfg.publicUrl,
    batcher: batcherHooks ?? batcher,
    relayCosign: (args) => sendTx(clients, { address: cfg.anchorAddress, abi: anchorWriteAbi, functionName: "cosign", args }),
    // The wallet clients extend publicActions, so they can read contracts too.
    grades: { reader: clients[0] as unknown as ContractReader, registry: cfg.verifierRegistry },
    sponsor: {
      reputation: cfg.reputationRegistry,
      accountImpl: cfg.accountImpl,
      code: (address) => (clients[0] as unknown as PublicClient).getCode({ address }),
      cosignedK: async (hash, signer) =>
        (await (clients[0] as unknown as ContractReader).readContract({ address: cfg.anchorAddress, abi: receiptAnchorAbi, functionName: "cosignedK", args: [hash, signer] })) as boolean,
      send: (req) => sendTx(clients, req as WriteRequest),
    },
  });
  return { app, batcher };
}

/// Refuse to run on the wrong chain: a mainnet host pointed at a testnet RPC would sign anchors nobody can verify.
export async function checkChain(cfg: Config): Promise<void> {
  for (const url of cfg.rpcUrls) {
    const got = await createPublicClient({ transport: http(url) }).getChainId();
    if (got !== cfg.chainId) throw new Error(`RPC ${new URL(url).host} is chain ${got}, but ASSAY_NETWORK=${cfg.network} needs ${cfg.chainId}`);
  }
}
