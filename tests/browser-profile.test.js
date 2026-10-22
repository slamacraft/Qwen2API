// 浏览器指纹（baxia 凭证）：代理从真实浏览器采集后按账号复用。
// 没有它，/api/v2/chat/completions 会被 WAF 判 unauthorized；有它（且 Version 头在位）
// 才能拿到正常 SSE 流。多账号轮换时每个账号用**自己**的指纹文件。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

process.env.API_KEY = 'browser-profile-test-key'
process.env.DATA_SAVE_MODE = 'none'
process.env.ACCOUNTS = ''
process.env.ENABLE_CLI = 'false'
process.env.ENABLE_FILE_LOG = 'false'
process.env.PROXY_URL = ''
process.env.BROWSER_PROFILE_PATH = ''

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen2api-browser-profile-'))
process.env.QWEN2API_RUNTIME_DIR = tmpDir

const config = require('../src/config/index.js')
const {
  getBrowserProfile,
  getWebVersion,
  tokenExpiresAt,
  resolveProfilePath,
  safeEmail,
  clearProfileCache,
  canUseAccountForUpstream,
  isProfileModeActive,
  DEFAULT_VERSION
} = require('../src/utils/browser-profile.js')
const { buildRequestHeaders } = require('../src/utils/header-profile.js')

const dataDir = path.join(tmpDir, 'data')
fs.mkdirSync(dataDir, { recursive: true })

const writeProfileFile = (file, payload) => {
  fs.writeFileSync(path.join(dataDir, file), JSON.stringify(payload), 'utf8')
  clearProfileCache()
}

const PROFILE_A = {
  cookie: 'tfstk=a-cookie; refresh_token=a-refresh',
  token: 'eyJhbGciOiJIUzI1NiJ9.a.signature',
  bxUa: '234!a-bx-ua',
  bxUmidtoken: 'T2gA-a-umid',
  bxV: '2.5.37',
  version: '0.3.21',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/155.0.0.0 Safari/537.36',
  secChUa: '"Google Chrome";v="155"',
  secChUaPlatform: '"Windows"',
  acceptLanguage: 'zh-CN,zh;q=0.9',
  timezone: 'Thu Oct 22 2026 10:00:00 GMT+0800',
  harvestedAt: '2026-10-22T02:00:00.000Z'
}

const PROFILE_B = {
  ...PROFILE_A,
  cookie: 'tfstk=b-cookie',
  token: 'eyJhbGciOiJIUzI1NiJ9.b.signature',
  bxUa: '234!b-bx-ua',
  version: '0.3.20'
}

test.after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) { /* ignore */ }
})

test.beforeEach(() => {
  config.browserProfilePath = ''
  // 每个用例从干净目录开始：指纹文件是全局回退的，残留会互相污染
  for (const name of fs.readdirSync(dataDir)) {
    try { fs.rmSync(path.join(dataDir, name), { force: true }) } catch (_) { /* ignore */ }
  }
  clearProfileCache()
})

test('el nombre de fichero por cuenta es seguro', () => {
  assert.equal(safeEmail('User.Name+tag@Example.com'), 'user.name_tag@example.com')
  assert.match(resolveProfilePath('a@x.com'), /browser-profile\.a@x\.com\.json$/)
  assert.match(resolveProfilePath(), /browser-profile\.json$/)
})

test('cada cuenta lee su propio fichero', () => {
  writeProfileFile(`browser-profile.${safeEmail('a@x.com')}.json`, PROFILE_A)
  writeProfileFile(`browser-profile.${safeEmail('b@x.com')}.json`, PROFILE_B)

  assert.equal(getBrowserProfile('a@x.com').bxUa, PROFILE_A.bxUa)
  assert.equal(getBrowserProfile('b@x.com').bxUa, PROFILE_B.bxUa)
  assert.equal(getWebVersion('a@x.com'), '0.3.21')
  assert.equal(getWebVersion('b@x.com'), '0.3.20')
})

test('una cuenta sin fichero propio cae al fichero global', () => {
  writeProfileFile('browser-profile.json', PROFILE_A)
  assert.equal(getBrowserProfile('sin-fichero@x.com').bxUa, PROFILE_A.bxUa)
})

