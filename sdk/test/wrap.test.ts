import { webcrypto } from "node:crypto";
import { base64url, type JWK } from "jose";
import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import { commitRequest, commitResponse } from "../src/commit.js";
import { createHostSigner } from "../src/hostSigner.js";
import { buildReceipt, receiptHash } from "../src/receipt.js";
import { ReceiptError, wrap } from "../src/wrap.js";

const COSIGNER = ("0x" + "cd".repeat(32)) as Hex;
const URL_ = "http://localhost:8787/v1/chat/completions";
const request = { model: "m", messages: [{ role: "user", content: "Say OK" }], temperature: 0 };

// A fake host: commits to `signedText`, but returns `servedText` (normally the same).
async function fakeHost(opts: { signedText?: string; servedText?: string; hashHeader?: (h: Hex) => string; noReceipt?: boolean } = {}) {
  const jwk = (await webcrypto.subtle.exportKey(
    "jwk",
    (await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])).privateKey,
  )) as JWK;
  const host = await createHostSigner(jwk, "k1");
  const seen: { headers?: Headers; init?: RequestInit } = {};
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seen.headers = new Headers(init?.headers);
    seen.init = init;
    const salt = `0x${seen.headers.get("X-Assay-Salt")}` as Hex;
    const cosigner = seen.headers.get("X-Assay-Cosigner") as Hex | null;
    const { messages, ...params } = JSON.parse(String(init?.body));
    const body = buildReceipt({
      model: "m",
      host: { agentId: "erc8004:10143:1962", keyId: "k1", alg: "ES256" },
      req: { commit: commitRequest(salt, messages, params), params, ...(cosigner ? { cosigner } : {}) },
      res: { commit: commitResponse(salt, opts.signedText ?? "OK"), tokensIn: 3, tokensOut: 1, finish: "stop" },
    });
    const jws = await host.signReceipt(body);
    const headers = new Headers({ "content-type": "application/json" });
    if (!opts.noReceipt) {
      headers.set("X-Assay-Receipt", base64url.encode(JSON.stringify({ body, jws })));
      headers.set("X-Assay-Receipt-Hash", (opts.hashHeader ?? ((h) => h))(receiptHash(body)));
    }
    const out = { choices: [{ message: { role: "assistant", content: opts.servedText ?? "OK" } }] };
    return new Response(JSON.stringify(out), { status: 200, headers });
  }) as typeof fetch;
  return { fetchImpl, seen };
}

const post = (headers?: HeadersInit): RequestInit => ({ method: "POST", headers, body: JSON.stringify(request) });

describe("wrap", () => {
  it("sends a fresh salt, keeps it, and checks the output commit", async () => {
    const { fetchImpl, seen } = await fakeHost();
    const out = await wrap(fetchImpl)(URL_, post({ "content-type": "application/json" }));
    expect(seen.headers!.get("X-Assay-Salt")).toBe(out.salt.slice(2));
    expect(seen.headers!.get("X-Assay-Salt")).toMatch(/^[0-9a-f]{64}$/);
    expect(seen.headers!.get("content-type")).toBe("application/json");
    expect(seen.headers!.has("X-Assay-Cosigner")).toBe(false);
    expect(out.outputCommitOk).toBe(true);
    expect(out.receipt.hash).toBe(receiptHash(out.receipt.body));
    expect(out.receipt.jws.split(".")).toHaveLength(3);
    expect(out.json).toMatchObject({ choices: [{ message: { content: "OK" } }] });
    expect(out.response.status).toBe(200);
  });

  it("uses a different salt per request", async () => {
    const { fetchImpl } = await fakeHost();
    const f = wrap(fetchImpl);
    const [a, b] = [await f(URL_, post()), await f(URL_, post())];
    expect(a.salt).not.toBe(b.salt);
  });

  it("forwards the co-signer key hash, which the host signs in as req.cosigner", async () => {
    const { fetchImpl, seen } = await fakeHost();
    const out = await wrap(fetchImpl, { cosigner: COSIGNER })(URL_, post());
    expect(seen.headers!.get("X-Assay-Cosigner")).toBe(COSIGNER);
    expect(out.receipt.body.req.cosigner).toBe(COSIGNER);
  });

  it("flags output that differs from what the host committed to", async () => {
    const { fetchImpl } = await fakeHost({ signedText: "OK", servedText: "OK!" });
    expect((await wrap(fetchImpl)(URL_, post())).outputCommitOk).toBe(false);
  });

  it("throws a ReceiptError carrying the unread reply when the receipt header is missing", async () => {
    const { fetchImpl } = await fakeHost({ noReceipt: true });
    const err = await wrap(fetchImpl)(URL_, post()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReceiptError);
    expect((err as ReceiptError).message).toMatch(/no X-Assay-Receipt header .*HTTP 200/);
    // The answer was paid for: it's still there to keep.
    expect(((await (err as ReceiptError).response.json()) as any).choices[0].message.content).toBe("OK");
  });

  it("throws a ReceiptError when X-Assay-Receipt-Hash doesn't match the body", async () => {
    const { fetchImpl } = await fakeHost({ hashHeader: () => "0x" + "00".repeat(32) });
    await expect(wrap(fetchImpl)(URL_, post())).rejects.toThrow(ReceiptError);
    await expect(wrap(fetchImpl)(URL_, post())).rejects.toThrow(/X-Assay-Receipt-Hash/);
  });

  it("throws a ReceiptError when the receipt header isn't readable", async () => {
    const fetchImpl = (async () => new Response("{}", { headers: { "X-Assay-Receipt": "not-base64url-json" } })) as typeof fetch;
    await expect(wrap(fetchImpl)(URL_, post())).rejects.toThrow(/X-Assay-Receipt can't be read/);
  });

  it("rejects a malformed cosigner up front", () => {
    expect(() => wrap(fetch, { cosigner: "0x1234" as Hex })).toThrow(/cosigner/);
  });
});
