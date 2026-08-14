# @night-stars-1/dsh-host-auth

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI 的第三方访问插件。准入方式是**预置访问密钥**——无注册、无账号：`/api/auth/login` 将提交的密钥与配置的 `accessKeys` 比对（SHA-256 摘要恒定时间比较）后签发会话 token，token 以 SHA-256 哈希存入 `web_access` storage domain，并通过 HttpOnly、SameSite=Strict 的 `dsh_auth` cookie 携带。内置 `/login` 页面只要求输入密钥；挂载在 webserver 上的准入 guard 对未认证的 `/api` 请求应答 401、在任何握手前拒绝未认证的 `/api` upgrade、把未认证的 HTML 导航重定向到 `/login`。会话在重启后仍然有效，超过 `sessionTtlMs` 过期。

## 前置要求

- 任意 `web` profile 挂载了 storage-domain 形态的 dsh（随附组合已包含）。**无需修改 dsh 安装**：guard 通过包装底层 `node:http` 服务器的 request/upgrade 监听器实现（`src/guard-mount.ts`）。包装读取 `WebServer` 类的 TypeScript 私有 `server` 字段；若某个 dsh 版本重命名了它，插件会在加载时大声失败，而不是静默失去保护。

## 安装与启用

先构建一次（在本目录 `pnpm install && pnpm run build`），然后装进 `web` profile——开发期用 `link:`，发布后用包名：

```sh
dsh plugin --profile web add link:/Users/nightstar/Desktop/code/dsh-plugins/dsh-auth
# after publishing: dsh plugin --profile web add @night-stars-1/dsh-host-auth --config.auto-install-peers=false
```

`--config.auto-install-peers=false` 阻止 pnpm 把 `@deepseek-ai/*` peer 从 registry 拉进 profile；peer 必须通过 profile 模块回退目录解析到宿主安装自己的单一实例。

然后在 `~/.dsh/profiles/web/cordis.patch.yml` 挂上插件行（每次 `dsh web` 启动自动应用）：

```yaml
- insert:
    - id: host-auth
      name: '@night-stars-1/dsh-host-auth'
      inject: [webRuntime]
      config:
        accessKeys:
          - 'change-me-to-a-long-random-key'
        sessionTtlMs: 604800000
        trustedHosts: !!js ctx.webRuntime.trustedHosts
```

配置项：`accessKeys`（默认 `[]`；可选的固定密钥，每个至少 8 位——用 `!!js [process.env.DSH_WEB_ACCESS_KEY]` 表达式可避免把明文写进文件）、`sessionTtlMs`（必填，毫秒）、`trustedHosts`（默认 `[]`；与 connection 插件相同的裸 `host[:port]` 词汇，加载时校验）、`allowRemoteAdmin`（默认 `false`；见下）。

**远程管理（`allowRemoteAdmin`）。**dsh 只把真正特权化的 `/api` 方法——`settings.*`、`credentials.*`、`host.pickDirectory`／`host.openPath`、`llm.discoverModels`，以及 preset 创作面（`agentPreset.read`／`copy`／`openDocument`／`remove`）——钉在回环 Host 上；在反向代理后面这些方法会对远程用户返回 `HTTP 403`。普通方法（`agentPreset.list`／`select`、`llm.providers`／`llm.models`、聊天等）**并不**被钉住——它们只需要在 `trustedHosts`（Docker 镜像里的 `DSH_TRUSTED_HOSTS`）里声明对外服务的主机即可，所以远程 `agentPreset.list` 的 403 应由 `trustedHosts` 解决，而不是这个开关。设为 `allowRemoteAdmin: true` 即向**已认证**会话开放特权面：guard 确认会话 cookie 后，对 `/api` 请求向下游呈现回环 authority（Host 与 Origin）。这会主动放弃 dsh 的回环安全默认值，需权衡——此后每个持钥人都能读取凭据（模型 API key）并修改配置。密钥管理（`/api/auth`）豁免于该重写、始终按真实 Host 判定；它对本机或配置文件密钥会话开放，因此页面密钥持有者无法增删访问密钥。无需重写的替代方案：SSH 端口转发（`ssh -L 8080:127.0.0.1:8080 服务器`）或 Tailscale，它们呈现真正的回环/私网 Host，开关保持关闭即可解锁特权面。

**密钥管理。**设置面板的"访问密钥"分区（由本包的浏览器半边提供）列出全部密钥——页面管理的密钥带备注、创建时间与**最后使用时间**（每次登录成功即刷新；配置文件密钥以只读方式列出，按摘要记录最后使用）——并支持添加与删除页面密钥。当任何地方都没有配置密钥时，从本机首次访问 `/login` 会改为引导设置。管理调用 `GET /api/auth/keys`、`POST /api/auth/add-key` 与 `POST /api/auth/remove-key`，对**服务器本机或配置文件密钥会话**开放（受信任的 LAN 页面密钥会话能通过栅栏但会得到 403 `loopback-only`），且在首次设置之后要求有效会话。页面密钥（至多 20 个，重复即拒绝）以 SHA-256 摘要存入 `web_access` domain——绝不存明文。删除密钥即吊销它的新登录；已有会话保留到退出或过期——要一次吊销全部会话与页面密钥，删除 `~/.dsh/storages/web_access.json` 即可。

## 已知限制

- **设置界面是插件自有的分区，而非 Plugins 页卡片。**包内带一个浏览器半边（`client-src/`，构建为 dsh 客户端模块工厂格式的 `lib/client.js`），通过设置对话框开放的 `settings.section` 插槽注册"访问密钥"页面，驱动插件自己的 `/api/auth` 端点。第三方插件目前无法在 Plugins 页本体出卡片：上游 API proxy 只向 Web 提供硬编码的 settings 命名空间白名单（`dsh-host-apiproxy` 的 `WEB_SETTINGS_NAMESPACES`）；插件仍保留 `host-auth` 命名空间注册，上游若开放白名单，那张卡片也会自动出现。
- 单一共享门禁、无身份：所有持钥者权限相同，看到同一宿主的会话、工作区与设置。
- 明文 HTTP cookie（无 `Secure` 属性）；非回环部署请在前方做 TLS 终结。
- 密钥尝试无速率限制。
- `src/trust.ts` 是 connection 插件浏览器信任栅栏的本地拷贝；需与上游保持行为一致。
