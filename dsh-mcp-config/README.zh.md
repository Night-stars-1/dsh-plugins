# @night-stars-1/dsh-mcp-config

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI 的第三方 MCP 服务器管理插件：在设置面板里增删 MCP 服务器，配置持久化到 `mcp_config` storage domain，并**实时热生效**——每次改动立即断开旧连接、拉起新的 [`dsh-mcp-client`](https://github.com/deepseek-ai/deepseek-harness) 实例，工具即时更新到模型可见的 `mcp__<serverName>__<tool>` 名字空间。支持 **stdio**（本地子进程）与 **streamable-http**（远程）两种传输。

## 前置要求

- 任意 `web` profile 挂载了 storage-domain 形态的 dsh（随附组合已包含）。
- 建议配合 [`@night-stars-1/dsh-host-auth`](../dsh-auth/README.zh.md) 使用：它的 `/api` 会话门禁跑在任何具名路由之前，因此 MCP 管理还会额外要求有效登录会话。

## 安装与启用

先构建（`pnpm install && pnpm run build`），然后装进 `web` profile：

```sh
dsh plugin --profile web add link:/path/to/dsh-mcp-config
# 发布后：dsh plugin --profile web add @night-stars-1/dsh-mcp-config --config.auto-install-peers=false
```

在 `~/.dsh/profiles/web/cordis.patch.yml` 挂上插件行：

```yaml
- insert:
    - id: mcp-config
      name: '@night-stars-1/dsh-mcp-config'
      inject: [webRuntime]
      config:
        trustedHosts: !!js ctx.webRuntime.trustedHosts
        allowRemoteManage: true
```

配置项：

- `trustedHosts`（默认 `[]`）：非回环的受信任主机（connection 插件的裸 `host[:port]` 词汇，加载时校验）。
- `allowRemoteManage`（默认 `false`）：`false` 时 MCP 管理**仅限回环**（最安全，因为新增服务器等于让宿主执行任意命令）；`true` 时放行 `trustedHosts` 里的主机（配合 dsh-auth 的会话门禁仍要求登录）。远程管理建议用 SSH 端口转发或 Tailscale 保持回环。

## 权限边界

MCP 管理面是**宿主级特权**（`command` 会作为子进程在宿主执行），因此默认钉在回环；`allowRemoteManage` 主动放宽到受信任主机，需自行权衡。密钥管理 `/api/auth/*` 与这里无关，仍由 dsh-auth 按回环判定。

## API

- `GET /api/mcp/list` → `{ servers: [{ id, serverName, transport, …, loaded, error }] }`
- `POST /api/mcp/add` → 入参为 stdio 或 streamable-http 的判别联合配置，返回 `{ server }`
- `POST /api/mcp/update` → 入参为 `{ id, ...配置 }`，保留原 id 与创建时间并返回 `{ server }`
- `POST /api/mcp/remove` → 入参 `{ id }`

全部先过浏览器信任栅栏（Host/Origin/Fetch-Metadata），再按 `allowRemoteManage` 决定是否要求回环；`serverName` 必须匹配 `[A-Za-z0-9_-]{1,32}` 且全局唯一。

## 已知限制

- 状态只区分「已加载 / 加载中 / 加载失败」；MCP 连接层面的重连由 dsh-mcp-client 自带（`failOnStartupError=false`），插件不追踪工具数量。
- 工具注册在宿主面/全局工具层，对所有会话与 preset 可见（与「全局」设计一致）。
