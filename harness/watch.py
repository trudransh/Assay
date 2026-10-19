"""Is everything up? Our three hosts, the indexer, and the wallets that pay gas. Alerts ntfy.sh/$NTFY_TOPIC.

  python3 harness/watch.py            (prints each problem and exits 1 if there is one)

Meant to run outside the VM (.github/workflows/watch.yml): a VM that's down can't report itself. The same alert
isn't sent twice within 3 hours, because the script reads the topic's recent messages first. Stdlib only.
"""
import json, os, sys, time, urllib.parse, urllib.request

from assay_probe import http

VM = "https://34-45-1-81.sslip.io"
HOSTS = {"testnet host 1962": VM, "Gemma host 10278": VM + "/mainnet", "Kimi host 10316": VM + "/kimi"}
INDEXER = "https://indexer.dev.hyperindex.xyz/557d70c/v1/graphql"
MAINNET, TESTNET = "https://rpc.monad.xyz", "https://testnet-rpc.monad.xyz"
# (name, address, rpc, alert below this many MON). The hosts warn in their logs below 1 MON.
WALLETS = [("host relayer", "0x4B497c919075E81344dD494Aea0Fc1e2a6499BF5", MAINNET, 1.0),
           ("host relayer, testnet", "0x4B497c919075E81344dD494Aea0Fc1e2a6499BF5", TESTNET, 0.5),
           ("verifier", "0x4BaC2Be288B5931886EeC4c555895CE6BcAB19e7", MAINNET, 1.0)]
BATCH_MAX = 64  # a host anchors as soon as this many receipts wait, so more than this means anchoring is failing
QUIET_HOURS = 3


def twice(check):
    """A check that fails is tried once more after 20 s, so a network blip doesn't page anyone."""
    if not check():
        return None
    time.sleep(20)
    return check()


def host_problem(url):
    s, d = http("GET", url + "/health", timeout=30)
    if s != 200 or not isinstance(d, dict) or d.get("ok") is not True:
        return f"GET {url}/health returned {s}: {str(d)[:120]}"
    if d.get("pending", 0) > BATCH_MAX:
        return f"{d['pending']} receipts waiting to be anchored (more than {BATCH_MAX}): anchoring may be failing"
    return None


def indexer_problem():
    s, d = http("POST", INDEXER, {"query": "{ __typename }"}, timeout=30)
    return None if s == 200 and isinstance(d, dict) and "data" in d else f"indexer returned {s}: {str(d)[:120]}"


def wallet_problem(address, rpc, floor):
    s, d = http("POST", rpc, {"jsonrpc": "2.0", "id": 1, "method": "eth_getBalance", "params": [address, "latest"]}, timeout=30)
    if s != 200 or not isinstance(d, dict) or "result" not in d:
        return f"balance read failed ({s}): {str(d)[:120]}"
    mon = int(d["result"], 16) / 1e18
    return f"{mon:.3f} MON left on {address} (alert below {floor})" if mon < floor else None


def problems():
    out = {}
    for name, url in HOSTS.items():
        if p := twice(lambda: host_problem(url)):
            out[f"Assay down: {name}"] = p
    if p := twice(indexer_problem):
        out["Assay down: indexer"] = p
    for name, address, rpc, floor in WALLETS:
        if p := wallet_problem(address, rpc, floor):
            out[f"Assay low gas: {name}"] = p
    return out


def recent_titles(topic):
    url = f"https://ntfy.sh/{urllib.parse.quote(topic)}/json?poll=1&since={QUIET_HOURS}h"
    with urllib.request.urlopen(url, timeout=30) as r:
        return {json.loads(line).get("title") for line in r.read().decode().splitlines() if line.strip()}


def main():
    found = problems()
    for title, msg in found.items():
        print(f"{title}: {msg}")
    topic = os.environ.get("NTFY_TOPIC")
    if found and topic:
        sent = recent_titles(topic)
        for title, msg in found.items():
            if title not in sent:
                urllib.request.urlopen(urllib.request.Request(f"https://ntfy.sh/{urllib.parse.quote(topic)}", msg.encode(),
                                                              {"Title": title, "Priority": "high"}), timeout=30)
    if not found:
        print("all up")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
