import { isMidaSdkError } from "@mida-context/sdk";
import {
  PartialListError,
  bodyFromJws,
  midaErrorLine,
  oneLine,
  readAssayRecord,
  refusalLine,
  toInteropRecord,
} from "./record.js";

const short = (id) => (typeof id === "string" && id.length > 12 ? `${id.slice(0, 10)}…` : id);
const shortAddr = (a) => (typeof a === "string" && a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const rpcHost = (rpcUrl) => {
  try {
    return new URL(rpcUrl).host;
  } catch {
    return rpcUrl;
  }
};
const stamp = (writtenAt) => new Date(writtenAt).toISOString().replace(/\.\d{3}Z$/, "Z");
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const refuse = (message, exitCode = 2, outcome = "refused") =>
  Object.assign(new Error(message), { name: "RefusalError", exitCode, outcome });

// The fields ASSAY's checkRecord throws on (instead of returning a verdict) — caught here so a
// bad shape is a refusal, never a crash and never a chain read.
const checkShape = (record) => {
  if (typeof record?.receiptHash !== "string" || !BYTES32.test(record.receiptHash)) {
    return "receiptHash is not a 32-byte hex string";
  }
  if (typeof record?.salt !== "string" || !BYTES32.test(record.salt)) {
    return "salt is not a 32-byte hex string";
  }
  const proof = record?.anchor?.proof;
  if (!Array.isArray(proof) || !proof.every((p) => typeof p === "string" && BYTES32.test(p))) {
    return "anchor.proof is not an array of 32-byte hex";
  }
  let body;
  try {
    body = bodyFromJws(record?.jws);
  } catch {
    return "the signed receipt is not readable";
  }
  for (const block of ["req", "res", "host"]) {
    if (typeof body[block] !== "object" || body[block] === null || Array.isArray(body[block])) {
      return `the signed receipt has no ${block} block`;
    }
  }
  return null;
};

// The pins ASSAY's check reads come from OUR config, never the record: the hosts we accept and,
// per chain, the ReceiptAnchor address and the RPC to read it over. The viem client is ours —
// it is what pins.chains[chainId].rpc would build anyway — so the record can never redirect the
// read. The chain read always runs; a no-chain check would accept a forged record.
export function chainPins(config, client) {
  return {
    trustedHosts: config.trustedHosts,
    chains: { [config.chainId]: { anchor: config.receiptAnchor, rpc: config.rpcUrl } },
    client,
  };
}

// ASSAY's own checkRecord on the interop record, called by both the reader and the writer. A
// throw out of that check (a chain or RPC failure) is exit 4 — never reported as ok — and the
// line carries only the error's name, never its message, the URL's path or the request body.
// `tail` is the caller's closing sentence ("Nothing was written." / "The context was not handed on.").
export async function checkOrRefuse({ assay, record, config, client, tail }) {
  const why = checkShape(record);
  if (why) {
    throw refuse(`check: the record is not usable for ASSAY's check (${why}). ${tail}`);
  }
  let verdict;
  try {
    verdict = await assay.checkRecord(record, chainPins(config, client));
  } catch (e) {
    // Our viem client wraps every network failure in its own error classes, so a bare
    // TypeError, RangeError or SyntaxError here means the check choked on the record itself.
    if (e instanceof TypeError || e instanceof RangeError || e instanceof SyntaxError) {
      throw refuse(
        `refused: ASSAY's check could not process the record for receipt ${short(record.receiptHash)} (${e.name}). ${tail}`,
      );
    }
    throw refuse(
      `chain: could not read ReceiptAnchor at ${shortAddr(config.receiptAnchor)} over ${rpcHost(config.rpcUrl)} (${e?.name ?? "Error"}). ${tail}`,
      4,
      "chain",
    );
  }
  if (verdict?.ok === true && Array.isArray(verdict.reasons) && verdict.reasons.length === 0) {
    return verdict;
  }
  const reasons = Array.isArray(verdict?.reasons)
    ? verdict.reasons.join("; ")
    : "the check returned no reasons";
  throw refuse(
    `refused: ASSAY's check did not pass for receipt ${short(record.receiptHash)} — ${reasons}. ${tail}`,
  );
}

// spec section-5 step 3: find the newest record the chain attributes to the writer, then run
// ASSAY's own checkRecord on it. The output is handed on only when verdict.ok === true AND
// verdict.reasons is empty — anything else prints ASSAY's reasons and exits 2. A throw out of that
// check (a chain or RPC failure) exits 4 and is never reported as ok.
export async function runRead({ config, assay, client, mida, log, receiptHash }) {
  try {
    const found = await readAssayRecord(mida, config, { receiptHash });
    if (!found) {
      throw refuse(
        `read: no record written by ${config.writerAgent} with assayReceipt 1 in projects.current. Nothing was checked.`,
      );
    }
    const { item, id, author, writtenAt, record } = found;
    log(
      `mida: record ${short(id)} written by ${author?.name ?? "unknown"} (${item.source}, ${stamp(writtenAt)}) holds receipt ${short(record.receiptHash)}`,
    );

    const verdict = await checkOrRefuse({
      assay,
      record: toInteropRecord(record),
      config,
      client,
      tail: "The context was not handed on.",
    });
    const body = verdict.body ?? {};
    log(
      oneLine(
        `accepted: host ${body?.host?.agentId} (trusted) served model ${body?.model}; the salt opens the commitments. Output: ${JSON.stringify(record.output)}`,
      ),
    );
    return { exitCode: 0, outcome: "accepted", output: record.output };
  } catch (e) {
    if (e instanceof PartialListError) {
      log(
        "mida: the record list came back incomplete (the store has not verified its newest rows yet). Nothing was checked. Run again in a minute.",
      );
      return { exitCode: 3, outcome: "partial" };
    }
    if (isMidaSdkError(e)) {
      log(refusalLine(midaErrorLine(e, "checked")));
      return { exitCode: 3, outcome: "mida" };
    }
    if (Number.isInteger(e?.exitCode)) {
      log(refusalLine(e.message));
      return { exitCode: e.exitCode, outcome: e.outcome ?? "refused" };
    }
    throw e;
  }
}
