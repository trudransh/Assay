import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AssaySdkError } from "../src/assay-sdk.js";
import { UsageError, main, parseArgs } from "../src/cli.js";

const HASH = "0x9a166cacb2ffe4784ad556f69b690b7cebf71150f737a5a3c324f9e98e7907e5";
const USAGE =
  'usage: node --env-file=.env src/cli.js ask "<prompt>" | write <receiptHash> [--run-file <path>] | read [<receiptHash>] | export [<receiptHash>] [--out <file>]';

describe("parseArgs", () => {
  it("parses the four commands", () => {
    expect(parseArgs(["ask", "Say OK"])).toEqual({ command: "ask", prompt: "Say OK" });
    expect(parseArgs(["write", HASH])).toEqual({ command: "write", receiptHash: HASH });
    expect(parseArgs(["write", HASH, "--run-file", "/x.json"])).toEqual({
      command: "write",
      receiptHash: HASH,
      runFile: "/x.json",
    });
    expect(parseArgs(["read"])).toEqual({ command: "read" });
    expect(parseArgs(["read", HASH])).toEqual({ command: "read", receiptHash: HASH });
    expect(parseArgs(["export"])).toEqual({ command: "export" });
    expect(parseArgs(["export", HASH])).toEqual({ command: "export", receiptHash: HASH });
    expect(parseArgs(["export", "--out", "/x.json"])).toEqual({ command: "export", outFile: "/x.json" });
    expect(parseArgs(["export", HASH, "--out", "/x.json"])).toEqual({
      command: "export",
      receiptHash: HASH,
      outFile: "/x.json",
    });
  });

  it("rejects bad shapes with the usage line, exit 1", () => {
    for (const argv of [
      ["ask"], ["write"], ["write", "0x12"], ["read", "0x12"], ["nope"], ["ask", "a", "b"],
      ["write", HASH, "--run-file"],
      ["export", "--out"], ["export", "--out", ""],
      ["export", "0x12", "--out", "/x.json"], ["export", HASH, "/x.json"], ["export", "--out", "/x.json", "extra"],
      ["export", "0x12"],
    ]) {
      try {
        parseArgs(argv);
        throw new Error(`no throw for ${argv}`);
      } catch (e) {
        expect(e).toBeInstanceOf(UsageError);
        expect(e.message).toBe(USAGE);
        expect(e.exitCode).toBe(1);
      }
    }
  });
});

describe("main", () => {
  const env = (dir) => ({
    MIDA_HOME: join(dir, "mida"),
    ASSAY_WRITER_AGENT: "assay-writer",
    ASSAY_READER_AGENT: "assay-reader",
    MIDA_PROJECT: dir,
    ASSAY_SDK_DIR: "unused-sdk",
  });

  const deps = (over = {}) => ({
    loadAssaySdk: async () => ({ checkRecord: async () => ({ ok: false, reasons: [] }) }),
    createMida: (agent) => {
      over.midaAgents?.push(agent);
      return {
        context: async () => ({ items: [], cursor: null, otherTasks: [] }),
        status: async () => ({
          up: true,
          text: "midad: answering — pid 42, up since 2026-10-09T10:00:00Z, queue 0 — test socket\nassay-writer: approved for this folder",
        }),
        remember: async () => ({ id: "0x" + "11".repeat(32), state: "anchored" }),
      };
    },
    createClient: () => ({ fake: "client" }),
    fetchImpl: async () => ({ status: 200, ok: true, json: async () => ({}) }),
    ...over,
  });

  it("prints the usage line and exits 1 on bad argv", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mida-cli-"));
    const lines = [];
    let code;
    await main(["nope"], env(dir), { ...deps(), log: (l) => lines.push(l), exit: (c) => (code = c) });
    expect(code).toBe(1);
    expect(lines).toEqual([USAGE]);
  });

  it("prints the SDK line and exits 1 when the ASSAY SDK is missing, before any Mida handle", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mida-cli-"));
    const midaAgents = [];
    const lines = [];
    let code;
    await main(["read"], env(dir), {
      ...deps({ midaAgents }),
      loadAssaySdk: async () => {
        throw new AssaySdkError(
          "assay: the ASSAY SDK is not built at unused-sdk/dist. At the repository root run: npx --yes pnpm@10.20.0 install --frozen-lockfile && npx --yes pnpm@10.20.0 --filter @assay/receipts build. Nothing was done.",
        );
      },
      log: (l) => lines.push(l),
      exit: (c) => (code = c),
    });
    expect(code).toBe(1);
    expect(lines.at(-1)).toContain("the ASSAY SDK is not built");
    expect(midaAgents).toHaveLength(0);
  });

  it("read and export use the reader agent, write uses the writer agent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mida-cli-"));
    const midaAgents = [];
    let code;
    await main(["read"], env(dir), {
      ...deps({ midaAgents }),
      log: () => {},
      exit: (c) => (code = c),
    });
    expect(code).toBe(2);
    expect(midaAgents).toEqual(["assay-reader"]);
    await main(["export", "--out", join(dir, "r.json")], env(dir), {
      ...deps({ midaAgents }),
      log: () => {},
      exit: (c) => (code = c),
    });
    expect(code).toBe(2);
    expect(midaAgents).toEqual(["assay-reader", "assay-reader"]);
    await main(["write", HASH], env(dir), {
      ...deps({ midaAgents }),
      log: () => {},
      exit: (c) => (code = c),
    });
    expect(code).toBe(2);
    expect(midaAgents).toEqual(["assay-reader", "assay-reader", "assay-writer"]);
  });

  it("a child process on an env parsed from the real .env.example prints usage, exit 1", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mida-cli-env-"));
    try {
      // the exact env the owner gets from copying .env.example — every optional key empty
      const text = await readFile(new URL("../.env.example", import.meta.url), "utf8");
      const env = {};
      for (const line of text.split("\n")) {
        const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
        if (m) env[m[1]] = m[2];
      }
      env.MIDA_HOME = join(dir, "mida");
      const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));
      const r = spawnSync(process.execPath, [cliPath, "bogus"], { encoding: "utf8", env });
      expect(r.status, `stdout=${r.stdout} stderr=${r.stderr}`).toBe(1);
      expect(r.stdout).toContain(USAGE);
      expect(r.stderr).toBe("");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("run through a symlink still reaches main — usage line, exit 1", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mida-cli-link-"));
    try {
      const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));
      const link = join(dir, "linked-cli.js");
      await symlink(cliPath, link);
      for (const invoked of [cliPath, link]) {
        const r = spawnSync(process.execPath, [invoked, "bogus"], { encoding: "utf8" });
        expect(r.status, `entry ${invoked}: stdout=${r.stdout} stderr=${r.stderr}`).toBe(1);
        expect(r.stdout).toContain(USAGE);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
