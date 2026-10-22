// Por que existe este fichero.
//
// El 2026-10-22 el panel decia, al cambiar a una cuenta sin sesion de navegador:
//   "账户 … 还没有绑定浏览器会话（缺 baxia 指纹），上游会拒绝请求。请为每个账号单独开一个
//    Chrome 数据目录并登录一次，然后执行 node scripts/harvest-browser-profile.mjs …"
// Eso es imposible en un servidor: el usuario no tiene Chrome alli. La solucion fue hacer que el
// SERVIDOR se fabrique la sesion: lanza un Chrome headless con un perfil temporal, inicia sesion
// con el email/password ya guardado de la cuenta, y recoge cookies + bx-ua.
//
// Estas pruebas fijan las tres piezas que hacen eso seguro y observable:
//   1. describeAccountUsability — la columna "¿realmente usable?" del panel (y su motivo);
//   2. provisionProfile — errores en lenguaje humano y sin arrancar Chrome cuando no se puede;
//   3. getUnavailableReason — el mensaje ya no manda al usuario a la linea de comandos ni
//      acusa a las cuentas que el administrador desactivo a proposito.
//
// Ninguna prueba abre un navegador: QWEN2API_DISABLE_AUTO_HARVEST=1 hace que provisionProfile
// falle antes de ejecutar el script (el gate ya la inyecta, aqui se fija explicitamente tambien).

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

process.env.API_KEY = 'fingerprint-provision-test-key'
process.env.DATA_SAVE_MODE = 'none'
process.env.ACCOUNTS = ''
process.env.ENABLE_CLI = 'false'
process.env.ENABLE_FILE_LOG = 'false'
process.env.PROXY_URL = ''
process.env.BROWSER_PROFILE_PATH = ''
process.env.QWEN2API_DISABLE_AUTO_HARVEST = '1'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen2api-provision-'))
process.env.QWEN2API_RUNTIME_DIR = tmpDir

const dataDir = path.join(tmpDir, 'data')
fs.mkdirSync(dataDir, { recursive: true })

const {
  describeAccountUsability,
  provisionProfile,
  provisionErrorText,
  clearProfileCache,
  safeEmail
} = require('../src/utils/browser-profile.js')
const accountManager = require('../src/utils/account.js')

const PROFILE = {
  cookie: 'tfstk=a; refresh_token=r',
  token: 'eyJhbGciOiJIUzI1NiJ9.a.sig',
  bxUa: '234!a-bx-ua',
  harvestedAt: '2026-10-22T07:00:00.000Z'
}

const writeProfile = (name, payload) => {
  fs.writeFileSync(path.join(dataDir, name), JSON.stringify(payload), 'utf8')
  clearProfileCache()
}

test.before(async () => { await accountManager._initPromise })

test.after(() => {
  accountManager.destroy()
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) { /* ignore */ }
})

test.beforeEach(() => {
  for (const name of fs.readdirSync(dataDir)) {
    try { fs.rmSync(path.join(dataDir, name), { force: true }) } catch (_) { /* ignore */ }
  }
  clearProfileCache()
})

// ---------------------------------------------------------------------------
// 1) La columna del panel: ¿usable? ¿por que no?
// ---------------------------------------------------------------------------

test('describeAccountUsability: con sesion propia la cuenta es usable', () => {
  writeProfile(`browser-profile.${safeEmail('a@x.com')}.json`, PROFILE)

  const usability = describeAccountUsability({ email: 'a@x.com' })
  assert.equal(usability.hasFingerprint, true)
  assert.equal(usability.usable, true)
  assert.equal(usability.unavailableCode, null)
  assert.equal(usability.fingerprintAt, PROFILE.harvestedAt, 'la fecha de recoleccion se muestra en el panel')
})

test('describeAccountUsability: sin sesion propia -> no_fingerprint (aunque haya otros perfiles)', () => {
  // Con perfiles por cuenta activos, una cuenta sin fichero propio NO puede enviar peticiones
  writeProfile(`browser-profile.${safeEmail('a@x.com')}.json`, PROFILE)

  const usability = describeAccountUsability({ email: 'sin-sesion@x.com' })
  assert.equal(usability.hasFingerprint, false)
  assert.equal(usability.usable, false)
  assert.equal(usability.unavailableCode, 'no_fingerprint')
  assert.equal(usability.fingerprintAt, null)
})

