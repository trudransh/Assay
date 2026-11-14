import unittest

from grade_age import VERIFIER, calldata, decode


class GradeAgeTest(unittest.TestCase):
    def test_calldata_matches_cast(self):
        # cast calldata "gradeOf(bytes32,bytes32,address[])" $(cast keccak moonshotai/kimi-k2.6) $(cast keccak erc8004:143:10316) "[0x4BaC…19e7]"
        self.assertEqual(calldata("moonshotai/kimi-k2.6", "erc8004:143:10316", VERIFIER),
                         "0x6b31581487ee87bf5e3d5cc82c897dd19527c9f47935f16d0bc8a2efda4c6a33066ad56957b4dfbdf9734c34770238340612b51cd2d264ed2c0643cd548f80078b53b984"
                         "0000000000000000000000000000000000000000000000000000000000000060"
                         "0000000000000000000000000000000000000000000000000000000000000001"
                         "0000000000000000000000004bac2be288b5931886eec4c555895ce6bcab19e7")

    def test_decode_reads_every_field(self):
        words = [0] * 11
        words[3], words[4], words[5], words[9], words[10] = 37, 37, 9059, 1792250648, int(VERIFIER, 16)
        g = decode("0x" + "".join(f"{w:064x}" for w in words))
        self.assertEqual((g["passed"], g["total"], g["ciLowBps"], g["t"]), (37, 37, 9059, 1792250648))
        self.assertEqual(g["verifier"], VERIFIER.lower())
        self.assertEqual(g["evidence"], "0x" + "0" * 64)


if __name__ == "__main__":
    unittest.main()
