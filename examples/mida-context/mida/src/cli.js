import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Mida } from "@mida-context/sdk";
import { createPublicClient, http } from "viem";
import { monadTestnet } from "viem/chains";
import { loadAssaySdk } from "./assay-sdk.js";
import { loadConfig } from "./config.js";
import { askHost, short, writeRunFile } from "./host.js";
import { runExport } from "./exporter.js";
import { bodyFromJws, oneLine } from "./record.js";
import { runRead } from "./reader.js";
import { runWrite } from "./writer.js";

const USAGE =
  'usage: node --env-file=.env src/cli.js ask "<prompt>" | write <receiptHash> [--run-file <path>] | read [<receiptHash>] | export [<receiptHash>] [--out <file>]';
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

export class UsageError extends Error {
  constructor() {
    super(USAGE);
    this.name = "UsageError";
    this.exitCode = 1;
  }
}

export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === "ask") {
    if (rest.length === 1 && rest[0] !== "") return { command: "ask", prompt: rest[0] };
    throw new UsageError();
  }
  if (cmd === "write") {
    if (rest.length >= 1 && BYTES32.test(rest[0])) {
      if (rest.length === 1) return { command: "write", receiptHash: rest[0] };
      if (rest.length === 3 && rest[1] === "--run-file" && rest[2] !== "") {
        return { command: "write", receiptHash: rest[0], runFile: rest[2] };
      }
    }
    throw new UsageError();
  }
  if (cmd === "read") {
    if (rest.length === 0) return { command: "read" };
    if (rest.length === 1 && BYTES32.test(rest[0])) return { command: "read", receiptHash: rest[0] };
    throw new UsageError();
  }
  if (cmd === "export") {
    const [a, b, c] = rest;
    if (rest.length === 0) return { command: "export" };
    if (rest.length === 1 && BYTES32.test(a)) {
      return { command: "export", receiptHash: a };
    }
    if (rest.length === 2 && a === "--out" && b !== "" && b !== undefined) {
      return { command: "export", outFile: b };
    }
    if (rest.length === 3 && BYTES32.test(a) && b === "--out" && c !== "" && c !== undefined) {
      return { command: "export", receiptHash: a, outFile: c };
    }
    throw new UsageError();
  }
  throw new UsageError();
}

export async function main(argv, env = process.env, deps = {}) {
  // Every message leaves through here on one line: nothing a host, a record or another program
  // sent can start an output line of its own.
  const print = deps.log ?? ((line) => console.log(line));
  const log = (line) => print(oneLine(line));
  const exit = deps.exit ?? ((code) => process.exit(code));
  const createMida =
    deps.createMida ??
    ((agent, config) => new Mida({ agent, home: config.midaHome, project: config.projectDir }));
  const createClient =
    deps.createClient ??
    ((config) =>
      createPublicClient({
        ...(config.chainId === monadTestnet.id ? { chain: monadTestnet } : {}),
        transport: http(config.rpcUrl),
      }));
  const fetchImpl = deps.fetchImpl ?? fetch;

  let code = 1;
  try {
    const args = parseArgs(argv);
    const config = (deps.loadConfig ?? loadConfig)(env);
    const assay = await (deps.loadAssaySdk ?? loadAssaySdk)(config.sdkDir);
    if (args.command === "ask") {
      const run = await askHost({ assay, fetchImpl, host: config.host, prompt: args.prompt });
      await writeRunFile(config.runsDir, { host: config.host, ...run });
      const body = bodyFromJws(run.jws, "saved");
      log(
        `asked: receipt ${short(run.receiptHash)} from host ${body.host.agentId}, model ${body.model} — output ${JSON.stringify(run.output)} (${body.res.tokensIn} tokens in, ${body.res.tokensOut} out)`,
      );
      log(
        `saved: runs/${run.receiptHash}.json holds the salt and the output (mode 600; never commit it). The host anchors every ~30 s; then run: write ${run.receiptHash}`,
      );
      code = 0;
    } else if (args.command === "write") {
      const mida = createMida(config.writerAgent, config);
      const client = createClient(config);
      const r = await runWrite({
        config,
        assay,
        client,
        fetchImpl,
        mida,
        log,
        receiptHash: args.receiptHash,
        runFile: args.runFile,
      });
      code = r.exitCode;
    } else if (args.command === "export") {
      const mida = createMida(config.readerAgent, config);
      const client = createClient(config);
      const r = await runExport({
        config,
        assay,
        client,
        mida,
        log,
        receiptHash: args.receiptHash,
        outFile: args.outFile,
      });
      code = r.exitCode;
    } else {
      const mida = createMida(config.readerAgent, config);
      const client = createClient(config);
      const r = await runRead({ config, assay, client, mida, log, receiptHash: args.receiptHash });
      code = r.exitCode;
    }
  } catch (e) {
    if (Number.isInteger(e?.exitCode)) {
      log(e.message);
      code = e.exitCode;
    } else {
      log(`unexpected: ${e?.name ?? "Error"}. Nothing more was done.`);
      code = 1;
    }
  }
  exit(code);
}

// Compare real paths: argv[1] may be a symlink to this file, and a string compare would leave
// the entry point silent (exits 0, prints nothing).
const isMain = (() => {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) await main(process.argv.slice(2));
