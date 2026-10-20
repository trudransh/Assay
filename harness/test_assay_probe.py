"""assay_probe.py argument handling and request building. urlopen is mocked, so nothing touches the network."""
import contextlib, csv, glob, io, json, os, shutil, sys, tempfile, unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import assay_probe as ap  # noqa: E402
import export_grade as eg  # noqa: E402

GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai"


class FakeResp(io.BytesIO):
    status = 200


def reply(req):
    """A correct answer for every case, so a live run passes everything."""
    body = json.loads(req.data)
    prompt = body["messages"][0]["content"]
    calls = {"Gwalior": ("get_weather", {"city": "Gwalior", "unit": "celsius"}),
             "DEL": ("search_flights", {"origin": "DEL", "destination": "BOM", "date": "2026-11-03", "passengers": 2}),
             "1250.50": ("convert_currency", {"amount": 1250.5, "from_currency": "USD", "to_currency": "INR"})}
    msg, finish = {"content": "OK"}, "stop"
    for needle, (name, args) in calls.items():
        if needle in prompt:
            msg = {"tool_calls": [{"function": {"name": name, "arguments": json.dumps(args)}}]}
    if body.get("max_tokens") == 16:
        finish = "length"
    return FakeResp(json.dumps({"choices": [{"message": msg, "finish_reason": finish}],
                                "usage": {"completion_tokens": 16}}).encode())


def no_network(*_a, **_k):
    raise AssertionError("network call during a test")


def run_main(argv):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        ap.main(argv)
    return out.getvalue()


class RequestBuilding(unittest.TestCase):
    def test_openrouter_requests_pin_the_provider(self):
        ep = ap.openrouter_ep({"tag": "z-ai/fp8", "pricing": None}, "z-ai/glm-5.3")
        body = ap.request_body(ep, "hi", temperature=0)
        self.assertEqual(body["provider"], {"only": ["z-ai/fp8"], "allow_fallbacks": False})
        self.assertEqual((body["model"], body["temperature"]), ("z-ai/glm-5.3", 0))

    def test_direct_requests_have_no_provider_field(self):
        ep = ap.direct_ep(GEMINI + "/", "gemma-4-31b-it", "GEMINI_API_KEY")
        self.assertEqual(ep["tag"], "direct:generativelanguage.googleapis.com")
        self.assertEqual(ep["base"], GEMINI)
        self.assertNotIn("provider", ap.request_body(ep, "hi"))

    def test_direct_tag_override(self):
        self.assertEqual(ap.direct_ep("http://localhost:8787/v1", "m", None, "assay-local")["tag"], "assay-local")

    def test_run_case_hits_direct_base_url_with_key(self):
        seen = []
        def fake(req, timeout):
            seen.append(req); return reply(req)
        ep = ap.direct_ep(GEMINI, "gemma-4-31b-it", "GEMINI_API_KEY")
        with mock.patch.object(ap.urllib.request, "urlopen", fake):
            rec = ap.run_case("k123", ep, ap.CASES[0])
        self.assertTrue(rec["ok"], rec)
        (req,) = seen
        self.assertEqual(req.full_url, GEMINI + "/chat/completions")
        self.assertEqual(req.get_header("Authorization"), "Bearer k123")
        body = json.loads(req.data)
        self.assertEqual(body["model"], "gemma-4-31b-it")
        self.assertNotIn("provider", body)

    def test_cap_check_passes_only_within_max_tokens(self):
        ep = ap.direct_ep("https://h/v1", "m", None)
        reply = lambda ct: (200, {"choices": [{"finish_reason": "length"}], "usage": {} if ct is None else {"completion_tokens": ct}})
        for ct, ok, why in [(16, True, ""), (18, True, ""), (2057, False, "billed output tokens=2057 over max_tokens=16"), (None, False, "no usage reported")]:
            with mock.patch.object(ap, "http", return_value=reply(ct)):
                r = ap.run_cap(None, ep)
            self.assertEqual((r["case"], r["ok"], r["reason"]), ("cap_16", ok, why))
        with mock.patch.object(ap, "http", return_value=(503, {"error": "busy"})):
            self.assertEqual((ap.run_cap(None, ep)["ok"], ap.run_cap(None, ep)["http"]), (False, 503))

    def test_billed_output_counts_thinking_reported_only_in_the_total(self):
        self.assertEqual(ap.billed_out({"prompt_tokens": 13, "completion_tokens": 0, "total_tokens": 26}), 13)
        self.assertEqual(ap.billed_out({"prompt_tokens": 13, "completion_tokens": 2057, "total_tokens": 2070}), 2057)
        self.assertIsNone(ap.billed_out({}))

    def test_stop_check_reads_the_answer_after_any_thinking(self):
        ep = ap.direct_ep("https://h/v1", "m", None)
        reply = lambda text: (200, {"choices": [{"message": {"content": text}, "finish_reason": "stop"}]})
        for text, ok in [("1 2 3 4 5 6 ", True), ("<thought>1 2 3 4 5 6 7 8</thought>1 2 3 4 5 6 ", True),
                         ("<think>7</think>", True), ("1 2 3 4 5 6 7 8 9", False), (None, True)]:
            with mock.patch.object(ap, "http", return_value=reply(text)):
                r = ap.run_stop(None, ep)
            self.assertEqual((r["case"], r["ok"]), ("stop_7", ok), text)
        with mock.patch.object(ap, "http", return_value=(500, {"error": "x"})):
            self.assertFalse(ap.run_stop(None, ep)["ok"])

    def test_no_key_sends_no_authorization(self):
        seen = []
        def fake(req, timeout):
            seen.append(req); return reply(req)
        with mock.patch.object(ap.urllib.request, "urlopen", fake):
            self.assertTrue(ap.run_max_tokens(None, ap.direct_ep("http://localhost:8787/v1", "m", None))["ok"])
        self.assertIsNone(seen[0].get_header("Authorization"))


