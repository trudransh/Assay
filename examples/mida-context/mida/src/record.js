export class RecordError extends Error {
  constructor(message) {
    super(message);
    this.name = "RecordError";
    this.exitCode = 2;
  }
}

// A page came back `partial`: the store's list was incomplete. Callers turn this into the
// section-10 line with their own verb ("written" / "checked"); exit 3.
export class PartialListError extends Error {
  constructor() {
    super("the record list came back incomplete");
    this.name = "PartialListError";
    this.exitCode = 3;
  }
}

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const AGENT_ID = /^erc8004:(\d+):(\d+)$/;
const ZERO_AUTHOR = `0x${"0".repeat(64)}`;
const NAMESPACE = "projects.current";
const PAGE_LIMIT = 65_536;

const short = (id) => (typeof id === "string" && id.length > 12 ? `${id.slice(0, 10)}…` : id);
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// Text that came out of a record, a receipt or another program must never start a new output
// line: a refused record could otherwise print its own "accepted:" line. Every control
// character, line separator and text-direction mark becomes a space.
export const oneLine = (s) =>
  String(s).replace(
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]+/g,
    " ",
  );

// A refusal or error line: one line, and runs of spaces collapsed, so padding cannot push quoted
// text onto a fresh screen row. Never used on the accepted line, whose output is shown as-is.
export const refusalLine = (s) => oneLine(s).replace(/ {2,}/g, " ");

// One refused/ unavailable Mida failure as the section-10 line. The SDK message's final full
// stop is stripped before "Nothing was <verb>." is appended.
export function midaErrorLine(e, verb) {
  const code = typeof e?.code === "string" ? e.code : "failed";
  const kind =
    code === "service-unavailable" || code === "transport-unavailable" ? "unavailable" : "refused";
  const msg = String(e?.message ?? "").replace(/\.$/, "");
  let line = `mida: ${kind} (${code}) — ${msg}. Nothing was ${verb}.`;
  if (code === "rate-limited") line += " One write per minute per agent: wait and run again.";
  return line;
}

// The receipt's body lives inside the signed JWS payload, never in a separate field — any code
// that needs the host id, model or commits decodes it here. `verb` is the caller's word for the
// "Nothing was <verb>." tail of a refusal line.
export function bodyFromJws(jws, verb = "done") {
  const fail = (why) => new RecordError(`assay: the receipt's JWS ${why}. Nothing was ${verb}.`);
  const parts = typeof jws === "string" ? jws.split(".") : [];
  if (parts.length !== 3 || parts.some((p) => p === "")) {
    throw fail("is not a compact three-part string");
  }
  let body;
  try {
    body = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw fail("payload is not base64url JSON");
  }
  if (!isObj(body)) throw fail("payload is not a JSON object");
  return body;
}

// The interop record: ASSAY's own fixture fields (receiptHash … source) plus our marker
// `assayReceipt` and `savedAt` — all of it inside the record's encrypted body. There is no
// `body` field: the receipt body is read from the signed JWS payload by whoever needs it.
// `anchor.contract` is the configured ReceiptAnchor address. No `type` key.
export function buildRecord({ run, anchored, jwks, host, anchor, now }) {
  if (!Array.isArray(run.messages)) {
    throw new RecordError(
      "assay: the record would carry no messages — ASSAY's check cannot open req.commit without them. Nothing was written.",
    );
  }
  const body = bodyFromJws(anchored.jws, "written");
  const m = AGENT_ID.exec(body?.host?.agentId ?? "");
  if (!m) {
    throw new RecordError(
      "assay: the receipt's host.agentId is not erc8004:<chainId>:<agentId>. Nothing was written.",
    );
  }
  // The chain is read from the signed host id, never the run file — a run file that claims a
  // different chain is refused; one that makes no claim still gets the signed chain.
  const chainId = Number(m[1]);
  if (run.chainId !== undefined && run.chainId !== chainId) {
    throw new RecordError(
      `assay: the receipt's host id names chain ${m[1]}, but the run file says chain ${run.chainId}. Nothing was written.`,
    );
  }
  return {
    assayReceipt: 1,
    receiptHash: run.receiptHash,
    chainId,
    jws: anchored.jws,
    jwks,
    anchor: {
      contract: anchor,
      agentId: Number(m[2]),
      root: anchored.root,
      proof: anchored.proof,
      tx: anchored.anchorTx,
    },
    salt: run.salt,
    output: run.output,
    messages: run.messages,
    source: `${host}/v1/receipts/${run.receiptHash}`,
    savedAt: new Date(now ? now() : Date.now()).toISOString(),
  };
}

// R4: who wrote a record is a chain fact — `source` and `author` on the item, never the content.
export function isWrittenBy(item, writerName) {
  return (
    item?.source === "AGENT_INFERRED" &&
    BYTES32.test(item?.author?.id ?? "") &&
    item.author.id.toLowerCase() !== ZERO_AUTHOR &&
    item?.author?.name === writerName
  );
}

