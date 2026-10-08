import type { Address } from "viem";

export interface ChainConfig {
  name: string;
  /// Short label for the network switch.
  short: string;
  /// The Assay host serving this chain, same-origin (Vercel rewrites it; Vite proxies it in dev).
  host: string;
  /// The reference host's ERC-8004 agent id on this chain, and one real anchored receipt, for "see it live" links.
  referenceHost: number;
  sampleReceipt: string;
  /// The host's anchor interval (BATCH_SECONDS). The host's /health overrides it when it reports one.
  batchSeconds: number;
  rpc: string;
  explorer: string;
  receiptAnchor: Address;
  verifierRegistry: Address;
  creAttestor: Address;
  identityRegistry: Address;
  reputationRegistry: Address;
  /// AssayAccount, the EIP-7702 delegate the host sponsors per-app keys through. Unset until deployed.
  assayAccount?: Address;
}

/// Hosts beyond each chain's reference host. Receipt lookups try them too; each serves one model.
export const EXTRA_HOSTS: { chainId: number; agentId: number; host: string; name: string; model: string }[] = [
  { chainId: 143, agentId: 10316, host: import.meta.env.VITE_HOST_URL_KIMI ?? "/host-kimi", name: "Assay Kimi host", model: "moonshotai/kimi-k2.6" },
];

/// Every chain Assay is deployed on. A receipt names its chain in host.agentId (erc8004:<chainId>:<id>).
export const CHAINS: Record<number, ChainConfig> = {
  10143: {
    name: "Monad testnet",
    short: "Testnet",
    host: import.meta.env.VITE_HOST_URL ?? "/host",
    referenceHost: 1962,
    sampleReceipt: "0x9a166cacb2ffe4784ad556f69b690b7cebf71150f737a5a3c324f9e98e7907e5",
    // The testnet host's BATCH_SECONDS (read from the VM on 5 Oct). /health reports it once the host patch is deployed.
    batchSeconds: 30,
    rpc: "https://testnet-rpc.monad.xyz",
    explorer: "https://testnet.monadvision.com",
    receiptAnchor: "0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24",
    verifierRegistry: "0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91",
    creAttestor: "0xB4A1CB9e40aDa44570Ae790430C23876d460deDC",
    identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    assayAccount: "0x4eaDaC20fc6842F360884a31cfA11411C664a2A1",
  },
  143: {
    name: "Monad mainnet",
    short: "Mainnet",
    host: import.meta.env.VITE_HOST_URL_MAINNET ?? "/host-mainnet",
    referenceHost: 10278,
    sampleReceipt: "0x1b443b455e55360cec874215c9d1ae3113794f6d3a6c2a0c480387b12e35c5f2",
    // host/deploy/push-secrets.sh sets BATCH_SECONDS=120 for mainnet.
    batchSeconds: 120,
    rpc: "https://rpc.monad.xyz",
    explorer: "https://monadvision.com",
    receiptAnchor: "0x049A73755cA3508ef3Daa4752A3406f6e00CfB13",
    verifierRegistry: "0x0C8603041E7d425c4DCa041680C7AF4581dDa9a1",
    creAttestor: "0xAD9e30dcC63670E1e54f1f12468D16eC1bceDf7a",
    identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    reputationRegistry: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
    assayAccount: "0x7755818dc08659D2A3A66FA3ddb1Ce636c145C91",
  },
};

const NETWORK_KEY = "assay.chain";
const FALLBACK_CHAIN = 143;

/// The network the reader picked in the top bar, remembered in this browser. Public setting, not a secret.
export function selectedChainId(): number {
  try {
    const id = Number(localStorage.getItem(NETWORK_KEY));
    if (CHAINS[id]) return id;
  } catch {
    // No storage (tests, private mode): use the default.
  }
  return FALLBACK_CHAIN;
}

export function setSelectedChainId(id: number) {
  try {
    localStorage.setItem(NETWORK_KEY, String(id));
  } catch {
    // Not remembered; the page still switches for this load.
  }
}

/// The chain the app defaults to: forms, Ask, host profiles without ?chain=. Receipts use their own chain.
export const CHAIN_ID = selectedChainId();

export function chainConfig(chainId: number = CHAIN_ID): ChainConfig {
  const c = CHAINS[chainId];
  if (!c) throw new Error(`This app doesn't know chain ${chainId}.`);
  return c;
}

/// "erc8004:143:7" → 143. Undefined when the string isn't an ERC-8004 agent id.
export function chainOfAgentId(agentId: string): number | undefined {
  const m = /^erc8004:(\d+):\d+$/.exec(agentId);
  return m ? Number(m[1]) : undefined;
}

// The default chain's values, for views that work on one chain at a time.
const primary = chainConfig();
export const DEFAULT_RPC = primary.rpc;
export const RECEIPT_ANCHOR = primary.receiptAnchor;
export const VERIFIER_REGISTRY = primary.verifierRegistry;
export const CRE_ATTESTOR = primary.creAttestor;
export const IDENTITY_REGISTRY = primary.identityRegistry;
export const EXPLORER = primary.explorer;
export const DEFAULT_HOST = primary.host;

export const DOCS_URL = "https://assay.gitbook.io/assay-docs";
export const QUICKSTART_URL = `${DOCS_URL}/getting-started/quickstart`;
export const GITHUB_URL = "https://github.com/trudransh/Assay";
// Envio Cloud GraphQL, one endpoint for every chain (ids are chain-prefixed). Public and read-only,
// so it is safe in the bundle; never put a token in a VITE_ variable.
export const INDEXER_URL: string = import.meta.env.VITE_INDEXER_URL ?? "https://indexer.dev.hyperindex.xyz/f15df95/v1/graphql";
