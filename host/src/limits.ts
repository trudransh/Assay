import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

export const HOUR = 3_600_000;

/// The client behind the proxies. Caddy (same machine) and Vercel forward it; directly connected callers are taken as-is.
/// Behind Vercel's rewrite this is Vercel's address, so web-app users share one client budget.
/// Forwarded headers can be forged by anyone calling the VM directly, so the global limit is the hard bound.
export function clientIp(c: Context): string {
  let remote = "unknown";
  try {
    remote = getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // No socket (in-process requests, tests): fall back to the forwarded headers below.
  }
  if (remote !== "unknown" && !/^(127\.|::1$|::ffff:127\.)/.test(remote)) return remote;
  // No socket on Cloudflare Workers: there the edge sets cf-connecting-ip, and a client can't override it.
  if (remote === "unknown" && c.req.header("cf-connecting-ip")) return c.req.header("cf-connecting-ip") as string;
  return c.req.header("x-real-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? remote;
}

/// Sliding one-hour window. In memory, per process: resets on restart, enough for one host instance.
export function overLimit(hits: Map<string, number[]>, key: string, limit: number, t: number): boolean {
  // Many one-off clients would otherwise grow the map forever: drop everyone idle for an hour.
  if (hits.size > 10_000) for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] >= HOUR) hits.delete(k);
  const recent = (hits.get(key) ?? []).filter((h) => t - h < HOUR);
  if (recent.length >= limit) return true;
  hits.set(key, [...recent, t]);
  return false;
}
