#!/usr/bin/env bash
# The VM's daily grading job (host/deploy/assay-grader.timer). Mondays and Thursdays it re-grades both of our hosts
# with regrade.sh, keeping the runs outside the checkout; every day it checks how old the onchain grades are.
# Each outcome goes to ntfy.sh/$NTFY_TOPIC. Posting stays with the owner: the alert says what to run.
set -uo pipefail
cd "$(dirname "$0")/.."
RUNS=${STATE_DIRECTORY:-/var/lib/assay-grader}
note() { curl -fsS -m 20 -H "Title: $1" -d "$2" "https://ntfy.sh/$NTFY_TOPIC" >/dev/null || echo "ntfy failed: $1" >&2; }
# This checkout only runs the grader (the hosts run from /opt/assay), so it can follow its branch on its own.
git pull --ff-only -q || note "Assay grader: git pull failed" "Grading with the checked-out commit $(git rev-parse --short HEAD)."

regrade() {
  local run=$1-$(date -u +%Y%m%d)
  if STAGE=0 OUT="$RUNS/$run" bash harness/regrade.sh "$1" > "$RUNS/$run.log" 2>&1; then
    note "Assay: $1 re-grade ready" "$(tail -n +2 "$RUNS/$run"/merged/summary_*.csv | cut -d, -f1,3,4 | tr , ' ')
On WSL: scp -r assay-vm:$RUNS/$run harness/regrade_out/ && bash harness/stage.sh harness/regrade_out/$run"
  else
    note "Assay: $1 re-grade FAILED" "$(tail -n 5 "$RUNS/$run.log")"
  fi
}

case $(date -u +%a) in
  # One after the other: started in the same second, both runs would get the same stamp and file names.
  Mon|Thu) regrade kimi; regrade gemma ;;
esac
python3 harness/grade_age.py > "$RUNS/age.txt" 2>&1 || note "Assay: grade over 5 days old" "$(cat "$RUNS/age.txt")"