test('describeAccountUsability: desactivada gana a cualquier otro motivo', () => {
  writeProfile(`browser-profile.${safeEmail('a@x.com')}.json`, PROFILE)

  const usability = describeAccountUsability({ email: 'a@x.com', disabled: true })
  assert.equal(usability.hasFingerprint, true, 'la sesion existe, pero la cuenta esta fuera de rotacion')
  assert.equal(usability.usable, false)
  assert.equal(usability.unavailableCode, 'disabled')
})

test('describeAccountUsability: el despliegue de una sola cuenta usa el fichero global', () => {
  writeProfile('browser-profile.json', PROFILE)

  const usability = describeAccountUsability({ email: 'solo@x.com' })
  assert.equal(usability.hasFingerprint, true)
  assert.equal(usability.viaGlobal, true)
  assert.equal(usability.usable, true)
})

// ---------------------------------------------------------------------------
// 2) provisionProfile: errores en lenguaje humano, sin arrancar Chrome
// ---------------------------------------------------------------------------

test('provisionProfile: sin contrasena guardada no intenta nada y lo dice claro', async () => {
  // El gate inyecta la variable para que las pruebas no abran Chrome; aqui se quita solo
  // para comprobar que la comprobacion de contrasena ocurre ANTES de lanzar nada.
  const saved = process.env.QWEN2API_DISABLE_AUTO_HARVEST
  delete process.env.QWEN2API_DISABLE_AUTO_HARVEST
  try {
    await assert.rejects(
      provisionProfile('sin-password@x.com', { email: 'sin-password@x.com' }),
      /没有保存密码/
    )
  } finally {
    if (saved === undefined) delete process.env.QWEN2API_DISABLE_AUTO_HARVEST
    else process.env.QWEN2API_DISABLE_AUTO_HARVEST = saved
  }
})

test('provisionProfile: con la recoleccion desactivada falla sin abrir Chrome', async () => {
  await assert.rejects(
    provisionProfile('cualquiera@x.com', { password: 'p' }),
    /禁用了浏览器采集/
  )
})

test('provisionProfile: dos llamadas concurrentes de la MISMA cuenta comparten una sola recoleccion', async () => {
  const first = provisionProfile('dup@x.com', { password: 'p' })
  const second = provisionProfile('dup@x.com', { password: 'p' })
  assert.equal(first, second, 'el panel puede pulsar dos veces: no deben abrirse dos Chrome')
  await assert.rejects(first)
})

test('provisionErrorText: del stderr del script solo queda la frase util', () => {
  assert.equal(
    provisionErrorText('[harvest] 失败: 账号登录失败（HTTP 400）：{"detail":"email not found"}'),
    '账号登录失败（HTTP 400）：{"detail":"email not found"}'
  )
  assert.equal(provisionErrorText(''), '采集脚本执行失败')
  assert.match(provisionErrorText('linea suelta sin prefijo'), /linea suelta/)
})

// ---------------------------------------------------------------------------
// 3) El mensaje de "no hay ninguna cuenta usable" ya no manda a la terminal
// ---------------------------------------------------------------------------

test('getUnavailableReason: senala el boton del panel y no acusa a las cuentas desactivadas', () => {
  // Modo perfiles por cuenta activo (hay un fichero por cuenta) y ninguna de las nuestras
  // tiene el suyo: es el caso exacto del mensaje que reporto el usuario.
  writeProfile(`browser-profile.${safeEmail('otra@x.com')}.json`, PROFILE)

  accountManager.isInitialized = true
  accountManager.initError = null
  accountManager.accountTokens = [
    { email: 'activa@example.invalid', token: 't', password: 'p' },
    { email: 'apagada@example.invalid', token: 't', password: 'p', disabled: true }
  ]

  const reason = accountManager.getUnavailableReason()
  assert.ok(reason, 'hay cuentas pero ninguna usable: debe explicarse')
  assert.match(reason, /activa@example\.invalid/)
  assert.ok(!reason.includes('apagada@example.invalid'),
    'una cuenta que el administrador desactivo a proposito no es una cuenta "sin sesion"')
  assert.match(reason, /生成/, 'debe apuntar al boton del panel (el servidor se fabrica la sesion)')
  assert.ok(!/node scripts\/harvest-browser-profile/.test(reason.split('也可以')[0]),
    'el panel es la via principal; el script es el plan B')
})

test('getUnavailableReason: con una cuenta usable no hay nada que explicar', () => {
  writeProfile(`browser-profile.${safeEmail('ok@x.com')}.json`, PROFILE)

  accountManager.isInitialized = true
  accountManager.initError = null
  accountManager.accountTokens = [{ email: 'ok@x.com', token: 't', password: 'p' }]

  assert.equal(accountManager.getUnavailableReason(), null)
})
