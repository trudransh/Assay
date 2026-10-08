#!/usr/bin/env python3
"""
assay_probe.py: grade every OpenRouter host of one open-weight model on
tool-call correctness and parameter enforcement, against the lab's own endpoint.

Stdlib only. Endpoint discovery and --dry-run need no API key.
Live runs need OPENROUTER_API_KEY and spend real money (see --dry-run estimate).
--base-url grades one OpenAI-compatible endpoint directly instead of OpenRouter's hosts,
and --reference-base-url adds a lab's own API as the reference.

Examples:
  python3 assay_probe.py --model z-ai/glm-5.3 --dry-run
  python3 assay_probe.py --model z-ai/glm-5.3 --reference z-ai --repeats 10
  python3 assay_probe.py --model moonshotai/kimi-k3 --reference moonshotai --only parasail,wafer
  python3 assay_probe.py --model google/gemma-4-31b-it:free --reference-model gemma-4-31b-it \
      --reference-base-url https://generativelanguage.googleapis.com/v1beta/openai \
      --reference-api-key-env GEMINI_API_KEY --dry-run
"""
import argparse, csv, json, math, os, re, sys, time, urllib.parse, urllib.request, urllib.error

API = "https://openrouter.ai/api/v1"

# ---------------------------------------------------------------- test cases
TOOLS = [
    {"type": "function", "function": {
        "name": "get_weather",
        "description": "Current weather for a city.",
        "parameters": {"type": "object", "properties": {
            "city": {"type": "string"},
            "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]}},
            "required": ["city", "unit"]}}},
    {"type": "function", "function": {
        "name": "search_flights",
        "description": "Search one-way flights.",
        "parameters": {"type": "object", "properties": {
            "origin": {"type": "string", "description": "IATA code"},
            "destination": {"type": "string", "description": "IATA code"},
            "date": {"type": "string", "description": "YYYY-MM-DD"},
            "passengers": {"type": "integer", "minimum": 1}},
            "required": ["origin", "destination", "date", "passengers"]}}},
    {"type": "function", "function": {
        "name": "convert_currency",
        "description": "Convert an amount between currencies.",
        "parameters": {"type": "object", "properties": {
            "amount": {"type": "number"},
            "from_currency": {"type": "string", "description": "ISO 4217"},
            "to_currency": {"type": "string", "description": "ISO 4217"}},
            "required": ["amount", "from_currency", "to_currency"]}}},
]

CASES = [
    {"id": "weather_basic", "prompt": "What's the weather in Gwalior right now? Use celsius.",
     "expect": "get_weather", "check": lambda a: a.get("unit") == "celsius" and "gwalior" in str(a.get("city", "")).lower()},
    {"id": "flight_full", "prompt": "Find me a flight from Delhi (DEL) to Mumbai (BOM) on 2026-11-03 for 2 people.",
     "expect": "search_flights", "check": lambda a: a.get("origin") == "DEL" and a.get("destination") == "BOM"
        and a.get("date") == "2026-11-03" and a.get("passengers") == 2},
    {"id": "currency_number", "prompt": "Convert 1250.50 US dollars to Indian rupees.",
     "expect": "convert_currency", "check": lambda a: abs(float(a.get("amount", 0)) - 1250.5) < 1e-6
        and a.get("from_currency") == "USD" and a.get("to_currency") == "INR"},
    {"id": "no_tool_needed", "prompt": "Reply with just the word OK. Do not call any tool.",
     "expect": None, "check": None},
]

# ---------------------------------------------------------------- helpers
RETRIES = 4  # free tiers throttle (429) and Google's OpenAI layer throws transient 500s

def http(method, url, body=None, key=None, timeout=120):
    """Retries 429 and 5xx with backoff. A response that still fails is returned and counted as an error, never a pass."""
    for attempt in range(RETRIES + 1):
        status, data = _http_once(method, url, body, key, timeout)
        if (status != 429 and status < 500) or attempt == RETRIES:
            return status, data
        time.sleep(min(60, 5 * 2 ** attempt))

def _http_once(method, url, body, key, timeout):
    # Assay hosts require a fresh 32-byte salt per request (SPEC §1); other APIs ignore the header.
    headers = {"Content-Type": "application/json", "User-Agent": "assay-probe/0.1", "X-Assay-Salt": os.urandom(32).hex()}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.load(e)
        except Exception:
            return e.code, {"error": str(e)}
    except Exception as e:
        return 0, {"error": str(e)}

def schema_ok(fn_name, args):
    """Minimal JSON-schema check: required keys, primitive types, enums."""
    spec = next(t["function"]["parameters"] for t in TOOLS if t["function"]["name"] == fn_name)
    for k in spec.get("required", []):
        if k not in args:
            return False, f"missing {k}"
    for k, v in args.items():
        p = spec["properties"].get(k)
        if p is None:
            return False, f"unknown key {k}"
        t = p.get("type")
        if t == "string" and not isinstance(v, str): return False, f"{k} not string"
        if t == "integer" and not (isinstance(v, int) and not isinstance(v, bool)): return False, f"{k} not integer"
        if t == "number" and not (isinstance(v, (int, float)) and not isinstance(v, bool)): return False, f"{k} not number"
        if "enum" in p and v not in p["enum"]: return False, f"{k} not in enum"
    if fn_name == "search_flights" and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(args.get("date", ""))):
        return False, "bad date format"
    return True, ""

