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


def decode(result):
    """(passed, total, t) from the returned (Grade, address); t is 0 when no trusted verifier graded the host."""
    w = [int(result[2 + 64 * i: 66 + 64 * i], 16) for i in range(11)]
    return w[3], w[4], w[9]


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--max-days", type=float, default=5)
    p.add_argument("--rpc-url", default=RPC)
    a = p.parse_args(argv)
    ok = True
    for name, (model, host) in HOSTS.items():
        s, d = http("POST", a.rpc_url, {"jsonrpc": "2.0", "id": 1, "method": "eth_call",
                                        "params": [{"to": REGISTRY, "data": calldata(model, host, VERIFIER)}, "latest"]})
        if s != 200 or not isinstance(d, dict) or "result" not in d:
            print(f"{name}: RPC failed ({s}): {str(d)[:120]}"); ok = False; continue
        passed, total, t = decode(d["result"])
        if not t:
            print(f"{name}: no grade onchain"); ok = False; continue
        age = (time.time() - t) / 86400
        ok &= age <= a.max_days
        print(f"{name}: {passed}/{total}, {age:.1f} days old (run {time.strftime('%d %b %H:%M UTC', time.gmtime(t))}, expires after 7)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
