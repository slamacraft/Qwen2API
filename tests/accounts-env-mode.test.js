// 环境变量模式（DATA_SAVE_MODE=none）下的账号写操作。
//
// 2026-10-23 用户实测：`bun run start`（没有 .env，DATA_SAVE_MODE 默认 none）后在管理面板加账号，
// 只看到三行日志 + 前端一句「保存失败」：
//   [WARN] [DATA] ⚠️ 环境变量模式不支持保存账户数据
//   [ERROR] [ACCOUNT] ❌ 账户 … 持久化失败，已回滚内存数据
// 报错里没有任何「该怎么办」的信息，用户只能猜。这里的约定是：**这类请求直接 400，
// 并在错误体里写清楚要改哪个环境变量**，而不是等 data-persistence 返回 false 再报 500。
//
// 同时钉住一个例外：setAccountDisabled 在 none 模式下本来就是「只改内存」的语义
// （account.js 有明确分支），不能被这条守卫拦掉。

process.env.DATA_SAVE_MODE = 'none'
process.env.API_KEY = 'env-mode-test-key'
process.env.ACCOUNTS = ''
process.env.ENABLE_CLI = 'false'
process.env.ENABLE_FILE_LOG = 'false'

const test = require('node:test')
const assert = require('node:assert/strict')

const router = require('../src/routes/accounts.js')
const accountManager = require('../src/utils/account.js')

// 路由栈里最后一层就是业务 handler（前面是 adminKeyVerify）
const handlerFor = (path, method) => {
  const layer = router.stack.find((entry) => entry.route && entry.route.path === path && entry.route.methods[method])
  assert.ok(layer, `route ${method.toUpperCase()} ${path} is mounted`)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

const createRes = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code
    return this
  },
  json(payload) {
    this.body = payload
    return this
  }
})

const callRoute = async (path, method, body) => {
  const res = createRes()
  await handlerFor(path, method)({ body }, res)
  return res
}

test.after(() => {
  try { accountManager.destroy() } catch { /* ignore */ }
})

test('环境变量模式下加账号：400 + 指明要改 DATA_SAVE_MODE', async () => {
  const res = await callRoute('/setAccount', 'post', { email: 'someone@example.com', password: 'x' })
  assert.equal(res.statusCode, 400)
  assert.match(res.body.error, /DATA_SAVE_MODE=none/)
  assert.match(res.body.error, /DATA_SAVE_MODE.*file/, '错误里必须给出可执行的下一步')
  assert.match(res.body.error, /ACCOUNTS/, '或者告诉用户用 ACCOUNTS 环境变量')
})

test('环境变量模式下批量加账号同样被拦（不静默失败）', async () => {
  const res = await callRoute('/setAccounts', 'post', { accounts: 'a@example.com:p' })
  assert.equal(res.statusCode, 400)
  assert.match(res.body.error, /DATA_SAVE_MODE=none/)
})

test('环境变量模式下删除账号 / 改代理也被拦', async () => {
  const removed = await callRoute('/deleteAccount', 'delete', { email: 'someone@example.com' })
  assert.equal(removed.statusCode, 400)
  assert.match(removed.body.error, /DATA_SAVE_MODE=none/)

  const proxy = await callRoute('/updateAccountProxy', 'post', { email: 'someone@example.com', proxy: 'http://127.0.0.1:7890' })
  assert.equal(proxy.statusCode, 400)
  assert.match(proxy.body.error, /DATA_SAVE_MODE=none/)
})

test('禁用/启用账号不被拦：none 模式下它本来就有「只改内存」的语义', async () => {
  const res = await callRoute('/setAccountDisabled', 'post', { email: 'nobody@example.com', disabled: true })
  // 账号不存在 → 404；关键是它走到了业务逻辑，而不是被环境变量守卫挡下
  assert.notEqual(res.statusCode, 400)
  assert.ok(!/DATA_SAVE_MODE=none/.test(String(res.body && res.body.error || '')))
})

test('file 模式下不再拦（由持久化层处理真正的失败）', async () => {
  const config = require('../src/config/index.js')
  const original = config.dataSaveMode
  config.dataSaveMode = 'file'
  try {
    const res = await callRoute('/setAccount', 'post', { email: '', password: '' })
    // 参数校验先命中（邮箱/密码为空），说明没被环境变量守卫挡住
    assert.equal(res.statusCode, 400)
    assert.match(res.body.error, /邮箱和密码不能为空/)
  } finally {
    config.dataSaveMode = original
  }
})
