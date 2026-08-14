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
  # 直接向 registry 查询 latest 的精确版本号再 pin 安装：pnpm 对 `@latest`
  # 标签的元数据缓存会把「最新版」解析成旧版，pin 精确版本绕开该缓存。
  echo "[entrypoint] 将 $PKG 升级到 npm 最新版"
  LATEST_VERSION="$(node -e 'const p=process.argv[1];fetch("https://registry.npmjs.org/"+p.replace("/","%2F")+"/latest").then(r=>r.ok?r.json():Promise.reject(new Error(String(r.status)))).then(j=>console.log(j.version)).catch(()=>process.exit(1))' "$PKG" 2>/dev/null || true)"
  if [ -z "$LATEST_VERSION" ]; then
    echo "[entrypoint] 查询 $PKG 最新版本失败，终止" >&2
    exit 1
  fi
  echo "[entrypoint] 最新版本：$LATEST_VERSION"
  dsh plugin --profile web add "$PKG@$LATEST_VERSION" --config.auto-install-peers=false
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
        # 由 .env 的 DSH_ALLOW_REMOTE_ADMIN 控制（true/1/yes/on 为开）：
        # 开启后已认证的远程会话可访问设置/凭据等特权面，密钥管理仍仅限本机。
        allowRemoteAdmin: !!js (['1','true','yes','on'].indexOf((process.env.DSH_ALLOW_REMOTE_ADMIN || '').toLowerCase()) >= 0)

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

TRUST_ARGS=()
for authority in ${DSH_TRUSTED_HOSTS:-}; do
  TRUST_ARGS+=(--trusted-host "$authority")
done
exec dsh web ${TRUST_ARGS[@]+"${TRUST_ARGS[@]}"}