def wilson(k, n, z=1.96):
    if n == 0: return (0.0, 0.0)
    p = k / n; d = 1 + z*z/n
    c = (p + z*z/(2*n)) / d; h = z*math.sqrt(p*(1-p)/n + z*z/(4*n*n)) / d
    return (max(0.0, c-h), min(1.0, c+h))

def endpoints(model):
    s, d = http("GET", f"{API}/models/{model}/endpoints")
    if s != 200:
        sys.exit(f"could not list endpoints for {model}: {s} {d}")
    return d["data"]["endpoints"]

def openrouter_ep(e, model):
    return {**e, "base": API, "model": model, "key_env": "OPENROUTER_API_KEY", "pin": True}

def direct_ep(base_url, model, key_env, tag=None):
    """A plain OpenAI-compatible endpoint. The direct: tag keeps it apart from OpenRouter hosts in grades."""
    base = base_url.rstrip("/")
    return {"tag": tag or "direct:" + urllib.parse.urlparse(base).netloc, "base": base, "model": model,
            "key_env": key_env, "pin": False, "quantization": None, "pricing": None}

def request_body(ep, prompt, **params):
    body = {"model": ep["model"], "messages": [{"role": "user", "content": prompt}], **params}
    if ep["pin"]:
        body["provider"] = {"only": [ep["tag"]], "allow_fallbacks": False}
    return body

# ---------------------------------------------------------------- one request
def run_case(key, ep, case):
    tag = ep["tag"]
    body = request_body(ep, case["prompt"], tools=TOOLS, tool_choice="auto", temperature=0, max_tokens=512)
    t0 = time.time(); s, d = http("POST", f"{ep['base']}/chat/completions", body, key); dt = time.time() - t0
    rec = {"case": case["id"], "tag": tag, "http": s, "latency_s": round(dt, 2),
           "served_by": d.get("provider") if isinstance(d, dict) else None}
    if s != 200 or "choices" not in d:
        rec.update(ok=False, reason=f"http {s}: {str(d)[:200]}"); return rec
    msg = d["choices"][0].get("message", {}); calls = msg.get("tool_calls") or []
    rec["usage"] = d.get("usage")
    if case["expect"] is None:
        rec.update(ok=len(calls) == 0, reason="" if not calls else "called a tool when none was needed"); return rec
    if not calls:
        rec.update(ok=False, reason="no tool call"); return rec
    fn = calls[0].get("function", {}); name = fn.get("name")
    if name != case["expect"]:
        rec.update(ok=False, reason=f"wrong tool {name}"); return rec
    try:
        args = json.loads(fn.get("arguments") or "{}")
    except Exception:
        rec.update(ok=False, reason="arguments not valid JSON"); return rec
    ok, why = schema_ok(name, args)
    if not ok:
        rec.update(ok=False, reason=f"schema: {why}", args=args); return rec
    try:
        good = case["check"](args)
    except Exception:
        good = False
    rec.update(ok=bool(good), reason="" if good else "wrong argument values", args=args); return rec

def run_max_tokens(key, ep):
    tag = ep["tag"]
    body = request_body(ep, "Write a 500-word essay about rivers.", max_tokens=16, temperature=0)
    s, d = http("POST", f"{ep['base']}/chat/completions", body, key)
    if s != 200 or "choices" not in d:
        return {"case": "max_tokens_16", "tag": tag, "ok": False, "reason": f"http {s}"}
    u = d.get("usage") or {}; fr = d["choices"][0].get("finish_reason")
    ct = u.get("completion_tokens")
    ok = fr == "length" or (ct is not None and ct <= 18)
    return {"case": "max_tokens_16", "tag": tag, "ok": ok, "reason": "" if ok else f"finish={fr} completion_tokens={ct}", "usage": u}

