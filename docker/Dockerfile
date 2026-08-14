# 带访问密钥门禁的 dsh web UI。所有组件都从 npm 安装；
# @night-stars-1/dsh-host-auth 插件由入口脚本在首次启动时装进
# 数据卷上的 profile。

FROM node:22
# dsh CLI + 它的 `dsh plugin` 子命令所调用的 pnpm。
ARG DSH_VERSION=0.1.0-rc.6
RUN npm install -g pnpm@11 @deepseek-ai/dsh@${DSH_VERSION}
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
# Harness 主目录（密钥、会话、profile）放在 /data 数据卷上。
ENV DSH_HOME=/data/.dsh
VOLUME /data
# profile 补丁把 webserver 改为绑定 0.0.0.0:3080（组合层配置，schema 支持），
# 端口映射直接对接它；访问控制由 dsh-auth 的密钥门禁承担，
# 密钥管理仍按 Host 头限定为仅限回环（即仅宿主机浏览器）。
EXPOSE 3080
ENTRYPOINT ["/entrypoint.sh"]
