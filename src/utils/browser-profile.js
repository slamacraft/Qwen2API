/**
 * 浏览器指纹（baxia）凭证：从真实浏览器会话里采一次，之后由代理复用。
 *
 * 为什么需要它：2026-10-22 起，`/api/v2/chat/completions` 同时校验三样东西——
 *   1) 请求头 `Version` 必须存在且等于线上前端版本（缺了直接 Bad_Request）；
 *   2) baxia 的 `bx-ua` / `bx-umidtoken` 必须有效（伪造/缺失会被 WAF 判 unauthorized）；
 *   3) 浏览器会话 cookie（tfstk / isg / atpsida / acw_tc / ssxmod_* / refresh_token），
 *      且必须与 Bearer token 属于**同一个登录会话**。
 * 这三样都不是能算出来的：`bx-ua` 由 baxia 的 JS 在页面里生成，和浏览器设备身份绑定。
 * 所以只能从真实浏览器里「采」出来，再由代理原样带上。
 *
 * 按账号分文件（多账号轮换）：
 *   data/browser-profile.<email>.json   ← 账号自己的会话（token + cookie + baxia 头）
 *   data/browser-profile.json           ← 全局兜底（单账号部署沿用这一份即可）
 *
 * 性能：profile 是热路径（每个上游请求都要读），所以按路径缓存并带 2s 的 stat TTL，
 * 采集脚本重写文件后最多 2s 生效，且不会每个请求都打一次 syscall。
 */

const fs = require('node:fs')
const path = require('node:path')
const config = require('../config/index.js')
const { logger } = require('./logger')

const DEFAULT_VERSION = '0.3.20'
// 文件系统 stat 的缓存窗口：采集脚本写文件后最多这么久生效
const STAT_TTL_MS = 2000

// path -> { checkedAt, mtimeMs, profile }
const cache = new Map()
// email -> Promise（同一账号并发请求只跑一次采集）
const harvesting = new Map()

/** 把邮箱变成安全的文件名片段。 */
const safeEmail = (email) => String(email || '').trim().toLowerCase().replace(/[^a-z0-9._@-]/g, '_')

const dataDirectory = () => path.resolve(process.env.QWEN2API_RUNTIME_DIR || process.cwd(), 'data')

/**
 * 账号的指纹文件路径。显式配置 BROWSER_PROFILE_PATH 时所有账号共用那一份。
 * @param {string} [email]
 * @returns {string}
 */
const resolveProfilePath = (email) => {
    const configured = String(config.browserProfilePath || '').trim()
    if (configured) return path.resolve(configured)
    const name = safeEmail(email)
    return path.join(dataDirectory(), name ? `browser-profile.${name}.json` : 'browser-profile.json')
}

const parseProfile = (raw) => {
    if (!raw || typeof raw !== 'object') return null
    const cookie = typeof raw.cookie === 'string' ? raw.cookie.trim() : ''
    const bxUa = typeof raw.bxUa === 'string' ? raw.bxUa.trim() : ''
    // cookie 和 bx-ua 缺一不可：只有 cookie 会被 WAF 当伪造客户端，只有 bx-ua 则没有会话
    if (!cookie || !bxUa) return null
    const str = (value, fallback = '') => (typeof value === 'string' && value.trim() ? value.trim() : fallback)
    return {
        cookie,
        token: str(raw.token),
        bxUa,
        bxUmidtoken: str(raw.bxUmidtoken),
        bxV: str(raw.bxV, '2.5.37'),
        version: /^\d+\.\d+\.\d+$/.test(str(raw.version)) ? str(raw.version) : DEFAULT_VERSION,
        // 浏览器真实请求头：用来替换掉代理合成的 UA / sec-ch-ua，避免指纹自相矛盾
        userAgent: str(raw.userAgent),
        secChUa: str(raw.secChUa),
        secChUaPlatform: str(raw.secChUaPlatform),
        secChUaMobile: str(raw.secChUaMobile),
        acceptLanguage: str(raw.acceptLanguage),
        timezone: str(raw.timezone),
        // 采集时用的 Chrome 调试端口：自动续期必须连回**同一个浏览器**，
        // 否则会把别的账号的会话采进这个账号的文件（串号）
        port: Number(raw.port) || 0,
        // 采集时那个浏览器的 profile 目录：浏览器关掉后代理可以用它拉起 headless 续期
        userDataDir: str(raw.userDataDir),
        harvestedAt: str(raw.harvestedAt) || null
    }
}