# ---------------------------------------------------------------- main
def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--reference", help="tag or provider slug of the lab's own endpoint, e.g. z-ai")
    ap.add_argument("--repeats", type=int, default=10, help="repeats per case per endpoint")
    ap.add_argument("--only", help="comma-separated substrings to restrict endpoints")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--out", default="assay_out")
    ap.add_argument("--base-url", help="grade this OpenAI-compatible endpoint directly instead of OpenRouter's hosts")
    ap.add_argument("--api-key-env", help="env var holding the --base-url API key (none sent if unset)")
    ap.add_argument("--tag", help="tag for the --base-url endpoint (default direct:<host>)")
    ap.add_argument("--reference-base-url", help="the lab's own OpenAI-compatible API, used as the reference")
    ap.add_argument("--reference-model", help="model id at --reference-base-url (default --model)")
    ap.add_argument("--reference-api-key-env", help="env var holding the reference API key (none sent if unset)")
    a = ap.parse_args(argv)
    if a.reference and a.reference_base_url:
        ap.error("use --reference or --reference-base-url, not both")

    eps, seen = [], set()
    if a.base_url:
        eps.append(direct_ep(a.base_url, a.model, a.api_key_env, a.tag))
    else:
        for e in endpoints(a.model):      # the API can list the same tag twice
            if e["tag"] not in seen:
                seen.add(e["tag"]); eps.append(openrouter_ep(e, a.model))
    if a.only:
        wanted = [w.strip().lower() for w in a.only.split(",")]
        eps = [e for e in eps if any(w in e["tag"].lower() for w in wanted)
               or (a.reference and a.reference.lower() in e["tag"].lower())]
    if a.reference_base_url:
        ref_ep = direct_ep(a.reference_base_url, a.reference_model or a.model, a.reference_api_key_env)
        if ref_ep["tag"] in {e["tag"] for e in eps}:
            ap.error(f"reference tag {ref_ep['tag']} collides with a graded endpoint; pass --tag")
        eps.append(ref_ep)
        a.reference = ref_ep["tag"]
    n_req = a.repeats * len(CASES) + 1
    est_in, est_out = 700, 200  # rough tokens per request (tool schemas + prompt; short outputs)
    total = 0.0
    print(f"{a.model}: {len(eps)} endpoints, {n_req} requests each\n")
    print(f"{'tag':28s} {'quant':8s} {'in$/M':>7s} {'out$/M':>7s} {'est $':>7s}")
    for e in eps:
        if not e["pricing"]:
            print(f"{e['tag']:28s} {'unknown':8s} {'n/a':>7s} {'n/a':>7s} {'n/a':>7s}  (direct, billed by its provider)")
            continue
        pi = float(e["pricing"]["prompt"]) * 1e6; po = float(e["pricing"]["completion"]) * 1e6
        cost = n_req * (est_in * pi + est_out * po) / 1e6; total += cost
        print(f"{e['tag']:28s} {str(e.get('quantization') or 'unknown'):8s} {pi:7.2f} {po:7.2f} {cost:7.2f}")
    print(f"\nestimated total: ${total:.2f} (reasoning models can cost several times more)")
    if a.dry_run:
        return

    keys = {env: os.environ.get(env) or sys.exit(f"set {env}") for env in {e["key_env"] for e in eps if e["key_env"]}}
    os.makedirs(a.out, exist_ok=True)
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    raw = open(os.path.join(a.out, f"raw_{stamp}.jsonl"), "w")
    summary = []
    for e in eps:
        tag = e["tag"]; recs = []; key = keys.get(e["key_env"])
        for _ in range(a.repeats):
            for c in CASES:
                r = run_case(key, e, c); recs.append(r); raw.write(json.dumps(r) + "\n"); raw.flush()
        r = run_max_tokens(key, e); recs.append(r); raw.write(json.dumps(r) + "\n")
        tool = [r for r in recs if r["case"] != "max_tokens_16" and r.get("http", 200) == 200]
        k = sum(r["ok"] for r in tool); n = len(tool); lo, hi = wilson(k, n)
        errors = sum(1 for r in recs if r.get("http") not in (None, 200))
        summary.append({"tag": tag, "quantization": e.get("quantization") or "unknown", "tool_pass": k, "tool_n": n,
                        "pass_rate": round(k/n, 3) if n else None, "ci_low": round(lo, 3), "ci_high": round(hi, 3),
                        "max_tokens_ok": recs[-1]["ok"], "http_errors": errors})
        print(f"{tag:28s} tool {k}/{n}  [{lo:.2f}, {hi:.2f}]  max_tokens_ok={recs[-1]['ok']}  errors={errors}")
    raw.close()
    ref = next((s for s in summary if a.reference and a.reference.lower() in s["tag"].lower()), None)
    for s in summary:
        s["delta_vs_reference"] = round(s["pass_rate"] - ref["pass_rate"], 3) if ref and s["pass_rate"] is not None and ref["pass_rate"] is not None else None
        # A host with no answered checks wasn't measured, so it can't be below anything.
        s["flag"] = "BELOW REFERENCE" if ref and s["tool_n"] and s["ci_high"] < ref["ci_low"] else ""
        s["model"] = a.model; s["reference"] = s is ref  # read by export_grade.py
    with open(os.path.join(a.out, f"summary_{stamp}.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(summary[0].keys())); w.writeheader(); w.writerows(summary)
    print(f"\nwrote {a.out}/raw_{stamp}.jsonl and summary_{stamp}.csv")

if __name__ == "__main__":
    main()
