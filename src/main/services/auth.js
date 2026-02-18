// Microsoft authorization for Minecraft Java (Authorization Code + PKCE + loopback redirect).
//
// Full chain:
//   MSA device code -> OAuth token -> XBL -> XSTS -> Minecraft Services ->
//   profile + entitlements
//
// The launcher relies on:
//  - persistent refresh token to auto-restore the session
//  - a real Minecraft Services access token for --accessToken
//  - profile { uuid, username }
//  - entitlement check (Java Edition)

const fs = require('fs')
const path = require('path')

const crypto = require('crypto')

const DEFAULT_CLIENT_ID = '00000000402b5328'
// Use the "consumers" tenant for personal Microsoft accounts.
// (Common works too, but consumers is the most predictable for Xbox/Minecraft.)
const MSA_AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0'

const MC_PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile'
const MC_ENTITLEMENTS_URL = 'https://api.minecraftservices.com/entitlements/mcstore'

function ensureFetch() {
  if (typeof fetch === 'function') return
  throw new Error('Встроенный fetch недоступен. Нужен Node 18+ / Electron 20+.')
}

function formBody(obj) {
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(obj)) usp.append(k, String(v))
  return usp
}

async function postForm(url, bodyObj) {
  ensureFetch()
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody(bodyObj)
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  if (!res.ok) {
    const msg = json?.error_description || json?.error || JSON.stringify(json)
    const err = new Error(`HTTP ${res.status} ${res.statusText}: ${msg}`)
    err.status = res.status
    err.body = json
    throw err
  }
  return json
}

async function postJson(url, jsonBody, extraHeaders = {}) {
  ensureFetch()
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...extraHeaders
    },
    body: JSON.stringify(jsonBody)
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  if (!res.ok) {
    const msg = json?.XErr ? `XErr=${json.XErr}` : (json?.error_description || json?.error || JSON.stringify(json))
    const err = new Error(`HTTP ${res.status} ${res.statusText}: ${msg}`)
    err.status = res.status
    err.body = json
    throw err
  }
  return json
}

function cachePath(app) {
  const dataDir = app?.getPath?.('userData') || process.cwd()
  const dir = path.join(dataDir, '.auth-cache')
  return { dir, file: path.join(dir, 'ms_refresh.json') }
}

function readCache(app) {
  try {
    const { file } = cachePath(app)
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function writeCache(app, payload) {
  try {
    const { dir, file } = cachePath(app)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8')
  } catch {}
}

function now() {
  return Date.now()
}

function safeCall(fn, ...args) {
  try { return fn?.(...args) } catch { return undefined }
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function randomUrlSafe(lenBytes = 32) {
  return b64url(crypto.randomBytes(lenBytes))
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest()
}

function createPkcePair() {
  const verifier = randomUrlSafe(32)
  const challenge = b64url(sha256(verifier))
  return { verifier, challenge }
}

async function authCodePkceLoopback({ clientId, openBrowser, onStep }) {
  if (typeof openBrowser !== 'function') {
    throw new Error('Не могу открыть окно входа: openBrowser не задан.')
  }

  const step = (s) => safeCall(onStep, String(s))
  const { verifier, challenge } = createPkcePair()
  const state = randomUrlSafe(18)

  step('PKCE: старт локального callback…')

  const http = require('http')
  const server = http.createServer()

  const codePromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { server.close() } catch {}
      reject(new Error('Время ожидания входа истекло. Нажми «Войти» ещё раз.'))
    }, 5 * 60 * 1000)

    server.on('request', (req, res) => {
      try {
        const u = new URL(req.url || '/', 'http://127.0.0.1')
        if (u.pathname !== '/callback') {
          res.writeHead(404); res.end('Not found');
          return
        }

        const returnedState = u.searchParams.get('state')
        const code = u.searchParams.get('code')
        const err = u.searchParams.get('error')
        const errDesc = u.searchParams.get('error_description')

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<html><body style="font-family:Segoe UI,Arial; padding:24px;"><h2>Готово ✅</h2><p>Вход завершён. Можешь закрыть это окно и вернуться в лаунчер.</p></body></html>')

        clearTimeout(timer)
        try { server.close() } catch {}

        if (err) {
          reject(new Error(String(errDesc || err)))
          return
        }
        if (!code) {
          reject(new Error('Microsoft не вернул код авторизации.'))
          return
        }
        if (returnedState !== state) {
          reject(new Error('Ошибка безопасности: state не совпал.'))
          return
        }
        resolve(code)
      } catch (e) {
        try { res.writeHead(500); res.end('Error') } catch {}
        try { server.close() } catch {}
        reject(e)
      }
    })
  })

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve())
    server.on('error', reject)
  })

  const port = server.address()?.port
  if (!port) {
    try { server.close() } catch {}
    throw new Error('Не удалось поднять локальный callback сервер.')
  }

  const redirectUri = `http://127.0.0.1:${port}/callback`

  const authUrl = new URL(`${MSA_AUTHORITY}/authorize`)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_mode', 'query')
  authUrl.searchParams.set('scope', 'XboxLive.signin offline_access openid profile email')
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('prompt', 'select_account')

  step('Открываю Microsoft вход в браузере…')
  await openBrowser(authUrl.toString())

  step('Жду подтверждения входа…')
  const code = await codePromise

  step('Обмениваю code → токены…')
  const token = await postForm(`${MSA_AUTHORITY}/token`, {
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    scope: 'XboxLive.signin offline_access openid profile email'
  })

  if (!token?.access_token) throw new Error('Не удалось получить Microsoft access_token.')
  if (!token?.refresh_token) throw new Error('Не удалось получить Microsoft refresh_token.')

  return { msAccessToken: token.access_token, refreshToken: token.refresh_token, expiresIn: token.expires_in || null }
}

