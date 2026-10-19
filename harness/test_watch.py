import os, unittest
from unittest import mock

import watch


class WatchTest(unittest.TestCase):
    @mock.patch("watch.time.sleep")
    def test_a_failed_check_is_tried_once_more(self, _sleep):
        flaky = iter(["down", None])
        self.assertIsNone(watch.twice(lambda: next(flaky)))
        self.assertEqual(watch.twice(lambda: "down"), "down")

    @mock.patch("watch.http", return_value=(200, {"result": hex(5 * 10**17)}))
    def test_wallet_below_its_floor_is_a_problem(self, _http):
        self.assertIn("0.500 MON", watch.wallet_problem("0xabc", "rpc", 1.0))
        self.assertIsNone(watch.wallet_problem("0xabc", "rpc", 0.5))

    @mock.patch("watch.http", return_value=(200, {"ok": True, "pending": 65}))
    def test_a_growing_queue_means_anchoring_is_failing(self, _http):
        self.assertIn("anchoring may be failing", watch.host_problem("https://h"))

    @mock.patch.dict(os.environ, {"NTFY_TOPIC": "t"})
    @mock.patch("watch.urllib.request.urlopen")
    @mock.patch("watch.recent_titles", return_value={"Assay down: indexer"})
    @mock.patch("watch.problems", return_value={"Assay down: indexer": "x", "Assay low gas: verifier": "y"})
    def test_only_alerts_not_sent_recently_go_out(self, _p, _r, urlopen):
        self.assertEqual(watch.main(), 1)
        sent = [c.args[0].get_header("Title") for c in urlopen.call_args_list]
        self.assertEqual(sent, ["Assay low gas: verifier"])


if __name__ == "__main__":
    unittest.main()
