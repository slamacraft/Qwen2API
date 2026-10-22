// 2026-10-22 的回归锁：`Version` 请求头**必须存在**，值等于线上前端版本。
//
// 实测：线上前端自己发的 completions 请求就带 `Version: 0.3.20`；把它去掉后
// /api/v2/chat/completions 立刻回 Bad_Request（"Internal error..."）。
// 同时，只有这个头还不够——还要有 baxia 指纹（bx-ua / bx-umidtoken）和浏览器会话
// cookie，见 tests/browser-profile.test.js 与 src/utils/browser-profile.js。
const test = require('node:test')
const assert = require('node:assert/strict')
const axios = require('axios')

process.env.API_KEY = 'version-header-test-key'
process.env.DATA_SAVE_MODE = 'none'
process.env.ACCOUNTS = ''
process.env.ENABLE_CLI = 'false'
process.env.ENABLE_FILE_LOG = 'false'
process.env.PROXY_URL = ''
process.env.CHAT_RETRY_COUNT = '0'
process.env.CHAT_RETRY_BACKOFF_MS = '0'
process.env.BROWSER_PROFILE_PATH = ''

const accountManager = require('../src/utils/account')
const AccountRotator = require('../src/utils/account-rotator')
const modelsMap = require('../src/models/models-map.js')
modelsMap.getLatestModels = async () => { throw new Error('offline test: no model fetch') }
const config = require('../src/config/index.js')
const { sendChatRequest } = require('../src/utils/request')

const VERSION_SHAPE = /^\d+\.\d+\.\d+$/

// 这个文件只验证 Version 头；显式指向一个不存在的指纹文件，避免被工作区里真实的
// data/browser-profile.json 干扰（那是给人用的，不是给测试用的）。
config.browserProfilePath = require('node:path').join(require('node:os').tmpdir(), 'qwen2api-no-profile.json')

const ACCOUNT = { email: 'version-header@example.invalid', token: 'version-header-token' }
const BODY = { model: 'qwen3-max', messages: [{ role: 'user', content: 'hola' }] }

const send = () => sendChatRequest(BODY, {
  chatId: 'version-header-chat',
  currentAccount: ACCOUNT
})

/** 拦 axios.post，记录每次请求的 URL 与 headers；completions 用 500 收尾，不发真实网络请求。 */
const capturePost = async (fn) => {
  const captured = []
  const original = axios.post
  axios.post = async (url, data, requestConfig) => {
    captured.push({ url: String(url), data, requestConfig })
    if (String(url).includes('/api/v2/chats/new')) {
      return { status: 200, data: { success: true, data: { id: 'created-chat-id' } } }
    }
    const error = new Error('Request failed with status code 500')
    error.response = { status: 500, headers: {}, data: '' }
    throw error
  }
  try { await fn() } finally { axios.post = original }
  return captured
}

test.before(async () => { await accountManager._initPromise })
test.beforeEach(() => {
  accountManager.accountTokens = [ACCOUNT]
  accountManager.isInitialized = true
  accountManager.accountRotator = new AccountRotator()
  accountManager.accountRotator.setAccounts([ACCOUNT])
})
test.after(() => { accountManager.destroy() })

test('la peticion de completions lleva el header Version', async () => {
  const captured = await capturePost(send)

  const completions = captured.find(item => item.url.includes('/api/v2/chat/completions'))
  assert.ok(completions, 'la peticion de completions se emitio')
  assert.match(completions.requestConfig.headers.Version, VERSION_SHAPE)
})

test('la peticion de chats/new tambien lo lleva', async () => {
  // 不传 chatId → 先走 generateChatID（POST /api/v2/chats/new），再走 completions
  const captured = await capturePost(() => sendChatRequest(BODY, { currentAccount: ACCOUNT }))

  const newChat = captured.find(item => item.url.includes('/api/v2/chats/new'))
  assert.ok(newChat, 'la peticion de chats/new se emitio')
  assert.match(newChat.requestConfig.headers.Version, VERSION_SHAPE)
})

test('el perfil legacy tambien lo lleva', async () => {
  const original = config.antidetectTier1Enabled
  config.antidetectTier1Enabled = false
  try {
    const captured = await capturePost(send)
    const completions = captured.find(item => item.url.includes('/api/v2/chat/completions'))
    assert.ok(completions)
    assert.match(completions.requestConfig.headers.Version, VERSION_SHAPE)
  } finally {
    config.antidetectTier1Enabled = original
  }
})

test('sin fichero de huella no se inventan cabeceras baxia', async () => {
  // 没有浏览器指纹时退回老行为：不带 bx-ua / bx-umidtoken（它们只能由真实浏览器产生）
  const captured = await capturePost(send)
  const completions = captured.find(item => item.url.includes('/api/v2/chat/completions'))
  assert.equal(completions.requestConfig.headers['bx-ua'], undefined)
  assert.equal(completions.requestConfig.headers['bx-umidtoken'], undefined)
})