async function refreshMsToken(clientId, refreshToken) {
  return postForm(`${MSA_AUTHORITY}/token`, {
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: 'XboxLive.signin offline_access'
  })
}

async function exchangeXbl(msAccessToken) {
  const xbl = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: {
      AuthMethod: 'RPS',
      SiteName: 'user.auth.xboxlive.com',
      RpsTicket: `d=${msAccessToken}`
    },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT'
  }, { 'x-xbl-contract-version': '1' })

  const uhs = xbl?.DisplayClaims?.xui?.[0]?.uhs
  if (!uhs || !xbl?.Token) throw new Error('Не удалось получить Xbox Live токен.')
  return { xblToken: xbl.Token, uhs }
}

async function exchangeXsts(xblToken) {
  const xsts = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: {
      SandboxId: 'RETAIL',
      UserTokens: [xblToken]
    },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT'
  }, { 'x-xbl-contract-version': '1' })

  if (!xsts?.Token) throw new Error('Не удалось получить XSTS токен.')
  return { xstsToken: xsts.Token }
}

async function exchangeMinecraft(uhs, xstsToken) {
  const mc = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
    identityToken: `XBL3.0 x=${uhs};${xstsToken}`
  })
  if (!mc?.access_token) throw new Error('Не удалось получить Minecraft access_token.')
  return { mcAccessToken: mc.access_token, mcExpiresIn: mc.expires_in }
}

