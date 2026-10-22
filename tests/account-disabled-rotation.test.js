// 手动禁用账号 = 从轮换队列里摘掉，但账号、token、统计都保留。
// 这是管理员的显式意图，必须与「冷却 / 额度耗尽」那种会自动恢复的状态分开：
// 冷却到点会自己回来，禁用不会。
const test = require('node:test')
const assert = require('node:assert/strict')

process.env.API_KEY = 'account-disabled-test-key'
process.env.DATA_SAVE_MODE = 'none'
process.env.ACCOUNTS = ''
process.env.ENABLE_CLI = 'false'
process.env.ENABLE_FILE_LOG = 'false'
process.env.PROXY_URL = ''

const config = require('../src/config/index.js')
const AccountRotator = require('../src/utils/account-rotator.js')
const accountManager = require('../src/utils/account.js')

const ACCOUNTS = () => [
  { email: 'active@example.invalid', token: 'token-active' },
  { email: 'paused@example.invalid', token: 'token-paused', disabled: true },
  { email: 'other@example.invalid', token: 'token-other' }
]

test.before(async () => { await accountManager._initPromise })
test.after(() => { accountManager.destroy() })

test('rotation never hands out a disabled account', () => {
  const rotator = new AccountRotator()
  // 用均摊策略把两个可用账号都取一遍，才能验证"被禁用的那个一次都没出现"
  rotator.setPolicy('balanced')
  rotator.setAccounts(ACCOUNTS())

  const picked = new Set()
  for (let i = 0; i < 8; i++) {
    const account = rotator.getNextAccount()
    assert.ok(account, 'there are still enabled accounts to hand out')
    picked.add(account.email)
  }

  assert.deepEqual([...picked].sort(), ['active@example.invalid', 'other@example.invalid'])
})

test('a disabled account is not reachable by email either', () => {
  const rotator = new AccountRotator()
  rotator.setAccounts(ACCOUNTS())

  assert.equal(rotator.getAccountByEmail('paused@example.invalid'), null)
  assert.equal(rotator.getTokenByEmail('paused@example.invalid'), null)
  assert.ok(rotator.getAccountByEmail('active@example.invalid'))
})

test('disabling every account leaves nothing to rotate', () => {
  const rotator = new AccountRotator()
  rotator.setAccounts(ACCOUNTS().map(account => ({ ...account, disabled: true })))

  assert.equal(rotator.getNextAccount(), null)
  const stats = rotator.getStats()
  assert.equal(stats.total, 3, 'the accounts are still there, just not usable')
  assert.equal(stats.available, 0)
})

test('a disabled account is reported as unavailable, not as cooling down', () => {
  const rotator = new AccountRotator()
  rotator.setAccounts(ACCOUNTS())

  const stats = rotator.getStats()
  assert.equal(stats.usageStats['paused@example.invalid'].available, false)
  // 冷却有结束时间，禁用没有：两者在 UI 上必须能区分开
  assert.equal(stats.usageStats['paused@example.invalid'].cooldownEndsAt, null)
})

test('setAccountDisabled flips the flag in memory and persists it', async () => {
  const originalMode = config.dataSaveMode
  const originalSave = accountManager.dataPersistence.saveAccount
  const saved = []
  config.dataSaveMode = 'file'
  accountManager.dataPersistence.saveAccount = async (email, payload) => { saved.push({ email, payload }); return true }
  accountManager.accountTokens = ACCOUNTS()
  try {
    assert.equal(await accountManager.setAccountDisabled('active@example.invalid', true), true)
    assert.equal(accountManager.accountTokens[0].disabled, true)
    assert.deepEqual(saved, [{ email: 'active@example.invalid', payload: { disabled: true } }])

    assert.equal(await accountManager.setAccountDisabled('active@example.invalid', false), true)
    assert.equal(accountManager.accountTokens[0].disabled, false)
  } finally {
    config.dataSaveMode = originalMode
    accountManager.dataPersistence.saveAccount = originalSave
  }
})

test('a failed persist rolls the flag back instead of lying to the UI', async () => {
  const originalMode = config.dataSaveMode
  const originalSave = accountManager.dataPersistence.saveAccount
  config.dataSaveMode = 'file'
  accountManager.dataPersistence.saveAccount = async () => false
  accountManager.accountTokens = ACCOUNTS()
  try {
    assert.equal(await accountManager.setAccountDisabled('active@example.invalid', true), false)
    assert.ok(!accountManager.accountTokens[0].disabled, 'memory must match what is on disk')
  } finally {
    config.dataSaveMode = originalMode
    accountManager.dataPersistence.saveAccount = originalSave
  }
})

test('unknown accounts are refused', async () => {
  accountManager.accountTokens = ACCOUNTS()
  assert.equal(await accountManager.setAccountDisabled('missing@example.invalid', true), false)
})

// ---------------------------------------------------------------------------
// 选号策略：priority = 按顺序取第一个可用（额度不够才换号），balanced = 均摊
// ---------------------------------------------------------------------------

test('priority 策略：一直用第一个可用账号，直到它不可用才顺延', () => {
  const rotator = new AccountRotator()
  rotator.setPolicy('priority')
  rotator.setAccounts([
    { email: 'primary@example.invalid', token: 't1' },
    { email: 'backup@example.invalid', token: 't2' }
  ])

  assert.equal(rotator.getNextAccount().email, 'primary@example.invalid')
  assert.equal(rotator.getNextAccount().email, 'primary@example.invalid', '粘住主账号，不轮流')

  // 额度耗尽 → 顺延到备用号
  rotator.recordQuotaExhausted('primary@example.invalid', 60)
  assert.equal(rotator.getNextAccount().email, 'backup@example.invalid')

  // 备用号也耗尽 → 没有可用账号
  rotator.recordQuotaExhausted('backup@example.invalid', 60)
  assert.equal(rotator.getNextAccount(), null)
})

test('balanced 策略仍然在账号之间均摊', () => {
  const rotator = new AccountRotator()
  rotator.setPolicy('balanced')
  rotator.setAccounts([
    { email: 'a@example.invalid', token: 't1' },
    { email: 'b@example.invalid', token: 't2' }
  ])

  const picked = [rotator.getNextAccount().email, rotator.getNextAccount().email]
  assert.deepEqual(picked.sort(), ['a@example.invalid', 'b@example.invalid'])
})

test('accountFilter 把不合格的账号挡在轮换之外', () => {
  const rotator = new AccountRotator()
  rotator.setPolicy('priority')
  rotator.setAccountFilter(account => account.email !== 'sin-fingerprint@example.invalid')
  rotator.setAccounts([
    { email: 'sin-fingerprint@example.invalid', token: 't1' },
    { email: 'con-fingerprint@example.invalid', token: 't2' }
  ])

  assert.equal(rotator.getNextAccount().email, 'con-fingerprint@example.invalid')
  assert.equal(rotator.getStats().available, 1)
})
