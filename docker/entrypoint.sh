#!/usr/bin/env bash
# Container entry: install the dsh-auth plugin into the volume-backed profile
# (idempotent), seed the profile patch on first boot, bridge the public port
# to dsh's loopback bind, then run the web UI.
set -euo pipefail

export DSH_HOME="${DSH_HOME:-/data/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/web"
mkdir -p "$PROFILE_DIR"

if [ ! -e "$PROFILE_DIR/node_modules/@night-stars-1/dsh-host-auth" ]; then
  echo "[entrypoint] installing dsh-auth into the web profile"
  dsh plugin --profile web add link:/opt/dsh-auth --config.auto-install-peers=false
fi

PATCH="$PROFILE_DIR/cordis.patch.yml"
if [ ! -s "$PATCH" ] || grep -qx '\[\]' "$PATCH"; then
  echo "[entrypoint] seeding profile patch (auth gate + browse directory picker)"
  cat > "$PATCH" <<'YAML'
# Seeded by the container entrypoint on first boot; edits persist on the
# /data volume and hot-reload while the server runs.

# Access-key gate. DSH_WEB_ACCESS_KEY seeds fixed keys (space-separated);
# page-managed keys (set from the /login page or 设置 → 访问密钥 on the host
# browser) work either way.
- insert:
    - id: host-auth
      name: '@night-stars-1/dsh-host-auth'
      inject: [webRuntime]
      config:
        accessKeys: !!js (process.env.DSH_WEB_ACCESS_KEY || '').split(' ').filter(Boolean)
        sessionTtlMs: 604800000
        trustedHosts: !!js ctx.webRuntime.trustedHosts

# Workspace picking stays in the browser (no native dialog exists in a container).
- id: directory-picker
  disabled: true
- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: ui-directory-picker-browse
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
YAML
fi

# dsh refuses non-loopback binds by design; socat exposes it on the container
# interface with the Host header passed through, preserving the loopback-only
# management boundary.
socat TCP-LISTEN:8080,fork,reuseaddr TCP:127.0.0.1:3080 &

TRUST_ARGS=()
for authority in ${DSH_TRUSTED_HOSTS:-}; do
  TRUST_ARGS+=(--trusted-host "$authority")
done
exec dsh web ${TRUST_ARGS[@]+"${TRUST_ARGS[@]}"}
