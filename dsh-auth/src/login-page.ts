/**
 * The served /login page: a self-contained HTML document (inline styles and
 * script, no external assets) driving the /api/auth endpoints. Three states
 * from /api/auth/status: first-run setup (no key configured anywhere, set
 * one from the host machine), signed-out (enter the key), and signed-in
 * (enter the app, sign out, and — on the host machine — change the key).
 * Product copy is Chinese, matching the Web GUI.
 */

/** Page script; kept free of template interpolation so the document template stays literal. */
const PAGE_SCRIPT = `
const MESSAGES = {
  'untrusted-request': '请求来源不受信任',
  'method-not-allowed': '请求方式不受支持',
  'invalid-request': '请求格式不正确',
  'invalid-credentials': '访问密钥不正确',
  'unauthenticated': '登录已过期，请重新输入密钥',
  'loopback-only': '只能在运行 dsh 的本机上修改密钥',
  'weak-key': '密钥至少需要 8 个字符',
}
const el = (id) => document.getElementById(id)
function message(code) {
  return MESSAGES[code] || ('请求失败（' + code + '）')
}
function showError(target, code) {
  target.textContent = message(code)
  target.hidden = false
  target.className = 'notice error'
}
function showOk(target, text) {
  target.textContent = text
  target.hidden = false
  target.className = 'notice ok'
}
async function post(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (response.ok) return null
  const payload = await response.json().catch(() => null)
  return payload && payload.error ? payload.error.code : String(response.status)
}
async function loadStatus() {
  try {
    const response = await fetch('/api/auth/status')
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}
async function submitSetup(event) {
  event.preventDefault()
  el('setup-notice').hidden = true
  const key = el('setup-key').value
  const failed = await post('/api/auth/add-key', { key })
  if (failed) {
    showError(el('setup-notice'), failed)
    return
  }
  const loginFailed = await post('/api/auth/login', { key })
  if (loginFailed) {
    showError(el('setup-notice'), loginFailed)
    return
  }
  location.href = '/'
}
async function submitLogin(event) {
  event.preventDefault()
  el('login-notice').hidden = true
  el('login-submit').disabled = true
  try {
    const failed = await post('/api/auth/login', { key: el('key').value })
    if (failed) {
      showError(el('login-notice'), failed)
      return
    }
    location.href = '/'
  } finally {
    el('login-submit').disabled = false
  }
}
async function signOut() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null)
  location.reload()
}
async function boot() {
  const status = await loadStatus()
  if (status && status.needsSetup) {
    el('setup').hidden = false
    el('setup-key').focus()
    if (!status.canManageKey) {
      el('setup-form').hidden = true
      showError(el('setup-notice'), 'loopback-only')
    }
  } else if (status && status.authenticated) {
    el('signed-in').hidden = false
    if (status.canManageKey) el('manage-hint').hidden = false
  } else {
    el('signed-out').hidden = false
    el('key').focus()
  }
  el('setup-form').addEventListener('submit', submitSetup)
  el('form').addEventListener('submit', submitLogin)
  el('sign-out').addEventListener('click', signOut)
}
boot()
`

/**
 * Render the complete /login HTML document.
 * @returns the UTF-8 HTML body.
 */
export function renderLoginPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>登录 - DeepSeek Harness</title>
<style>
:root { color-scheme: light dark; }
body {
  margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: light-dark(#f5f6f8, #16181d); color: light-dark(#1c1f24, #e8eaee);
}
.card {
  width: min(360px, calc(100vw - 48px)); padding: 32px 28px; border-radius: 16px;
  background: light-dark(#ffffff, #1f232b); box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
}
h1 { margin: 0 0 8px; font-size: 20px; text-align: center; }
.hint { margin: 0 0 20px; font-size: 13px; text-align: center; opacity: 0.65; }
label { display: block; margin: 12px 0 6px; font-size: 13px; opacity: 0.8; }
input {
  width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 14px; color: inherit;
  border: 1px solid light-dark(#d5d9e0, #3a4150); border-radius: 8px; background: transparent;
}
button[type="submit"], #enter {
  width: 100%; margin-top: 20px; padding: 10px 0; font-size: 15px; border: none; border-radius: 8px;
  cursor: pointer; background: #4d6bfe; color: #fff;
}
#sign-out {
  width: 100%; margin-top: 10px; padding: 9px 0; font-size: 14px; border-radius: 8px; cursor: pointer;
  background: transparent; color: inherit; border: 1px solid light-dark(#d5d9e0, #3a4150);
}
.notice { margin: 14px 0 0; padding: 9px 12px; border-radius: 8px; font-size: 13px; }
.notice.error { background: light-dark(#fdecec, #3a2226); color: light-dark(#b3261e, #ff8a80); }
.notice.ok { background: light-dark(#e8f5ec, #1f3327); color: light-dark(#1a7f37, #7ee2a8); }
#signed-in p { text-align: center; font-size: 14px; }
#change { margin-top: 22px; padding-top: 16px; border-top: 1px solid light-dark(#e4e7ec, #2c313c); }
#change h2 { margin: 0; font-size: 14px; }
</style>
</head>
<body>
<main class="card">
<h1>DeepSeek Harness</h1>
<section id="setup" hidden>
  <p class="hint">首次使用：请设置访问密钥（至少 8 个字符）</p>
  <form id="setup-form">
    <label for="setup-key">访问密钥</label>
    <input id="setup-key" name="setup-key" type="password" autocomplete="new-password" required>
    <p id="setup-notice" hidden></p>
    <button type="submit">设置并进入</button>
  </form>
</section>
<section id="signed-out" hidden>
  <form id="form">
    <label for="key">访问密钥</label>
    <input id="key" name="key" type="password" autocomplete="current-password" required>
    <p id="login-notice" hidden></p>
    <button id="login-submit" type="submit">进入</button>
  </form>
</section>
<section id="signed-in" hidden>
  <p>已通过密钥认证</p>
  <button id="enter" type="button" onclick="location.href='/'">进入应用</button>
  <button id="sign-out" type="button">退出登录</button>
  <p id="manage-hint" class="hint" hidden>密钥的添加、删除与使用记录在应用内"设置 → 访问密钥"管理</p>
</section>
</main>
<script>${PAGE_SCRIPT}</script>
</body>
</html>
`
}