test('sin fichero global ni propio devuelve null y no rompe', () => {
  config.browserProfilePath = path.join(tmpDir, 'no-existe.json')
  assert.equal(getBrowserProfile('nadie@x.com'), null)
  assert.equal(getWebVersion('nadie@x.com'), config.qwenWebVersion || DEFAULT_VERSION)
})

test('un fichero incompleto se ignora (sin bx-ua no sirve)', () => {
  writeProfileFile(`browser-profile.${safeEmail('roto@x.com')}.json`, { cookie: 'tfstk=x', bxUa: '' })
  assert.equal(getBrowserProfile('roto@x.com'), null)
})

test('las cabeceras usan el fingerprint de ESA cuenta (cookie, baxia, UA, token, Version)', () => {
  writeProfileFile(`browser-profile.${safeEmail('a@x.com')}.json`, PROFILE_A)
  writeProfileFile(`browser-profile.${safeEmail('b@x.com')}.json`, PROFILE_B)

  const headersA = buildRequestHeaders(
    { email: 'a@x.com', fingerprint: null },
    { chatBaseUrl: 'https://chat.qwen.ai', token: 'cuenta-token', accept: 'application/json' }
  )
  const headersB = buildRequestHeaders(
    { email: 'b@x.com', fingerprint: null },
    { chatBaseUrl: 'https://chat.qwen.ai', token: 'cuenta-token', accept: 'application/json' }
  )

  assert.equal(headersA['cookie'], PROFILE_A.cookie)
  assert.equal(headersA['bx-ua'], PROFILE_A.bxUa)
  assert.equal(headersA['bx-umidtoken'], PROFILE_A.bxUmidtoken)
  assert.equal(headersA['user-agent'], PROFILE_A.userAgent, 'el UA sintetico se sustituye por el real')
  assert.equal(headersA['sec-ch-ua'], PROFILE_A.secChUa)
  assert.equal(headersA['Authorization'], `Bearer ${PROFILE_A.token}`)
  assert.equal(headersA['Version'], PROFILE_A.version)

  assert.equal(headersB['cookie'], PROFILE_B.cookie)
  assert.equal(headersB['bx-ua'], PROFILE_B.bxUa)
  assert.equal(headersB['Authorization'], `Bearer ${PROFILE_B.token}`)
  assert.notEqual(headersA['bx-ua'], headersB['bx-ua'])
})

test('sin fingerprint se mantiene el comportamiento anterior', () => {
  config.browserProfilePath = path.join(tmpDir, 'tampoco-existe.json')
  const headers = buildRequestHeaders(
    { email: 'plain@x.com', fingerprint: null },
    { chatBaseUrl: 'https://chat.qwen.ai', token: 'cuenta-token', accept: 'application/json', ssxmodItna: 'itna', ssxmodItna2: 'itna2' }
  )

  assert.match(headers['cookie'], /^token=cuenta-token/)
  assert.match(headers['cookie'], /ssxmod_itna=itna/)
  assert.equal(headers['bx-ua'], undefined)
  assert.equal(headers['bx-umidtoken'], undefined)
  assert.equal(headers['Authorization'], 'Bearer cuenta-token')
  assert.match(headers['Version'], /^\d+\.\d+\.\d+$/)
})

test('tokenExpiresAt lee el exp del JWT', () => {
  const payload = Buffer.from(JSON.stringify({ exp: 1893456000 })).toString('base64url')
  assert.equal(tokenExpiresAt(`header.${payload}.sig`), 1893456000)
  assert.equal(tokenExpiresAt('basura'), 0)
  assert.equal(tokenExpiresAt(''), 0)
})

// ---------------------------------------------------------------------------
// 哪些账号能参与轮换：没有自己指纹的账号不能（否则被拒或串到别人额度）
// ---------------------------------------------------------------------------
test('con perfiles por cuenta activos, una cuenta sin fichero propio queda fuera', () => {
  clearProfileCache()
  assert.equal(canUseAccountForUpstream({ email: 'a@x.com' }), true, 'sin perfiles, modo legado')

  writeProfileFile(`browser-profile.${safeEmail('a@x.com')}.json`, PROFILE_A)
  assert.equal(isProfileModeActive(), true)
  assert.equal(canUseAccountForUpstream({ email: 'a@x.com' }), true)
  assert.equal(canUseAccountForUpstream({ email: 'b@x.com' }), false, 'b no tiene sesión propia')
})
