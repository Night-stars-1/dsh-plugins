#!/usr/bin/env bash
# One-shot deployment for the containerized dsh web UI with the access-key
# gate. First run generates docker/.env (random access key included); later
# runs reuse it. Requires docker with the compose plugin.
#
#   ./deploy.sh            # = up: build + start + wait + print access info
#   ./deploy.sh down       # stop and remove the container (data volume kept)
#   ./deploy.sh restart    # restart the container
#   ./deploy.sh logs       # follow server logs
#   ./deploy.sh status     # container state + health probe
#   ./deploy.sh update     # git pull + rebuild + restart
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=.env

random_key() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 24 | tr -d '/+=' | cut -c1-24
  else
    head -c 18 /dev/urandom | base64 | tr -d '/+=' | cut -c1-24
  fi
}

env_value() {
  sed -n "s/^$1=//p" "$ENV_FILE" 2>/dev/null | head -1
}

ensure_env() {
  if [ ! -f "$ENV_FILE" ]; then
    local key
    key="$(random_key)"
    cat > "$ENV_FILE" <<EOF
# dsh web deployment config (read by docker compose; keep out of git).
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
    echo "[deploy] generated $ENV_FILE (access key: $key)"
  fi
  if [ -z "$(env_value DEEPSEEK_API_KEY)" ]; then
    echo "[deploy] warning: DEEPSEEK_API_KEY is empty in docker/.env — the UI works but chatting will fail"
  fi
}

port() { env_value DSH_PORT | grep -E '^[0-9]+$' || echo 8080; }

wait_ready() {
  local p="$1"
  for _ in $(seq 1 60); do
    if curl -s -m 2 -o /dev/null "http://127.0.0.1:$p/login"; then return 0; fi
    sleep 2
  done
  echo "[deploy] server did not answer within 120s; check: ./deploy.sh logs" >&2
  return 1
}

cmd="${1:-up}"
case "$cmd" in
  up)
    ensure_env
    mkdir -p workspace
    docker compose up -d --build
    p="$(port)"
    wait_ready "$p"
    echo
    echo "✅ dsh web 已启动"
    echo "   本机访问（可管理密钥）: http://localhost:$p"
    echo "   访问密钥: $(env_value DSH_WEB_ACCESS_KEY)"
    echo "   局域网访问需在 docker/.env 的 DSH_TRUSTED_HOSTS 加入对应 主机[:端口] 后 ./deploy.sh restart"
    ;;
  down)
    docker compose down
    ;;
  restart)
    docker compose restart
    wait_ready "$(port)"
    echo "[deploy] restarted"
    ;;
  logs)
    docker compose logs -f
    ;;
  status)
    docker compose ps
    p="$(port)"
    code="$(curl -s -m 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$p/login" || true)"
    echo "health: GET /login -> ${code:-no answer}"
    ;;
  update)
    git -C .. pull --ff-only
    docker compose up -d --build
    wait_ready "$(port)"
    echo "[deploy] updated and restarted"
    ;;
  *)
    echo "usage: ./deploy.sh [up|down|restart|logs|status|update]" >&2
    exit 1
    ;;
esac
