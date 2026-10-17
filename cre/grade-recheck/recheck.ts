// Pure re-check logic: a port of harness/export_grade.py and assay_probe.wilson. No CRE imports, so it unit-tests directly.
import { gunzipSync, strFromU8 } from 'fflate'
import { encodeAbiParameters, keccak256, parseAbiParameters, sha256, stringToHex, type Hex } from 'viem'

export const MAX_TOKENS_CASE = 'max_tokens_16'

/** The GradePosted fields the re-check needs. */
export type Claim = {
	verifier: Hex
	model: Hex
	hostKey: Hex
	passed: number
	total: number
	ciLowBps: number
	ciHighBps: number
	evidence: Hex
	t: bigint
}

export type Recheck = {
	hashOk: boolean
	tag: string | null
	passed: number
	total: number
	ciLowBps: number
	ciHighBps: number
	stampT: string | null
}

export function wilson(k: number, n: number, z = 1.96): [number, number] {
	if (n === 0) return [0, 0]
	const p = k / n
	const d = 1 + (z * z) / n
	const c = (p + (z * z) / (2 * n)) / d
	const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
	return [Math.max(0, c - h), Math.min(1, c + h)]
}

// Python round(x, 9): toFixed rounds the exact binary value, like Python does.
const round9 = (x: number) => Number(x.toFixed(9))
const clampBps = (v: number) => Math.max(0, Math.min(10000, v))

/** Widen, never narrow: low rounds down, high rounds up (export_grade.to_bps). */
export function toBps(lo: number, hi: number): [number, number] {
	return [clampBps(Math.floor(round9(lo * 10000))), clampBps(Math.ceil(round9(hi * 10000)))]
}

/** Python truthiness for JSON values: {} and [] are falsy there, truthy in JS. */
function pyTruthy(v: unknown): boolean {
	if (Array.isArray(v)) return v.length > 0
	if (v !== null && typeof v === 'object') return Object.keys(v).length > 0
	return Boolean(v)
}

/** passed/total per tag, recounted exactly like export_grade.counts_from_raw. */
export function countsFromRaw(jsonl: string): Map<string, [number, number]> {
	const out = new Map<string, [number, number]>()
	for (const line of jsonl.split(/\r\n|\r|\n/)) {
		if (!line.trim()) continue
		const r = JSON.parse(line)
		if (r.case === MAX_TOKENS_CASE || (r.http ?? 200) !== 200) continue
		if (typeof r.tag !== 'string') throw new Error('raw record without a tag')
		const [k, n] = out.get(r.tag) ?? [0, 0]
		out.set(r.tag, [k + (pyTruthy(r.ok) ? 1 : 0), n + 1])
	}
	return out
}

/** Regular files of a ustar archive (what export_grade.write_evidence writes). */
export function untar(tar: Uint8Array): Map<string, Uint8Array> {
	const files = new Map<string, Uint8Array>()
	const str = (a: number, b: number) => strFromU8(tar.subarray(a, b)).replace(/\0.*$/s, '')
	for (let off = 0; off + 512 <= tar.length; ) {
		if (tar.subarray(off, off + 512).every((b) => b === 0)) break
		const name = str(off, off + 100)
		const prefix = str(off + 345, off + 500)
		const size = Number.parseInt(str(off + 124, off + 136).trim() || '0', 8)
		const type = String.fromCharCode(tar[off + 156])
		if (Number.isNaN(size) || off + 512 + size > tar.length) throw new Error('truncated tar')
		if (type === '0' || type === '\0') files.set(prefix ? `${prefix}/${name}` : name, tar.subarray(off + 512, off + 512 + size))
		off += 512 + Math.ceil(size / 512) * 512
	}
	return files
}

/** D21 host key preimage; `assayHosts` maps a run tag to its "erc8004:<chain>:<agent>" identity. */
export function hostKeyPreimage(tag: string, assayHosts: Record<string, string> = {}): string {
	return assayHosts[tag] ?? (tag.startsWith('direct:') ? tag : `openrouter:${tag}`)
}

