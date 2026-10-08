import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bodyFromJws, oneLine } from "./record.js";

export class HostError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.name = "HostError";
    this.exitCode = exitCode;
  }
}

export class RunFileError extends Error {
  constructor(message, opts = {}) {
    super(message);
    this.name = "RunFileError";
    this.exitCode = 2;
    this.missing = opts.missing === true;
  }
}

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const AGENT_ID = /^erc8004:(\d+):(\d+)$/;

export const short = (id) => (typeof id === "string" && id.length > 12 ? `${id.slice(0, 10)}…` : id);

const hostName = (host) => {
  try {
    return new URL(host).host;
  } catch {
    return host;
  }
};

const unreachable = (host, e, verb) =>
  new HostError(
    `assay: could not reach the host at ${hostName(host)} (${e?.name ?? "Error"}). Nothing was ${verb}.`,
    4,
  );

// `ask` through their wrap(): one POST to /v1/chat/completions with a fresh salt. Returns every
// field the run file needs except `assayRun` and `host`, which writeRunFile/the caller adds.
export async function askHost({ assay, fetchImpl, host, prompt, now }) {
  const messages = [{ role: "user", content: prompt }];
  const params = { max_tokens: 64, temperature: 0 };
  const seen = {};
  const spy = async (url, init) => {
    const r = await fetchImpl(url, init);
    seen.res = r;
    return r;
  };
  let result;
  try {
    result = await assay.wrap(spy)(`${host}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages, ...params }),
    });
  } catch (e) {
    if (seen.res && seen.res.ok === false) {
      const head = `assay: the host answered HTTP ${seen.res.status} and signed no receipt. Nothing was saved.`;
      let detail = "";
      try {
        const j = await seen.res.json();
        if (typeof j?.error?.message === "string") detail = oneLine(j.error.message.slice(0, 120));
      } catch {
        // A non-JSON refusal body is not quoted.
      }
      throw new HostError(detail ? `${head}\n${detail}` : head, 4);
    }
    if (typeof e?.message === "string" && e.message.includes("X-Assay-Receipt header")) {
      throw new HostError(
        `assay: the answer carried no receipt (is ${hostName(host)} an ASSAY host?). Nothing was saved.`,
        4,
      );
    }
    throw unreachable(host, e, "saved");
  }
  if (result.outputCommitOk !== true) {
    throw new HostError(
      "assay: the host's res.commit does not match the output it returned. Nothing was saved.",
      2,
    );
  }
  const { jws, hash } = result.receipt;
  const body = bodyFromJws(jws, "saved");
  const m = AGENT_ID.exec(body?.host?.agentId ?? "");
  if (!m) {
    throw new HostError(
      "assay: the receipt's host.agentId is not erc8004:<chainId>:<agentId>. Nothing was saved.",
      2,
    );
  }
  const output = assay.assistantOutput(result.json?.choices?.[0]?.message);
  return {
    receiptHash: hash,
    chainId: Number(m[1]),
    jws,
    salt: result.salt,
    output,
    messages,
    params,
    askedAt: new Date(now ? now() : Date.now()).toISOString(),
  };
}

// `write`: GET /v1/receipts/<hash>. 404 and pending get their own exit codes; anything else is
// the unreachable line, which never quotes a body.
export async function fetchReceipt({ fetchImpl, host, receiptHash }) {
  let r;
  try {
    r = await fetchImpl(`${host}/v1/receipts/${receiptHash}`);
  } catch (e) {
    throw unreachable(host, e, "written");
  }
  if (r.status === 404) {
    throw new HostError(
      `assay: the host does not know receipt ${short(receiptHash)}. Nothing was written.`,
      2,
    );
  }
  if (!r.ok) {
    throw new HostError(
      `assay: could not reach the host at ${hostName(host)} (HTTP ${r.status}). Nothing was written.`,
      4,
    );
  }
  let j;
  try {
    j = await r.json();
  } catch (e) {
    throw unreachable(host, e, "written");
  }
  if (j?.status === "pending") return { status: "pending" };
  // Only a complete "anchored" answer counts — "signed", "failed" or a missing field means the
  // receipt is not usable for a record, and a true line beats a silent mis-parse.
  const bad = [];
  if (j?.status !== "anchored") {
    bad.push(`status ${JSON.stringify(j?.status ?? null)}, not "anchored"`);
  } else {
    if (typeof j.jws !== "string" || j.jws === "") bad.push("no usable jws");
    if (!BYTES32.test(j.root ?? "")) bad.push("no usable root");
    if (!Array.isArray(j.proof)) bad.push("no usable proof");
    if (typeof j.anchorTx !== "string" || j.anchorTx === "") bad.push("no usable anchorTx");
  }
  if (bad.length !== 0) {
    throw new HostError(
      `assay: the host's answer for receipt ${short(receiptHash)} is not usable (${bad.join("; ")}). Nothing was written.`,
      2,
    );
  }
  return {
    status: "anchored",
    jws: j.jws,
    root: j.root,
    proof: j.proof,
    anchorTx: j.anchorTx,
  };
}

export async function fetchJwks({ fetchImpl, host }) {
  let r;
  try {
    r = await fetchImpl(`${host}/.well-known/jwks.json`);
  } catch (e) {
    throw unreachable(host, e, "written");
  }
  if (!r.ok) {
    throw new HostError(
      `assay: could not reach the host at ${hostName(host)} (HTTP ${r.status}). Nothing was written.`,
      4,
    );
  }
  try {
    return await r.json();
  } catch (e) {
    throw unreachable(host, e, "written");
  }
}

// runs/<receiptHash>.json — mode 600 through a temp file and a rename. The run object the caller
// hands in already carries `host`; this stamps `assayRun: 1` and refuses a bad hash.
export async function writeRunFile(dir, run) {
  if (!BYTES32.test(run?.receiptHash ?? "")) {
    throw new RunFileError(
      `write: the run file for ${short(run?.receiptHash)} is not usable (receiptHash is not 32-byte hex). Nothing was written.`,
    );
  }
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${run.receiptHash}.json`);
  const tmp = join(dir, `.${run.receiptHash}.tmp`);
  await writeFile(tmp, `${JSON.stringify({ assayRun: 1, ...run }, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, path);
  return path;
}

export async function readRunFile(path) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    throw new RunFileError(
      `write: could not read the run file at ${path} (${e?.code ?? e?.name ?? "Error"}). Nothing was written.`,
      { missing: e?.code === "ENOENT" },
    );
  }
  let file;
  try {
    file = JSON.parse(raw);
  } catch {
    throw new RunFileError(
      `write: the run file at ${path} is not usable (not JSON). Nothing was written.`,
    );
  }
  const why =
    file?.assayRun !== 1
      ? "assayRun is not 1"
      : !BYTES32.test(file?.receiptHash ?? "")
        ? "receiptHash is not 32-byte hex"
        : undefined;
  if (why) {
    throw new RunFileError(
      `write: the run file at ${path} is not usable (${why}). Nothing was written.`,
    );
  }
  return file;
}
