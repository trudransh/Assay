#!/usr/bin/env bash
# Run from the repo root on your machine: host/deploy/push-secrets.sh <user@vm> <domain> [testnet|mainnet|kimi]
# Writes /etc/assay/host-<instance>.env on the VM and restarts assay-host@<instance>. Prints no values.
# The per-network settings follow the host's rule: NAME_<NETWORK> first, and plain NAME only for testnet.
# `kimi` is a second mainnet host: its own agent (HOST_AGENT_ID_KIMI), key (host/.keys/kimi.jwk.json) and port,
# serving Kimi K2.6 through OpenRouter pinned to Moonshot's own endpoint, with tight caps because it's paid.
set -euo pipefail
TARGET=${1:?usage: push-secrets.sh <user@vm> <domain> [testnet|mainnet|kimi]}
DOMAIN=${2:?usage: push-secrets.sh <user@vm> <domain> [testnet|mainnet|kimi]}
INST=${3:-testnet}
case "$INST" in
  testnet) NET=testnet; PORT=8787; DATA=data; URL="https://$DOMAIN"; JWK=host.jwk.json ;;
  mainnet) NET=mainnet; PORT=8788; DATA=data-mainnet; URL="https://$DOMAIN/mainnet"; JWK=host.jwk.json ;;
  kimi) NET=mainnet; PORT=8789; DATA=data-kimi; URL="https://$DOMAIN/kimi"; JWK=kimi.jwk.json ;;
  *) echo "instance must be testnet, mainnet or kimi"; exit 1 ;;
esac
SUFFIX="_${NET^^}"
# A missing key is empty, not an error: with pipefail a failed grep would stop the script silently.
val() { { grep "^$1=" .env || true; } | tail -1 | cut -d= -f2-; }
trap 'echo "push-secrets: failed at line $LINENO" >&2' ERR
net() { local v; v=$(val "$1$SUFFIX"); [ -z "$v" ] && [ "$NET" = testnet ] && v=$(val "$1"); echo "$v"; }

ENV_FILE=$(mktemp)
trap 'rm -f "$ENV_FILE"' EXIT
chmod 600 "$ENV_FILE"
{
  echo "ASSAY_NETWORK=$NET"
  if [ "$INST" = kimi ]; then
    echo "OPENROUTER_API_KEY=$(val OPENROUTER_API_KEY)"
    echo "UPSTREAM_MODEL=moonshotai/kimi-k2.6"
    echo "UPSTREAM_PROVIDER=moonshotai/int4"
    echo "HOST_JWK_PATH=.keys/kimi.jwk.json"
    echo "HOST_NAME=Assay Kimi host"
    # About $0.002 per answer at most, and at most 30 answers an hour for the whole host.
    echo "DEFAULT_MAX_TOKENS=512"; echo "MAX_TOKENS_CAP=512"; echo "CHAT_LIMIT=10"; echo "CHAT_LIMIT_GLOBAL=30"
  else
    echo "UPSTREAM_URL=https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    echo "UPSTREAM_API_KEY=$(val GEMINI_API_KEY)"
    echo "UPSTREAM_MODEL=gemma-4-31b-it"
  fi
  for k in MONAD_RPC_URL ANCHOR_ADDRESS HOST_AGENT_ID VERIFIER_REGISTRY ACCOUNT_IMPL; do
    v=$(net $k)
    # The Kimi host has its own agent id; everything else it shares with the mainnet host.
    if [ "$INST" = kimi ] && [ "$k" = HOST_AGENT_ID ]; then v=$(val HOST_AGENT_ID_KIMI); fi
    if [ -n "$v" ]; then echo "${k}_${NET^^}=$v"; fi
  done
  # Shared settings may also be overridden per network (e.g. BATCH_SECONDS_MAINNET).
  for k in RELAYER_PRIVATE_KEY BATCH_SECONDS BATCH_MAX; do v=$(val "$k$SUFFIX"); [ -z "$v" ] && v=$(val $k); echo "$k=$v"; done | \
    # Every mainnet anchor costs real MON, so batch less often there unless told otherwise.
    { if [ "$NET" = mainnet ] && [ -z "$(val BATCH_SECONDS_MAINNET)" ]; then sed 's/^BATCH_SECONDS=.*/BATCH_SECONDS=120/'; else cat; fi; }
  echo "PORT=$PORT"
  echo "DATA_DIR=$DATA"
  echo "PUBLIC_URL=$URL"
} > "$ENV_FILE"

if [ "$INST" = kimi ] && [ -z "$(val HOST_AGENT_ID_KIMI)" ]; then echo "push-secrets: set HOST_AGENT_ID_KIMI in .env first" >&2; exit 1; fi
scp -q "$ENV_FILE" "$TARGET:/tmp/host-$INST.env"
scp -q "host/.keys/$JWK" "$TARGET:/tmp/$JWK"
# Receipts live on the VM; never overwrite them with an older copy from this machine.
ssh "$TARGET" "sudo install -m 640 -g assay /tmp/host-$INST.env /etc/assay/host-$INST.env &&
  sudo install -m 600 -o assay -g assay /tmp/$JWK /opt/assay/host/.keys/$JWK &&
  sudo install -d -o assay -g assay -m 700 /opt/assay/host/$DATA &&
  rm -f /tmp/host-$INST.env /tmp/$JWK &&
  sudo systemctl enable -q assay-host@$INST && sudo systemctl restart assay-host@$INST && sleep 4 && systemctl --no-pager status assay-host@$INST | head -5"
echo "Check: curl $URL/health"
