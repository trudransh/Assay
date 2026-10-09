// Pay per verified answer: buy N answers from Assay host 10316 (Kimi K2.6, Monad mainnet) and settle only what verifies.
//   npm install assay-receipts viem && node job.mjs 10
// Prints one line per receipt and the job's deliverableHash (the Merkle root over its receipt hashes).
// Pay for each line with ok=true. Keep job.json private: it holds the salts that let you re-prove any line later.
import { wrap, hostGradeCheck, verifyReceipt, buildBatch, waitForAnchor } from "assay-receipts";
import { createPublicClient, http } from "viem";
import { writeFileSync } from "node:fs";

const N = Number(process.argv[2] ?? 10);
const MAX_TOKENS = 256;
const HOST = "https://34-45-1-81.sslip.io/kimi";
const ANCHOR = "0x049A73755cA3508ef3Daa4752A3406f6e00CfB13"; // ReceiptAnchor, Monad mainnet
const VERIFIER = "0x4BaC2Be288B5931886EeC4c555895CE6BcAB19e7";
const client = createPublicClient({ transport: http("https://rpc.monad.xyz") });

// Refuse before paying unless the host is graded "pass" against Moonshot's own endpoint.
const ask = wrap(fetch, {
  gate: {
    check: hostGradeCheck(HOST, { model: "moonshotai/kimi-k2.6", host: "erc8004:143:10316", verifiers: [VERIFIER], reference: "openrouter:moonshotai/int4" }),
    allow: ["pass"],
  },
});

const jobs = [];
for (let i = 0; i < N; i++) {
  const messages = [{ role: "user", content: `In one sentence, name a river and the country it flows through. (#${i + 1})` }];
  const r = await ask(`${HOST}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages, max_tokens: MAX_TOKENS }),
  });
  jobs.push({ hash: r.receipt.hash, salt: r.salt, messages, output: r.json.choices[0].message.content, body: r.receipt.body, jws: r.receipt.jws });
  console.log(`asked ${i + 1}/${N}: ${r.receipt.hash}`);
}

const jwks = await fetch(`${HOST}/.well-known/jwks.json`).then((r) => r.json());
console.log("waiting for the batch to be anchored on Monad (up to ~3 min)...");
const results = [];
for (const j of jobs) {
  // Not anchored within 3 minutes (the error says when the host's next batch is): not verified, don't pay for it.
  const s = await waitForAnchor(HOST, j.hash).catch((e) => (console.log(e.message), {}));
  const v = s.status === "anchored"
    ? await verifyReceipt({ body: j.body, jws: j.jws, jwks, proof: s.proof, root: s.root, onchain: { client, anchor: ANCHOR }, salt: j.salt, output: j.output, messages: j.messages })
    : null;
  const need = ["jws", "hash", "kid", "merkle", "anchored", "outputCommit", "promptCommit"];
  const verified = !!v && need.every((k) => v.checks[k] === "pass");
  const withinCap = j.body.req.params.max_tokens === MAX_TOKENS && j.body.res.tokensOut <= MAX_TOKENS;
  results.push({ receiptHash: j.hash, anchorTx: s.anchorTx ?? null, verified, withinCap, tokensOut: j.body.res.tokensOut, ok: verified && withinCap });
  console.log(`${j.hash}  verified=${verified}  withinCap=${withinCap} (${j.body.res.tokensOut}/${MAX_TOKENS})  ok=${verified && withinCap}`);
}

const deliverableHash = buildBatch(jobs.map((j) => j.hash)).root;
writeFileSync("job.json", JSON.stringify({ deliverableHash, results, jobs }, null, 2));
console.log(`\n${results.filter((r) => r.ok).length}/${N} ok · deliverableHash ${deliverableHash} · saved job.json (contains salts: keep it private)`);
