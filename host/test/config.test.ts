import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const base = {
  OPENROUTER_API_KEY: "sk-or-test",
  UPSTREAM_MODEL: "z-ai/glm-5.3",
  MONAD_RPC_URL: "https://rpc.one",
  ANCHOR_ADDRESS: "0x049A73755cA3508ef3Daa4752A3406f6e00CfB13",
  HOST_AGENT_ID: "1962",
  RELAYER_PRIVATE_KEY: `0x${"11".repeat(32)}`,
};

describe("loadConfig", () => {
  it("applies defaults", () => {
    const c = loadConfig(base);
    expect(c.batchSeconds).toBe(300);
    expect(c.batchMax).toBe(64);
    expect(c.port).toBe(8787);
    expect(c.hostAgentId).toBe(1962n);
    // The network's public RPC is the automatic fallback.
    expect(c.rpcUrls).toEqual(["https://rpc.one", "https://testnet-rpc.monad.xyz"]);
    expect(c.network).toBe("testnet");
    expect(c.chainId).toBe(10143);
    expect(c.hostJwkPath).toMatch(/host\/\.keys\/host\.jwk\.json$/);
    expect(c.retiredJwkPaths).toEqual([]);
    expect(c.upstreamProvider).toBeUndefined();
  });

  it("switches networks with ASSAY_NETWORK, preferring NAME_<NETWORK> over NAME", () => {
    const both = { ...base, MONAD_RPC_URL_MAINNET: "https://main.rpc", ANCHOR_ADDRESS_MAINNET: "0x049A73755cA3508ef3Daa4752A3406f6e00CfB13", HOST_AGENT_ID_MAINNET: "7", VERIFIER_REGISTRY_MAINNET: "0x0C8603041E7d425c4DCa041680C7AF4581dDa9a1" };
    const t = loadConfig(both);
    expect([t.chainId, t.hostAgentId, t.rpcUrls[0]]).toEqual([10143, 1962n, "https://rpc.one"]);
    const m = loadConfig({ ...both, ASSAY_NETWORK: "mainnet" });
    expect([m.chainId, m.hostAgentId, m.anchorAddress, m.rpcUrls]).toEqual([143, 7n, "0x049A73755cA3508ef3Daa4752A3406f6e00CfB13", ["https://main.rpc", "https://rpc.monad.xyz"]]);
    expect(m.identityRegistry).toBe("0x8004A169FB4a3325136EB29fA0ceB6D2e539a432");
  });

  it("never lets plain (testnet) names leak into a mainnet config", () => {
    // base has plain MONAD_RPC_URL, ANCHOR_ADDRESS and HOST_AGENT_ID: all testnet.
    expect(() => loadConfig({ ...base, ASSAY_NETWORK: "mainnet", VERIFIER_REGISTRY_MAINNET: "0x0C8603041E7d425c4DCa041680C7AF4581dDa9a1" })).toThrow(/MONAD_RPC_URL.*required|ANCHOR_ADDRESS|HOST_AGENT_ID/);
  });

  it("requires a mainnet VerifierRegistry and a known network", () => {
    expect(() => loadConfig({ ...base, ASSAY_NETWORK: "mainnet" })).toThrow(/VERIFIER_REGISTRY_MAINNET/);
    expect(() => loadConfig({ ...base, ASSAY_NETWORK: "goerli" })).toThrow(/ASSAY_NETWORK/);
  });

  it("uses OpenRouter by default and a direct upstream with its own key", () => {
    expect(loadConfig(base).upstreamUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
    const url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    const { OPENROUTER_API_KEY: _, ...noOr } = base;
    const c = loadConfig({ ...noOr, UPSTREAM_URL: url, UPSTREAM_API_KEY: "g-key" });
    expect(c.upstreamUrl).toBe(url);
    expect(c.openrouterApiKey).toBe("g-key");
    expect(() => loadConfig({ ...noOr, UPSTREAM_URL: url })).toThrow(/UPSTREAM_API_KEY/);
    expect(() => loadConfig({ ...base, UPSTREAM_URL: "http://plain" , UPSTREAM_API_KEY: "k" })).toThrow(/https/);
    expect(() => loadConfig({ ...base, UPSTREAM_URL: url, UPSTREAM_API_KEY: "k", UPSTREAM_PROVIDER: "z-ai" })).toThrow(/UPSTREAM_PROVIDER/);
  });

  it("reads the second RPC and retired key paths", () => {
    const c = loadConfig({ ...base, MONAD_RPC_URL_2: "https://rpc.two", RETIRED_JWK_PATHS: "a.json, b.json" });
    expect(c.rpcUrls).toEqual(["https://rpc.one", "https://rpc.two"]);
    expect(c.retiredJwkPaths).toHaveLength(2);
  });

  it("lists every problem and never echoes secrets", () => {
    const bad = { ...base, OPENROUTER_API_KEY: "", HOST_AGENT_ID: "abc", RELAYER_PRIVATE_KEY: "0xdeadbeefsecret", BATCH_MAX: "0" };
    let msg = "";
    try {
      loadConfig(bad);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("OPENROUTER_API_KEY is required");
    expect(msg).toContain("HOST_AGENT_ID must be a positive integer");
    expect(msg).toContain("RELAYER_PRIVATE_KEY must be 0x + 64 hex");
    expect(msg).toContain("BATCH_MAX must be an integer >= 1");
    expect(msg).not.toContain("deadbeefsecret");
  });

  it("rejects a bad anchor address", () => {
    expect(() => loadConfig({ ...base, ANCHOR_ADDRESS: "0x1234" })).toThrow(/ANCHOR_ADDRESS/);
  });
});

describe("per-host caps", () => {
  it("are unset by default and read when given", () => {
    expect(loadConfig(base)).toMatchObject({ chatLimit: undefined, chatLimitGlobal: undefined, defaultMaxTokens: undefined, maxTokensCap: undefined });
    const c = loadConfig({ ...base, CHAT_LIMIT: "10", CHAT_LIMIT_GLOBAL: "30", DEFAULT_MAX_TOKENS: "256", MAX_TOKENS_CAP: "512" });
    expect(c).toMatchObject({ chatLimit: 10, chatLimitGlobal: 30, defaultMaxTokens: 256, maxTokensCap: 512 });
    expect(() => loadConfig({ ...base, MAX_TOKENS_CAP: "0" })).toThrow(/MAX_TOKENS_CAP/);
  });
});

describe("UPSTREAM_REASONING", () => {
  it("maps off and effort levels, and rejects anything else", () => {
    expect(loadConfig(base).reasoning).toBeUndefined();
    expect(loadConfig({ ...base, UPSTREAM_REASONING: "off" }).reasoning).toEqual({ enabled: false });
    expect(loadConfig({ ...base, UPSTREAM_REASONING: "low" }).reasoning).toEqual({ effort: "low" });
    expect(() => loadConfig({ ...base, UPSTREAM_REASONING: "max" })).toThrow(/UPSTREAM_REASONING/);
  });
});
