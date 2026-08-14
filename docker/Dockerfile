# Build context = dsh-plugins repository root (docker compose sets it).
# Stage 1 builds the dsh-auth plugin; stage 2 installs the official dsh CLI
# and ships the built plugin with its production runtime dependencies.

FROM node:22 AS plugin-build
ENV CI=true
RUN npm install -g pnpm@11
WORKDIR /build
COPY dsh-auth/ ./dsh-auth/
RUN cd dsh-auth && pnpm install && pnpm run build
# Deploy copy: package.json with the runtime peers promoted to dependencies
# (the linked plugin resolves its own runtime imports from its real path, so
# the deploy folder must carry them), then a production-only install.
RUN mkdir /deploy && cp -r dsh-auth/lib dsh-auth/README.md dsh-auth/README.zh.md /deploy/ \
  && node -e '\
const fs = require("fs"); \
const m = JSON.parse(fs.readFileSync("dsh-auth/package.json", "utf8")); \
m.dependencies = { ...m.dependencies, \
  "@deepseek-ai/schemastery": "3.18.1", \
  "@deepseek-ai/dsh-storage-domain": "0.0.1-rc.5" }; \
delete m.devDependencies; delete m.scripts; delete m.pnpm; \
fs.writeFileSync("/deploy/package.json", JSON.stringify(m, null, 2));' \
  && cd /deploy && pnpm install --prod

FROM node:22
RUN apt-get update && apt-get install -y --no-install-recommends socat \
  && rm -rf /var/lib/apt/lists/*
# dsh CLI + the pnpm its `dsh plugin` subcommand shells out to.
RUN npm install -g pnpm@11 @deepseek-ai/dsh@0.1.0-rc.6
COPY --from=plugin-build /deploy /opt/dsh-auth
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
# Harness home (keys, sessions, profile) lives on the /data volume.
ENV DSH_HOME=/data/.dsh
VOLUME /data
# dsh itself only binds 127.0.0.1:3080; the entrypoint's socat bridges
# 0.0.0.0:8080 to it with the Host header passed through unchanged, so the
# plugin's loopback-only key management stays host-browser-only.
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