/** 读一个文件，带 stat TTL 缓存。force=true 时绕过缓存（刚采集完）。 */
const readProfileFile = (file, force = false) => {
    const now = Date.now()
    const hit = cache.get(file)
    if (!force && hit && now - hit.checkedAt < STAT_TTL_MS) return hit.profile

    let stat
    try {
        stat = fs.statSync(file)
    } catch (_) {
        cache.set(file, { checkedAt: now, mtimeMs: 0, profile: null })
        return null
    }

    if (hit && hit.mtimeMs === stat.mtimeMs && hit.profile !== undefined) {
        hit.checkedAt = now
        return hit.profile
    }

    let profile = null
    try {
        profile = parseProfile(JSON.parse(fs.readFileSync(file, 'utf8')))
        if (!profile) logger.warn(`浏览器指纹文件内容不完整（需要 cookie 与 bxUa）：${file}`, 'REQUEST')
    } catch (error) {
        logger.warn(`读取浏览器指纹失败: ${error.message}`, 'REQUEST')
    }
    cache.set(file, { checkedAt: now, mtimeMs: stat.mtimeMs, profile })
    return profile
}

// 已经提示过"在用全局兜底指纹"的账号，避免每个请求刷一条
const warnedFallback = new Set()

/**
 * 取账号的浏览器指纹：先找账号自己的文件，没有再回退到全局文件（单账号部署）。
 *
 * 注意：全局文件里的 token 属于**采集时的那个账号**。多账号场景下如果某个账号
 * 只有全局兜底，它的请求会带着别人的 token 出去（等于串号、白烧别人的额度），
 * 所以这里会提示一次，让部署者给该账号补一份自己的指纹。
 * @param {string} [email]
 * @returns {object|null}
 */
const getBrowserProfile = (email) => {
    const accountPath = resolveProfilePath(email)
    const accountProfile = readProfileFile(accountPath)
    if (accountProfile) return accountProfile

    const globalPath = resolveProfilePath(null)
    if (globalPath === accountPath) return null

    const fallback = readProfileFile(globalPath)
    if (fallback && email && !warnedFallback.has(email)) {
        warnedFallback.add(email)
        logger.warn(
            `账号 ${email} 没有自己的浏览器指纹文件，正在使用全局指纹（${globalPath}）——多账号时这会串号，请为该账号单独采集`,
            'REQUEST'
        )
    }
    return fallback
}

/**
 * 要发送的 `Version` 头：指纹文件里的前端版本 > 环境变量 > 内置值。
 * 这个头**必须存在**（缺失时 completions 直接 Bad_Request）。
 * @param {string} [email]
 * @returns {string}
 */
const getWebVersion = (email) => {
    const profile = getBrowserProfile(email)
    if (profile && profile.version) return profile.version
    const configured = String(config.qwenWebVersion || '').trim()
    return /^\d+\.\d+\.\d+$/.test(configured) ? configured : DEFAULT_VERSION
}

/** 解析 JWT 的 exp（秒）；解析不出来返回 0。 */
const tokenExpiresAt = (token) => {
    try {
        const payload = String(token || '').split('.')[1]
        if (!payload) return 0
        const json = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
        return Number(json.exp) || 0
    } catch (_) {
        return 0
    }
}

/**
 * 确保某个账号的 access token 还新鲜：快过期/已过期时自动跑一次采集脚本。
 *
 * Qwen 的 access token 只有 15 分钟寿命（iat→exp 实测 900s），refresh_token 有效 30 天。
 * 刷新必须在**浏览器会话内**完成（服务端校验 Bearer 与 refresh_token cookie 属于同一会话），
 * 所以这里不能自己换 token，只能让浏览器刷新后重新采一次。
 *
 * 采集依赖 Chrome 带 --remote-debugging-port 启动且该账号已登录；失败只记日志，不抛错。
 * @param {string} [email]
 * @param {{force?: boolean, timeoutMs?: number}} [options]
 * @returns {Promise<object|null>}
 */
