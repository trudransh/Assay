import json, os, tempfile, unittest

from feed import RAW_BASE, build, published


def run_file(d, stamp, model, reference, tags):
    grades = [{"tag": t, "hostKeyPreimage": p} for t, p in tags]
    with open(os.path.join(d, f"grades_{stamp}.json"), "w") as f:
        json.dump({"modelId": model, "reference": reference, "evidence": f"0x{stamp}", "evidenceFile": f"evidence_{stamp}.tar.gz", "grades": grades}, f)


def grade(evidence, t=100):
    return {"hostKey": "0xk", "passed": 32, "total": 32, "ciLowBps": 8928, "ciHighBps": 10000, "checks": "0xc",
            "refModel": "0xr", "evidence": evidence, "t": t, "verifier": "0xv", "model": "0xm"}


class FeedTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        run_file(self.dir, "1", "kimi", "moonshotai/int4", [("moonshotai/int4", "openrouter:moonshotai/int4"), ("a/fp8", "openrouter:a/fp8")])
        run_file(self.dir, "2", "kimi", "moonshotai/int4", [("moonshotai/int4", "openrouter:moonshotai/int4"), ("assay-kimi", "erc8004:143:1")])
        run_file(self.dir, "3", "glm", "z/fp8", [("z/fp8", "openrouter:z/fp8")])

    def test_published_collects_hosts_reference_and_files(self):
        models, files = published(self.dir)
        self.assertEqual(models["kimi"], {"reference": "openrouter:moonshotai/int4",
                                          "hosts": ["openrouter:moonshotai/int4", "openrouter:a/fp8", "erc8004:143:1"]})
        self.assertEqual(files["0x2"], "evidence_2.tar.gz")

    def test_only_onchain_grades_make_the_feed(self):
        models, files = published(self.dir)
        onchain = {("kimi", "openrouter:moonshotai/int4"): grade("0x2"), ("kimi", "erc8004:143:1"): grade("0xgone")}
        feed = build(models, files, lambda m, h: onchain.get((m, h)), 5)
        self.assertEqual([m["model"] for m in feed["models"]], ["kimi"])  # glm has nothing onchain
        hosts = {h["host"]: h for h in feed["models"][0]["hosts"]}
        self.assertEqual(set(hosts), {"openrouter:moonshotai/int4", "erc8004:143:1"})
        self.assertEqual(hosts["openrouter:moonshotai/int4"]["evidenceUrl"], RAW_BASE + "evidence_2.tar.gz")
        self.assertIsNone(hosts["erc8004:143:1"]["evidenceUrl"])  # evidence not in any published file
        self.assertNotIn("model", hosts["erc8004:143:1"])
        self.assertEqual((feed["version"], feed["chainId"], feed["generatedAt"]), (1, 143, 5))

    def test_a_failed_read_stops_the_build(self):
        models, files = published(self.dir)
        def boom(m, h):
            raise RuntimeError("RPC failed")
        with self.assertRaises(RuntimeError):
            build(models, files, boom, 5)


if __name__ == "__main__":
    unittest.main()
