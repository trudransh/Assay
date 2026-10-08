"""Does a host respect the caller's max_tokens? A controlled, repeated measurement.

The 8 Oct Kimi K2.6 run had three hosts answer a 16-token cap with thousands of tokens, each tried once.
This repeats it: every host, N trials with the same cap, once with OpenRouter's require_parameters off and
once on. With it on, OpenRouter only routes to a provider that declares support for every parameter sent,
so an overrun that survives it is the provider's, and one that disappears was the routing path's.

  python3 cap_probe.py --model moonshotai/kimi-k2.6 --reference moonshotai/int4 --trials 10 --dry-run
  python3 cap_probe.py --model moonshotai/kimi-k2.6 --reference moonshotai/int4 --trials 10

Writes cap_<stamp>.jsonl (one line per request) and cap_summary_<stamp>.csv, and prints the sha256 of the raw file.
Stdlib only, like assay_probe.py.
"""
import argparse, csv, hashlib, json, os, statistics, sys, time

from assay_probe import direct_ep, endpoints, http, openrouter_ep, request_body

PROMPT = "Write a 500-word essay about rivers."
SLACK = 2  # a cap of 16 may come back as 17 or 18 with some tokenizers; more than that is an overrun


def trial(key, ep, cap, require_parameters):
    body = request_body(ep, PROMPT, max_tokens=cap, temperature=0)
    if ep["pin"]:
        body["provider"]["require_parameters"] = require_parameters
    s, d = http("POST", f"{ep['base']}/chat/completions", body, key)
    rec = {"tag": ep["tag"], "cap": cap, "require_parameters": require_parameters if ep["pin"] else None, "http": s}
    if s != 200 or not isinstance(d, dict) or "choices" not in d:
        rec["error"] = str(d)[:200]
        return rec
    u = d.get("usage") or {}
    ct = u.get("completion_tokens")
    rt = (u.get("completion_tokens_details") or {}).get("reasoning_tokens") or 0
    rec.update(
        served_by=d.get("provider"),
        finish=d["choices"][0].get("finish_reason"),
        completion_tokens=ct,
        reasoning_tokens=rt,
        visible_tokens=None if ct is None else ct - rt,
        cost=u.get("cost"),
    )
    rec["overrun"] = ct is not None and ct > cap + SLACK
    return rec


def summarize(recs, reference_tag=None):
    """One row per (tag, require_parameters): overruns out of answered trials, median tokens, cost vs the reference."""
    groups = {}
    for r in recs:
        groups.setdefault((r["tag"], r["require_parameters"]), []).append(r)
    rows = []
    for (tag, rp), rs in groups.items():
        ok = [r for r in rs if r["http"] == 200 and r.get("completion_tokens") is not None]
        costs = [r["cost"] for r in ok if r.get("cost") is not None]
        rows.append({
            "tag": tag,
            "require_parameters": rp,
            "trials": len(rs),
            "answered": len(ok),
            "overruns": sum(r["overrun"] for r in ok),
            "median_completion_tokens": statistics.median([r["completion_tokens"] for r in ok]) if ok else None,
            "median_visible_tokens": statistics.median([r["visible_tokens"] for r in ok]) if ok else None,
            "median_cost": statistics.median(costs) if costs else None,
            "http_errors": len(rs) - len(ok),
        })
    for row in rows:
        ref = next((x for x in rows if reference_tag and x["tag"] == reference_tag and x["require_parameters"] == row["require_parameters"]), None)
        row["cost_vs_reference"] = round(row["median_cost"] / ref["median_cost"], 1) if ref and ref["median_cost"] and row["median_cost"] is not None else None
    return rows


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--reference", help="exact tag of the lab's own endpoint, e.g. moonshotai/int4")
    ap.add_argument("--trials", type=int, default=10)
    ap.add_argument("--cap", type=int, default=16)
    ap.add_argument("--only", help="comma-separated substrings to restrict endpoints (the reference is always kept)")
    ap.add_argument("--base-url", help="also probe this OpenAI-compatible endpoint directly (e.g. an Assay host)")
    ap.add_argument("--tag", help="tag for --base-url")
    ap.add_argument("--out", default="cap_out")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)

    eps, seen = [], set()
    for e in endpoints(a.model):
        if e["tag"] not in seen:
            seen.add(e["tag"]); eps.append(openrouter_ep(e, a.model))
    if a.only:
        wanted = [w.strip().lower() for w in a.only.split(",")]
        eps = [e for e in eps if any(w in e["tag"].lower() for w in wanted) or e["tag"] == a.reference]
    direct = direct_ep(a.base_url, a.model, None, a.tag) if a.base_url else None

    # Two modes per OpenRouter endpoint, one for a direct endpoint (routing doesn't apply).
    n = a.trials * (2 * len(eps) + (1 if direct else 0))
    worst = sum(a.trials * 2 * 3000 * float(e["pricing"]["completion"]) for e in eps if e["pricing"])
    print(f"{a.model}: {len(eps)} OpenRouter endpoints{' + 1 direct' if direct else ''}, {n} requests, cap {a.cap}")
    print(f"worst case if every reply overran to ~3000 tokens: ${worst:.2f}; with no overruns it's a few cents")
    if a.dry_run:
        return

    key = os.environ.get("OPENROUTER_API_KEY") or sys.exit("set OPENROUTER_API_KEY")
    os.makedirs(a.out, exist_ok=True)
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    path = os.path.join(a.out, f"cap_{stamp}.jsonl")
    recs = []
    with open(path, "w") as raw:
        jobs = [(e, rp) for e in eps for rp in (False, True)] + ([(direct, None)] if direct else [])
        for ep, rp in jobs:
            for _ in range(a.trials):
                r = trial(key if ep["pin"] else None, ep, a.cap, bool(rp))
                recs.append(r); raw.write(json.dumps(r) + "\n"); raw.flush()
            mine = [r for r in recs[-a.trials:] if r["http"] == 200]
            print(f"{ep['tag']:28s} require_parameters={str(rp):5s} overruns {sum(r['overrun'] for r in mine)}/{len(mine)}  errors {a.trials - len(mine)}")
    rows = summarize(recs, a.reference)
    with open(os.path.join(a.out, f"cap_summary_{stamp}.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
    digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
    print(f"\nwrote {path} (sha256 0x{digest}) and cap_summary_{stamp}.csv")


if __name__ == "__main__":
    main()
