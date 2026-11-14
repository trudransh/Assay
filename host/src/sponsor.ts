import { assayAccountAbi, delegationCode, reputationAbi, sponsoredCallTypedData } from "@assay/receipts";
import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { decodeFunctionData, isAddress, isHex, parseAbi, recoverMessageAddress, recoverTypedDataAddress, type Address, type Hex } from "viem";
import { recoverAuthorizationAddress } from "viem/utils";
import { publicError } from "./errors.js";
import { clientIp, overLimit } from "./limits.js";
import type { SqlStore as Store } from "./sql-store.js";

/// Sponsored transactions for per-app requester keys (Kai's paymaster advice). The relayer pays the gas, so a
/// per-app address never holds MON and is never linked to a funding wallet. To keep the relayer from paying for
/// anything else, it only sponsors the two calls Assay needs, and only for receipts this host issued:
///   POST /v1/sponsor/cosignk   ReceiptAnchor.cosignK for an anchored receipt of this host
///   POST /v1/sponsor/feedback  ERC-8004 feedback about this host, citing a receipt the sender co-signed,
///                              sent from the per-app address itself through AssayAccount (EIP-7702)
export const SPONSOR_LIMIT = 10;
export const SPONSOR_LIMIT_GLOBAL = 100;
/// Strings in feedback are stored onchain at the relayer's cost.
export const FEEDBACK_TEXT_MAX = 200;
const MAX_DEADLINE_MS = 3_600_000;

export interface SponsorRequest {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args: readonly unknown[];
  authorizationList?: unknown[];
}

export interface SponsorDeps {
  chainId: number;
  agentId: bigint;
  anchor: Address;
  reputation: Address;
  /// The AssayAccount deployment. Without it only /cosignk is served.
  accountImpl?: Address;
  store: Pick<Store, "getReceipt" | "getBatch">;
  code(address: Address): Promise<Hex | undefined>;
  cosignedK(receiptHash: Hex, signer: Address): Promise<boolean>;
  /// Simulates, then sends from the relayer. A call that would revert costs nothing.
  send(req: SponsorRequest): Promise<Hex>;
  now?: () => number;
}

const cosignKAbi = parseAbi(["function cosignK(uint256 agentId, bytes32 receiptHash, bytes32[] proof, bytes32 root, bytes signature)"]);
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const SIG65 = /^0x[0-9a-fA-F]{130}$/;
const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const fail = (c: Context, status: ContentfulStatusCode, message: string) => c.json({ error: { message } }, status);
const uint = (v: unknown): bigint | undefined => ((typeof v === "string" || typeof v === "number") && /^\d{1,78}$/.test(String(v)) ? BigInt(v) : undefined);