class Arguments(unittest.TestCase):
    def test_direct_dry_run_makes_no_calls(self):
        with mock.patch.object(ap.urllib.request, "urlopen", no_network):
            out = run_main(["--model", "gemma", "--base-url", "http://localhost:8787/v1",
                            "--reference-base-url", GEMINI, "--dry-run"])
        self.assertIn("direct:localhost:8787", out)
        self.assertIn("direct:generativelanguage.googleapis.com", out)

    def test_openrouter_dry_run_only_lists_endpoints(self):
        seen = []
        listing = {"data": {"endpoints": [
            {"tag": "google-ai-studio", "quantization": None, "pricing": {"prompt": "0", "completion": "0"}},
            {"tag": "google-ai-studio", "quantization": None, "pricing": {"prompt": "0", "completion": "0"}}]}}
        def fake(req, timeout):
            seen.append(req); return FakeResp(json.dumps(listing).encode())
        with mock.patch.object(ap.urllib.request, "urlopen", fake):
            out = run_main(["--model", "google/gemma-4-31b-it:free", "--reference-model", "gemma-4-31b-it",
                            "--reference-base-url", GEMINI, "--dry-run"])
        self.assertEqual([r.get_method() for r in seen], ["GET"])
        self.assertTrue(seen[0].full_url.endswith("/models/google/gemma-4-31b-it:free/endpoints"))
        self.assertIn("2 endpoints", out)  # duplicate tag dropped, reference added

    def test_reference_flags_are_exclusive(self):
        with mock.patch.object(ap.urllib.request, "urlopen", no_network), \
             contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            ap.main(["--model", "m", "--base-url", "http://a/v1", "--reference", "x", "--reference-base-url", GEMINI, "--dry-run"])

    def test_reference_tag_collision_rejected(self):
        with mock.patch.object(ap.urllib.request, "urlopen", no_network), \
             contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            ap.main(["--model", "m", "--base-url", GEMINI, "--reference-base-url", GEMINI, "--dry-run"])

    def test_live_run_requires_key_env(self):
        with mock.patch.object(ap.urllib.request, "urlopen", no_network), \
             mock.patch.dict(os.environ, {}, clear=True), contextlib.redirect_stdout(io.StringIO()), \
             self.assertRaises(SystemExit):
            ap.main(["--model", "m", "--base-url", "http://a/v1", "--api-key-env", "ASSAY_TEST_KEY"])


class LiveRunToExport(unittest.TestCase):
    def test_direct_run_feeds_export(self):
        d = tempfile.mkdtemp(); self.addCleanup(shutil.rmtree, d)
        auth = set()
        def fake(req, timeout):
            auth.add((req.full_url.split("/")[2], req.get_header("Authorization"))); return reply(req)
        with mock.patch.object(ap.urllib.request, "urlopen", fake), \
             mock.patch.dict(os.environ, {"ASSAY_TEST_KEY": "k"}):
            run_main(["--model", "google/gemma-4-31b-it", "--base-url", "http://localhost:8787/v1",
                      "--reference-base-url", GEMINI, "--reference-api-key-env", "ASSAY_TEST_KEY",
                      "--repeats", "2", "--out", d])
        # each endpoint gets its own key: the reference's key never leaks to the graded host
        self.assertEqual(auth, {("localhost:8787", None), ("generativelanguage.googleapis.com", "Bearer k")})
        (summary,) = glob.glob(os.path.join(d, "summary_*.csv"))
        with open(summary) as f:
            rows = {r["tag"]: r for r in csv.DictReader(f)}
        self.assertEqual(rows["direct:generativelanguage.googleapis.com"]["reference"], "True")
        self.assertEqual(rows["direct:localhost:8787"]["reference"], "False")
        self.assertEqual(rows["direct:localhost:8787"]["tool_pass"], "8")
        stamp = os.path.basename(summary)[len("summary_"):-len(".csv")]
        doc = eg.export(d, stamp, assay_agent=(10143, 1962), assay_tag="direct:localhost:8787")
        self.assertEqual(doc["modelId"], "google/gemma-4-31b-it")
        self.assertEqual(doc["reference"], "direct:generativelanguage.googleapis.com")
        self.assertEqual([g["passed"] for g in doc["grades"]], [8, 8])



class Retry(unittest.TestCase):
    def test_retries_429_then_returns_success(self):
        codes = [429, 500, 200]
        def fake(req, timeout=None):
            c = codes.pop(0)
            if c != 200:
                raise ap.urllib.error.HTTPError(req.full_url, c, "x", {}, io.BytesIO(b'{"error":{}}'))
            r = io.BytesIO(b'{"ok":true}'); r.status = 200
            return contextlib.nullcontext(r)
        with mock.patch.object(ap.urllib.request, "urlopen", fake), mock.patch.object(ap.time, "sleep") as sl:
            self.assertEqual(ap.http("GET", "https://x"), (200, {"ok": True}))
        self.assertEqual(sl.call_count, 2)

    def test_gives_up_and_never_retries_4xx(self):
        calls = []
        def fake(req, timeout=None):
            calls.append(1)
            raise ap.urllib.error.HTTPError(req.full_url, 400, "x", {}, io.BytesIO(b'{}'))
        with mock.patch.object(ap.urllib.request, "urlopen", fake), mock.patch.object(ap.time, "sleep"):
            self.assertEqual(ap.http("GET", "https://x")[0], 400)
        self.assertEqual(len(calls), 1)

if __name__ == "__main__":
    unittest.main()