async function getProfile(mcAccessToken) {
  ensureFetch()
  const res = await fetch(MC_PROFILE_URL, {
    headers: { Authorization: `Bearer ${mcAccessToken}` }
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  if (!res.ok) {
    throw new Error(`Minecraft профиль недоступен (HTTP ${res.status}). Возможно, нет лицензии.`)
  }
  if (!json?.id || !json?.name) throw new Error('Minecraft профиль пустой/неожиданный.')
  return { id: json.id, name: json.name }
}

async function getEntitlements(mcAccessToken) {
  ensureFetch()
  const res = await fetch(MC_ENTITLEMENTS_URL, {
    headers: {
      Authorization: `Bearer ${mcAccessToken}`,
      Accept: 'application/json'
    }
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  if (!res.ok) {
    const err = new Error(`Entitlements недоступны (HTTP ${res.status}).`)
    err.status = res.status
    err.body = json
    throw err
  }
  const items = Array.isArray(json?.items) ? json.items : []
  const ownsJava = items.some(i => {
    const n = String(i?.name || '').toLowerCase()
    return n.includes('minecraft')
  })
  return { ownsJava, items }
}

function packResult({
  clientId,
  msAccessToken,
  refreshToken,
  xblToken,
  xstsToken,
  uhs,
  mcAccessToken,
  mcExpiresIn,
  profile,
  entitlements
}) {
  const updatedAt = now()
  const mcExpiresAt = mcExpiresIn ? (updatedAt + Number(mcExpiresIn) * 1000) : null
  return {
    accessToken: mcAccessToken,
    expiresIn: mcExpiresIn,
    expiresAt: mcExpiresAt,
    profile,
    entitlements,
    tokens: {
      clientId,
      ms: { accessToken: msAccessToken || null, refreshToken: refreshToken || null },
      xbl: { token: xblToken || null, uhs: uhs || null },
      xsts: { token: xstsToken || null },
      minecraft: { accessToken: mcAccessToken || null }
    },
    updatedAt
  }
}

async function loginMicrosoftJava({ app, userId, onStep, forceRefresh = false, clientId, openBrowser }) {
  const cid = clientId || DEFAULT_CLIENT_ID

  const step = (s) => safeCall(onStep, String(s))

  // Fast path: refresh token
  if (!forceRefresh) {
    const cached = readCache(app)
    if (cached?.refreshToken && cached?.clientId === cid) {
      try {
        step('MS refresh → OK')
        const token = await refreshMsToken(cid, cached.refreshToken)
        const msAccessToken = token.access_token
        const refreshToken = token.refresh_token || cached.refreshToken
        step('XBL → OK')
        const { xblToken, uhs } = await exchangeXbl(msAccessToken)
        step('XSTS → OK')
        const { xstsToken } = await exchangeXsts(xblToken)
        step('MC login → OK')
        const { mcAccessToken, mcExpiresIn } = await exchangeMinecraft(uhs, xstsToken)
        step('MC profile → OK')
        const profile = await getProfile(mcAccessToken)
        step('MC entitlements → ...')
        const entitlements = await getEntitlements(mcAccessToken)

        const packed = packResult({
          clientId: cid,
          msAccessToken,
          refreshToken,
          xblToken,
          xstsToken,
          uhs,
          mcAccessToken,
          mcExpiresIn,
          profile,
          entitlements
        })

        writeCache(app, {
          clientId: cid,
          refreshToken,
          profile,
          entitlements,
          mcExpiresAt: packed.expiresAt,
          updatedAt: packed.updatedAt
        })

        return packed
      } catch {
        // fallback to device flow
      }
    }
  }

  // Interactive login (system browser) with PKCE + loopback callback.
  const token = await authCodePkceLoopback({ clientId: cid, openBrowser, onStep })
  const msAccessToken = token.msAccessToken
  const refreshToken = token.refreshToken

  step('XBL → OK')
  const { xblToken, uhs } = await exchangeXbl(msAccessToken)
  step('XSTS → OK')
  const { xstsToken } = await exchangeXsts(xblToken)
  step('MC login → OK')
  const { mcAccessToken, mcExpiresIn } = await exchangeMinecraft(uhs, xstsToken)
  step('MC profile → OK')
  const profile = await getProfile(mcAccessToken)

  step('MC entitlements → OK')
  const entitlements = await getEntitlements(mcAccessToken)

  const packed = packResult({
    clientId: cid,
    msAccessToken,
    refreshToken,
    xblToken,
    xstsToken,
    uhs,
    mcAccessToken,
    mcExpiresIn,
    profile,
    entitlements
  })

  writeCache(app, {
    clientId: cid,
    refreshToken,
    profile,
    entitlements,
    mcExpiresAt: packed.expiresAt,
    updatedAt: packed.updatedAt
  })
  return packed
}

async function logoutMicrosoft({ app } = {}) {
  try {
    const { file } = cachePath(app)
    if (fs.existsSync(file)) fs.unlinkSync(file)
  } catch {}
}

async function validateCachedSession({ app, clientId } = {}) {
  const cid = clientId || DEFAULT_CLIENT_ID
  const cached = readCache(app)
  if (!cached?.refreshToken || cached.clientId !== cid) return { ok: false, error: 'NO_REFRESH' }
  try {
    const res = await loginMicrosoftJava({ app, forceRefresh: false, clientId: cid })
    return { ok: true, ...res }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}

module.exports = {
  loginMicrosoftJava,
  logoutMicrosoft,
  validateCachedSession
}
