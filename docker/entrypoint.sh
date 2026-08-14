#!/usr/bin/env bash
# 容器入口：把认证插件从 npm 装进数据卷上的 profile（幂等），首次启动时
# 写入 profile 补丁，把对外端口桥接到 dsh 的回环监听，然后运行 web UI。
set -euo pipefail

export DSH_HOME="${DSH_HOME:-/data/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/web"
mkdir -p "$PROFILE_DIR"

if [ ! -e "$PROFILE_DIR/node_modules/@night-stars-1/dsh-host-auth" ]; then
  echo "[entrypoint] 正在把 @night-stars-1/dsh-host-auth 装进 web profile"
  dsh plugin --profile web add @night-stars-1/dsh-host-auth --config.auto-install-peers=false
fi

PATCH="$PROFILE_DIR/cordis.patch.yml"
if [ ! -s "$PATCH" ] || grep -qx '\[\]' "$PATCH"; then
  echo "[entrypoint] 写入 profile 补丁（访问密钥门禁 + 浏览器内目录选择器）"
  cat > "$PATCH" <<'YAML'
# 由容器入口脚本在首次启动时写入；修改会持久化在 /data 数据卷上，
# 服务运行中保存即热重载。

# 访问密钥门禁。DSH_WEB_ACCESS_KEY 预置固定密钥（空格分隔可多个）；
# 页面管理的密钥（在 /login 页或宿主机浏览器的"设置 → 访问密钥"里设置）
# 两种方式都有效。
- insert:
    - id: host-auth
      name: '@night-stars-1/dsh-host-auth'
      inject: [webRuntime]
      config:
        accessKeys: !!js (process.env.DSH_WEB_ACCESS_KEY || '').split(' ').filter(Boolean)
        sessionTtlMs: 604800000
        trustedHosts: !!js ctx.webRuntime.trustedHosts

# 工作区目录选择固定为浏览器内模式（容器里不存在原生文件对话框）。
- id: directory-picker
  disabled: true
- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: ui-directory-picker-browse
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
YAML
fi

# dsh 设计上拒绝绑定非回环地址；socat 把它暴露到容器网卡上，
# Host 头原样透传，保住"密钥管理仅限回环"的安全边界。
socat TCP-LISTEN:8080,fork,reuseaddr TCP:127.0.0.1:3080 &

TRUST_ARGS=()
for authority in ${DSH_TRUSTED_HOSTS:-}; do
  TRUST_ARGS+=(--trusted-host "$authority")
done
exec dsh web ${TRUST_ARGS[@]+"${TRUST_ARGS[@]}"}
