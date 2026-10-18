#!/usr/bin/env bash
# Stages a finished re-grade for posting: the evidence bundle goes where CRE fetches it once pushed, the bundle
# and grades file to docs/evidence. regrade.sh calls it; for a run made on the VM, copy the run folder here first
# (the ntfy alert has the command).
#   bash harness/stage.sh harness/regrade_out/<run>
set -euo pipefail
RUN=${1:?usage: stage.sh <run dir>}
M=$(realpath "$RUN")/merged
cd "$(dirname "$0")/.."
EV=$(ls "$M"/evidence_*.tar.gz | tail -1)
S=$(basename "$EV" .tar.gz); S=${S#evidence_}
SHA=$(cut -c1-64 "$EV.sha256")
# A grade onchain may already point at the published bundle: never replace it with different bytes.
for f in evidence_$S.tar.gz grades_$S.json; do
  if [ -e "docs/evidence/$f" ] && ! cmp -s "$M/$f" "docs/evidence/$f"; then
    echo "stage.sh: docs/evidence/$f already exists with different content; not overwriting" >&2; exit 1
  fi
done
cp "$EV" "cre/grade-recheck/fixtures/evidence/$SHA.tar.gz"
cp "$EV" "$M/grades_$S.json" docs/evidence/
echo "staged: docs/evidence/evidence_$S.tar.gz, docs/evidence/grades_$S.json, cre/grade-recheck/fixtures/evidence/$SHA.tar.gz"
echo "next: commit and push those three files, then run: bash harness/post.sh $RUN/post_cmds.txt"
