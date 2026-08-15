/**
 * The "MCP 服务器" settings page: lists every configured MCP server with its
 * live load status, and adds/removes servers through the plugin's
 * /api/mcp endpoints. Layout mirrors the native settings sections
 * (dsh-client-ui-primitives + `--dsw-alias-*` design tokens), with the add
 * form in a Modal so the page stays compact.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  IconEditOutline16,
  IconPlusOutline16,
  IconTrashOutline16,
  IconWarningOutline16,
  Input,
  Modal,
  Pill,
} from '@deepseek-ai/dsh-client-ui-primitives'

type Transport = 'stdio' | 'streamable-http'

interface McpServerView {
  id: string
  serverName: string
  transport: Transport
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  toolCallTimeoutMs?: number
  createdAt: number
  loaded: boolean
  error: string | null
  online: boolean
  tools: { name: string; description: string }[]
}

interface ListResponse {
  servers: McpServerView[]
}

const MESSAGES: Record<string, string> = {
  'loopback-only': 'MCP 管理仅限服务器本机',
  'untrusted-request': '请求来源不受信任',
  'invalid-request': '请求格式不正确',
  'duplicate-server-name': '该 serverName 已存在',
  'too-many-servers': 'MCP 服务器数量已达上限',
  'unknown-server': '服务器不存在',
}

/** Native-token layout, mirroring the shipped settings sections. */
const styles = {
  section: { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720, color: 'var(--dsw-alias-label-primary)' },
  title: { margin: 0, fontSize: 18, fontWeight: 600 },
  intro: { margin: 0, fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' },
  notice: { margin: 0, fontSize: 13, color: 'var(--dsw-alias-state-error-primary)' },
  empty: { margin: 0, fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' },
  cards: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 },
  card: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
    border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12,
    background: 'var(--dsw-alias-bg-layer-3)',
  },
  cardMain: { flex: 1, minWidth: 0 },
  cardNameRow: { display: 'flex', alignItems: 'center', gap: 8 },
  cardName: { fontSize: 14, fontWeight: 600 },
  cardMeta: {
    fontSize: 12, color: 'var(--dsw-alias-label-tertiary)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2,
  },
  cardError: {
    display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
    color: 'var(--dsw-alias-state-error-primary)', marginTop: 4, overflowWrap: 'anywhere',
  },
  toolsRow: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  status: {
    display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12,
    color: 'var(--dsw-alias-label-tertiary)', fontWeight: 400, whiteSpace: 'nowrap',
  },
  statusDot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  statusOnline: { background: 'var(--dsw-alias-state-success-primary)' },
  statusOffline: { background: 'var(--dsw-alias-label-tertiary)' },
  addButton: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 6, height: 44, borderRadius: 12, boxSizing: 'border-box', width: '100%',
    border: '1px dashed var(--dsw-alias-border-l3)',
    background: 'transparent', color: 'var(--dsw-alias-label-primary)',
    cursor: 'pointer', font: 'inherit', fontSize: 13,
  },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  transportRow: { display: 'flex', gap: 8 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: 500, color: 'var(--dsw-alias-label-secondary)' },
  textarea: {
    padding: '8px 10px', fontSize: 13, borderRadius: 8, color: 'inherit',
    border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-3)',
    fontFamily: 'inherit', minHeight: 60, resize: 'vertical', width: '100%', boxSizing: 'border-box',
  },
} as const

/** Same-origin JSON fetch; a non-2xx throws with the server's error code. */
async function apiJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await response.text()
  let body: unknown = text
  try { body = JSON.parse(text) } catch { /* non-JSON body */ }
  if (!response.ok) {
    const code = (body as { error?: { code?: string } } | null)?.error?.code
    throw new Error(MESSAGES[code ?? ''] ?? code ?? `HTTP ${response.status}`)
  }
  return body
}

/** Parse one-arg-per-line text into a string list. */
function parseArgs(text: string): string[] {
  return text.split('\n').map(line => line.trim()).filter(Boolean)
}

