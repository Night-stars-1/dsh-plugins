# dsh web UI with the access-key gate. Everything installs from npm; the
# @night-stars-1/dsh-host-auth plugin is installed by the entrypoint into the
# volume-backed profile on first boot.

FROM node:22
RUN apt-get update && apt-get install -y --no-install-recommends socat \
  && rm -rf /var/lib/apt/lists/*
# dsh CLI + the pnpm its `dsh plugin` subcommand shells out to.
ARG DSH_VERSION=0.1.0-rc.6
RUN npm install -g pnpm@11 @deepseek-ai/dsh@${DSH_VERSION}
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
# Harness home (keys, sessions, profile) lives on the /data volume.
ENV DSH_HOME=/data/.dsh
VOLUME /data
# dsh itself only binds 127.0.0.1:3080; the entrypoint's socat bridges
# 0.0.0.0:8080 to it with the Host header passed through unchanged, so the
# plugin's loopback-only key management stays host-browser-only.
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
