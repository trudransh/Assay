import type { Address, Hex } from "viem";
import { gradeStatus, type Grade, type GradeStatus } from "./grade.js";

/// One host's newest onchain grade, as harness/feed.py publishes it. `host` is its hostKeyOf spec.
export interface FeedHost {
  host: string;
  hostKey: Hex;
  passed: number;
  total: number;
  ciLowBps: number;
  ciHighBps: number;
  checks: Hex;
  refModel: Hex;
  /// sha256 of the evidence bundle.
  evidence: Hex;
  /// Where that bundle is published, or null when the feed doesn't know.
  evidenceUrl: string | null;
  /// Unix seconds.
  t: number;
  verifier: Address;
}

export interface FeedModel {
  model: string;
  modelHash: Hex;
  /// The lab's own endpoint the hosts were graded against (a hostKeyOf spec), or null.
  reference: string | null;
  hosts: FeedHost[];
}

/// The public grade feed. It holds numbers, not verdicts: judge them with feedStatuses when you read them,
/// so an old copy can't show an expired grade as a pass. Hosts nobody graded aren't in it.
export interface Feed {
  version: 1;
  chainId: number;
  registry: Address;
  verifiers: Address[];
  /// Unix seconds.
  generatedAt: number;
  models: FeedModel[];
}

const asGrade = (m: FeedModel, h: FeedHost): Grade => ({
  model: m.modelHash,
  hostKey: h.hostKey,
  checks: h.checks,
  passed: h.passed,
  total: h.total,
  ciLowBps: h.ciLowBps,
  ciHighBps: h.ciHighBps,
  refModel: h.refModel,
  evidence: h.evidence,
  t: BigInt(h.t),
});

/// Status of every graded host for `model`, keyed by its spec and judged with gradeStatus against the reference's
/// grade in the same feed. `now` is unix seconds. A model the feed doesn't cover gives an empty map.
export function feedStatuses(feed: Feed, model: string, now: number = Math.floor(Date.now() / 1000)): Map<string, GradeStatus> {
  if (feed?.version !== 1 || !Array.isArray(feed.models)) throw new Error("not an Assay grade feed (version 1)");
  const out = new Map<string, GradeStatus>();
  const m = feed.models.find((x) => x.model === model);
  if (!m) return out;
  const ref = m.hosts.find((h) => h.host === m.reference);
  for (const h of m.hosts) out.set(h.host, gradeStatus(asGrade(m, h), { now, reference: ref && asGrade(m, ref) }));
  return out;
}

/// OpenRouter provider tags for `provider: { ignore }` on `model`: the feed's openrouter: hosts whose status is in
/// `block` (default "fail" only). Hosts with no grade aren't in the feed, so blocking "unknown" only adds expired ones.
export function toOpenRouterIgnore(feed: Feed, model: string, opts: { now?: number; block?: readonly GradeStatus[] } = {}): string[] {
  const block = opts.block ?? ["fail"];
  return [...feedStatuses(feed, model, opts.now)]
    .filter(([host, status]) => host.startsWith("openrouter:") && block.includes(status))
    .map(([host]) => host.slice("openrouter:".length));
}