/** Parse KEY=VALUE-per-line text into a dict; malformed lines are skipped. */
function parseDict(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue
    out[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim()
  }
  return out
}

/** Render a string list back to one-arg-per-line text for the editor. */
function formatArgs(args: string[]): string {
  return args.join('\n')
}

/** Render a dict back to KEY=VALUE-per-line text for the editor. */
function formatDict(dict: Record<string, string>): string {
  return Object.entries(dict).map(([key, value]) => `${key}=${value}`).join('\n')
}

export function McpSection(): React.JSX.Element {
  const [servers, setServers] = useState<McpServerView[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [transport, setTransport] = useState<Transport>('stdio')
  const [serverName, setServerName] = useState('')
  const [command, setCommand] = useState('')
  const [argsText, setArgsText] = useState('')
  const [envText, setEnvText] = useState('')
  const [cwd, setCwd] = useState('')
  const [url, setUrl] = useState('')
  const [headersText, setHeadersText] = useState('')

  const reload = useCallback(async (): Promise<void> => {
    try {
      const data = await apiJson('/api/mcp/list') as ListResponse
      setServers(data.servers)
      setNotice(null)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const resetForm = useCallback((): void => {
    setTransport('stdio')
    setServerName('')
    setCommand('')
    setArgsText('')
    setEnvText('')
    setCwd('')
    setUrl('')
    setHeadersText('')
  }, [])

  const openForm = useCallback((): void => {
    resetForm()
    setEditingId(null)
    setNotice(null)
    setShowForm(true)
  }, [resetForm])

  const closeForm = useCallback((): void => {
    if (submitting) return
    setShowForm(false)
  }, [submitting])

  const startEdit = useCallback((server: McpServerView): void => {
    setEditingId(server.id)
    setTransport(server.transport)
    setServerName(server.serverName)
    if (server.transport === 'stdio') {
      setCommand(server.command ?? '')
      setArgsText(formatArgs(server.args ?? []))
      setEnvText(formatDict(server.env ?? {}))
      setCwd(server.cwd ?? '')
    } else {
      setUrl(server.url ?? '')
      setHeadersText(formatDict(server.headers ?? {}))
    }
    setNotice(null)
    setShowForm(true)
  }, [])

  const save = useCallback(async (): Promise<void> => {
    const payload: Record<string, unknown> = { transport, serverName }
    if (transport === 'stdio') {
      Object.assign(payload, { command, args: parseArgs(argsText), env: parseDict(envText), cwd })
    } else {
      Object.assign(payload, { url, headers: parseDict(headersText) })
    }
    setSubmitting(true)
    try {
      const path = editingId === null ? '/api/mcp/add' : '/api/mcp/update'
      const body = editingId === null ? payload : { id: editingId, ...payload }
      await apiJson(path, { method: 'POST', body: JSON.stringify(body) })
      setShowForm(false)
      await reload()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }, [transport, serverName, command, argsText, envText, cwd, url, headersText, editingId, reload])

  const remove = useCallback(async (id: string): Promise<void> => {
    try {
      await apiJson('/api/mcp/remove', { method: 'POST', body: JSON.stringify({ id }) })
      await reload()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }, [reload])

  return (
    <section style={styles.section}>
      <h2 style={styles.title}>MCP 服务器</h2>
      <p style={styles.intro}>配置外部 MCP 服务器，其工具会以 mcp__serverName__tool 的名字提供给模型，改完即时生效。</p>

      {notice !== null && <p style={styles.notice} role="alert">{notice}</p>}

      {servers.length === 0 ? (
        <p style={styles.empty}>尚未配置 MCP 服务器。</p>
      ) : (
        <ul style={styles.cards}>
          {servers.map(server => (
            <li key={server.id} style={styles.card}>
              <div style={styles.cardMain}>
                <div style={styles.cardNameRow}>
                  <span style={styles.cardName}>{server.serverName}</span>
                  <span style={styles.status}>
                    <span style={{ ...styles.statusDot, ...(server.online ? styles.statusOnline : styles.statusOffline) }} />
                    {server.online ? '在线' : '离线'}
                  </span>
                </div>
                <div style={styles.cardMeta}>
                  {server.transport === 'stdio' ? server.command : server.url}
                </div>
                {server.tools.length > 0 && (
                  <div style={styles.toolsRow}>
                    {server.tools.map(tool => <Pill key={tool.name}>{tool.name}</Pill>)}
                  </div>
                )}
                {server.error !== null && (
                  <div style={styles.cardError}>
                    <IconWarningOutline16 />{server.error}
                  </div>
                )}
              </div>
              <Button variant="ghost" size="sm" icon={<IconEditOutline16 />} onClick={() => { startEdit(server) }}>编辑</Button>
              <Button variant="outline" size="sm" icon={<IconTrashOutline16 />} onClick={() => { void remove(server.id) }}>删除</Button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" style={styles.addButton} onClick={openForm}>
        <IconPlusOutline16 size={14} />
        添加服务器
      </button>

      <Modal
        open={showForm}
        onClose={closeForm}
        title={editingId === null ? '添加 MCP 服务器' : '编辑 MCP 服务器'}
        closeLabel="关闭"
        footer={(
          <>
            <Button variant="outline" disabled={submitting} onClick={closeForm}>取消</Button>
            <Button disabled={submitting} onClick={() => { void save() }}>{submitting ? '保存中…' : '保存'}</Button>
          </>
        )}
      >
        <div style={styles.form}>
          <div style={styles.transportRow}>
            <Pill active={transport === 'stdio'} onClick={() => { setTransport('stdio') }}>stdio（本地进程）</Pill>
            <Pill active={transport === 'streamable-http'} onClick={() => { setTransport('streamable-http') }}>streamable-http（远程）</Pill>
          </div>

          <div style={styles.field}>
            <span style={styles.fieldLabel}>serverName</span>
            <Input value={serverName} placeholder="github" autoFocus spellCheck={false} onChange={event => { setServerName(event.target.value) }} />
          </div>

          {transport === 'stdio' ? (
            <>
              <div style={styles.field}>
                <span style={styles.fieldLabel}>command</span>
                <Input value={command} placeholder="npx" spellCheck={false} onChange={event => { setCommand(event.target.value) }} />
              </div>
              <div style={styles.field}>
                <span style={styles.fieldLabel}>args（每行一个）</span>
                <textarea style={styles.textarea} value={argsText} placeholder={'-y\n@modelcontextprotocol/server-github'} onChange={event => { setArgsText(event.target.value) }} />
              </div>
              <div style={styles.field}>
                <span style={styles.fieldLabel}>env（KEY=VALUE 每行一个）</span>
                <textarea style={styles.textarea} value={envText} placeholder={'GITHUB_TOKEN=...'} onChange={event => { setEnvText(event.target.value) }} />
              </div>
              <div style={styles.field}>
                <span style={styles.fieldLabel}>cwd（工作目录，可选）</span>
                <Input value={cwd} placeholder="/workspace" spellCheck={false} onChange={event => { setCwd(event.target.value) }} />
              </div>
            </>
          ) : (
            <>
              <div style={styles.field}>
                <span style={styles.fieldLabel}>url</span>
                <Input value={url} placeholder="http://localhost:3000/mcp" spellCheck={false} onChange={event => { setUrl(event.target.value) }} />
              </div>
              <div style={styles.field}>
                <span style={styles.fieldLabel}>headers（KEY=VALUE 每行一个）</span>
                <textarea style={styles.textarea} value={headersText} placeholder={'Authorization=Bearer ...'} onChange={event => { setHeadersText(event.target.value) }} />
              </div>
            </>
          )}
        </div>
      </Modal>
    </section>
  )
}
