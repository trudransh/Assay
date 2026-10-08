import { link, mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { isMidaSdkError } from "@mida-context/sdk";
import { checkOrRefuse } from "./reader.js";
import {
  PartialListError,
  midaErrorLine,
  readAssayRecord,
  refusalLine,
  toInteropRecord,
} from "./record.js";

const short = (id) => (typeof id === "string" && id.length > 12 ? `${id.slice(0, 10)}…` : id);
const stamp = (writtenAt) => new Date(writtenAt).toISOString().replace(/\.\d{3}Z$/, "Z");
const refuse = (message, exitCode = 2, outcome = "refused") =>
  Object.assign(new Error(message), { name: "RefusalError", exitCode, outcome });

// `export [<receiptHash>] --out <file>`: the same pick as `read` (the newest record the chain
// attributes to the writer), written out in ASSAY's interop field set so their
// examples/mida-context/check.mts can check it. ASSAY's check runs first, chain read on, so a
// record the reader would refuse is never written out. The file holds the salt — mode 600, written
// atomically through a hard link, never overwritten.
export async function runExport({ config, assay, client, mida, log, receiptHash, outFile }) {
  try {
    const found = await readAssayRecord(mida, config, { receiptHash });
    if (!found) {
      throw refuse(
        `export: no record written by ${config.writerAgent} with assayReceipt 1 in projects.current. Nothing was exported.`,
      );
    }
    const { item, id, author, writtenAt, record } = found;
    log(
      `mida: record ${short(id)} written by ${author?.name ?? "unknown"} (${item.source}, ${stamp(writtenAt)}) holds receipt ${short(record.receiptHash)}`,
    );
    const interop = toInteropRecord(record);
    await checkOrRefuse({ assay, record: interop, config, client, tail: "Nothing was exported." });
    const target = await outPath(config.exportsDir, outFile, record.receiptHash);
    await writeInteropFile(target, interop);
    log(
      `exported: ${target} — this file contains the salt; it must not be published unless the call was a test.`,
    );
    return { exitCode: 0, outcome: "exported", file: target };
  } catch (e) {
    if (e instanceof PartialListError) {
      log(
        "mida: the record list came back incomplete (the store has not verified its newest rows yet). Nothing was exported. Run again in a minute.",
      );
      return { exitCode: 3, outcome: "partial" };
    }
    if (isMidaSdkError(e)) {
      log(refusalLine(midaErrorLine(e, "exported")));
      return { exitCode: 3, outcome: "mida" };
    }
    if (Number.isInteger(e?.exitCode)) {
      log(refusalLine(e.message));
      return { exitCode: e.exitCode, outcome: e.outcome ?? "refused" };
    }
    throw e;
  }
}

// Where the export lands: no --out means exports/<receiptHash>.json, a bare name means
// exports/<name> — both under the package's gitignored folder. An absolute path or one with a
// directory part is used exactly as given.
async function outPath(exportsDir, outFile, receiptHash) {
  const target =
    outFile === undefined || outFile === null || outFile === ""
      ? join(exportsDir, `${receiptHash}.json`)
      : isAbsolute(outFile) || outFile.includes("/") || outFile.includes("\\")
        ? resolve(outFile)
        : join(exportsDir, outFile);
  if (dirname(target) === exportsDir) await mkdir(exportsDir, { recursive: true });
  return target;
}

// Write through a same-directory temp file, then link() it into place: the target appears whole
// or not at all, and link() refusing EEXIST means an existing file is never overwritten. The
// mode comes from the temp file, which is 600.
async function writeInteropFile(outFile, interop) {
  const target = resolve(outFile);
  const dir = dirname(target);
  const tmp = join(dir, `.${basename(target)}.${process.pid}.tmp`);
  try {
    await writeFile(tmp, `${JSON.stringify(interop, null, 2)}\n`, { mode: 0o600 });
  } catch (e) {
    throw refuse(`export: could not write ${outFile} (${e?.code ?? e?.name ?? "Error"}). Nothing was exported.`);
  }
  try {
    await link(tmp, target);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    if (e?.code === "EEXIST") {
      throw refuse(`export: ${outFile} already exists — the file is never overwritten. Nothing was exported.`);
    }
    throw refuse(`export: could not write ${outFile} (${e?.code ?? e?.name ?? "Error"}). Nothing was exported.`);
  }
  await unlink(tmp);
}
