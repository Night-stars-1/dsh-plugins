#!/usr/bin/env bash
# 带访问密钥门禁（@night-stars-1/dsh-host-auth）的 dsh web UI 一键部署。
# 只需要 docker（含 compose 插件）和 curl：本脚本从 dsh-plugins 仓库下载
# 构建文件，生成含随机访问密钥的 .env，然后交给 docker compose；
# dsh 和插件本体都从 npm 安装，无需 clone 任何仓库。
#
#   curl -fsSL https://raw.githubusercontent.com/Night-stars-1/dsh-plugins/main/deploy.sh -o deploy.sh
#   bash deploy.sh
#
#   bash deploy.sh            # 即 up：下载构建文件、构建、启动、打印访问信息
#   bash deploy.sh down       # 停止并移除容器（数据卷保留）
#   bash deploy.sh restart    # 重启（使 .env 修改生效）
#   bash deploy.sh logs       # 跟踪服务日志
#   bash deploy.sh status     # 容器状态 + 健康探测
#   bash deploy.sh update     # 重新下载构建文件、重建、重启
#   bash deploy.sh destroy    # 移除容器和数据卷（密钥、会话都会清空）
#
# 部署状态放在 $DSH_DEPLOY_DIR（默认 ~/dsh-web）；运行数据持久化在
# dsh-data 数据卷里。
set -euo pipefail

WORKDIR="${DSH_DEPLOY_DIR:-$HOME/dsh-web}"
RAW_BASE="${DSH_RAW_BASE:-https://raw.githubusercontent.com/Night-stars-1/dsh-plugins/main/docker}"
BUILD_FILES=(Dockerfile entrypoint.sh docker-compose.yml)

mkdir -p "$WORKDIR/workspace"
cd "$WORKDIR"

fetch_build_files() {
  # 仓库 docker/ 目录是构建文件的唯一权威；缺失时下载，update 时强制刷新。
  local force="${1:-}"
  for file in "${BUILD_FILES[@]}"; do
    if [ "$force" = force ] || [ ! -f "$file" ]; then
      echo "[deploy] 下载 $file"
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
# dsh web 部署配置（docker compose 读取；请勿泄露此文件）。
# 模型访问密钥；不填可以打开界面但无法聊天。
DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY:-}
# 固定访问密钥（空格分隔可多个）；页面管理的密钥并行有效。
DSH_WEB_ACCESS_KEY=$key
# 信任栅栏额外接受的主机，空格分隔，
# 例如 "192.168.1.5:8080 chat.example.com"。
DSH_TRUSTED_HOSTS=${DSH_TRUSTED_HOSTS:-}
# 对外发布的端口。
DSH_PORT=${DSH_PORT:-8080}
EOF
    echo "[deploy] 已生成 $WORKDIR/.env（访问密钥：${key}）"
  fi
  if [ -z "$(env_value DEEPSEEK_API_KEY)" ]; then
    echo "[deploy] 警告：.env 里 DEEPSEEK_API_KEY 为空——界面可用，但聊天会失败"
  fi
}

port() { env_value DSH_PORT | grep -E '^[0-9]+$' || echo 8080; }

wait_ready() {
  local p="$1"
  # 首次启动还要在容器里下载插件，最多等 4 分钟。
  for _ in $(seq 1 120); do
    if curl -s -m 2 -o /dev/null "http://127.0.0.1:$p/login"; then return 0; fi
    sleep 2
  done
  echo "[deploy] 服务 240 秒内未就绪；请查看：bash deploy.sh logs" >&2
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
  restart)
    # 用 up -d 而不是 docker compose restart：后者不会重新读取 .env，
    # 环境变量（如 DSH_TRUSTED_HOSTS）的修改必须重建容器才生效。
    docker compose up -d --force-recreate
    wait_ready "$(port)" && echo "[deploy] 已重启（.env 已重新应用）"
    ;;
  logs)     docker compose logs -f ;;
  status)
    docker compose ps
    p="$(port)"
    code="$(curl -s -m 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$p/login" || true)"
    echo "健康检查: GET /login -> ${code:-无响应}"
    ;;
  update)
    fetch_build_files force
    docker compose up -d --build
    wait_ready "$(port)"
    echo "[deploy] 已更新并重启"
    ;;
  destroy)  docker compose down -v ;;
  *)
    echo "用法: bash deploy.sh [up|down|restart|logs|status|update|destroy]" >&2
    exit 1
    ;;
esac
