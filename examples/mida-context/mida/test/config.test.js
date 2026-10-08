import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ConfigError, loadConfig } from "../src/config.js";

const FOLDER = path.resolve(import.meta.dirname, "..");
const SDK = path.resolve(import.meta.dirname, "../../../../sdk");
const HOME = "/Users/test/.mida-assay";

function problem(env) {
  try {
    loadConfig(env);
  } catch (e) {
    return e;
  }
  throw new Error("loadConfig did not throw");
}

describe("loadConfig", () => {
  it("refuses a missing MIDA_HOME", () => {
    const e = problem({});
    expect(e).toBeInstanceOf(ConfigError);
    expect(e.exitCode).toBe(1);
    expect(e.message).toBe(
      "config: MIDA_HOME is missing or invalid (an absolute path). Nothing was done.",
    );
  });

  it("refuses a relative MIDA_HOME", () => {
    const e = problem({ MIDA_HOME: "relative/x" });
    expect(e).toBeInstanceOf(ConfigError);
    expect(e.message).toBe(
      "config: MIDA_HOME is missing or invalid (an absolute path). Nothing was done.",
    );
  });

  it("returns defaults with only MIDA_HOME set", () => {
    expect(loadConfig({ MIDA_HOME: HOME })).toEqual({
      midaHome: HOME,
      writerAgent: "assay-writer",
      readerAgent: "assay-reader",
      projectDir: FOLDER,
      host: "https://34-45-1-81.sslip.io",
      receiptAnchor: "0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24",
      trustedHosts: ["erc8004:10143:1962"],
      chainId: 10143,
      sdkDir: SDK,
      rpcUrl: "https://testnet-rpc.monad.xyz",
      runsDir: path.join(FOLDER, "runs"),
      exportsDir: path.join(FOLDER, "exports"),
    });
  });

  it("runs/ and exports/ always live in this folder, even when MIDA_PROJECT points away", () => {
    const cfg = loadConfig({ MIDA_HOME: HOME, MIDA_PROJECT: "/some/other/folder" });
    expect(cfg.projectDir).toBe("/some/other/folder");
    expect(cfg.runsDir).toBe(path.join(FOLDER, "runs"));
    expect(cfg.exportsDir).toBe(path.join(FOLDER, "exports"));
  });

  it("loads the real .env.example with only MIDA_HOME filled in — empty means not set", async () => {
    const text = await readFile(new URL("../.env.example", import.meta.url), "utf8");
    const env = {};
    for (const line of text.split("\n")) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (m) env[m[1]] = m[2];
    }
    // the example ships every optional key as an empty value — each must read as "not set"
    expect(env.ASSAY_TRUSTED_HOSTS).toBe("");
    expect(env.ASSAY_CHAIN_ID).toBe("");
    env.MIDA_HOME = HOME;
    expect(loadConfig(env)).toEqual(loadConfig({ MIDA_HOME: HOME }));
  });

  it("refuses identical writer and reader names", () => {
    const e = problem({
      MIDA_HOME: HOME,
      ASSAY_WRITER_AGENT: "assay-x",
      ASSAY_READER_AGENT: "assay-x",
    });
    expect(e.message).toBe(
      "config: ASSAY_READER_AGENT and ASSAY_WRITER_AGENT must be different agents (a record cannot vouch for itself). Nothing was done.",
    );
  });

  it("refuses a malformed reader name", () => {
    const e = problem({ MIDA_HOME: HOME, ASSAY_READER_AGENT: "Bad_Name" });
    expect(e.message).toBe(
      "config: ASSAY_READER_AGENT is missing or invalid (1–40 lowercase letters, digits or dashes). Nothing was done.",
    );
  });

  it("refuses a malformed writer name", () => {
    const e = problem({ MIDA_HOME: HOME, ASSAY_WRITER_AGENT: "Bad_Name" });
    expect(e.message).toBe(
      "config: ASSAY_WRITER_AGENT is missing or invalid (1–40 lowercase letters, digits or dashes). Nothing was done.",
    );
  });

  it("refuses a non-address anchor, and checksums a valid one", () => {
    const e = problem({ MIDA_HOME: HOME, ASSAY_RECEIPT_ANCHOR: "hello" });
    expect(e.message).toBe(
      "config: ASSAY_RECEIPT_ANCHOR is missing or invalid (a 0x address). Nothing was done.",
    );
    const cfg = loadConfig({
      MIDA_HOME: HOME,
      ASSAY_RECEIPT_ANCHOR: "0x63e4f42e6d254ed6aae735f9f4169bbfd12c1a24",
    });
    expect(cfg.receiptAnchor).toBe("0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24");
  });

  it("parses a comma-separated trusted-host list, trimming spaces", () => {
    const cfg = loadConfig({
      MIDA_HOME: HOME,
      ASSAY_TRUSTED_HOSTS: "erc8004:10143:1962, erc8004:10143:10278",
    });
    expect(cfg.trustedHosts).toEqual(["erc8004:10143:1962", "erc8004:10143:10278"]);
  });

  it("refuses a trusted-host value that is not erc8004:<chainId>:<id>", () => {
    const e = problem({ MIDA_HOME: HOME, ASSAY_TRUSTED_HOSTS: "1962" });
    expect(e.message).toBe(
      "config: ASSAY_TRUSTED_HOSTS is missing or invalid (comma-separated erc8004:<chainId>:<agentId> values). Nothing was done.",
    );
  });

  it("refuses a non-numeric chain id", () => {
    const e = problem({ MIDA_HOME: HOME, ASSAY_CHAIN_ID: "abc" });
    expect(e.message).toBe(
      "config: ASSAY_CHAIN_ID is missing or invalid (a whole number). Nothing was done.",
    );
    expect(loadConfig({ MIDA_HOME: HOME, ASSAY_CHAIN_ID: "10143" }).chainId).toBe(10143);
  });

  it("refuses a non-http(s) host and strips a trailing slash", () => {
    const e = problem({ MIDA_HOME: HOME, ASSAY_HOST: "ftp://x" });
    expect(e.message).toBe(
      "config: ASSAY_HOST is missing or invalid (an http or https URL). Nothing was done.",
    );
    const cfg = loadConfig({ MIDA_HOME: HOME, ASSAY_HOST: "https://x.test/" });
    expect(cfg.host).toBe("https://x.test");
  });

  it("never reads process.env when an env object is given", () => {
    expect(problem({})).toBeInstanceOf(ConfigError);
  });

  // review 2 M3: the chain id, the ReceiptAnchor address, the RPC and the trusted hosts are one
  // setting. Changing only the chain id used to keep testnet's address and RPC, so a "mainnet"
  // reader would have read testnet and said accepted.
  it("refuses another chain id unless the anchor, the RPC and the trusted hosts are all given", () => {
    const base = { MIDA_HOME: "/h", ASSAY_CHAIN_ID: "143" };
    const full = {
      ...base,
      ASSAY_RECEIPT_ANCHOR: "0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24",
      MONAD_RPC_URL: "https://rpc.example",
      ASSAY_TRUSTED_HOSTS: "erc8004:143:7",
    };
    expect(loadConfig(full).chainId).toBe(143);
    for (const missing of ["ASSAY_RECEIPT_ANCHOR", "MONAD_RPC_URL", "ASSAY_TRUSTED_HOSTS"]) {
      const env = { ...full };
      delete env[missing];
      expect(() => loadConfig(env), missing).toThrow(
        `config: ${missing} is missing or invalid (required when ASSAY_CHAIN_ID is not 10143: the testnet default is never reused on another chain). Nothing was done.`,
      );
    }
  });

  it("refuses a trusted host on a different chain than ASSAY_CHAIN_ID", () => {
    expect(() => loadConfig({ MIDA_HOME: "/h", ASSAY_TRUSTED_HOSTS: "erc8004:1:5" })).toThrow(
      "config: ASSAY_TRUSTED_HOSTS is missing or invalid (every host must be on chain 10143, the configured ASSAY_CHAIN_ID). Nothing was done.",
    );
  });
});