const ensureFreshProfileToken = async (email, { force = false, timeoutMs = 25000 } = {}) => {
    // 测试环境不要真的去开浏览器采集（tools/test-gate.js 会注入这个变量）
    if (process.env.QWEN2API_DISABLE_AUTO_HARVEST === '1') return getBrowserProfile(email)

    const profile = getBrowserProfile(email)
    if (!profile) return null

    const exp = tokenExpiresAt(profile.token)
    const now = Math.floor(Date.now() / 1000)
    if (!force && exp > now + 120) return profile

    const key = safeEmail(email) || '__global__'
    if (harvesting.has(key)) return harvesting.get(key)

    const script = path.resolve(__dirname, '../../scripts/harvest-browser-profile.mjs')
    if (!fs.existsSync(script)) {
        logger.warn('浏览器指纹需要刷新，但找不到采集脚本 scripts/harvest-browser-profile.mjs', 'REQUEST')
        return profile
    }

    const outFile = resolveProfilePath(email)
    // 必须连回**采集这个指纹时的那台浏览器**：用全局端口会把别的账号的会话采进来（串号）
    const port = String(profile.port || config.chromeDebugPort || 9333)
    const task = (async () => {
        logger.info(`浏览器指纹的 access token 已过期，正在从浏览器重新采集（${email || '全局'}）…`, 'REQUEST', '🔄')
        let ok = await runHarvest(script, port, outFile, timeoutMs)
        // 浏览器窗口没开：用临时 profile 起一个无头 Chrome，把指纹里的 cookie 注入进去，
        // 让页面自己用 refresh_token 换新 token 再采一次。采完脚本会自己关掉浏览器。
        // 这条路径要多花时间（拉起 Chrome + 打开页面 + 等页面换 token），实测 3~5 秒，
        // 但 refresh_token 失效时会一直轮询到超时，所以给一个更宽的预算，别让它被误杀。
        if (!ok) {
            logger.info('调试浏览器没在运行，改用 headless + 注入 cookie 续期…', 'REQUEST', '🌐')
            ok = await runHarvest(script, port, outFile, Math.max(timeoutMs, 45000), ['--headless', '--inject-from', outFile])
        }
        if (!ok) {
            logger.warn(
                `浏览器指纹自动采集失败（Chrome 是否带 --remote-debugging-port=${port} 启动且已登录？）`,
                'REQUEST'
            )
            return getBrowserProfile(email)
        }
        logger.info('浏览器指纹已刷新', 'REQUEST', '🔄')
        return readProfileFile(outFile, true) || getBrowserProfile(email)
    })().finally(() => { harvesting.delete(key) })

    harvesting.set(key, task)
    return task
}

/** 跑一次采集脚本；成功返回 true。extraArgs 用于 headless + 注入 cookie / 登录模式。 */
const runHarvest = (script, port, outFile, timeoutMs, extraArgs = []) =>
    runHarvestProcess(script, port, outFile, timeoutMs, { extraArgs }).then(result => result.ok)

/**
 * 跑一次采集脚本，返回完整结果（成功与否 + stderr）。
 * @param {string} script 脚本路径
 * @param {string|number} port 调试端口
 * @param {string} outFile 指纹输出文件
 * @param {number} timeoutMs 超时
 * @param {{extraArgs?: string[], env?: Record<string,string>}} [options]
 * @returns {Promise<{ok: boolean, stderr: string, stdout: string}>}
 */
const runHarvestProcess = (script, port, outFile, timeoutMs, { extraArgs = [], env = {} } = {}) => new Promise((resolve) => {
    const { execFile } = require('node:child_process')
    execFile(
        process.execPath,
        [script, '--port', port, '--out', outFile, ...extraArgs],
        { timeout: timeoutMs, windowsHide: true, env: { ...process.env, ...env } },
        (error, stdout, stderr) => {
            const result = { ok: !error, stderr: String(stderr || ''), stdout: String(stdout || '') }
            if (error) logger.debug(`采集脚本失败: ${result.stderr.trim().slice(0, 160) || error.message}`, 'REQUEST')
            resolve(result)
        }
    )
})

/**
 * 从采集脚本的 stderr 里挑出人话（脚本最后会打一行 `[harvest] 失败: …`）。
 * 面板会把这句直接展示给用户，所以别把整段栈丢出去。
 */
