import contextlib, csv, hashlib, io, json, os, shutil, sys, tarfile, tempfile, unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import export_grade as eg  # noqa: E402

STAMP = "20261005T101500Z"
FIELDS = ["tag", "quantization", "tool_pass", "tool_n", "pass_rate", "ci_low", "ci_high",
          "max_tokens_ok", "http_errors", "delta_vs_reference", "flag"]

def write_run(d, results, extra_cols=None):
    """results: {tag: [ok, ok, ...]} for tool cases with http 200; adds one http error and a max_tokens row per tag."""
    rows = []
    with open(os.path.join(d, f"raw_{STAMP}.jsonl"), "w") as raw:
        for tag, oks in results.items():
            for ok in oks:
                raw.write(json.dumps({"case": "weather_basic", "tag": tag, "http": 200, "ok": ok}) + "\n")
            raw.write(json.dumps({"case": "flight_full", "tag": tag, "http": 502, "ok": False}) + "\n")
            raw.write(json.dumps({"case": "max_tokens_16", "tag": tag, "ok": True}) + "\n")
            row = {"tag": tag, "quantization": "fp8", "tool_pass": sum(oks), "tool_n": len(oks),
                   "pass_rate": "", "ci_low": "", "ci_high": "", "max_tokens_ok": True,
                   "http_errors": 1, "delta_vs_reference": "", "flag": ""}
            row.update((extra_cols or {}).get(tag, {}))
            rows.append(row)
    fields = FIELDS + sorted({k for r in rows for k in r} - set(FIELDS))
    with open(os.path.join(d, f"summary_{STAMP}.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(rows)


class Keccak(unittest.TestCase):
    VECTORS = {
        "": "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
        "abc": "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
    }

    def test_pure_python_known_vectors(self):
        for s, h in self.VECTORS.items():
            self.assertEqual(eg.keccak256_py(s.encode()).hex(), h)

    def test_not_sha3(self):
        self.assertNotEqual(eg.keccak256_py(b"abc"), hashlib.sha3_256(b"abc").digest())

    def test_keccak_hex_without_cast(self):
        with mock.patch.object(eg.shutil, "which", return_value=None):
            self.assertEqual(eg.keccak_hex("abc"), "0x" + self.VECTORS["abc"])

    @unittest.skipUnless(shutil.which("cast"), "cast not installed")
    def test_pure_python_matches_cast(self):
        # lengths around the 136-byte rate boundary exercise multi-block padding
        for data in [b"", b"abc", b"x" * 135, b"x" * 136, b"x" * 137, b"x" * 300, "z-ai/glm-5.3".encode()]:
            self.assertEqual(eg.keccak256_py(data), eg.keccak256_cast(data), len(data))


class Encodings(unittest.TestCase):
    # Fixed vectors: changing any of these changes onchain keys, so it must be deliberate.
    def test_openrouter_host_key(self):
        pre = eg.host_key_preimage("z-ai/fp8")
        self.assertEqual(pre, "openrouter:z-ai/fp8")
        self.assertEqual(eg.keccak_hex(pre), "0xe62ef805f5e37ece31d01a1567ffc50f659d5abebce5dc9462568ff81241cc81")

    def test_assay_host_key_uses_erc8004_identity(self):
        pre = eg.host_key_preimage("direct:assay.example.com", (10143, 1962))
        self.assertEqual(pre, "erc8004:10143:1962")
        self.assertEqual(eg.keccak_hex(pre), "0xbc6bc5b79f83de1bb4e63bacbdb8d82c8a38e1c9caa38043f8b6ba33ffb33e6c")

    def test_direct_host_key_keeps_its_tag(self):
        pre = eg.host_key_preimage("direct:generativelanguage.googleapis.com")
        self.assertEqual(pre, "direct:generativelanguage.googleapis.com")
        self.assertEqual(eg.keccak_hex(pre), "0xd0fe1e8708e22bc3fe3b101f9ab21a41052eb11b27d4d994f91cccca881927c7")

    def test_checks_and_model(self):
        self.assertEqual(eg.keccak_hex(eg.CHECKS_ID), "0x414c940358dd4cd842c195ab1ad421a6a54559284c6846f743916a5f934e001e")
        self.assertEqual(eg.keccak_hex("z-ai/glm-5.3"), "0x6cc954dc904d6bf2f1c308fedd093554068e88708ed27a3f644fd82e61e5d271")

    def test_bps_rounding_direction(self):
        self.assertEqual(eg.to_bps(0.123456, 0.654321), (1234, 6544))
        self.assertEqual(eg.to_bps(0.25, 0.75), (2500, 7500))  # exact values stay exact
        self.assertEqual(eg.to_bps(0.99999, 0.00001), (9999, 1))
        # float noise: 0.57 * 10000 == 5699.999999999999, 0.56 * 10000 == 5600.000000000001
        self.assertEqual(eg.to_bps(0.57, 1.0)[0], 5700)
        self.assertEqual(eg.to_bps(0.0, 0.56)[1], 5600)

    def test_bps_clamped(self):
        self.assertEqual(eg.to_bps(-0.01, 1.01), (0, 10000))

    def test_parse_agent(self):
        self.assertEqual(eg.parse_agent("10143:1962"), (10143, 1962))
        for bad in ["10143", "a:1", "1:", "1:2:3"]:
            with self.assertRaises(Exception):
                eg.parse_agent(bad)


class Export(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.d)

    def run_export(self, **kw):
        kw.setdefault("model", "z-ai/glm-5.3")
        kw.setdefault("reference", "z-ai/fp8")
        return eg.export(self.d, STAMP, **kw)

    def test_grade_fields_and_bounds(self):
        write_run(self.d, {"z-ai/fp8": [True] * 40, "cheap/int4": [True] * 25 + [False] * 15, "zero/fp8": [False] * 40})
        doc = self.run_export()
        self.assertEqual(len(doc["grades"]), 3)
        for g in doc["grades"]:
            self.assertEqual(set(g) - {"tag", "hostKeyPreimage"},
                             {"model", "hostKey", "checks", "passed", "total", "ciLowBps", "ciHighBps", "refModel", "evidence", "t"})
            self.assertLessEqual(g["passed"], g["total"])
            self.assertLessEqual(g["ciLowBps"], g["ciHighBps"])
            for v in (g["ciLowBps"], g["ciHighBps"]):
                self.assertTrue(0 <= v <= 10000)
            self.assertEqual(g["refModel"], eg.keccak_hex("z-ai/fp8"))
            self.assertEqual(g["t"], 1791195300)
        by = {g["tag"]: g for g in doc["grades"]}
        self.assertEqual((by["cheap/int4"]["passed"], by["cheap/int4"]["total"]), (25, 40))
        self.assertEqual(by["z-ai/fp8"]["ciHighBps"], 10000)
        self.assertEqual(by["zero/fp8"]["ciLowBps"], 0)
        with open(os.path.join(self.d, f"grades_{STAMP}.json")) as f:
            self.assertEqual(json.load(f), doc)

    def test_evidence_hash_matches_tarball(self):
        write_run(self.d, {"z-ai/fp8": [True, False]})
        doc = self.run_export()
        tgz = os.path.join(self.d, doc["evidenceFile"])
        with open(tgz, "rb") as f:
            digest = hashlib.sha256(f.read()).hexdigest()
        self.assertEqual(doc["evidence"], "0x" + digest)
        self.assertEqual(doc["grades"][0]["evidence"], "0x" + digest)
        with open(tgz + ".sha256") as f:
            self.assertEqual(f.read().split()[0], digest)
        with tarfile.open(tgz) as t:
            self.assertEqual(t.getnames(), [f"provenance_{STAMP}.json", f"raw_{STAMP}.jsonl", f"summary_{STAMP}.csv"])

    def test_provenance_in_bundle(self):
        write_run(self.d, {"z-ai/fp8": [True], "direct:assay.example.com": [True], "down/fp8": []})
        with mock.patch.object(eg, "grader_commit", return_value=("ab" * 20, False)):
            doc = self.run_export(assay_agent=(143, 10278), assay_tag="direct:assay.example.com",
                                  operator="erc8004:143:10279", stance="vouches")
        with tarfile.open(os.path.join(self.d, doc["evidenceFile"])) as t:
            prov = json.load(t.extractfile(f"provenance_{STAMP}.json"))
        self.assertEqual(prov["grader"], {"repo": eg.GRADER_REPO, "commit": "ab" * 20, "dirty": False, "checks": eg.CHECKS_ID})
        self.assertEqual((prov["operator"], prov["stance"]), ("erc8004:143:10279", "vouches"))
        # every endpoint in the run, skipped ones included, with the same preimage its grade uses
        self.assertEqual(prov["hostKeyPreimages"], {"z-ai/fp8": "openrouter:z-ai/fp8",
                                                    "direct:assay.example.com": "erc8004:143:10278",
                                                    "down/fp8": "openrouter:down/fp8"})
        for g in doc["grades"]:
            self.assertEqual(prov["hostKeyPreimages"][g["tag"]], g["hostKeyPreimage"])

    def test_provenance_defaults_to_ran_grader(self):
        write_run(self.d, {"z-ai/fp8": [True]})
        self.run_export()
        with open(os.path.join(self.d, f"provenance_{STAMP}.json")) as f:
            prov = json.load(f)
        self.assertEqual((prov["operator"], prov["stance"]), (None, "ran-grader"))

    def test_unknown_stance_rejected(self):
        write_run(self.d, {"z-ai/fp8": [True]})
        with self.assertRaises(SystemExit):
            self.run_export(stance="trust-me")

    def test_grader_commit_outside_git(self):
        with mock.patch.object(eg.subprocess, "run", side_effect=FileNotFoundError):
            self.assertEqual(eg.grader_commit(), (None, None))

    def test_evidence_is_deterministic(self):
        write_run(self.d, {"z-ai/fp8": [True, False]})
        with mock.patch("time.time", return_value=1000.0):
            first = self.run_export()["evidence"]
        os.utime(os.path.join(self.d, f"raw_{STAMP}.jsonl"), (0, 12345))
        with mock.patch("time.time", return_value=2000.0):
            self.assertEqual(self.run_export()["evidence"], first)

    def test_assay_agent_key(self):
        write_run(self.d, {"z-ai/fp8": [True], "direct:assay.example.com": [True]})
        doc = self.run_export(assay_agent=(10143, 1962), assay_tag="direct:assay.example.com")
        by = {g["tag"]: g for g in doc["grades"]}
        self.assertEqual(by["direct:assay.example.com"]["hostKey"], eg.keccak_hex("erc8004:10143:1962"))
        self.assertEqual(by["z-ai/fp8"]["hostKey"], eg.keccak_hex("openrouter:z-ai/fp8"))

    def test_assay_agent_needs_known_tag(self):
        write_run(self.d, {"z-ai/fp8": [True]})
        with self.assertRaises(SystemExit):
            self.run_export(assay_agent=(10143, 1962), assay_tag="nope")

    def test_endpoint_without_successes_is_skipped(self):
        write_run(self.d, {"z-ai/fp8": [True], "down/fp8": []})
        doc = self.run_export()
        self.assertEqual([g["tag"] for g in doc["grades"]], ["z-ai/fp8"])
        self.assertEqual(doc["skipped"], ["down/fp8"])

    def test_summary_raw_mismatch_rejected(self):
        write_run(self.d, {"z-ai/fp8": [True, True]})
        with open(os.path.join(self.d, f"raw_{STAMP}.jsonl"), "a") as f:
            f.write(json.dumps({"case": "weather_basic", "tag": "z-ai/fp8", "http": 200, "ok": False}) + "\n")
        with self.assertRaises(SystemExit):
            self.run_export()

    def test_unknown_reference_rejected(self):
        write_run(self.d, {"z-ai/fp8": [True]})
        with self.assertRaises(SystemExit):
            self.run_export(reference="z-ai")

    def test_model_and_reference_from_summary_columns(self):
        cols = {"z-ai/fp8": {"model": "z-ai/glm-5.3", "reference": True},
                "cheap/int4": {"model": "z-ai/glm-5.3", "reference": False}}
        write_run(self.d, {"z-ai/fp8": [True], "cheap/int4": [False]}, cols)
        doc = eg.export(self.d, STAMP)
        self.assertEqual((doc["modelId"], doc["reference"]), ("z-ai/glm-5.3", "z-ai/fp8"))

    def test_cli_picks_newest_stamp(self):
        write_run(self.d, {"z-ai/fp8": [True]})
        with contextlib.redirect_stdout(io.StringIO()):
            eg.main(["--out", self.d, "--model", "z-ai/glm-5.3", "--reference", "z-ai/fp8"])
        self.assertTrue(os.path.exists(os.path.join(self.d, f"grades_{STAMP}.json")))


if __name__ == "__main__":
    unittest.main()
