#!/usr/bin/env bash
# Runs the cast commands from post_grade.py with the assay-verifier keystore, asking for its password once.
#   bash harness/post.sh harness/regrade_out/<run>/post_cmds.txt
# Monad bills the gas limit, not gas used, so it's set to the postGrade estimate x 1.2.
set -euo pipefail
CMDS=$(realpath "${1:?usage: post.sh <post_cmds.txt>}")
cd "$(dirname "$0")/../contracts"
read -rsp "assay-verifier keystore password: " PW; echo
n=0; total=$(grep -c . "$CMDS")
while IFS= read -r cmd; do
  n=$((n+1)); echo "[$n/$total]"
  eval "$cmd --password \"\$PW\" --gas-limit 256000" | grep -E "^(status|transactionHash)" || echo "  failed, continuing"
done < "$CMDS"
unset PW
