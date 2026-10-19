"""Public grade feed: each model we've graded, every host graded for it, and that host's newest onchain grade.

  python3 harness/feed.py --out feed.json

Host names come from the published grade files (docs/evidence/grades_*.json); the grades come from
VerifierRegistry.gradeOf on Monad mainnet, from our verifier, so the feed holds only what's onchain.
It carries numbers, not verdicts: readers judge pass, warn or fail with the SDK's feedStatuses at read time,
so an old copy of the feed can't show an expired grade as a pass. Stdlib only.
"""
import argparse, glob, json, os, sys, time

from export_grade import keccak_hex
from grade_age import REGISTRY, RPC, VERIFIER, grade_of

EVIDENCE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "evidence")
RAW_BASE = "https://raw.githubusercontent.com/trudransh/Assay/main/docs/evidence/"
CHAIN_ID = 143
GRADE_FIELDS = ("hostKey", "passed", "total", "ciLowBps", "ciHighBps", "checks", "refModel", "evidence", "t", "verifier")


def published(evidence_dir=EVIDENCE):
    """({model: {"reference": preimage or None, "hosts": [preimage, ...]}}, {evidence hash: file name})"""
    models, files = {}, {}
    for f in sorted(glob.glob(os.path.join(evidence_dir, "grades_*.json"))):
        with open(f) as fh:
            run = json.load(fh)
        m = models.setdefault(run["modelId"], {"reference": None, "hosts": []})
        for g in run["grades"]:
            if g["hostKeyPreimage"] not in m["hosts"]:
                m["hosts"].append(g["hostKeyPreimage"])
            if g["tag"] == run.get("reference"):
                m["reference"] = g["hostKeyPreimage"]  # the newest run's reference wins (files sort by stamp)
        files[run["evidence"]] = run["evidenceFile"]
    return models, files


def build(models, files, lookup, now):
    """`lookup(model, host preimage)` returns the onchain grade dict or None. Models with no onchain grade are left out."""
    out = []
    for model, m in sorted(models.items()):
        hosts = []
        for pre in m["hosts"]:
            g = lookup(model, pre)
            if g:
                hosts.append({"host": pre, **{k: g[k] for k in GRADE_FIELDS},
                              "evidenceUrl": RAW_BASE + files[g["evidence"]] if g["evidence"] in files else None})
        if hosts:
            out.append({"model": model, "modelHash": keccak_hex(model), "reference": m["reference"], "hosts": hosts})
    return {"version": 1, "chainId": CHAIN_ID, "registry": REGISTRY, "verifiers": [VERIFIER], "generatedAt": now, "models": out}


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--out", required=True, help="where to write the feed (replaced atomically)")
    p.add_argument("--rpc-url", default=RPC)
    a = p.parse_args(argv)
    models, files = published()
    # Any failed read stops the build: a feed missing a host would read as "never graded".
    feed = build(models, files, lambda m, h: grade_of(m, h, a.rpc_url), int(time.time()))
    tmp = a.out + ".tmp"
    with open(tmp, "w") as f:
        json.dump(feed, f, indent=1)
    os.replace(tmp, a.out)
    print(f"feed: {len(feed['models'])} models, {sum(len(m['hosts']) for m in feed['models'])} graded hosts -> {a.out}")


if __name__ == "__main__":
    sys.exit(main())
