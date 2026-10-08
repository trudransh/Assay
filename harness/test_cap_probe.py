import unittest

from cap_probe import summarize


def rec(tag, ct, rt=0, rp=False, cost=0.001, http=200, cap=16):
    r = {"tag": tag, "cap": cap, "require_parameters": rp, "http": http}
    if http == 200:
        r.update(completion_tokens=ct, reasoning_tokens=rt, visible_tokens=ct - rt, cost=cost, overrun=ct > cap + 2, finish="stop")
    return r


class SummarizeTest(unittest.TestCase):
    def test_counts_overruns_only_among_answered_trials(self):
        rows = summarize([rec("a", 2000), rec("a", 16), rec("a", 0, http=429)], None)
        self.assertEqual(rows[0]["overruns"], 1)
        self.assertEqual(rows[0]["answered"], 2)
        self.assertEqual(rows[0]["http_errors"], 1)

    def test_visible_tokens_exclude_reasoning(self):
        rows = summarize([rec("a", 2000, rt=1400)], None)
        self.assertEqual(rows[0]["median_visible_tokens"], 600)

    def test_cost_is_compared_with_the_reference_in_the_same_mode(self):
        rs = [rec("ref", 16, cost=0.0001), rec("a", 2000, cost=0.009), rec("ref", 16, rp=True, cost=0.0002), rec("a", 16, rp=True, cost=0.0002)]
        rows = {(r["tag"], r["require_parameters"]): r for r in summarize(rs, "ref")}
        self.assertEqual(rows[("a", False)]["cost_vs_reference"], 90.0)
        self.assertEqual(rows[("a", True)]["cost_vs_reference"], 1.0)

    def test_a_cap_of_16_tolerates_two_tokens_of_slack(self):
        self.assertFalse(rec("a", 18)["overrun"])
        self.assertTrue(rec("a", 19)["overrun"])


if __name__ == "__main__":
    unittest.main()
