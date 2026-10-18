#!/usr/bin/env bash
# Re-grade one of our Assay hosts against the lab's own endpoint and stage the result for posting.
#   bash harness/regrade.sh gemma|kimi        (from the repo root; API keys come from .env and are never printed)
# Probes the reference and the host in parallel, merges the two runs, exports grades with provenance
# (operator = our verifier agent, stance "vouches"), copies the evidence bundle to where CRE fetches it once
# pushed, and writes the post commands. It never touches a key: run `bash harness/post.sh <post_cmds.txt>` yourself.
# Re-running the same day skips probes that already finished. The host probe sends GRADER_TOKEN from .env, which
# lets it past the host's chat limits (Kimi's allows 10 an hour); push-secrets.sh puts the same token on the VM.
set -euo pipefail
cd "$(dirname "$0")/.."
WHO=${1:?usage: regrade.sh gemma|kimi}
OPERATOR=erc8004:143:10279
REGISTRY=0x0C8603041E7d425c4DCa041680C7AF4581dDa9a1
RPC=https://rpc.monad.xyz
case "$WHO" in
  gemma) MODEL=gemma-4-31b-it AGENT=143:10278 TAG=assay-gemma-10278 REPEATS=10
         HOST_URL=https://34-45-1-81.sslip.io/mainnet/v1 REFERENCE=direct:generativelanguage.googleapis.com
         REF_ARGS=(--base-url https://generativelanguage.googleapis.com/v1beta/openai --api-key-env GEMINI_API_KEY --reference "$REFERENCE") ;;
  kimi)  MODEL=moonshotai/kimi-k2.6 AGENT=143:10316 TAG=assay-kimi-10316 REPEATS=8
         HOST_URL=https://34-45-1-81.sslip.io/kimi/v1 REFERENCE=moonshotai/int4
         REF_ARGS=(--only moonshotai --reference "$REFERENCE") ;;
  *) echo "regrade.sh: host must be gemma or kimi" >&2; exit 1 ;;
esac
OUT=${OUT:-harness/regrade_out/$WHO-$(date -u +%Y%m%d)}
mkdir -p "$OUT"
set -a; . ./.env; set +a

probe() { # <dir> <assay_probe args...>; skipped when the dir already holds a finished run
  local dir=$1; shift
  compgen -G "$dir/summary_*.csv" >/dev/null && return 0
  python3 -u harness/assay_probe.py --model "$MODEL" --repeats "$REPEATS" --out "$dir" "$@" > "$dir.log" 2>&1
}
probe "$OUT/ref" "${REF_ARGS[@]}" & REF_PID=$!
probe "$OUT/host" --base-url "$HOST_URL" --tag "$TAG" --api-key-env GRADER_TOKEN & HOST_PID=$!
wait $REF_PID && wait $HOST_PID

# One run with both endpoints, under the reference run's stamp.
S=$(basename "$(ls "$OUT"/ref/summary_*.csv | tail -1)" .csv); S=${S#summary_}
M=$OUT/merged
rm -rf "$M"; mkdir -p "$M"
cat "$OUT/ref/raw_$S.jsonl" "$OUT"/host/raw_*.jsonl > "$M/raw_$S.jsonl"
{ cat "$OUT/ref/summary_$S.csv"; tail -n +2 -q "$OUT"/host/summary_*.csv; } > "$M/summary_$S.csv"

python3 harness/export_grade.py --out "$M" --stamp "$S" --model "$MODEL" --reference "$REFERENCE" \
  --assay-agent "$AGENT" --assay-tag "$TAG" --operator "$OPERATOR" --stance vouches
SHA=$(cut -c1-64 "$M/evidence_$S.tar.gz.sha256")
# A grade onchain may already point at the published bundle: never replace it with different bytes.
for f in evidence_$S.tar.gz grades_$S.json; do
  if [ -e "docs/evidence/$f" ] && ! cmp -s "$M/$f" "docs/evidence/$f"; then
    echo "regrade.sh: docs/evidence/$f already exists with different content; not overwriting" >&2; exit 1
  fi
done
cp "$M/evidence_$S.tar.gz" "cre/grade-recheck/fixtures/evidence/$SHA.tar.gz"
cp "$M/evidence_$S.tar.gz" "$M/grades_$S.json" docs/evidence/

python3 harness/post_grade.py "$M/grades_$S.json" --registry "$REGISTRY" --rpc-url "$RPC" > "$OUT/post_cmds.txt"
column -s, -t "$M/summary_$S.csv" | cut -c1-120
echo
echo "staged: docs/evidence/evidence_$S.tar.gz, docs/evidence/grades_$S.json, cre/grade-recheck/fixtures/evidence/$SHA.tar.gz"
echo "next: commit and push those three files, then run: bash harness/post.sh $OUT/post_cmds.txt"