const provisionErrorText = (stderr) => {
    const lines = String(stderr || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    const failed = [...lines].reverse().find(line => line.includes('失败'))
    const text = (failed || lines[lines.length - 1] || '采集脚本执行失败')
        .replace(/^\[harvest\]\s*/, '')
        .replace(/^失败[:：]\s*/, '')
    return text.slice(0, 300)
}

// 服务端自备指纹：同一进程里必须串行——无头 Chrome 用同一个调试端口，并发会把
// 一个账号的会话采进另一个账号的文件（串号，白烧别人额度）。
let provisionChain = Promise.resolve()
// email -> Promise（同一个账号并发点「生成」只跑一次）
const provisioning = new Map()
// email -> 下次允许自动重试的时间戳（自动自愈失败后冷却，避免每个请求都去登录一次）
const provisionBackoff = new Map()
const PROVISION_BACKOFF_MS = 10 * 60 * 1000

/** 现在能不能为这个账号再试一次自动补会话（失败后冷却 10 分钟）。 */
const canAttemptProvision = (email) => {
    const nextAt = provisionBackoff.get(safeEmail(email))
    return !nextAt || Date.now() >= nextAt
}

const noteProvisionFailure = (email) => provisionBackoff.set(safeEmail(email), Date.now() + PROVISION_BACKOFF_MS)
const clearProvisionBackoff = (email) => provisionBackoff.delete(safeEmail(email))

/**
 * 服务端自己为账号生成浏览器指纹：起一个临时 profile 的无头 Chrome，用账号邮箱/密码
 * 登录 chat.qwen.ai（登录请求由页面发出，带 baxia 指纹），让页面把 refresh_token 换成
 * access_token，然后采集 cookie + bx-ua 写进该账号的指纹文件。
 *
 * 这样服务器部署时不需要用户在本机装 Chrome 或跑命令行。
 *
 * @param {string} email 账号邮箱
 * @param {{password?: string, proxy?: string}} account 账号对象（必须有 password）
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<object>} 写好的指纹（同 getBrowserProfile 的结构）
 * @throws {Error} 登录失败 / 找不到 Chrome / 超时，message 是人话，可直接展示
 */
const provisionProfile = (email, account, { timeoutMs = 90000 } = {}) => {
    if (!email) return Promise.reject(new Error('缺少账号邮箱'))
    const key = safeEmail(email)
    if (provisioning.has(key)) return provisioning.get(key)

    const task = (async () => {
        if (process.env.QWEN2API_DISABLE_AUTO_HARVEST === '1') {
            throw new Error('当前进程禁用了浏览器采集（QWEN2API_DISABLE_AUTO_HARVEST=1）')
        }
        if (!account || !account.password) {
            throw new Error(`账号 ${email} 没有保存密码，无法自动生成浏览器会话；请重新添加账号（需要邮箱+密码）`)
        }
        const script = path.resolve(__dirname, '../../scripts/harvest-browser-profile.mjs')
        if (!fs.existsSync(script)) {
            throw new Error('找不到采集脚本 scripts/harvest-browser-profile.mjs（编译版二进制里没有 scripts/ 目录）')
        }
        const outFile = resolveProfilePath(email)
        const port = String(config.chromeDebugPort || 9333)

        // 串行闸门：排队期间不占端口，前一个跑完才轮到自己
        const previous = provisionChain
        let release
        provisionChain = new Promise(resolve => { release = resolve })
        await previous.catch(() => { })
        try {
            logger.info(`正在为 ${email} 自动生成浏览器会话（无头 Chrome 登录）…`, 'REQUEST', '🌐')
            const result = await runHarvestProcess(script, port, outFile, timeoutMs, {
                extraArgs: ['--headless', '--login-account'],
                // 密码走环境变量，不进 argv（进程列表能看到 argv）
                env: { QWEN2API_LOGIN_ACCOUNT: JSON.stringify({ email, password: account.password }) },
            })
            if (!result.ok) {
                const message = provisionErrorText(result.stderr)
                noteProvisionFailure(email)
                throw new Error(message)
            }
            const profile = readProfileFile(outFile, true)
            if (!profile) {
                noteProvisionFailure(email)
                throw new Error('采集脚本跑完了，但没有写出可用的指纹文件（cookie 或 bx-ua 为空）')
            }
            clearProvisionBackoff(email)
            logger.success(`账号 ${email} 的浏览器会话已生成`, 'REQUEST', '✅')
            return profile
        } finally {
            release()
        }
    })().finally(() => { provisioning.delete(key) })

    provisioning.set(key, task)
    return task
}

/**
 * 账号「是否真的可用」的展示摘要（管理面板那一列用）。
 *
 * 注意：这里按「有没有浏览器会话」判断，比上游轮换的判定更严格一点——轮换在
 * legacy 模式（一个指纹文件都没有）下仍会放行账号，但那种请求必然被 WAF 拒，
 * 面板应该照实显示「缺会话」。
 * @param {{email?: string, disabled?: boolean}} account
 */
const describeAccountUsability = (account) => {
    const email = account && account.email
    const disabled = Boolean(account && account.disabled)
    const own = email ? readProfileFile(resolveProfilePath(email)) : null
    // 单账号老部署：只有全局兜底文件、没有按账号的文件时，全局指纹就是这个账号的会话
    const viaGlobal = !own && !isProfileModeActive() && Boolean(readProfileFile(resolveProfilePath(null)))
    const hasFingerprint = Boolean(own) || viaGlobal
    const usable = !disabled && hasFingerprint
    return {
        hasFingerprint,
        fingerprintAt: own ? own.harvestedAt : null,
        viaGlobal,
        usable,
        unavailableCode: disabled ? 'disabled' : (usable ? null : 'no_fingerprint')
    }
}


/** 仅供测试：清空文件缓存。 */
const clearProfileCache = () => {
    cache.clear()
    modeCache = null
}

// 目录扫描结果缓存（判断"是否已经有按账号的指纹"）
let modeCache = null

/**
 * 这个账号是否有**自己的**指纹文件（不含全局兜底）。
 * @param {string} [email]
 * @returns {boolean}
 */
const hasOwnProfile = (email) => {
    if (!email) return false
    try {
        return fs.statSync(resolveProfilePath(email)).isFile()
    } catch (_) {
        return false
    }
}

/**
 * 指纹机制是否已按账号启用（数据目录里至少有一份 browser-profile.<email>.json）。
 *
 * 一旦启用，没有自己指纹的账号就不该参与轮换：它要么被上游拒（unauthorized），
 * 要么（更糟）借全局兜底指纹串到别的账号的额度上。
 * @returns {boolean}
 */
const isProfileModeActive = () => {
    const now = Date.now()
    if (modeCache && now - modeCache.checkedAt < STAT_TTL_MS) return modeCache.active
    let active = false
    try {
        active = fs.readdirSync(dataDirectory())
            .some((name) => /^browser-profile\..+\.json$/.test(name))
    } catch {
        // 数据目录读不到（还没创建/权限问题）就当作未启用，保持 legacy 行为，不要抛
    }
    modeCache = { checkedAt: now, active }
    return active
}

/**
 * 该账号能不能拿去做上游请求。
 * - 有自己的指纹 → 可以；
 * - 指纹机制还没按账号启用（单账号老部署，只有全局文件）→ 可以，沿用老行为；
 * - 否则 → 不可以（缺会话，请求必然失败或串号）。
 * @param {{email?: string}} account
 * @returns {boolean}
 */
const canUseAccountForUpstream = (account) => {
    const email = account && account.email
    if (!email) return true
    if (hasOwnProfile(email)) return true
    return !isProfileModeActive()
}

module.exports = {
    DEFAULT_VERSION,
    getBrowserProfile,
    getWebVersion,
    ensureFreshProfileToken,
    tokenExpiresAt,
    resolveProfilePath,
    safeEmail,
    hasOwnProfile,
    isProfileModeActive,
    canUseAccountForUpstream,
    clearProfileCache,
    // 服务端自备指纹（管理面板「生成」按钮 / 加账号后自动补 / 请求时自愈）
    provisionProfile,
    describeAccountUsability,
    canAttemptProvision,
    noteProvisionFailure,
    clearProvisionBackoff,
    provisionErrorText,
    runHarvestProcess,
}
