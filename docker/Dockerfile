# 带访问密钥门禁的 dsh web UI。所有组件都从 npm 安装；
# @night-stars-1/dsh-host-auth 插件由入口脚本在首次启动时装进
# 数据卷上的 profile。

FROM node:22
RUN apt-get update && apt-get install -y --no-install-recommends socat \
  && rm -rf /var/lib/apt/lists/*
# dsh CLI + 它的 `dsh plugin` 子命令所调用的 pnpm。
ARG DSH_VERSION=0.1.0-rc.6
RUN npm install -g pnpm@11 @deepseek-ai/dsh@${DSH_VERSION}
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
# Harness 主目录（密钥、会话、profile）放在 /data 数据卷上。
ENV DSH_HOME=/data/.dsh
VOLUME /data
# dsh 本体只监听 127.0.0.1:3080；入口脚本用 socat 把 0.0.0.0:8080 桥接
# 过去，Host 头原样透传——因此插件"仅限回环的密钥管理"只对宿主机浏览器开放。
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
