/**
 * The "访问密钥" settings page: lists every access key (page-managed and
 * deployment-config) with its last use, and — on the host machine — adds and
 * removes page-managed keys through the plugin's /api/auth endpoints.
 * Plain same-origin fetch; inline styles so the bundle needs no CSS pipeline.
 */

import { useCallback, useEffect, useState } from 'react'

interface AccessStatus {
  authenticated: boolean
  needsSetup: boolean
  canManageKey: boolean
}

interface PageKeyView {
  id: string
  label: string
  createdAt: number
  lastUsedAt: number | null
}

interface ConfigKeyView {
  index: number
  lastUsedAt: number | null
}

interface KeysView {
  keys: PageKeyView[]
  configKeys: ConfigKeyView[]
}

const MESSAGES: Record<string, string> = {
  'loopback-only': '需在本机操作，或用配置文件密钥登录',
  'weak-key': '密钥至少需要 8 个字符',
  'invalid-request': '请求格式不正确',
  'unauthenticated': '登录已过期，请刷新页面重新登录',
  'duplicate-key': '该密钥已存在',
  'unknown-key': '密钥不存在（可能已被删除）',
  'too-many-keys': '页面管理的密钥数量已达上限',
}

const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560, fontSize: 14 },
  title: { fontSize: 16, fontWeight: 600, margin: 0 },
  hint: { opacity: 0.65, fontSize: 13, margin: 0, lineHeight: 1.6 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '6px 8px', opacity: 0.6, fontWeight: 500, borderBottom: '1px solid rgba(128,128,128,0.25)' },
  td: { padding: '8px 8px', borderBottom: '1px solid rgba(128,128,128,0.15)' },
  row: { display: 'flex', gap: 8 },
  input: {
    padding: '8px 10px', fontSize: 14, borderRadius: 8, color: 'inherit',
    border: '1px solid rgba(128,128,128,0.4)', background: 'transparent',
  },
  button: {
    padding: '8px 16px', fontSize: 14, borderRadius: 8, border: 'none',
    cursor: 'pointer', background: '#4d6bfe', color: '#fff', whiteSpace: 'nowrap',
  },
  removeButton: {
    padding: '4px 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
    background: 'transparent', color: '#e5484d', border: '1px solid rgba(229,72,77,0.5)',
  },
  error: { color: '#e5484d', fontSize: 13, margin: 0 },
  ok: { color: '#30a46c', fontSize: 13, margin: 0 },
} as const

function formatTime(value: number | null): string {
  if (value === null) return '从未使用'
  return new Date(value).toLocaleString()
}

async function readError(response: Response): Promise<string> {
  const body = await response.json().catch(() => undefined) as { error?: { code?: string } } | undefined
  const code = body?.error?.code ?? String(response.status)
  return MESSAGES[code] ?? `请求失败（${code}）`
}

/**
 * Render the access-key settings page.
 * @returns the page element tree.
 */
export function AccessKeySection(): React.JSX.Element {
  const [status, setStatus] = useState<AccessStatus | undefined>(undefined)
  const [view, setView] = useState<KeysView | undefined>(undefined)
  const [label, setLabel] = useState('')
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>(undefined)

  const reload = useCallback(async () => {
    try {
      const statusResponse = await fetch('/api/auth/status')
      const nextStatus = statusResponse.ok ? await statusResponse.json() as AccessStatus : undefined
      setStatus(nextStatus)
      if (nextStatus?.canManageKey === true) {
        const keysResponse = await fetch('/api/auth/keys')
        setView(keysResponse.ok ? await keysResponse.json() as KeysView : undefined)
      }
    } catch {
      setStatus(undefined)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const addKey = useCallback(async () => {
    setNotice(undefined)
    try {
      const response = await fetch('/api/auth/add-key', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: draft, label }),
      })
      if (!response.ok) {
        setNotice({ kind: 'error', text: await readError(response) })
        return
      }
      setDraft('')
      setLabel('')
      setNotice({ kind: 'ok', text: '密钥已添加，立即生效' })
      await reload()
    } catch {
      setNotice({ kind: 'error', text: '网络错误' })
    }
  }, [draft, label, reload])

  const removeKey = useCallback(async (id: string) => {
    setNotice(undefined)
    try {
      const response = await fetch('/api/auth/remove-key', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!response.ok) {
        setNotice({ kind: 'error', text: await readError(response) })
        return
      }
      setNotice({ kind: 'ok', text: '密钥已删除；已登录的会话保持有效' })
      await reload()
    } catch {
      setNotice({ kind: 'error', text: '网络错误' })
    }
  }, [reload])

  return (
    <div style={styles.page}>
      <h3 style={styles.title}>访问密钥</h3>
      <p style={styles.hint}>
        访问该 Web 界面需要密钥登录。可以添加多个密钥（例如按人发放，删除即吊销新登录），每个密钥记录最近一次登录时间；
        密钥以 SHA-256 摘要存储，绝不保存明文。管理需在运行 dsh 的本机上进行，或用配置文件密钥登录后进行。
      </p>
      {status === undefined ? (
        <p style={styles.hint}>正在读取状态…</p>
      ) : !status.canManageKey ? (
        <p style={styles.hint}>需在本机操作，或用配置文件密钥登录后才能管理密钥。</p>
      ) : (
        <>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>备注</th>
                <th style={styles.th}>创建时间</th>
                <th style={styles.th}>最后使用</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {(view?.keys ?? []).map(key => (
                <tr key={key.id}>
                  <td style={styles.td}>{key.label === '' ? '（未命名）' : key.label}</td>
                  <td style={styles.td}>{new Date(key.createdAt).toLocaleString()}</td>
                  <td style={styles.td}>{formatTime(key.lastUsedAt)}</td>
                  <td style={styles.td}>
                    <button style={styles.removeButton} type="button" onClick={() => { void removeKey(key.id) }}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
              {(view?.configKeys ?? []).map(key => (
                <tr key={`config-${key.index}`}>
                  <td style={styles.td}>配置文件密钥 #{key.index + 1}</td>
                  <td style={styles.td}>—</td>
                  <td style={styles.td}>{formatTime(key.lastUsedAt)}</td>
                  <td style={styles.td}><span style={{ opacity: 0.5, fontSize: 12 }}>配置管理</span></td>
                </tr>
              ))}
              {(view?.keys?.length ?? 0) === 0 && (view?.configKeys?.length ?? 0) === 0 && (
                <tr><td style={styles.td} colSpan={4}>还没有任何密钥</td></tr>
              )}
            </tbody>
          </table>
          <div style={styles.row}>
            <input
              style={{ ...styles.input, width: 120 }}
              type="text"
              placeholder="备注（可选）"
              value={label}
              onChange={(event) => { setLabel(event.target.value) }}
            />
            <input
              style={{ ...styles.input, flex: 1 }}
              type="password"
              placeholder="新密钥（至少 8 个字符）"
              autoComplete="new-password"
              value={draft}
              onChange={(event) => { setDraft(event.target.value) }}
            />
            <button style={styles.button} type="button" onClick={() => { void addKey() }}>
              添加
            </button>
          </div>
          {notice !== undefined && (
            <p style={notice.kind === 'ok' ? styles.ok : styles.error}>{notice.text}</p>
          )}
        </>
      )}
    </div>
  )
}
