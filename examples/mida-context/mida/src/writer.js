import { join } from "node:path";
import { MidaSdkError, isMidaSdkError } from "@mida-context/sdk";
import { RunFileError, fetchJwks, fetchReceipt, readRunFile } from "./host.js";
import { checkOrRefuse } from "./reader.js";
import {
  PartialListError,
  bodyFromJws,
  buildRecord,
  midaErrorLine,
  oneLine,
  pickRecord,
  refusalLine,
  toInteropRecord,
  walkItems,
} from "./record.js";

const AGENT_ID = /^erc8004:(\d+):(\d+)$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const short = (id) => (typeof id === "string" && id.length > 12 ? `${id.slice(0, 10)}…` : id);
const refuse = (message) => Object.assign(new Error(message), { name: "RefusalError", exitCode: 2 });

// spec section-5 step 2: everything the run file claims is re-derived before one record is
// written, and the same receipt is never saved twice. Every refusal maps to one section-10 line.
export async function runWrite({ config, assay, client, fetchImpl, mida, log, now, receiptHash, runFile }) {
  try {
    const run = await loadRun({ config, receiptHash, runFile });
    if (String(run.receiptHash).toLowerCase() !== String(receiptHash).toLowerCase()) {
      throw refuse(
        `write: the run file names receipt ${short(run.receiptHash)}, not ${short(receiptHash)}. Nothing was written.`,
      );
    }
    if (run.chainId !== config.chainId) {
      throw refuse(
        `write: receipt ${short(receiptHash)} is from chain ${run.chainId}; this folder is configured for chain ${config.chainId}. Nothing was written.`,
      );
    }
    if (!Array.isArray(run.messages)) {
      throw refuse(
        `write: the run file for ${short(run.receiptHash)} carries no messages; ASSAY's check cannot open req.commit without them. Nothing was written.`,
      );
    }
    if (!BYTES32.test(run.salt ?? "")) {
      throw refuse(
        `write: the salt in the run file for ${short(receiptHash)} is not 32-byte hex. Nothing was written.`,
      );
    }

    const anchored = await fetchReceipt({ fetchImpl, host: config.host, receiptHash: run.receiptHash });
    if (anchored.status === "pending") {
      throw refuse(
        `assay: receipt ${short(run.receiptHash)} is not anchored yet (the host says pending). Nothing was written. Try again in about 30 s.`,
      );
    }
    const body = bodyFromJws(anchored.jws, "written");
    if (assay.receiptHash(body) !== run.receiptHash) {
      throw refuse(
        `assay: the host returned a body that does not hash to ${short(run.receiptHash)}. Nothing was written.`,
      );
    }
    const m = AGENT_ID.exec(body?.host?.agentId ?? "");
    log(
      oneLine(
        `assay: the host reports receipt ${short(run.receiptHash)} anchored under host ${m?.[2] ?? body?.host?.agentId} — root ${short(anchored.root)}, tx ${short(anchored.anchorTx)}`,
      ),
    );

    if (assay.commitResponse(run.salt, run.output) !== body.res.commit) {
      throw refuse(
        `assay: the salt in the run file does not open res.commit for receipt ${short(run.receiptHash)}. Nothing was written.`,
      );
    }
    if (assay.commitRequest(run.salt, run.messages, body.req.params) !== body.req.commit) {
      throw refuse(
        `assay: the messages in the run file do not open req.commit for receipt ${short(run.receiptHash)}. Nothing was written.`,
      );
    }

    const jwks = await fetchJwks({ fetchImpl, host: config.host });

    const status = await mida.status();
    if (status?.up === false) {
      throw new MidaSdkError("service-unavailable", status.text || "the Mida service is not answering");
    }
    log(`mida: ${status.text}`);

    let already;
    await walkItems(
      mida,
      (items) =>
        (already = pickRecord(items, {
          writerName: config.writerAgent,
          receiptHash: run.receiptHash,
          allowPending: true,
        })) != null,
    );
    if (already) {
      log(
        `already recorded: Mida record ${short(already.id)} holds receipt ${short(run.receiptHash)}. Nothing was written.`,
      );
      return { exitCode: 0, outcome: "already-recorded" };
    }

    const content = buildRecord({
      run,
      anchored,
      jwks,
      host: config.host,
      anchor: config.receiptAnchor,
      now,
    });
    // The record is only worth saving if ASSAY's own check accepts it — the same check the
    // reader runs, chain read on. A record that check would refuse is never written.
    await checkOrRefuse({
      assay,
      record: toInteropRecord(content),
      config,
      client,
      tail: "Nothing was written.",
    });
    log(`assay: check passed for receipt ${short(run.receiptHash)} — the record is one the reader will accept`);
    const saved = await mida.remember({ namespace: "projects.current", kind: "EPISODE", content });
    if (saved.state === "pending") {
      log(
        `recorded: Mida record ${short(saved.id)} (pending) in projects.current — it anchors with the next batch.`,
      );
      return { exitCode: 0, outcome: "pending" };
    }
    log(
      `recorded: Mida record ${short(saved.id)} (anchored) in projects.current, author ${config.writerAgent} — receipt ${short(run.receiptHash)}, salt and output inside the encrypted body`,
    );
    return { exitCode: 0, outcome: "recorded" };
  } catch (e) {
    if (e instanceof PartialListError) {
      log(
        "mida: the record list came back incomplete (the store has not verified its newest rows yet). Nothing was written. Run again in a minute.",
      );
      return { exitCode: 3, outcome: "partial" };
    }
    if (isMidaSdkError(e)) {
      log(refusalLine(midaErrorLine(e, "written")));
      return { exitCode: 3, outcome: "mida" };
    }
    if (Number.isInteger(e?.exitCode)) {
      log(refusalLine(e.message));
      return { exitCode: e.exitCode, outcome: e.outcome ?? "refused" };
    }
    throw e;
  }
}

async function loadRun({ config, receiptHash, runFile }) {
  const path = runFile ?? join(config.runsDir, `${receiptHash}.json`);
  try {
    return await readRunFile(path);
  } catch (e) {
    if (e instanceof RunFileError && e.missing) {
      throw refuse(
        `write: no runs/${short(receiptHash)}.json — run ask first, or pass --run-file <path>. Nothing was written.`,
      );
    }
    throw e;
  }
}
