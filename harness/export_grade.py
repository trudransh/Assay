#!/usr/bin/env python3
"""
export_grade.py: turn one assay_probe.py run into VerifierRegistry grades.

Reads summary_<stamp>.csv and raw_<stamp>.jsonl from --out, writes
grades_<stamp>.json (one Grade per endpoint, SPEC section 5) and
evidence_<stamp>.tar.gz plus evidence_<stamp>.tar.gz.sha256. The bundle also carries
provenance_<stamp>.json: the grader commit, who ran it, and whether they vouch for it (SPEC section 5).

Examples:
  python3 export_grade.py --model z-ai/glm-5.3 --reference z-ai/fp8
  python3 export_grade.py --model z-ai/glm-5.3 --reference z-ai/fp8 \\
      --assay-agent 10143:1962 --assay-tag direct:assay.example.com --stamp 20261005T101500Z
"""
import argparse, calendar, csv, glob, gzip, hashlib, io, json, math, os, shutil, subprocess, sys, tarfile, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from assay_probe import CHECKS, wilson  # noqa: E402

CHECKS_ID = CHECKS["v0"]  # summaries from before the checks column
MAX_TOKENS_CASE = "max_tokens_16"
GRADER_REPO = "https://github.com/trudransh/Assay"
# vouches: the operator stands behind the methodology. ran-grader: they only ran this code (SPEC section 5).
STANCES = ("ran-grader", "vouches")

# ---------------------------------------------------------------- keccak-256
_RC = [0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
       0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
       0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
       0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
       0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
       0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008]
_ROT = [[0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14]]
_M = (1 << 64) - 1

def _rol(v, n):
    return ((v << n) | (v >> (64 - n))) & _M if n else v

def _f(a):
    for rc in _RC:
        c = [a[x][0] ^ a[x][1] ^ a[x][2] ^ a[x][3] ^ a[x][4] for x in range(5)]
        d = [c[(x - 1) % 5] ^ _rol(c[(x + 1) % 5], 1) for x in range(5)]
        a = [[a[x][y] ^ d[x] for y in range(5)] for x in range(5)]
        b = [[0] * 5 for _ in range(5)]
        for x in range(5):
            for y in range(5):
                b[y][(2 * x + 3 * y) % 5] = _rol(a[x][y], _ROT[x][y])
        a = [[b[x][y] ^ (~b[(x + 1) % 5][y] & b[(x + 2) % 5][y]) for y in range(5)] for x in range(5)]
        a[0][0] ^= rc
    return a

