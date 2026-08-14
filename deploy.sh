#!/usr/bin/env bash
# Standalone deployment of the dsh web UI with the access-key gate
# (@night-stars-1/dsh-host-auth). Only docker (with the compose plugin) and
# curl are required: this script downloads the build files from the
# dsh-plugins repository, generates .env with a random access key, and runs
# docker compose. dsh and the plugin themselves install from npm.
#
#   curl -fsSL https://raw.githubusercontent.com/Night-stars-1/dsh-plugins/main/deploy.sh -o deploy.sh
#   bash deploy.sh
#
#   bash deploy.sh            # = up: fetch files, build, start, print access info
#   bash deploy.sh down       # stop and remove the container (data volume kept)
#   bash deploy.sh restart    # restart (apply .env edits)
#   bash deploy.sh logs       # follow server logs
#   bash deploy.sh status     # container state + health probe
#   bash deploy.sh update     # re-download build files, rebuild, restart
#   bash deploy.sh destroy    # remove container AND the data volume (keys, sessions)
#
# State lives in $DSH_DEPLOY_DIR (default ~/dsh-web); runtime data persists
# in the dsh-data docker volume.
set -euo pipefail

WORKDIR="${DSH_DEPLOY_DIR:-$HOME/dsh-web}"
RAW_BASE="${DSH_RAW_BASE:-https://raw.githubusercontent.com/Night-stars-1/dsh-plugins/main/docker}"
BUILD_FILES=(Dockerfile entrypoint.sh docker-compose.yml)

mkdir -p "$WORKDIR/workspace"
cd "$WORKDIR"

fetch_build_files() {
  local force="${1:-}"
  for file in "${BUILD_FILES[@]}"; do
    if [ "$force" = force ] || [ ! -f "$file" ]; then
      echo "[deploy] fetching $file"
      curl -fsSL "$RAW_BASE/$file" -o "$file"
    fi
  done
}

random_key() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 24 | tr -d '/+=' | cut -c1-24
  else
    head -c 18 /dev/urandom | base64 | tr -d '/+=' | cut -c1-24
  fi
}

env_value() { sed -n "s/^$1=//p" .env 2>/dev/null | head -1; }

ensure_env() {
  if [ ! -f .env ]; then
    local key
    key="$(random_key)"
    cat > .env <<EOF
# dsh web deployment config (read by docker compose; keep this file private).
# Model access; chatting fails without it.
DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY:-}
# Fixed access key(s), space-separated; page-managed keys work alongside.
DSH_WEB_ACCESS_KEY=$key
# Extra authorities the trust fence accepts, space-separated,
# e.g. "192.168.1.5:8080 chat.example.com".
DSH_TRUSTED_HOSTS=${DSH_TRUSTED_HOSTS:-}
# Host port the UI is published on.
DSH_PORT=${DSH_PORT:-8080}
EOF
    echo "[deploy] generated $WORKDIR/.env (access key: $key)"
  fi
  if [ -z "$(env_value DEEPSEEK_API_KEY)" ]; then
    echo "[deploy] warning: DEEPSEEK_API_KEY is empty in .env — the UI works but chatting will fail"
  fi
}

port() { env_value DSH_PORT | grep -E '^[0-9]+$' || echo 8080; }

wait_ready() {
  local p="$1"
  # First boot also downloads the plugin inside the container; allow 4 minutes.
  for _ in $(seq 1 120); do
    if curl -s -m 2 -o /dev/null "http://127.0.0.1:$p/login"; then return 0; fi
    sleep 2
  done
  echo "[deploy] server did not answer within 240s; check: bash deploy.sh logs" >&2
  return 1
}

cmd="${1:-up}"
case "$cmd" in
  up)
    fetch_build_files
    ensure_env
    docker compose up -d --build
    p="$(port)"
    wait_ready "$p"
    echo
    echo "✅ dsh web 已启动"
    echo "   本机访问（可管理密钥）: http://localhost:$p"
    echo "   访问密钥: $(env_value DSH_WEB_ACCESS_KEY)"
    echo "   配置文件: $WORKDIR/.env（改后执行 bash deploy.sh restart）"
    ;;
  down)     docker compose down ;;
  restart)  docker compose restart && wait_ready "$(port)" && echo "[deploy] restarted" ;;
  logs)     docker compose logs -f ;;
  status)
    docker compose ps
    p="$(port)"
    code="$(curl -s -m 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$p/login" || true)"
    echo "health: GET /login -> ${code:-no answer}"
    ;;
  update)
    fetch_build_files force
    docker compose up -d --build
    wait_ready "$(port)"
    echo "[deploy] updated and restarted"
    ;;
  destroy)  docker compose down -v ;;
  *)
    echo "usage: bash deploy.sh [up|down|restart|logs|status|update|destroy]" >&2
    exit 1
    ;;
esac
