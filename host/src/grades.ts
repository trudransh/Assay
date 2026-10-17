import { gradeOf, gradeStatus, hostKeyOf, type ContractReader } from "@assay/receipts";
import type { Hono } from "hono";
import { publicError } from "./errors.js";
import { isAddress, keccak256, stringToBytes, type Address } from "viem";

export interface GradeDeps {
  reader: ContractReader;
  registry: Address;
  now?: () => number;
}

/// GET /v1/grade?model=<id>&host=<spec or hostKey>&verifiers=<a,b>[&reference=<spec or hostKey>]
/// One call answers "can I trust this host for this model right now", with the call that reproduces it.
export function mountGrades(app: Hono, d: GradeDeps): void {
  app.get("/v1/grade", async (c) => {
    const model = c.req.query("model")?.trim();
    const host = c.req.query("host")?.trim() ?? "";
    const ref = c.req.query("reference")?.trim();
    const verifiers = (c.req.query("verifiers") ?? "").split(",").map((v) => v.trim()).filter(Boolean);
    const hostKey = hostKeyOf(host);
    const refKey = ref ? hostKeyOf(ref) : undefined;

    if (!model) return c.json({ error: { message: "model is required, e.g. z-ai/glm-5.3" } }, 400);
    if (!hostKey) return c.json({ error: { message: "host must be erc8004:<chain>:<id>, openrouter:<tag>, direct:<host> or a 0x bytes32 host key" } }, 400);
    if (ref && !refKey) return c.json({ error: { message: "reference has the same format as host" } }, 400);
    if (verifiers.length === 0 || !verifiers.every((v) => isAddress(v))) {
      return c.json({ error: { message: "verifiers must be a comma-separated list of the verifier addresses you trust" } }, 400);
    }

    const modelKey = keccak256(stringToBytes(model));
    const trusted = verifiers as Address[];
    try {
      const got = await gradeOf(d.reader, d.registry, modelKey, hostKey, trusted);
      const refGot = refKey ? await gradeOf(d.reader, d.registry, modelKey, refKey, trusted) : null;
      const now = Math.floor((d.now ?? Date.now)() / 1000);
      const status = gradeStatus(got?.grade, { now, reference: refGot?.grade });
      const g = got?.grade;
      return c.json({
        status,
        model,
        host,
        hostKey,
        grade: g
          ? { passed: g.passed, total: g.total, ciLowBps: g.ciLowBps, ciHighBps: g.ciHighBps, evidence: g.evidence, checks: g.checks, refModel: g.refModel, t: Number(g.t) }
          : null,
        verifier: got?.by ?? null,
        reference: refGot ? { hostKey: refKey, ciLowBps: refGot.grade.ciLowBps, ciHighBps: refGot.grade.ciHighBps, t: Number(refGot.grade.t) } : null,
        reproduce: {
          kind: "contract-call",
          address: d.registry,
          function: "gradeOf(bytes32,bytes32,address[])",
          args: [modelKey, hostKey, trusted],
        },
      });
    } catch (e) {
      return c.json({ error: { message: `grade lookup failed: ${publicError(e)}` } }, 502);
    }
  });
}
