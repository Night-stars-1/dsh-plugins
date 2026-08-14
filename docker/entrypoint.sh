#!/usr/bin/env bash
# 容器入口：把认证插件从 npm 装进数据卷上的 profile（幂等），确保 profile
# 补丁包含全接口绑定与门禁配置（首次启动写入，旧卷缺块则追加），然后运行 web UI。
set -euo pipefail

export DSH_HOME="${DSH_HOME:-/data/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/web"
mkdir -p "$PROFILE_DIR"

PKG='@night-stars-1/dsh-host-auth'
plugin_resolves() {
  node -e "require.resolve('$PKG/package.json', { paths: ['$PROFILE_DIR'] })" >/dev/null 2>&1
}
if ! plugin_resolves; then
  # 清理旧镜像时代遗留的 link: 安装记录（其目标目录已不存在），否则
  # pnpm 会认为依赖已满足而跳过真正的 npm 安装。
  if grep -q "\"$PKG\": \"link:" "$PROFILE_DIR/package.json" 2>/dev/null; then
    echo "[entrypoint] 清理陈旧的 link: 安装记录"
    dsh plugin --profile web remove "$PKG" || true
  fi
  echo "[entrypoint] 正在把 $PKG 从 npm 装进 web profile"
  dsh plugin --profile web add "$PKG" --config.auto-install-peers=false
  plugin_resolves || { echo "[entrypoint] 插件安装后仍无法解析，终止" >&2; exit 1; }
elif [ "${DSH_PLUGIN_UPDATE:-}" = "1" ]; then
  # 强制把插件升级到 npm 最新版；数据卷上的密钥、会话、补丁都保留。
  echo "[entrypoint] 将 $PKG 升级到 npm 最新版"
  dsh plugin --profile web add "$PKG@latest" --config.auto-install-peers=false
  plugin_resolves || { echo "[entrypoint] 插件升级后仍无法解析，终止" >&2; exit 1; }
fi

PATCH="$PROFILE_DIR/cordis.patch.yml"
if [ ! -s "$PATCH" ] || grep -qx '\[\]' "$PATCH"; then
  echo "[entrypoint] 写入 profile 补丁（全接口绑定 + 访问密钥门禁 + 浏览器内目录选择器）"
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

# 全接口绑定块：让 dsh 直接监听 0.0.0.0:3080，端口映射即可到达（无需 socat）。
# 单独检测并追加，兼容旧数据卷里没有这一块的补丁。
if ! grep -q "id: webserver" "$PATCH"; then
  echo "[entrypoint] 追加 webserver 全接口绑定配置"
  cat >> "$PATCH" <<'YAML'

# dsh 绑定容器全接口（组合层配置，配置 schema 本身支持 0.0.0.0）；
# 访问控制由上面的密钥门禁承担，密钥管理仍按 Host 头限定为仅限回环。
- id: webserver
  config:
    host: '0.0.0.0'
    port: 3080
YAML
fi

TRUST_ARGS=()
for authority in ${DSH_TRUSTED_HOSTS:-}; do
  TRUST_ARGS+=(--trusted-host "$authority")
done
exec dsh web ${TRUST_ARGS[@]+"${TRUST_ARGS[@]}"}
