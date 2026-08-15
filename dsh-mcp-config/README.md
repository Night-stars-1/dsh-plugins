# @night-stars-1/dsh-mcp-config

English | [中文](README.zh.md)

Third-party MCP server manager for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI: a settings page to add and remove MCP servers, persisted in the `mcp_config` storage domain and hot-applied — each change tears down the old connection and starts a live [`dsh-mcp-client`](https://github.com/deepseek-ai/deepseek-harness) instance, so tools refresh immediately under the model-facing `mcp__<serverName>__<tool>` namespace. Both **stdio** (spawned child process) and **streamable-http** transports are supported.

## Requirements

- Any `web`-profile dsh with the storage-domain form mounted (the shipped composition does).
- Recommended with [`@night-stars-1/dsh-host-auth`](../dsh-auth/README.md): its `/api` session guard runs before every named route, so MCP management additionally requires a live session.

## Install and enable

Build once (`pnpm install && pnpm run build`), then install into the `web` profile and mount the row in `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: mcp-config
      name: '@night-stars-1/dsh-mcp-config'
      inject: [webRuntime]
      config:
        trustedHosts: !!js ctx.webRuntime.trustedHosts
        allowRemoteManage: true
```

Config: `trustedHosts` (default `[]`; the connection plugin's bare `host[:port]` vocabulary, validated at load), `allowRemoteManage` (default `false`; see below).

**Privilege boundary.** MCP management is host-level privilege — a stdio `command` is spawned as a child process on the host. It is therefore loopback-only by default; `allowRemoteManage: true` widens it to the declared `trustedHosts` (and, with dsh-auth installed, still requires a live session). Prefer SSH port-forward or Tailscale to keep management loopback.

## API

- `GET /api/mcp/list` → `{ servers: [{ id, serverName, transport, …, loaded, error }] }`
- `POST /api/mcp/add` → a stdio or streamable-http discriminated-union config; returns `{ server }`
- `POST /api/mcp/update` → `{ id, ...config }`; preserves the existing id and creation time and returns `{ server }`
- `POST /api/mcp/remove` → `{ id }`

All endpoints pass the browser-trust fence (Host/Origin/Fetch-Metadata) first; `serverName` must match `[A-Za-z0-9_-]{1,32}` and be unique.

## Known limitations

- Status is coarse (loaded / loading / failed); reconnect state and tool counts are not surfaced.
- Tools register on the host-plane (global) tool layer, so they are visible to every session and preset.