export function mountSponsor(app: Hono, d: SponsorDeps): void {
  const now = d.now ?? Date.now;
  const hits = new Map<string, number[]>();
  const limited = (c: Context) =>
    overLimit(hits, clientIp(c), SPONSOR_LIMIT, now()) ? `sponsored transactions are limited to ${SPONSOR_LIMIT} per hour per client` :
    overLimit(hits, "*", SPONSOR_LIMIT_GLOBAL, now()) ? "this host is at its hourly sponsoring limit; try again later" : undefined;

  /// The receipt must be this host's and anchored: that's what makes the relayer's gas well spent.
  const anchored = (hash: Hex) => {
    if (!d.store.getReceipt(hash)) return { error: [404, "unknown receipt: this host only sponsors receipts it issued"] as const };
    const batch = d.store.getBatch(hash);
    if (!batch) return { error: [409, "receipt is not anchored yet; retry after the next batch"] as const };
    return { batch };
  };

  app.post("/v1/sponsor/cosignk", async (c) => {
    const why = limited(c);
    if (why) return fail(c, 429, why);
    const b: unknown = await c.req.json().catch(() => undefined);
    if (!isObj(b) || typeof b.receiptHash !== "string" || !BYTES32.test(b.receiptHash) || typeof b.signature !== "string" || !SIG65.test(b.signature)) {
      return fail(c, 400, "body must be {receiptHash: 0x + 64 hex, signature: 65-byte EIP-191 signature over the receipt hash}");
    }
    const hash = b.receiptHash.toLowerCase() as Hex;
    const a = anchored(hash);
    if (a.error) return fail(c, a.error[0], a.error[1]);
    const signer = await recoverMessageAddress({ message: { raw: hash }, signature: b.signature as Hex }).catch(() => undefined);
    if (!signer) return fail(c, 400, "signature doesn't recover");
    if (await d.cosignedK(hash, signer)) return fail(c, 409, `${signer} already co-signed this receipt`);
    try {
      const txHash = await d.send({ address: d.anchor, abi: cosignKAbi, functionName: "cosignK", args: [d.agentId, hash, a.batch.proofs[hash], a.batch.root, b.signature] });
      return c.json({ txHash, signer });
    } catch (e) {
      return fail(c, 502, `sponsored co-sign failed: ${publicError(e)}`);
    }
  });

  app.post("/v1/sponsor/feedback", async (c) => {
    if (!d.accountImpl) return fail(c, 503, "sponsored feedback isn't enabled on this host");
    const why = limited(c);
    if (why) return fail(c, 429, why);
    const b: unknown = await c.req.json().catch(() => undefined);
    const call = isObj(b) && isObj(b.call) ? b.call : undefined;
    const nonce = uint(call?.nonce);
    const deadline = uint(call?.deadline);
    if (!isObj(b) || typeof b.account !== "string" || !isAddress(b.account) || !call || !isHex(call.data) || nonce === undefined || deadline === undefined || typeof call.signature !== "string" || !SIG65.test(call.signature)) {
      return fail(c, 400, "body must be {account, call: {data, nonce, deadline, signature}, authorization?}");
    }
    const account = b.account as Address;
    const t = BigInt(Math.floor(now() / 1000));
    if (deadline <= t || deadline > t + BigInt(MAX_DEADLINE_MS / 1000)) return fail(c, 400, "deadline must be in the next hour (unix seconds)");

    let args: readonly unknown[];
    try {
      const decoded = decodeFunctionData({ abi: reputationAbi, data: call.data as Hex });
      args = decoded.args;
    } catch {
      return fail(c, 400, "call.data must be ReputationRegistry.giveFeedback");
    }
    const [agentId, , , tag1, tag2, endpoint, feedbackURI, feedbackHash] = args as [bigint, bigint, number, string, string, string, string, Hex];
    if (agentId !== d.agentId) return fail(c, 400, `this host only sponsors feedback about itself (agent ${d.agentId})`);
    if ([tag1, tag2, endpoint, feedbackURI].some((x) => x.length > FEEDBACK_TEXT_MAX)) return fail(c, 400, `feedback text fields are limited to ${FEEDBACK_TEXT_MAX} characters each`);
    const hash = feedbackHash.toLowerCase() as Hex;
    const a = anchored(hash);
    if (a.error) return fail(c, a.error[0], `feedbackHash: ${a.error[1]}`);

    // Checked here so a bad request never reaches the chain, even as a simulation.
    const typed = sponsoredCallTypedData(d.chainId, account, { target: d.reputation, data: call.data as Hex, nonce, deadline });
    const signer = await recoverTypedDataAddress({ ...typed, signature: call.signature as Hex }).catch(() => undefined);
    if (signer?.toLowerCase() !== account.toLowerCase()) return fail(c, 400, "call.signature isn't from the account");
    // Receipt-backed only (D26): the sender co-signed the receipt it cites. /cosignk sponsors that step too.
    if (!(await d.cosignedK(hash, account))) return fail(c, 409, "co-sign the receipt with this account first (POST /v1/sponsor/cosignk)");

    const code = (await d.code(account))?.toLowerCase();
    let authorizationList: unknown[] | undefined;
    if (code !== delegationCode(d.accountImpl)) {
      if (code && code !== "0x") return fail(c, 409, "this account already runs other code; it can't be sponsored");
      const auth = isObj(b.authorization) ? b.authorization : undefined;
      const parsed = auth && {
        address: auth.address,
        chainId: Number(auth.chainId),
        nonce: Number(auth.nonce),
        r: auth.r,
        s: auth.s,
        yParity: Number(auth.yParity),
      };
      if (!parsed || parsed.address?.toLowerCase() !== d.accountImpl.toLowerCase() || parsed.chainId !== d.chainId || !BYTES32.test(parsed.r) || !BYTES32.test(parsed.s)) {
        return fail(c, 400, `first use needs authorization: an EIP-7702 authorization from the account to ${d.accountImpl} on chain ${d.chainId}`);
      }
      const by = await recoverAuthorizationAddress({ authorization: parsed } as Parameters<typeof recoverAuthorizationAddress>[0]).catch(() => undefined);
      if (by?.toLowerCase() !== account.toLowerCase()) return fail(c, 400, "authorization isn't signed by the account");
      authorizationList = [parsed];
    }

    try {
      const txHash = await d.send({
        address: account,
        abi: assayAccountAbi,
        functionName: "execute",
        args: [d.reputation, call.data, nonce, deadline, call.signature],
        ...(authorizationList ? { authorizationList } : {}),
      });
      return c.json({ txHash, account });
    } catch (e) {
      return fail(c, 502, `sponsored feedback failed: ${publicError(e)}`);
    }
  });
}
