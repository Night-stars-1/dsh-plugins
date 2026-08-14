# @night-stars-1/dsh-host-auth

English | [中文](README.zh.md)

Third-party access plugin for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI. Admission is a **pre-shared access key** — no registration, no accounts: `/api/auth/login` verifies the submitted key against the configured `accessKeys` (SHA-256 digests compared in constant time) and issues a session token, stored SHA-256-hashed in the `web_access` storage domain and carried by the HttpOnly SameSite=Strict `dsh_auth` cookie. The served `/login` page asks for the key; an admission guard mounted over the webserver answers unauthenticated `/api` requests 401, refuses unauthenticated `/api` upgrades before any handshake, and redirects unauthenticated HTML navigations to `/login`. Sessions survive restarts and expire after `sessionTtlMs`.

## Requirements

- Any dsh whose `web` profile mounts the storage-domain form (the shipped composition does). **No modification of the dsh installation is needed**: the guard wraps the underlying `node:http` server's request/upgrade listeners (`src/guard-mount.ts`). The wrap reads the `WebServer` class's TypeScript-private `server` field; a dsh release that renames it fails loud at plugin load instead of silently dropping protection.

## Install and enable

Build once (`pnpm install && pnpm run build` in this directory), then install into the `web` profile — `link:` during development, the published name once released:

```sh
dsh plugin --profile web add link:/Users/nightstar/Desktop/code/dsh-plugins/dsh-auth
# after publishing: dsh plugin --profile web add @night-stars-1/dsh-host-auth --config.auto-install-peers=false
```

`--config.auto-install-peers=false` keeps pnpm from fetching `@deepseek-ai/*` peers from the registry into the profile; peers must resolve to the host installation's own single instances through the profile module fallback.

Then mount the row in `~/.dsh/profiles/web/cordis.patch.yml` (applied automatically on every `dsh web` start):

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

Config: `accessKeys` (default `[]`; optional fixed keys, each at least 8 characters — a `!!js [process.env.DSH_WEB_ACCESS_KEY]` expression keeps the literal out of the file), `sessionTtlMs` (required, ms), `trustedHosts` (default `[]`; the connection plugin's bare `host[:port]` vocabulary, validated at load), `allowRemoteAdmin` (default `false`; see below).

**Remote admin (`allowRemoteAdmin`).** dsh pins its privileged `/api` methods — settings, credentials, directory picking, preset authoring — to a loopback Host, so behind a reverse proxy the settings dialog and model config answer `HTTP 403` for remote users while chat still works. Set `allowRemoteAdmin: true` to open that plane to **authenticated** sessions: after the guard confirms the session cookie, it presents a loopback Host to the downstream handler for `/api` requests. This deliberately trades away dsh's loopback safety default, so weigh it — every key holder can then read credentials (model API keys) and change configuration. Key management (`/api/auth`) is exempt from the rewrite and always judges the real Host, so adding or removing access keys stays host-machine-only regardless. Alternatives that need no rewrite: SSH port-forward (`ssh -L 8080:127.0.0.1:8080 server`) or Tailscale, which present a genuine loopback/private Host and unlock the privileged plane with the flag off.

**Key management.** The settings dialog's "访问密钥" section (shipped by this package's browser half) lists every key — page-managed ones with label, creation time, and **last use** (stamped on each successful login; deployment-config keys are listed read-only with their last use tracked by digest) — and adds or removes page keys. With no key configured anywhere, the first `/login` visit from the host machine walks a setup form instead. Management drives `GET /api/auth/keys`, `POST /api/auth/add-key`, and `POST /api/auth/remove-key`, all **loopback-only** (a trusted LAN authority passes the fence but answers 403 `loopback-only`) and, past first-run setup, requiring a live session. Page keys (up to 20, duplicates refused) are stored as SHA-256 digests in the `web_access` domain — never plaintext. Removing a key revokes new logins with it; live sessions stay valid until logout or expiry — delete `~/.dsh/storages/web_access.json` to revoke every session and page key at once.

## Known limitations

- **The settings surface is a plugin-owned section, not a Plugins-page card.** The package ships a browser half (`client-src/`, built to `lib/client.js` in the dsh client-module factory format) that registers a "访问密钥" page into the settings dialog's open `settings.section` slot, driving the plugin's own `/api/auth` endpoints. A card on the Plugins page proper is impossible for third-party plugins today: the upstream API proxy serves only a hardcoded settings-namespace allowlist (`WEB_SETTINGS_NAMESPACES` in `dsh-host-apiproxy`); the plugin's `host-auth` namespace registration is kept so that card also lights up if upstream ever opens the allowlist.
- One shared gate, no identities: every key holder is equal, and everyone sees the same host's sessions, workspaces, and settings.
- Plain-HTTP cookie (no `Secure` attribute); put TLS termination in front for any non-loopback deployment.
- No rate limiting on key attempts.
- `src/trust.ts` is a local copy of the connection plugin's browser-trust fence; keep it behaviorally identical to upstream.