// The newest item whose content marks it as a receipt record the writer wrote. Items arrive
// most-recently-anchored first, so the first match in walk order is the newest.
// A record that is not anchored yet has no author on chain, so only the writer's own
// have-I-saved-this check (`allowPending`) may match one; the reader never does.
export function pickRecord(items, { writerName, receiptHash, allowPending = false } = {}) {
  const want = typeof receiptHash === "string" ? receiptHash.toLowerCase() : undefined;
  for (const item of items ?? []) {
    const c = item?.content;
    if (!isObj(c) || c.assayReceipt !== 1) continue;
    if (!allowPending && item?.state !== "anchored") continue;
    if (!isWrittenBy(item, writerName)) continue;
    if (want !== undefined && String(c.receiptHash ?? "").toLowerCase() !== want) continue;
    return item;
  }
  return null;
}

// Pages of projects.current, most-recent first, until the cursor runs out or `until(items)`
// matches. `partial` stops the walk — the list may not be whole.
export async function walkItems(mida, until) {
  const items = [];
  let cursor;
  for (;;) {
    const page = await mida.context({
      namespace: NAMESPACE,
      limit: PAGE_LIMIT,
      ...(cursor ? { cursor } : {}),
    });
    if (page?.partial === true) throw new PartialListError();
    items.push(...(page?.items ?? []));
    if (until && until(items)) return items;
    cursor = page?.cursor ?? null;
    if (!cursor) return items;
  }
}

const unusable = (item, field, why) =>
  new RecordError(
    `read: record ${short(item?.id)} is not a usable receipt record (${field}: ${why}). Nothing was handed on.`,
  );

// R5: copy only the allow-listed fields, each validated. `id`, `author` and `writtenAt` always
// come from the item — the chain — never from the content.
export function parseRecord(item, config) {
  const c = item?.content;
  if (!isObj(c)) throw unusable(item, "content", "not an object");
  if (c.assayReceipt !== 1) throw unusable(item, "assayReceipt", "is not 1");
  if (c.chainId !== config.chainId) {
    throw unusable(item, "chainId", `is ${c.chainId}, this reader checks chain ${config.chainId}`);
  }
  if (!BYTES32.test(c.receiptHash ?? "")) throw unusable(item, "receiptHash", "not 32-byte hex");
  const jwsParts = typeof c.jws === "string" ? c.jws.split(".") : [];
  if (jwsParts.length !== 3 || jwsParts.some((p) => p === "")) {
    throw unusable(item, "jws", "not a three-part string");
  }
  if (!Array.isArray(c.jwks?.keys)) throw unusable(item, "jwks", "jwks.keys is not an array");
  const a = c.anchor;
  if (!isObj(a)) throw unusable(item, "anchor", "not an object");
  if (
    typeof a.contract !== "string" ||
    a.contract.toLowerCase() !== String(config.receiptAnchor).toLowerCase()
  ) {
    throw new RecordError(
      `read: record ${short(item.id)} names ReceiptAnchor ${a.contract}, but this reader checks ${config.receiptAnchor}. Nothing was handed on.`,
    );
  }
  if (!Number.isInteger(a.agentId)) throw unusable(item, "anchor.agentId", "not a number");
  if (!BYTES32.test(a.root ?? "")) throw unusable(item, "anchor.root", "not 32-byte hex");
  if (!Array.isArray(a.proof) || !a.proof.every((p) => BYTES32.test(p))) {
    throw unusable(item, "anchor.proof", "not an array of 32-byte hex");
  }
  if (!BYTES32.test(c.salt ?? "")) throw unusable(item, "salt", "not 32-byte hex");
  if (typeof c.output !== "string") throw unusable(item, "output", "not a string");
  if (!Array.isArray(c.messages)) throw unusable(item, "messages", "not an array");
  const record = {
    assayReceipt: 1,
    receiptHash: c.receiptHash,
    chainId: c.chainId,
    jws: c.jws,
    jwks: c.jwks,
    anchor: { contract: a.contract, agentId: a.agentId, root: a.root, proof: a.proof, tx: a.tx },
    salt: c.salt,
    output: c.output,
    messages: c.messages,
    source: c.source,
    savedAt: c.savedAt,
  };
  return { id: item.id, author: item.author, writtenAt: item.writtenAt, record };
}

// The record stripped to ASSAY's interop field set — what their checkRecord reads and what
// `export` writes. The marker and savedAt are ours; they never leave the Mida record.
export function toInteropRecord(record) {
  return {
    receiptHash: record.receiptHash,
    chainId: record.chainId,
    jws: record.jws,
    jwks: record.jwks,
    anchor: {
      contract: record.anchor.contract,
      agentId: record.anchor.agentId,
      root: record.anchor.root,
      proof: record.anchor.proof,
      tx: record.anchor.tx,
    },
    salt: record.salt,
    output: record.output,
    messages: record.messages,
    source: record.source,
  };
}

// R4 + R5 as one call — the entry point ASSAY's own check can import: the allow-listed record
// plus the item (the author and time the chain recorded). null when nothing qualifies.
export async function readAssayRecord(mida, config, { receiptHash } = {}) {
  let match;
  await walkItems(mida, (items) => {
    match = pickRecord(items, { writerName: config.writerAgent, receiptHash });
    return match != null;
  });
  if (!match) return null;
  return { item: match, ...parseRecord(match, config) };
}