def keccak256_py(data: bytes) -> bytes:
    """Ethereum Keccak-256 (0x01 padding). hashlib.sha3_256 uses 0x06 and gives different hashes."""
    rate = 136
    msg = bytearray(data) + b"\x01" + b"\x00" * ((-len(data) - 1) % rate)
    msg[-1] |= 0x80
    a = [[0] * 5 for _ in range(5)]
    for off in range(0, len(msg), rate):
        for i in range(rate // 8):
            a[i % 5][i // 5] ^= int.from_bytes(msg[off + 8 * i: off + 8 * i + 8], "little")
        a = _f(a)
    return b"".join(a[i % 5][i // 5].to_bytes(8, "little") for i in range(4))

def keccak256_cast(data: bytes):
    """`cast keccak` on the hex bytes, or None when cast is missing."""
    if not shutil.which("cast"):
        return None
    out = subprocess.run(["cast", "keccak", "0x" + data.hex()], capture_output=True, text=True, check=True)
    return bytes.fromhex(out.stdout.strip()[2:])

def keccak_hex(text: str) -> str:
    data = text.encode("utf-8")
    h = keccak256_cast(data) or keccak256_py(data)
    return "0x" + h.hex()

# ---------------------------------------------------------------- encodings
def host_key_preimage(tag, assay_agent=None):
    """D21: Assay hosts are keyed by ERC-8004 identity, OpenRouter endpoints by tag."""
    if assay_agent:
        chain, agent = assay_agent
        return f"erc8004:{chain}:{agent}"
    # assay_probe.py tags direct endpoints "direct:<host>"; they are not OpenRouter hosts
    return tag if tag.startswith("direct:") else f"openrouter:{tag}"

def to_bps(lo, hi):
    """Widen, never narrow: low rounds down, high rounds up, both clamped to [0, 10000]."""
    clamp = lambda v: max(0, min(10000, v))
    # round(…, 9) drops float noise so 0.25 * 10000 doesn't ceil to 2501
    return clamp(math.floor(round(lo * 10000, 9))), clamp(math.ceil(round(hi * 10000, 9)))

def parse_agent(s):
    chain, sep, agent = s.partition(":")
    if not (sep and chain.isdigit() and agent.isdigit()):
        raise argparse.ArgumentTypeError(f"--assay-agent wants CHAIN:ID, got {s!r}")
    return int(chain), int(agent)

# ---------------------------------------------------------------- evidence
def write_evidence(paths, dest):
    """Deterministic tar.gz (fixed mtime/owner, sorted) so the same run always hashes the same."""
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz, tarfile.open(fileobj=gz, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        for p in sorted(paths, key=os.path.basename):
            info = tarfile.TarInfo(os.path.basename(p))
            with open(p, "rb") as f:
                blob = f.read()
            info.size, info.mtime, info.mode = len(blob), 0, 0o644
            tar.addfile(info, io.BytesIO(blob))
    with open(dest, "wb") as f:
        f.write(buf.getvalue())
    digest = hashlib.sha256(buf.getvalue()).hexdigest()
    with open(dest + ".sha256", "w") as f:
        f.write(f"{digest}  {os.path.basename(dest)}\n")
    return "0x" + digest

def grader_commit():
    """(commit, dirty) of the harness checkout, or (None, None) outside git. Untracked run folders don't count as dirty."""
    here = os.path.dirname(os.path.abspath(__file__))
    git = lambda *a: subprocess.run(["git", "-C", here, *a], capture_output=True, text=True, check=True).stdout.strip()
    try:
        return git("rev-parse", "HEAD"), bool(git("status", "--porcelain", "--untracked-files=no", "--", "."))
    except (OSError, subprocess.CalledProcessError):
        return None, None

# ---------------------------------------------------------------- export
def counts_from_raw(path):
    """passed/total per tag, recomputed from raw responses the same way assay_probe.py does."""
    out = {}
    with open(path) as f:
        for line in f:
            if not line.strip():
                continue
            r = json.loads(line)
            if r.get("case") == MAX_TOKENS_CASE or r.get("http", 200) != 200:
                continue
            k, n = out.get(r["tag"], (0, 0))
            out[r["tag"]] = (k + bool(r.get("ok")), n + 1)
    return out

def latest_stamp(out_dir):
    found = sorted(glob.glob(os.path.join(out_dir, "summary_*.csv")))
    if not found:
        sys.exit(f"no summary_*.csv in {out_dir}")
    return os.path.basename(found[-1])[len("summary_"):-len(".csv")]

def export(out_dir, stamp, model=None, reference=None, assay_agent=None, assay_tag=None, operator=None, stance="ran-grader"):
    summary_p = os.path.join(out_dir, f"summary_{stamp}.csv")
    raw_p = os.path.join(out_dir, f"raw_{stamp}.jsonl")
    with open(summary_p, newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        sys.exit(f"{summary_p} is empty")
    model = model or rows[0].get("model") or sys.exit("pass --model (summary has no model column)")
    if reference is None:
        reference = next((r["tag"] for r in rows if r.get("reference") == "True"), None)
    if reference is None:
        sys.exit("pass --reference TAG (summary marks no reference endpoint)")
    tags = [r["tag"] for r in rows]
    if reference not in tags:
        sys.exit(f"reference {reference!r} is not an endpoint in this run: {tags}")
    if assay_agent and assay_tag not in tags:
        sys.exit(f"--assay-agent needs --assay-tag set to one of {tags}")
    if stance not in STANCES:
        sys.exit(f"stance must be one of {STANCES}, got {stance!r}")

    suites = {r.get("checks") or CHECKS_ID for r in rows}
    if len(suites) != 1:
        sys.exit(f"the endpoints in this run were graded with different checks: {sorted(suites)}")
    checks_id = suites.pop()

    counts = counts_from_raw(raw_p)
    t = calendar.timegm(time.strptime(stamp, "%Y%m%dT%H%M%SZ"))
    pres = {tag: host_key_preimage(tag, assay_agent if tag == assay_tag else None) for tag in tags}
    # The tag -> host key map rides in the bundle, so a recount (the CRE workflow) needs no hand-kept list.
    commit, dirty = grader_commit()
    prov_p = os.path.join(out_dir, f"provenance_{stamp}.json")
    with open(prov_p, "w") as f:
        json.dump({"grader": {"repo": GRADER_REPO, "commit": commit, "dirty": dirty, "checks": checks_id},
                   "operator": operator, "stance": stance, "hostKeyPreimages": pres}, f, indent=2, sort_keys=True)
        f.write("\n")
    evidence = write_evidence([summary_p, raw_p, prov_p], os.path.join(out_dir, f"evidence_{stamp}.tar.gz"))
    model_h, checks_h, ref_h = keccak_hex(model), keccak_hex(checks_id), keccak_hex(reference)

    grades, skipped = [], []
    for r in rows:
        tag = r["tag"]; k, n = counts.get(tag, (0, 0))
        if (str(k), str(n)) != (r["tool_pass"], r["tool_n"]):
            sys.exit(f"{tag}: summary says {r['tool_pass']}/{r['tool_n']} but raw log says {k}/{n}")
        if n == 0:  # VerifierRegistry rejects total == 0
            skipped.append(tag); continue
        lo, hi = to_bps(*wilson(k, n))
        pre = pres[tag]
        grades.append({"tag": tag, "hostKeyPreimage": pre,
                       "model": model_h, "hostKey": keccak_hex(pre), "checks": checks_h,
                       "passed": k, "total": n, "ciLowBps": lo, "ciHighBps": hi,
                       "refModel": ref_h, "evidence": evidence, "t": t})
    doc = {"stamp": stamp, "modelId": model, "checksId": checks_id, "reference": reference,
           "evidenceFile": f"evidence_{stamp}.tar.gz", "evidence": evidence,
           "grades": grades, "skipped": skipped}
    with open(os.path.join(out_dir, f"grades_{stamp}.json"), "w") as f:
        json.dump(doc, f, indent=2); f.write("\n")
    return doc

def main(argv=None):
    ap = argparse.ArgumentParser(description="Export assay_probe.py results as VerifierRegistry grades.")
    ap.add_argument("--out", default="assay_out", help="folder with summary_<stamp>.csv and raw_<stamp>.jsonl")
    ap.add_argument("--stamp", help="run to export (default: newest summary in --out)")
    ap.add_argument("--model", help="model id, e.g. z-ai/glm-5.3 (default: summary's model column)")
    ap.add_argument("--reference", help="exact tag of the reference endpoint (default: summary's reference column)")
    ap.add_argument("--assay-agent", type=parse_agent, metavar="CHAIN:ID",
                    help="ERC-8004 identity of the Assay host graded in this run (D21)")
    ap.add_argument("--assay-tag", help="tag of the endpoint that --assay-agent belongs to")
    ap.add_argument("--operator", help="who ran the grader, e.g. erc8004:143:10279 (goes in provenance_<stamp>.json)")
    ap.add_argument("--stance", choices=STANCES, default="ran-grader",
                    help="vouches: you stand behind the methodology; ran-grader (default): you only ran this code")
    a = ap.parse_args(argv)
    doc = export(a.out, a.stamp or latest_stamp(a.out), a.model, a.reference, a.assay_agent, a.assay_tag, a.operator, a.stance)
    print(f"wrote {len(doc['grades'])} grades to {a.out}/grades_{doc['stamp']}.json"
          + (f" (skipped, no successful responses: {', '.join(doc['skipped'])})" if doc["skipped"] else ""))
    print(f"evidence {a.out}/{doc['evidenceFile']} sha256 {doc['evidence']}")

if __name__ == "__main__":
    main()
