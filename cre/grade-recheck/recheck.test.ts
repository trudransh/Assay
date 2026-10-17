import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { gzipSync, strToU8 } from 'fflate'
import { decodeAbiParameters, sha256, type Hex } from 'viem'
import {
	type Claim,
	countsFromRaw,
	encodeReport,
	hostKeyPreimage,
	keccakText,
	REPORT_PARAMS,
	recheckBundle,
	stampToT,
	toBps,
	untar,
	wilson,
} from './recheck'

const dir = `${import.meta.dir}/fixtures`
const STAMP = '20261005T101500Z'
export const bundle = new Uint8Array(readFileSync(`${dir}/run/evidence_${STAMP}.tar.gz`))
export const grades = JSON.parse(readFileSync(`${dir}/run/grades_${STAMP}.json`, 'utf8'))
export const ASSAY_HOSTS = { 'direct:assay.example.com': 'erc8004:10143:1962' }
const VERIFIER = '0x00000000000000000000000000000000000000A1' as Hex

export function claimOf(g: any): Claim {
	return { verifier: VERIFIER, model: g.model, hostKey: g.hostKey, passed: g.passed, total: g.total, ciLowBps: g.ciLowBps, ciHighBps: g.ciHighBps, evidence: g.evidence, t: BigInt(g.t) }
}

describe('Wilson interval matches export_grade.py', () => {
	const vectors: [number, number, number, number][] = JSON.parse(readFileSync(`${dir}/wilson_vectors.json`, 'utf8'))
	test(`${vectors.length} checked-in vectors`, () => {
		const bad = vectors.filter(([k, n, lo, hi]) => {
			const [l, h] = toBps(...wilson(k, n))
			return l !== lo || h !== hi
		})
		expect(bad).toEqual([])
	})
	test('rounding widens and strips float noise', () => {
		expect(toBps(0.123456, 0.654321)).toEqual([1234, 6544])
		expect(toBps(0.25, 0.75)).toEqual([2500, 7500])
		expect(toBps(0.57, 1.0)).toEqual([5700, 10000])
	})
})

describe('encodings', () => {
	test('host key preimages and pinned hashes (D21)', () => {
		expect(keccakText(hostKeyPreimage('z-ai/fp8'))).toBe('0xe62ef805f5e37ece31d01a1567ffc50f659d5abebce5dc9462568ff81241cc81')
		expect(hostKeyPreimage('direct:generativelanguage.googleapis.com')).toBe('direct:generativelanguage.googleapis.com')
		expect(keccakText(hostKeyPreimage('direct:assay.example.com', ASSAY_HOSTS))).toBe('0xbc6bc5b79f83de1bb4e63bacbdb8d82c8a38e1c9caa38043f8b6ba33ffb33e6c')
	})
	test('stamp to timestamp', () => {
		expect(stampToT(STAMP)).toBe(1791195300n)
		expect(stampToT('2026-10-05')).toBeNull()
	})
})

describe('raw log recount', () => {
	test('skips max_tokens and non-200 rows, uses Python truthiness', () => {
		const raw = [
			{ tag: 'a', http: 200, ok: true },
			{ tag: 'a', ok: 1 },
			{ tag: 'a', http: 200, ok: {} },
			{ tag: 'a', http: 200, ok: [] },
			{ tag: 'a', http: 502, ok: true },
			{ tag: 'a', case: 'max_tokens_16', ok: true },
		]
			.map((r) => JSON.stringify(r))
			.join('\r\n')
		expect(countsFromRaw(`${raw}\n\n`).get('a')).toEqual([2, 4])
	})
	test('bundle holds the summary and the raw log', () => {
		const files = untar(require('fflate').gunzipSync(bundle))
		expect([...files.keys()]).toEqual([`provenance_${STAMP}.json`, `raw_${STAMP}.jsonl`, `summary_${STAMP}.csv`])
		expect(files.get(`raw_${STAMP}.jsonl`)).toEqual(new Uint8Array(readFileSync(`${dir}/run/raw_${STAMP}.jsonl`)))
	})
})

