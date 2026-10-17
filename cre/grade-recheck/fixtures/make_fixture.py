#!/usr/bin/env python3
"""Regenerate the test fixtures with the real harness code, so the TS port is checked against it.

  python3 cre/grade-recheck/fixtures/make_fixture.py

Writes run/ (a small probe run plus export_grade.py output) and wilson_vectors.json.
"""
import csv, json, os, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "harness"))
import export_grade as eg  # noqa: E402
from assay_probe import wilson  # noqa: E402

STAMP = "20261005T101500Z"
# tag -> ok flags for tool cases with http 200
RESULTS = {
    "z-ai/fp8": [True] * 9 + [False],
    "chutes/bf16": [True] * 6 + [False] * 4,
    "direct:assay.example.com": [True, True, True, False, True, True, True, True, False, True],
}

def write_run(d):
    rows = []
    with open(os.path.join(d, f"raw_{STAMP}.jsonl"), "w") as raw:
        for tag, oks in RESULTS.items():
            for i, ok in enumerate(oks):
                raw.write(json.dumps({"case": f"case_{i}", "tag": tag, "http": 200, "ok": ok}) + "\n")
            raw.write(json.dumps({"case": "flight_full", "tag": tag, "http": 502, "ok": False}) + "\n")
            raw.write(json.dumps({"case": "max_tokens_16", "tag": tag, "ok": True}) + "\n")
            lo, hi = wilson(sum(oks), len(oks))
            rows.append({"tag": tag, "tool_pass": sum(oks), "tool_n": len(oks), "ci_low": round(lo, 3),
                         "ci_high": round(hi, 3), "http_errors": 1, "model": "z-ai/glm-5.3",
                         "reference": tag == "z-ai/fp8"})
    with open(os.path.join(d, f"summary_{STAMP}.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)

def main():
    run = os.path.join(HERE, "run")
    os.makedirs(run, exist_ok=True)
    write_run(run)
    eg.grader_commit = lambda: ("0" * 40, False)  # pinned, so the fixture doesn't change with every commit
    doc = eg.export(run, STAMP, assay_agent=(10143, 1962), assay_tag="direct:assay.example.com",
                    operator="erc8004:10143:7", stance="vouches")
    # Content-addressed copy, the layout the workflow fetches (<evidenceBaseUrl>/<sha256>.tar.gz)
    os.makedirs(os.path.join(HERE, "evidence"), exist_ok=True)
    shutil.copyfile(os.path.join(run, doc["evidenceFile"]), os.path.join(HERE, "evidence", doc["evidence"][2:] + ".tar.gz"))
    # HTTP replay payloads for `cre workflow simulate --trigger-index 1 --http-payload ...`
    g = doc["grades"][2]
    keys = ["model", "hostKey", "passed", "total", "ciLowBps", "ciHighBps", "evidence", "t"]
    honest = {"verifier": "0x00000000000000000000000000000000000000A1", **{k: g[k] for k in keys}}
    for name, p in [("honest", honest), ("inflated", {**honest, "passed": 10, "ciLowBps": 7224, "ciHighBps": 10000})]:
        with open(os.path.join(HERE, f"replay-{name}.json"), "w") as f:
            json.dump(p, f, indent=2); f.write("\n")
    vectors = []
    for n in range(1, 101):
        for k in range(n + 1):
            vectors.append([k, n, *eg.to_bps(*wilson(k, n))])
    for k, n in [(0, 1000), (1, 1000), (500, 1000), (999, 1000), (1000, 1000), (12345, 54321)]:
        vectors.append([k, n, *eg.to_bps(*wilson(k, n))])
    with open(os.path.join(HERE, "wilson_vectors.json"), "w") as f:
        json.dump(vectors, f, separators=(",", ":")); f.write("\n")

if __name__ == "__main__":
    main()
