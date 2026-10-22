const express = require('express')
const router = express.Router()
const config = require('../config')
const accountManager = require('../utils/account')
const { logger } = require('../utils/logger')
const { JwtDecode } = require('../utils/tools')
const { adminKeyVerify } = require('../middlewares/authorization')
const { deleteAccount, saveAccounts } = require('../utils/setting')
const { parseAccountLine } = require('../utils/account-parser')
const { isValidProxyUrl } = require('../utils/proxy-helper')
const { DEFAULT_CLI_QUOTA_LIMIT, getAccountCliState } = require('../utils/cli-support')
const { provisionProfile, describeAccountUsability, clearProvisionBackoff } = require('../utils/browser-profile')

// 仅在 proxy 字段存在时触发；空字符串/null 一律视为"清除代理"，无需校验
const PROXY_FORMAT_ERROR = '代理 URL 格式无效，应以 http://、https://、socks5:// 或 socks5h:// 开头'

const batchAccountTasks = new Map()
const BATCH_TASK_RETENTION_MS = 1000 * 60 * 30
const BATCH_TASK_RESULT_LIMIT = 12

/**
 * 生成批量任务 ID
 * @returns {string} 任务 ID
 */
const generateBatchTaskId = () => `batch_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

/**
 * 计划清理已完成的批量任务
 * @param {string} taskId - 任务 ID
 */
const scheduleBatchTaskCleanup = (taskId) => {
  setTimeout(() => {
    batchAccountTasks.delete(taskId)
  }, BATCH_TASK_RETENTION_MS)
}

/**
 * 解析批量账号文本
 * 行格式（与 ENV ACCOUNTS 一致）：
 *   email:password                  — 老格式
 *   email:password|proxy_url        — 新格式，附带账号级代理
 * @param {string} accountsText - 原始账号文本
 * @returns {{ accountLines: string[], parsedAccounts: Array<{ email: string, password: string, proxy: string|null }>, invalidCount: number }} 解析结果
 */
const parseBatchAccountsText = (accountsText) => {
  const normalizedText = String(accountsText).replace(/[\r]/g, '\n')
  const accountLines = normalizedText
    .split('\n')
    .map(item => item.trim())
    .filter(item => item !== '')

  const parsedAccounts = []
  let invalidCount = 0

  for (const accountLine of accountLines) {
    const parsed = parseAccountLine(accountLine)
    if (!parsed) {
      invalidCount++
      continue
    }
    // 行格式合法但 proxy 字段格式错误，整行视为无效，避免后续登录后才暴露失败
    if (parsed.proxy && !isValidProxyUrl(parsed.proxy)) {
      invalidCount++
      continue
    }
    parsedAccounts.push(parsed)
  }

  return {
    accountLines,
    parsedAccounts,
    invalidCount
  }
}

/**
 * 构造新的批量任务
 * @param {number} total - 总条目数
 * @param {number} valid - 有效条目数
 * @param {number} skipped - 跳过条目数
 * @param {number} invalid - 无效条目数
 * @returns {object} 任务对象
 */
const createBatchAccountTask = (total, valid, skipped, invalid) => {
  const concurrency = Math.max(1, parseInt(config.batchLoginConcurrency) || 5)
  const task = {
    id: generateBatchTaskId(),
    status: 'pending',
    message: '任务已创建，等待执行',
    concurrency,
    total,
    valid,
    skipped,
    invalid,
    processed: 0,
    completed: skipped + invalid,
    success: 0,
    failed: 0,
    activeEmails: [],
    failedEmails: [],
    recentResults: [],
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null
  }

  batchAccountTasks.set(task.id, task)
  return task
}

/**
 * 记录批量任务最近结果
 * @param {object} task - 任务对象
 * @param {object} result - 单条结果
 */
const pushBatchTaskResult = (task, result) => {
  task.recentResults.unshift(result)
  if (task.recentResults.length > BATCH_TASK_RESULT_LIMIT) {
    task.recentResults.length = BATCH_TASK_RESULT_LIMIT
  }
}

/**
 * 获取批量任务快照
 * @param {object} task - 任务对象
 * @returns {object} 可序列化的任务状态
 */
const getBatchTaskSnapshot = (task) => {
  const total = task.total || 0
  const progress = total > 0 ? Number(((task.completed / total) * 100).toFixed(2)) : 100

  return {
    taskId: task.id,
    status: task.status,
    message: task.message,
    total: task.total,
    valid: task.valid,
    skipped: task.skipped,
    invalid: task.invalid,
    processed: task.processed,
    completed: task.completed,
    pending: Math.max(0, task.total - task.completed),
    success: task.success,
    failed: task.failed,
    progress,
    concurrency: task.concurrency,
    activeEmails: task.activeEmails,
    failedEmails: task.failedEmails,
    recentResults: task.recentResults,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt
  }
}

/**
 * 更新批量任务文案
 * @param {object} task - 任务对象
 */
const updateBatchTaskMessage = (task) => {
  if (task.status === 'completed') {
    task.message = `批量添加完成，成功 ${task.success} 个，失败 ${task.failed} 个`
    return
  }

  if (task.status === 'failed') {
    if (!task.message) {
      task.message = '批量添加执行失败'
    }
    return
  }

  const activeCount = task.activeEmails.length
  if (activeCount > 0) {
    task.message = `正在处理 ${task.completed}/${task.total}，并发中 ${activeCount} 个`
  } else {
    task.message = `正在处理 ${task.completed}/${task.total}`
  }
}

/**
 * 执行单个账号的批量登录任务
 * @param {object} task - 任务对象
 * @param {{ email: string, password: string, proxy: string|null }} account - 账号信息
 */
const processBatchAccountItem = async (task, account) => {
  const { email, password, proxy } = account
  task.activeEmails.push(email)
  updateBatchTaskMessage(task)

  try {
    const authToken = await accountManager.login(email, password, proxy)
    if (!authToken) {
      throw new Error('登录失败')
    }

    const decoded = JwtDecode(authToken)
    const saved = await accountManager.addAccountWithToken(email, password, authToken, decoded.exp, proxy)
    if (!saved) {
      throw new Error('保存失败')
    }

    task.success++
    pushBatchTaskResult(task, {
      email,
      status: 'success',
      message: '登录成功'
    })
  } catch (error) {
    task.failed++
    if (!task.failedEmails.includes(email)) {
      task.failedEmails.push(email)
    }

    pushBatchTaskResult(task, {
      email,
      status: 'failed',
      message: error.message || '登录失败'
    })

    logger.error(`批量登录账号失败: ${email}`, 'ACCOUNT', '', error)
  } finally {
    task.processed++
    task.completed++
    task.activeEmails = task.activeEmails.filter(item => item !== email)
    updateBatchTaskMessage(task)
  }
}

/**
 * 执行批量账号添加任务
 * @param {object} task - 任务对象
 * @param {Array<{ email: string, password: string }>} newAccounts - 待处理账号
 * @returns {Promise<object>} 最终任务对象
 */
const runBatchAccountTask = async (task, newAccounts) => {
  try {
    task.status = 'running'
    task.startedAt = Date.now()
    updateBatchTaskMessage(task)

    if (newAccounts.length === 0) {
      task.status = 'completed'
      task.finishedAt = Date.now()
      updateBatchTaskMessage(task)
      scheduleBatchTaskCleanup(task.id)
      return task
    }

    for (let i = 0; i < newAccounts.length; i += task.concurrency) {
      const batch = newAccounts.slice(i, i + task.concurrency)
      await Promise.allSettled(batch.map(account => processBatchAccountItem(task, account)))
    }

    task.status = 'completed'
    task.finishedAt = Date.now()
    updateBatchTaskMessage(task)
    scheduleBatchTaskCleanup(task.id)
    return task
  } catch (error) {
    task.status = 'failed'
    task.finishedAt = Date.now()
    task.message = error.message || '批量添加执行失败'
    logger.error('批量创建账号失败', 'ACCOUNT', '', error)
    scheduleBatchTaskCleanup(task.id)
    return task
  }
}

/**
 * 透传账号令牌（JWT）：管理员可见完整 JWT。
 * 现在只有 GET /accountDetail 会用到它——列表接口不再下发凭据，凭据按需取。
 * 该接口由 adminKeyVerify 保护，能读到详情的人本就持有管理密钥；
 * 管理后台需要完整令牌来排障与迁移账号（复制令牌），掩码只会让「复制」变成复制一串圆点。
 * 令牌不会被前端回传（新增账号用 email+password 重新登录，编辑代理/刷新仅用 email），
 * 故完整返回不会引入额外的回写风险。
 * @param {string|null|undefined} token 原始 JWT
 * @returns {string} 原始令牌，缺失时返回空串
 */
const exposeAccountToken = (token) => (token || '')

/**
 * 获取所有账号（分页）
 *
 * 只返回列表需要的字段（email / expires / proxy / disabled）：密码与 JWT 走
 * GET /accountDetail 按需取，避免一次拉全量账号时把每个账号的凭据塞进同一个响应。
 *
 * @param {number} page 页码
 * @param {number} pageSize 每页数量
 * @returns {Object} 账号列表
 */
router.get('/getAllAccounts', adminKeyVerify, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const pageSize = parseInt(req.query.pageSize) || 1000
    const start = (page - 1) * pageSize

    // 获取所有账号键
    const allAccounts = accountManager.getAllAccountKeys()
    const total = allAccounts.length

    // 分页处理
    const paginatedAccounts = allAccounts.slice(start, start + pageSize)

    // 获取每个账号的详细信息
    // 列表刻意**不下发** password / token：凭据只在「账号详情」里按需取
    // （GET /accountDetail）。一次拉全量账号时把每个 JWT 一起塞进响应既没必要，
    // 也让响应体大一个量级。
    const accounts = paginatedAccounts.map(account => {
      // 浏览器会话（baxia 指纹）状态：没有它上游必然拒请求，所以列表要能一眼看出来。
      // usable/unavailableCode 是「真的能发请求吗」的结论，不是健康状态（那是另一列）。
      const usability = describeAccountUsability(account)
      return {
        email: account.email,
        expires: account.expires,
        proxy: account.proxy ?? null,
        disabled: account.disabled === true,
        hasFingerprint: usability.hasFingerprint,
        fingerprintAt: usability.fingerprintAt,
        viaGlobalFingerprint: usability.viaGlobal,
        usable: usability.usable,
        unavailableCode: usability.unavailableCode
      }
    })

    res.json({
      total,
      page,
      pageSize,
      data: accounts
    })
  } catch (error) {
    logger.error('获取账号列表失败', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /setAccount
 * 添加账号
 *
 * @param {string} email 邮箱
 * @param {string} password 密码
 * @param {string} [proxy] 账号专属代理 URL（可选，HTTP/HTTPS/SOCKS5）
 * @returns {Object} 账号信息
 */
router.post('/setAccount', adminKeyVerify, async (req, res) => {
  try {
    const { email, password, proxy } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: '邮箱和密码不能为空' })
    }

    // 规范化 proxy：空字符串/纯空白/非字符串 → null
    const normalizedProxy = (typeof proxy === 'string' && proxy.trim()) ? proxy.trim() : null

    // 防御性校验：拦截明显的拼写错误（缺协议等），运行时才暴露的错误对用户不友好
    if (normalizedProxy && !isValidProxyUrl(normalizedProxy)) {
      return res.status(400).json({ error: PROXY_FORMAT_ERROR })
    }

    // 检查账号是否已存在
    const exists = accountManager.accountTokens.find(item => item.email === email)
    if (exists) {
      return res.status(409).json({ error: '账号已存在' })
    }

    const authToken = await accountManager.login(email, password, normalizedProxy)
    if (!authToken) {
      return res.status(401).json({ error: '登录失败' })
    }
    // 解析JWT
    const decoded = JwtDecode(authToken)
    const expires = decoded.exp

    const success = await saveAccounts(email, password, authToken, expires, normalizedProxy)

    if (success) {
      // 新账号先返回，浏览器会话（baxia 指纹）在后台补：服务器部署时用户不需要本机 Chrome。
      // 失败只记日志——账号本身是好的，面板上会显示「缺会话」并给出重试按钮。
      provisionProfile(email, { password, proxy: normalizedProxy })
        .then(() => logger.success(`新账号 ${email} 的浏览器会话已自动生成`, 'ACCOUNT'))
        .catch(error => logger.warn(`新账号 ${email} 自动生成浏览器会话失败: ${error.message}`, 'ACCOUNT'))
      res.status(200).json({
        email,
        message: '账号创建成功'
      })
    } else {
      res.status(500).json({ error: '账号创建失败' })
    }
  } catch (error) {
    logger.error('创建账号失败', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /provisionFingerprint
 * 为账号生成浏览器会话（baxia 指纹）。
 *
 * 服务器部署的关键：采集不需要用户本机 Chrome。服务端起一个临时 profile 的无头
 * Chrome，在页面里用账号邮箱/密码登录 chat.qwen.ai（登录请求带 baxia 指纹），
 * 页面用服务端下发的 refresh_token 换 access_token，然后采 cookie + bx-ua 写文件。
 *
 * 耗时 3~15 秒；同一个账号并发调用会共享同一次采集，不同账号之间串行排队。
 *
 * @param {string} email 账号邮箱
 * @returns {Object} { ok, email, fingerprintAt, hasFingerprint }
 */
router.post('/provisionFingerprint', adminKeyVerify, async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim()
  if (!email) return res.status(400).json({ error: '缺少邮箱' })

  const account = accountManager.accountTokens.find(item => item.email === email)
  if (!account) return res.status(404).json({ error: '账号不存在' })

  try {
    // 手动点按钮要能立刻重试：清掉「请求时自动自愈」留下的冷却
    clearProvisionBackoff(email)
    await provisionProfile(email, account)
    const usability = describeAccountUsability(account)
    res.json({
      ok: true,
      email,
      hasFingerprint: usability.hasFingerprint,
      fingerprintAt: usability.fingerprintAt
    })
  } catch (error) {
    const message = (error && error.message) || '生成浏览器会话失败'
    logger.warn(`为账号 ${email} 生成浏览器会话失败: ${message}`, 'ACCOUNT')
    // 配置类问题（没密码/没 Chrome/二进制没有 scripts）返回 400，其余当 500
    const configProblem = /没有保存密码|找不到 Chrome|找不到采集脚本|禁用了浏览器采集/.test(message)
    res.status(configProblem ? 400 : 500).json({ error: message })
  }
})

/**
 * DELETE /deleteAccount
 * 删除账号
 * 
 * @param {string} email 邮箱
 * @returns {Object} 账号信息
 */
router.delete('/deleteAccount', adminKeyVerify, async (req, res) => {
  try {
    const { email } = req.body

    // 检查账号是否存在
    const exists = await accountManager.accountTokens.find(item => item.email === email)
    if (!exists) {
      return res.status(404).json({ error: '账号不存在' })
    }

    // 删除账号
    const success = await deleteAccount(email)

    if (success) {
      res.json({ message: '账号删除成功' })
    } else {
      res.status(500).json({ error: '账号删除失败' })
    }
  } catch (error) {
    logger.error('删除账号失败', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})


/**
 * POST /setAccounts
 * 批量添加账号（并行处理）
 *
 * @param {string} accounts 账号列表
 * @returns {Object} 添加结果统计
 */
router.post('/setAccounts', adminKeyVerify, async (req, res) => {
  try {
    let { accounts, async: asyncTask } = req.body
    if (!accounts) {
      return res.status(400).json({ error: '账号列表不能为空' })
    }

    const { accountLines, parsedAccounts, invalidCount } = parseBatchAccountsText(accounts)

    if (accountLines.length === 0) {
      return res.status(400).json({ error: '没有有效的账号' })
    }

    if (parsedAccounts.length === 0) {
      return res.status(400).json({ error: '没有符合格式的账号，请使用 email:password' })
    }

    const existingEmails = new Set(accountManager.getAllAccountKeys().map(acc => acc.email))
    const seenEmails = new Set()
    const newAccounts = []
    let skippedCount = 0

    for (const account of parsedAccounts) {
      if (existingEmails.has(account.email) || seenEmails.has(account.email)) {
        skippedCount++
        continue
      }

      seenEmails.add(account.email)
      newAccounts.push(account)
    }

    const task = createBatchAccountTask(accountLines.length, parsedAccounts.length, skippedCount, invalidCount)

    if (asyncTask === true || asyncTask === 'true') {
      runBatchAccountTask(task, newAccounts)

      return res.status(202).json({
        message: '批量添加任务已创建',
        ...getBatchTaskSnapshot(task)
      })
    }

    await runBatchAccountTask(task, newAccounts)

    res.json({
      message: '批量添加完成',
      ...getBatchTaskSnapshot(task)
    })
  } catch (error) {
    logger.error('批量创建账号失败', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /batchTasks/:taskId
 * 获取批量添加任务进度
 *
 * @param {string} taskId 任务 ID
 * @returns {Object} 任务进度
 */
router.get('/batchTasks/:taskId', adminKeyVerify, async (req, res) => {
  const { taskId } = req.params
  const task = batchAccountTasks.get(taskId)

  if (!task) {
    return res.status(404).json({ error: '任务不存在或已过期' })
  }

  res.json(getBatchTaskSnapshot(task))
})

/**
 * GET /accountDetail
 * 单个账号的完整信息（含密码与完整 JWT）。
 *
 * 列表接口刻意不下发凭据，只有用户真的打开某个账号的详情面板时才走这里：
 * 凭据按需取，比每次列表都把所有 JWT 一起传一遍暴露面更小，响应也更轻。
 *
 * @query {string} email 邮箱
 * @returns {Object} { email, password, token, expires, proxy, disabled, stats }
 */
router.get('/accountDetail', adminKeyVerify, async (req, res) => {
  try {
    const email = String(req.query.email || '').trim()
    if (!email) {
      return res.status(400).json({ error: '邮箱不能为空' })
    }

    const account = accountManager.getAllAccountKeys().find(item => item.email === email)
    if (!account) {
      return res.status(404).json({ error: '账号不存在' })
    }

    res.json({
      email: account.email,
      password: account.password ?? '',
      token: exposeAccountToken(account.token),
      expires: account.expires ?? null,
      proxy: account.proxy ?? null,
      disabled: account.disabled === true,
      stats: account.stats ?? null
    })
  } catch (error) {
    logger.error('获取账号详情失败', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /setAccountDisabled
 * 手动启用/禁用账号：禁用后不再进入轮换队列（账号与统计保留）。
 *
 * @param {string} email 邮箱
 * @param {boolean} disabled true = 禁用
 * @returns {Object} 更新结果
 */
router.post('/setAccountDisabled', adminKeyVerify, async (req, res) => {
  try {
    const { email, disabled } = req.body

    if (!email) {
      return res.status(400).json({ error: '邮箱不能为空' })
    }

    const exists = accountManager.accountTokens.find(item => item.email === email)
    if (!exists) {
      return res.status(404).json({ error: '账号不存在' })
    }

    const next = disabled === true
    const success = await accountManager.setAccountDisabled(email, next)

    if (success) {
      res.json({
        message: next ? '账号已禁用' : '账号已启用',
        email,
        disabled: exists.disabled === true
      })
    } else {
      res.status(500).json({ error: '更新账号禁用状态失败' })
    }
  } catch (error) {
    logger.error('更新账号禁用状态失败', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /exportAccounts
 * 导出全部账号凭据，格式与 ACCOUNTS 环境变量一致（email:password[|proxy]），
 * 可直接粘回去做批量导入。
 *
 * 列表接口已经不下发凭据，所以导出必须走服务端，而不是前端拼字符串。
 */
router.get('/exportAccounts', adminKeyVerify, async (req, res) => {
  try {
    const lines = accountManager.getAllAccountKeys().map(account => {
      const credentials = `${account.email}:${account.password ?? ''}`
      return account.proxy ? `${credentials}|${account.proxy}` : credentials
    })

    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="qwen2api-accounts.txt"')
    res.send(lines.join('\n'))
  } catch (error) {
    logger.error('导出账号失败', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /updateAccountProxy
 * 更新账号专属代理 URL
 * 传入空字符串/null 视为清除代理，回退到全局 PROXY_URL（若存在）
 *
 * @param {string} email 邮箱
 * @param {string|null} proxy 新代理 URL，空表示清除
 * @returns {Object} 更新结果
 */
router.post('/updateAccountProxy', adminKeyVerify, async (req, res) => {
  try {
    const { email, proxy } = req.body

    if (!email) {
      return res.status(400).json({ error: '邮箱不能为空' })
    }

    // 同 /setAccount：仅在传入了非空 proxy 时才校验格式；空值用于清除
    const normalizedProxy = (typeof proxy === 'string' && proxy.trim()) ? proxy.trim() : null
    if (normalizedProxy && !isValidProxyUrl(normalizedProxy)) {
      return res.status(400).json({ error: PROXY_FORMAT_ERROR })
    }

    const exists = accountManager.accountTokens.find(item => item.email === email)
    if (!exists) {
      return res.status(404).json({ error: '账号不存在' })
    }

    const success = await accountManager.updateAccountProxy(email, normalizedProxy)

    if (success) {
      res.json({
        message: '账号代理更新成功',
        email,
        proxy: exists.proxy ?? null
      })
    } else {
      res.status(500).json({ error: '账号代理更新失败' })
    }
  } catch (error) {
    logger.error('更新账号代理失败', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /refreshAccount
 * 刷新单个账号的令牌
 *
 * @param {string} email 邮箱
 * @returns {Object} 刷新结果
 */
router.post('/refreshAccount', adminKeyVerify, async (req, res) => {
  try {
    const { email } = req.body

    if (!email) {
      return res.status(400).json({ error: '邮箱不能为空' })
    }

    // 检查账号是否存在
    const exists = accountManager.accountTokens.find(item => item.email === email)
    if (!exists) {
      return res.status(404).json({ error: '账号不存在' })
    }

    // 刷新账号令牌
    const success = await accountManager.refreshAccountToken(email)

    if (success) {
      res.json({
        message: '账号令牌刷新成功',
        email: email
      })
    } else {
      res.status(500).json({ error: '账号令牌刷新失败' })
    }
  } catch (error) {
    logger.error('刷新账号令牌失败', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /refreshAllAccounts
 * 刷新所有账号的令牌
 *
 * @param {number} thresholdHours 过期阈值（小时），默认24小时
 * @returns {Object} 刷新结果
 */
router.post('/refreshAllAccounts', adminKeyVerify, async (req, res) => {
  try {
    const { thresholdHours = 24 } = req.body

    // 刷新前先统计临期账户：refreshedCount 为 0 时，面板据此区分「没有临期令牌」与「全部刷新失败」
    const expiringCount = accountManager.getAccountsNeedingRefresh(thresholdHours).length

    // 执行批量刷新
    const refreshedCount = await accountManager.autoRefreshTokens(thresholdHours)

    res.json({
      message: '批量刷新完成',
      refreshedCount: refreshedCount,
      expiringCount: expiringCount,
      thresholdHours: thresholdHours
    })
  } catch (error) {
    logger.error('批量刷新账号令牌失败', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /forceRefreshAllAccounts
 * 强制刷新所有账号的令牌（不管是否即将过期）
 *
 * @returns {Object} 刷新结果
 */
router.post('/forceRefreshAllAccounts', adminKeyVerify, async (req, res) => {
  try {
    // 强制刷新所有账号（设置阈值为很大的值，确保所有账号都会被刷新）
    const refreshedCount = await accountManager.autoRefreshTokens(8760) // 365天

    res.json({
      message: '强制刷新完成',
      refreshedCount: refreshedCount,
      totalAccounts: accountManager.getAllAccountKeys().length
    })
  } catch (error) {
    logger.error('强制刷新账号令牌失败', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})


/**
 * GET /accountStats
 * 返回 dashboard 用 daily stats + per-account status
 * status.kind —— 账户健康，优先级 cooldown > warn > token_expiring > active
 * status.cli  —— CLI 可用性，与健康互不遮挡：disabled / unsupported / pending / available
 *
 * @returns {{
 *   accounts: Array<{
 *     email: string,
 *     stats: { chat: {input,output}, cli: {calls,input,output} },
 *     cliRequestNumber: number,
 *     status: { kind: string, cli: string, cooldownEndsAt: number|null, lastErrorAt: number|null, lastErrorCode: string|number|null }
 *   }>,
 *   cliQuotaLimit: number
 * }}
 */
router.get('/accountStats', adminKeyVerify, async (req, res) => {
  try {
    const now = Date.now()

    const rotatorStats = accountManager.accountRotator.getStats()
    const usageStats = rotatorStats.usageStats || {}

    const accounts = accountManager.getAllAccountKeys().map(account => {
      const email = account.email
      const rotatorRecord = usageStats[email] || {}
      const cliState = getAccountCliState(account, rotatorRecord, now)

      return {
        email,
        ...cliState
      }
    })

    const cliQuotaLimit = accounts.some(account => account.cliQuotaLimit === DEFAULT_CLI_QUOTA_LIMIT)
      ? DEFAULT_CLI_QUOTA_LIMIT
      : 0

    res.json({
      accounts,
      cliQuotaLimit
    })
  } catch (error) {
    logger.error('获取账户 stats 失败', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /statsHistory
 * 返回 dashboard /statistics 用 — 历史每日 token 消耗 (90 天 retention).
 * 今日数据合并自 account.stats (live counter) 到 history[today]，
 * 避免新部署后首日 UI 全空。
 *
 * Known edge-case: a ~5 s window at 00:00 between resetting stats=0 and
 * writing statsHistory[yesterday] via saveAllAccounts — a brief "sag"
 * once per day. Not patched (seconds, once per day).
 *
 * @returns {{
 *   today: string,                            // YYYY-MM-DD in server TZ
 *   accounts: Array<{
 *     email: string,
 *     history: Record<string, { chat: {input,output}, cli: {calls,input,output} }>
 *   }>
 * }}
 */
router.get('/statsHistory', adminKeyVerify, async (req, res) => {
  try {
    // today is the same helper used by the archival routine (paired with
    // _getYesterdayKey). The frontend MUST build ranges (currentMonth /
    // prevMonth / last90) off this value, not new Date() — otherwise
    // differing browser/container TZs can shift month boundaries.
    const today = accountManager.getTodayKey()

    const accounts = accountManager.getAllAccountKeys().map(account => {
      // Deep copy of history: the 5 s window at 00:00 has _resetDailyCounters
      // mutating nested chat/cli entries; a shallow top-level copy does not
      // protect against that. The deep copy avoids handing the client a
      // half-reset snapshot.
      const history = {}
      const src = account.statsHistory || {}
      for (const key of Object.keys(src)) {
        const entry = src[key] || {}
        const chat = entry.chat || {}
        const cli = entry.cli || {}
        history[key] = {
          chat: { input: Number(chat.input) || 0, output: Number(chat.output) || 0 },
          cli: {
            calls: Number(cli.calls) || 0,
            input: Number(cli.input) || 0,
            output: Number(cli.output) || 0
          }
        }
      }

      // Today is the live counter from account.stats.
      // Deep copy of chat/cli — otherwise a concurrent accumulateStats call
      // may mutate the object already handed out.
      const s = account.stats || { chat: { input: 0, output: 0 }, cli: { calls: 0, input: 0, output: 0 } }
      history[today] = {
        chat: { input: Number(s.chat?.input) || 0, output: Number(s.chat?.output) || 0 },
        cli: {
          calls: Number(s.cli?.calls) || 0,
          input: Number(s.cli?.input) || 0,
          output: Number(s.cli?.output) || 0
        }
      }

      return { email: account.email, history }
    })

    res.json({ today, accounts })
  } catch (error) {
    logger.error('获取 statsHistory 失败', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /debug/archiveYesterday
 * Debug-only: manual trigger for the archival/reset routine (used while
 * smoke-testing the storage layer).
 *
 * Registered ONLY when ENABLE_STATS_DEBUG_ARCHIVE === 'true'.
 * NODE_ENV is intentionally NOT used: debug access must be explicitly enabled
 * regardless of the runtime or deployment environment.
 *
 * In any normal (including production) configuration the route is absent —
 * POST returns 404. Caveat: GET on any unknown path falls into app.get('*')
 * and returns the SPA with status 200, so always verify route absence with
 * `-X POST`.
 */
if (process.env.ENABLE_STATS_DEBUG_ARCHIVE === 'true') {
  router.post('/debug/archiveYesterday', adminKeyVerify, async (req, res) => {
    try {
      await accountManager.archiveYesterdayForTest()
      res.json({ ok: true, archivedAt: new Date().toISOString() })
    } catch (error) {
      // The readiness guard inside archiveYesterdayForTest throws with this message.
      if (error && error.message && error.message.includes('not initialized')) {
        return res.status(503).json({ error: 'account manager not initialized, try again' })
      }
      logger.error('debug/archiveYesterday 失败', 'ACCOUNT', '', error)
      res.status(500).json({ error: error.message })
    }
  })
  logger.info('已启用 debug/archiveYesterday 端点 (ENABLE_STATS_DEBUG_ARCHIVE=true)', 'ACCOUNT')
}

module.exports = router