describe('recheckBundle against the harness export', () => {
	for (const g of grades.grades) {
		test(`${g.tag} recomputes to the exported grade`, () => {
			const r = recheckBundle(bundle, claimOf(g), ASSAY_HOSTS)
			expect(r).toEqual({ hashOk: true, tag: g.tag, passed: g.passed, total: g.total, ciLowBps: g.ciLowBps, ciHighBps: g.ciHighBps, stampT: String(g.t) })
		})
	}
	test('evidence hash mismatch', () => {
		const tampered = gzipSync(strToU8('not the bundle'), { mtime: 0 })
		expect(recheckBundle(tampered, claimOf(grades.grades[0])).hashOk).toBe(false)
	})
	test('provenance in the bundle maps the Assay host, no config needed', () => {
		expect(recheckBundle(bundle, claimOf(grades.grades[2])).tag).toBe('direct:assay.example.com')
	})
	test('a bundle without provenance (before 17 Oct) needs the config mapping', () => {
		const legacy = new Uint8Array(readFileSync(`${dir}/evidence/cd0b0aab09afd28ffb56d22dff6ac18a9ae582a4dad1e03b738c9d88e3a8b090.tar.gz`))
		const claim = { ...claimOf(grades.grades[2]), evidence: sha256(legacy) }
		expect(recheckBundle(legacy, claim).tag).toBeNull()
		expect(recheckBundle(legacy, claim, ASSAY_HOSTS).tag).toBe('direct:assay.example.com')
	})
	test('bundle without exactly one raw log is rejected', () => {
		const empty = gzipSync(new Uint8Array(1024), { mtime: 0 })
		const claim = { ...claimOf(grades.grades[0]), evidence: sha256(empty) }
		expect(() => recheckBundle(empty, claim)).toThrow('expected one raw_')
	})
})

describe('report encoding matches CreAttestor abi.decode', () => {
	const g = grades.grades[1]
	const claim = claimOf(g)
	const r = recheckBundle(bundle, claim)

	test('agreeing report round-trips through viem', () => {
		const enc = encodeReport(claim, r)
		expect((enc.length - 2) / 2).toBe(9 * 32) // CreAttestor.REPORT_LENGTH
		expect(decodeAbiParameters(REPORT_PARAMS, enc)).toEqual([VERIFIER, g.model, g.hostKey, BigInt(g.t), g.passed, g.total, g.ciLowBps, g.ciHighBps, true])
	})

	test('inflated claim: report carries the recount and agree = false', () => {
		const lie = { ...claim, passed: 9, ciLowBps: 5958, ciHighBps: 9822 }
		const out = decodeAbiParameters(REPORT_PARAMS, encodeReport(lie, recheckBundle(bundle, lie)))
		expect(out.slice(4)).toEqual([6, 10, 3126, 8319, false])
	})

	test('any single field off by one disagrees', () => {
		for (const off of [{ passed: claim.passed + 1 }, { total: claim.total + 1 }, { ciLowBps: claim.ciLowBps + 1 }, { ciHighBps: claim.ciHighBps - 1 }]) {
			const c = { ...claim, ...off }
			expect(decodeAbiParameters(REPORT_PARAMS, encodeReport(c, recheckBundle(bundle, c)))[8]).toBe(false)
		}
	})

	test('wrong timestamp disagrees', () => {
		const late = { ...claim, t: claim.t + 1n }
		expect(decodeAbiParameters(REPORT_PARAMS, encodeReport(late, recheckBundle(bundle, late)))[8]).toBe(false)
	})

	test('hash mismatch: report carries the posted counts and agree = false', () => {
		const bad = { ...claim, evidence: `0x${'00'.repeat(32)}` as Hex }
		const out = decodeAbiParameters(REPORT_PARAMS, encodeReport(bad, recheckBundle(bundle, bad)))
		expect(out.slice(4)).toEqual([6, 10, 3126, 8319, false])
	})

	const cast = spawnSync('cast', ['--version']).status === 0
	test.if(cast)('cast abi-decode reads the same layout', () => {
		const enc = encodeReport(claim, r)
		const sig = 'f()(address,bytes32,bytes32,uint64,uint32,uint32,uint16,uint16,bool)'
		const out = JSON.parse(spawnSync('cast', ['abi-decode', '--json', sig, enc], { encoding: 'utf8' }).stdout)
		expect(out).toEqual([VERIFIER, g.model, g.hostKey, g.t, 6, 10, 3126, 8319, true])
	})
})