export const keccakText = (s: string): Hex => keccak256(stringToHex(s))

/** Tag -> host key preimage from the bundle's provenance_<stamp>.json; {} for bundles without one (before 17 Oct) or a broken one. */
export function provenanceHosts(files: Map<string, Uint8Array>): Record<string, string> {
	const found = [...files.keys()].filter((f) => /^provenance_.+\.json$/.test(f))
	if (found.length !== 1) return {}
	try {
		const m = JSON.parse(strFromU8(files.get(found[0])!)).hostKeyPreimages
		return Object.fromEntries(Object.entries(m ?? {}).filter(([, v]) => typeof v === 'string')) as Record<string, string>
	} catch {
		return {}
	}
}

/** "20261005T101500Z" -> unix seconds, like calendar.timegm(time.strptime(stamp, "%Y%m%dT%H%M%SZ")). */
export function stampToT(stamp: string): bigint | null {
	const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp)
	if (!m) return null
	const [y, mo, d, h, mi, s] = m.slice(1).map(Number)
	return BigInt(Date.UTC(y, mo - 1, d, h, mi, s) / 1000)
}

/** Everything one node computes from the fetched bundle. Deterministic, so identical consensus applies. */
export function recheckBundle(bundle: Uint8Array, claim: Claim, assayHosts: Record<string, string> = {}): Recheck {
	const fail: Recheck = { hashOk: false, tag: null, passed: 0, total: 0, ciLowBps: 0, ciHighBps: 0, stampT: null }
	if (sha256(bundle).toLowerCase() !== claim.evidence.toLowerCase()) return fail
	const files = untar(gunzipSync(bundle))
	const raws = [...files.keys()].filter((f) => /^raw_.+\.jsonl$/.test(f))
	if (raws.length !== 1) throw new Error(`expected one raw_<stamp>.jsonl in the bundle, found ${raws.length}`)
	const stampT = stampToT(raws[0].slice('raw_'.length, -'.jsonl'.length))
	const counts = countsFromRaw(strFromU8(files.get(raws[0])!))
	// The verifier's own map, hashed into the evidence, wins over the config's list (kept for older bundles).
	const hosts = { ...assayHosts, ...provenanceHosts(files) }
	const tag = [...counts.keys()].find((t) => keccakText(hostKeyPreimage(t, hosts)) === claim.hostKey.toLowerCase()) ?? null
	const [passed, total] = tag ? counts.get(tag)! : [0, 0]
	const [ciLowBps, ciHighBps] = toBps(...wilson(passed, total))
	return { hashOk: true, tag, passed, total, ciLowBps, ciHighBps, stampT: stampT === null ? null : stampT.toString() }
}

/** True when the recomputed grade equals the posted one in every field we can recompute. */
export function agrees(r: Recheck, c: Claim): boolean {
	return (
		r.hashOk &&
		r.tag !== null &&
		r.stampT === c.t.toString() &&
		r.passed === c.passed &&
		r.total === c.total &&
		r.ciLowBps === c.ciLowBps &&
		r.ciHighBps === c.ciHighBps
	)
}

export const REPORT_PARAMS = parseAbiParameters(
	'address verifier, bytes32 model, bytes32 hostKey, uint64 t, uint32 passed, uint32 total, uint16 ciLowBps, uint16 ciHighBps, bool agree',
)

/**
 * CreAttestor report. It carries the recomputed counts when the bundle could be recounted for this host;
 * otherwise (hash mismatch, unknown host, nothing countable) the posted counts with agree = false.
 */
export function encodeReport(c: Claim, r: Recheck): Hex {
	const own = r.hashOk && r.tag !== null && r.total > 0
	const v = own ? r : c
	return encodeAbiParameters(REPORT_PARAMS, [c.verifier, c.model, c.hostKey, c.t, v.passed, v.total, v.ciLowBps, v.ciHighBps, agrees(r, c)])
}
