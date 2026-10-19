"""How old is the newest onchain grade for each of our hosts? Exits 1 if one is missing or older than --max-days.

  python3 harness/grade_age.py                 (Monad mainnet, our verifier, both hosts)

Grades stop counting 7 days after their run, so the VM job (harness/vm_grader.sh) alerts at 5.
Stdlib only: one eth_call per host to VerifierRegistry.gradeOf.
"""
import argparse, sys, time

from assay_probe import http
from export_grade import keccak_hex

REGISTRY = "0x0C8603041E7d425c4DCa041680C7AF4581dDa9a1"
VERIFIER = "0x4BaC2Be288B5931886EeC4c555895CE6BcAB19e7"  # owner of verifier agent 10279
RPC = "https://rpc.monad.xyz"
HOSTS = {"gemma": ("gemma-4-31b-it", "erc8004:143:10278"), "kimi": ("moonshotai/kimi-k2.6", "erc8004:143:10316")}


def calldata(model, host, verifier):
    """gradeOf(keccak(model), keccak(host), [verifier])"""
    words = [keccak_hex(model)[2:], keccak_hex(host)[2:], f"{0x60:064x}", f"{1:064x}", verifier[2:].lower().rjust(64, "0")]
    return "0x" + keccak_hex("gradeOf(bytes32,bytes32,address[])")[2:10] + "".join(words)


FIELDS = ("model", "hostKey", "checks", "passed", "total", "ciLowBps", "ciHighBps", "refModel", "evidence", "t", "verifier")
HASHES = {"model", "hostKey", "checks", "refModel", "evidence"}


def decode(result):
    """The returned (Grade, address) as a dict; t is 0 when no trusted verifier graded the host."""
    w = [result[2 + 64 * i: 66 + 64 * i] for i in range(11)]
    out = {f: "0x" + v if f in HASHES else int(v, 16) for f, v in zip(FIELDS, w)}
    out["verifier"] = "0x" + w[10][24:]
    return out


def grade_of(model, host, rpc=RPC, verifier=VERIFIER):
    """Newest grade from `verifier` for (model, host), or None when there is none. Raises if the RPC fails."""
    s, d = http("POST", rpc, {"jsonrpc": "2.0", "id": 1, "method": "eth_call",
                              "params": [{"to": REGISTRY, "data": calldata(model, host, verifier)}, "latest"]})
    if s != 200 or not isinstance(d, dict) or "result" not in d:
        raise RuntimeError(f"RPC failed ({s}): {str(d)[:120]}")
    g = decode(d["result"])
    return g if g["t"] else None


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--max-days", type=float, default=5)
    p.add_argument("--rpc-url", default=RPC)
    a = p.parse_args(argv)
    ok = True
    for name, (model, host) in HOSTS.items():
        try:
            g = grade_of(model, host, a.rpc_url)
        except RuntimeError as e:
            print(f"{name}: {e}"); ok = False; continue
        if not g:
            print(f"{name}: no grade onchain"); ok = False; continue
        passed, total, t = g["passed"], g["total"], g["t"]
        age = (time.time() - t) / 86400
        ok &= age <= a.max_days
        print(f"{name}: {passed}/{total}, {age:.1f} days old (run {time.strftime('%d %b %H:%M UTC', time.gmtime(t))}, expires after 7)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
