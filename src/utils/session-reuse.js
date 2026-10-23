/**
 * 会话复用：把「客户端会话」映射到「上游 Qwen 会话」，续聊只发增量。
 *
 * 纯状态机在 conversation-session.js；这里负责把它接进请求/响应：
 *   - 身份：显式 id 优先（X-Conversation-Id / prompt_cache_key / metadata.user_id / user），
 *     指纹兜底，键没命中时按「历史前缀」找会话（无状态客户端就是靠这条自动切回窗口）
 *   - 选号：已有会话 → 粘住它所属的账号；新会话 → 最少使用（均摊）
 *   - 续用/分叉：只渲染增量，不再重发整段历史（增量开头永远带任务锚点）
 *   - 记录：从上游 `response.created` 拿到 user/assistant 消息 id，供下一轮续用
 *   - 可见性：created/continued/branched/diverged 计数 + 每条规划一条日志（含 new 的原因）
 *   - 持久化：DATA_SAVE_MODE=file 时落盘到 data/session-reuse.json，重启不丢
 *
 * 只有上游明确 `status: "finished"` 的回合才会被记录成"可续用"；被截断/中断的回合
 * 记成 badTurn，下一轮从那条 user 消息重新分叉（官方"重新生成"语义），但只分叉一次
 * ——见 conversation-session.js#planTurn 的 branch-exhausted。
 */

const fs = require('node:fs')
const path = require('node:path')
const {
    buildConversationKey,
    createConversationSessions,
    findSessionByPrefix,
    planTurn,
    recordTurn
} = require('./conversation-session')
const { logger } = require('./logger')
const config = require('../config/index.js')
const { resolveRuntimePath } = require('./runtime-paths.js')

const sessions = createConversationSessions({
    ttlMs: Math.max(60, Number(config.sessionReuseTtlSeconds) || 1800) * 1000,
    maxEntries: Math.max(1, Number(config.sessionReuseMaxEntries) || 200)
})

/* ---------------------------------------------------------------- 身份 -- */

/** 显式会话 id 的请求头（客户端主动声明"我还是上次那个会话"）。 */
const CONVERSATION_ID_HEADER = 'x-conversation-id'
const CONVERSATION_ID_MAX_CHARS = 200
/** 无会话时等同一会话的并发首轮记录完，最多等这么久（ms）。 */
const INFLIGHT_WAIT_MS = 2000

/**
 * 客户端声明的会话身份，按可信度排序取第一个。
 *
 * 无状态客户端不会告诉我们它是谁，于是这里接受三种常见约定：
 *   - `X-Conversation-Id`：本项目自己的头，最直接
 *   - OpenAI `prompt_cache_key`：官方给"路由到同一个缓存"用的字段，语义正好
 *   - Anthropic `metadata.user_id` / `metadata.session_id`、OpenAI 老字段 `user`
 * @param {object} req
 * @returns {string|null}
 */
const resolveConversationId = (req) => {
    const header = typeof req?.get === 'function'
        ? req.get(CONVERSATION_ID_HEADER)
        : req?.headers?.[CONVERSATION_ID_HEADER]
    const candidates = [
        header,
        req?.body?.prompt_cache_key,
        req?.body?.metadata?.user_id,
        req?.body?.metadata?.session_id,
        req?.body?.user
    ]
    for (const value of candidates) {
        if (typeof value === 'string' && value.trim()) return value.trim().slice(0, CONVERSATION_ID_MAX_CHARS)
        if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    }
    return null
}

/**
 * 客户端会话身份：显式 id → 指纹（模型 + 工具名集合 + 首条用户消息）。
 *
 * @param {object} req
 * @param {{raw?: Array, model?: string, tools?: unknown}} [context] 覆盖取值来源
 *        （Anthropic 面在 buildInternalRequest 之前就得规划，拿不到 req.raw_messages）
 * @returns {string}
 */
const conversationKeyFor = (req, context = {}) => {
    const explicit = resolveConversationId(req)
    if (explicit) return `id:${buildConversationKey({ userId: explicit })}`
    const raw = Array.isArray(context.raw)
        ? context.raw
        : (Array.isArray(req.raw_messages) ? req.raw_messages : [])
    return `fp:${buildConversationKey({
        model: context.model !== undefined ? context.model : req.body?.model,
        tools: context.tools !== undefined ? context.tools : req.body?.tools,
        firstMessage: raw.find(message => message && message.role !== 'system') ?? null
    })}`
}

/* ------------------------------------------------------- 计数与并发门 -- */

const stats = {
    created: 0,
    continued: 0,
    branched: 0,
    diverged: 0,
    branchExhausted: 0,
    prefixMatched: 0
}

const bumpStats = (plan, { prefixMatched = false } = {}) => {
    if (prefixMatched) stats.prefixMatched += 1
    if (plan.mode === 'continue') stats.continued += 1
    else if (plan.mode === 'branch') stats.branched += 1
    else {
        stats.created += 1
        if (plan.reason === 'branch-exhausted') stats.branchExhausted += 1
        else if (plan.reason === 'history-diverged' || plan.reason === 'history-shortened') stats.diverged += 1
    }
}

/** key -> 等待中的 promise（只用来给"无会话时的并发首轮"排队）。 */
const inflight = new Map()

const markInflight = (key) => {
    if (!key || inflight.has(key)) return false
    let release
    const promise = new Promise((resolve) => { release = resolve })
    inflight.set(key, { promise, release })
    return true
}

const releaseInflight = (key) => {
    const entry = inflight.get(key)
    if (!entry) return
    inflight.delete(key)
    entry.release()
}

/**
 * 同一会话的两个首轮并发进来，会各自新建一个上游 chat（正是要避免的）。
 * 第二个请求最多等这么久，让第一个先记录；等不到就照常往下走（绝不无限等）。
 */
const waitForInflight = async (key, ms = INFLIGHT_WAIT_MS) => {
    const entry = inflight.get(key)
    if (!entry) return
    await Promise.race([
        entry.promise,
        new Promise((resolve) => {
            const timer = setTimeout(resolve, ms)
            if (typeof timer.unref === 'function') timer.unref()
        })
    ])
}

/* ------------------------------------------------------------ 持久化 -- */

const persistEnabled = () => config.sessionReusePersist !== false && String(config.dataSaveMode) === 'file'

const persistFile = () => resolveRuntimePath('data', 'session-reuse.json')

let loaded = false
let saveTimer = null

const ensureLoaded = () => {
    if (loaded) return
    loaded = true
    if (!persistEnabled()) return
    try {
        const parsed = JSON.parse(fs.readFileSync(persistFile(), 'utf8'))
        const entries = parsed && typeof parsed.sessions === 'object' ? parsed.sessions : {}
        for (const [key, session] of Object.entries(entries)) {
            if (key && session && session.chatId) sessions.set(key, session)
        }
        logger.debug(`会话复用：从磁盘恢复 ${sessions.size} 个会话`, 'CHAT')
    } catch (_) {
        // 没有存档 = 首次启动（或 file 模式刚打开），不是错误
    }
}

const flushSessions = () => {
    if (!persistEnabled()) return
    try {
        const file = persistFile()
        fs.mkdirSync(path.dirname(file), { recursive: true })
        const payload = { version: 1, updatedAt: Date.now(), sessions: {} }
        for (const entry of sessions.entries()) payload.sessions[entry.key] = entry.session
        fs.writeFileSync(file, JSON.stringify(payload), 'utf8')
    } catch (error) {
        logger.warn(`会话复用：写入 ${persistFile()} 失败（${error.message}）`, 'CHAT')
    }
}

/** 节流写盘：一轮一个文件写没有意义，攒 2 秒。 */
const scheduleSave = () => {
    if (!persistEnabled() || saveTimer) return
    saveTimer = setTimeout(() => {
        saveTimer = null
        flushSessions()
    }, 2000)
    if (typeof saveTimer.unref === 'function') saveTimer.unref()
}

/* ------------------------------------------------------------ 规划 -- */

/**
 * 决定这一轮怎么发，并选好账号。
 * @param {object} req
 * @param {{raw?: Array, model?: string, tools?: unknown}} [context]
 * @returns {Promise<{key: string, plan: object, account: object|null, session: object|null}|null>}
 */
const planForRequest = async (req, context = {}) => {
    if (!config.sessionReuseEnabled) return null
    ensureLoaded()
    const accountManager = require('./account.js')
    const raw = Array.isArray(context.raw)
        ? context.raw
        : (Array.isArray(req.raw_messages) ? req.raw_messages : [])
    if (raw.length === 0) return null

    let key = conversationKeyFor(req, { ...context, raw })
    let session = sessions.get(key)

    // 无会话：可能是同一会话的并发首轮，等前一个记录完再看一眼
    if (!session) {
        await waitForInflight(key)
        session = sessions.get(key)
    }

    // 仍然没有：按历史前缀找（无状态客户端每轮重发全量历史，键漂了也能认回来）
    let prefixMatched = false
    if (!session) {
        const match = findSessionByPrefix(sessions.entries(), raw)
        if (match) {
            prefixMatched = true
            session = match.session
            // 迁到当前键，下一轮就是一次命中，不用再扫一遍
            if (match.key !== key) {
                sessions.delete(match.key)
                sessions.set(key, session)
            }
        }
    }

    // 已有会话：优先它所属的账号（会话不能跨号续）
    let account = null
    if (session && session.chatId && session.accountEmail) {
        account = accountManager.accountRotator.getAccountByEmail(session.accountEmail) || null
    }
    if (!account) account = accountManager.getLeastUsedAccount()

    const plan = planTurn({ session, messages: raw, accountEmail: account && account.email })
    // 增量里要带的任务锚点（applyDelta 用）
    plan.taskAnchor = String(session?.taskAnchor || '')
    plan.prefixMatched = prefixMatched
    // 记录时要靠它累计分叉次数（见 conversation-session.js#recordTurn）
    plan.previousSession = session || null

    // 没有会话可续时把这一轮登记成"在建"，让并发首轮排队（见 waitForInflight）
    if (plan.mode === 'new') markInflight(key)

    bumpStats(plan, { prefixMatched })
    logger.debug(
        `会话复用：${plan.mode}（${plan.reason}${prefixMatched ? '，前缀命中' : ''}）`
        + ` key=${key.slice(0, 16)} 历史 ${raw.length} 条`
        + (plan.deltaStart !== undefined ? ` 增量 ${raw.length - plan.deltaStart} 条` : ''),
        'CHAT'
    )

    return { key, plan, account, session }
}

/* ------------------------------------------------------------ 应用 -- */

/**
 * 增量里可以丢掉的消息下标：
 *   - assistant：那是**我们自己生成的**回复，上游会话里已经有了；
 *   - 已经同步过的工具结果（同一个 tool_call_id 在 raw[0..start) 里出现过）：客户端
 *     重试时会把同一段 `[TOOL RESULT]` 再发一遍，上游会话里同样已经有了。重复发不但
 *     浪费 token，还会让模型以为工具被重新调用过。
 *
 * 返回的是**原始数组的下标**，不是消息本身：`foldToolMessages` 是 1:1、保序的
 * （它用 .map），所以下标在折叠前后一致；而折叠后 tool_call_id 就没了（tool 消息变成
 * 一条 `[TOOL RESULT]` 文本），先折叠再按 id 去重是行不通的。
 * @param {Array} raw 完整客户端历史
 * @param {number} start 增量起点
 * @returns {number[]} 要发送的消息下标
 */
const deltaIndexesOf = (raw, start) => {
    const list = Array.isArray(raw) ? raw : []
    const from = Math.max(0, start)
    const seenToolResults = new Set()
    for (const message of list.slice(0, from)) {
        if (message && message.role === 'tool' && message.tool_call_id) seenToolResults.add(String(message.tool_call_id))
    }
    const kept = []
    for (let index = from; index < list.length; index += 1) {
        const message = list[index]
        if (!message || message.role === 'assistant') continue
        if (message.role === 'tool' && message.tool_call_id) {
            const id = String(message.tool_call_id)
            if (seenToolResults.has(id)) continue
            seenToolResults.add(id)
        }
        kept.push(index)
    }
    return kept
}

/**
 * 续用/分叉时，把请求体里的"全量历史 + 台账"换成"只有增量"。
 * 工具结果按与全量路径相同的折叠规则渲染，只是只取增量的那几条。
 *
 * 两点不能省：
 *   1. 任务锚点：父链断了（parentId 为 null）时，上游只剩工具结果，模型会合理地
 *      说"没有原始任务"。锚点保证任务永远在。
 *   2. 前缀与回合指令：中间件把 toolPrompt / ledger / directive 拼在 messages[0].content
 *      里，直接覆盖 content 会把它们一起丢掉——模型于是看不到工具协议、也看不到
 *      "继续同一任务"的指令，只能吐裸正文（正是 2026-10-23 复现的那条路径）。
 *      所以这里用同一个 composeAgentContent 重新拼，顺序仍是一份实现说了算。
 * @param {object} req
 * @param {{deltaStart?: number, taskAnchor?: string}} plan
 * @returns {boolean} 是否成功替换（没有增量时返回 false，调用方回退全量重放）
 */
const applyDelta = (req, plan) => {
    const raw = Array.isArray(req.raw_messages) ? req.raw_messages : []
    const start = Math.max(0, Number(plan && plan.deltaStart) || 0)
    const kept = deltaIndexesOf(raw, start)
    if (kept.length === 0) return false

    let folded
    try {
        // 折叠要看到完整数组（工具结果靠 tool_call_id 回链到 assistant 消息），
        // 折叠后按下标取增量的那几条。
        const { foldToolMessages } = require('./tool-prompt.js')
        const full = foldToolMessages(raw)
        folded = kept.map((index) => full[index] || raw[index])
    } catch (_) {
        folded = kept.map((index) => raw[index])
    }

    const { formatHistoryMessages } = require('./chat-helpers.js')
    const text = String(formatHistoryMessages(folded) || '').trim()
    if (!text) return false

    const anchor = String(plan?.taskAnchor || '').trim()
    const body = anchor && !text.includes('[ORIGINAL TASK]')
        ? `[ORIGINAL TASK]\n${anchor}\n\n${text}`
        : text

    const message = req.body && Array.isArray(req.body.messages) ? req.body.messages[0] : null
    if (!message) return false
    const { composeAgentContent } = require('../middlewares/chat-middleware.js')
    message.content = composeAgentContent({
        history: body,
        prefix: req.agent_prefix || '',
        directive: req.agent_directive || '',
        role: message.role || 'user'
    })
    return true
}

/* ------------------------------------------------------------ 记录 -- */

/**
 * 一轮结束后记录状态。只在拿到上游消息 id 时记录；没拿到的回合当作 badTurn，
 * 下一轮会从这条 user 消息重新分叉。
 * @param {object} input
 */
const remember = ({ key, plan, accountEmail, chatId, userMessageId, assistantMessageId, raw, finished }) => {
    try {
        if (!key || !chatId) return
        const messages = Array.isArray(raw) ? raw : []
        // 本轮结束后，客户端下一次发来的历史 = 本轮消息 + 我们返回的 assistant 消息。
        // 这里用「本轮消息 + 一条占位 assistant」记长度，靠 userMessageId/assistantMessageId
        // 定位上游；前缀哈希只用本轮消息，下一轮匹配时按长度放宽。
        sessions.set(key, recordTurn({
            chatId,
            accountEmail: accountEmail || (plan && plan.account && plan.account.email) || null,
            messages,
            deltaStart: plan && Number.isInteger(plan.deltaStart) ? plan.deltaStart : 0,
            userMessageId: userMessageId || null,
            assistantMessageId: assistantMessageId || null,
            badTurn: finished !== true,
            mode: plan && plan.mode,
            previous: (plan && plan.previousSession) || null
        }))
        scheduleSave()
        logger.debug(
            `会话复用：${plan && plan.mode === 'branch' ? '分叉' : '续用'}已记录（chat=${chatId}, 已同步 ${messages.length} 条）`,
            'CHAT'
        )
    } finally {
        // 记录完就放行等在同一会话上的并发请求
        releaseInflight(key)
    }
}

/** 失败路径也要放行，否则并发首轮要等满 INFLIGHT_WAIT_MS。 */
const abort = (key) => releaseInflight(key)

const clearSessions = () => {
    // 先加载：清空要清的是"磁盘上那份"和内存里的，否则重启后一清空反而把存档原样写回去
    ensureLoaded()
    sessions.clear()
    if (persistEnabled()) scheduleSave()
}

const getSession = (key) => {
    ensureLoaded()
    return sessions.get(key)
}

/**
 * 只读快照：/sessions 用它。只带哈希、计数与任务锚点前 120 字（面板靠它认出"这是
 * 哪段对话"），绝不带整段历史正文。
 *
 * 先 ensureLoaded：面板刚启动时也要能看到磁盘上已有的会话，不能等"下一个聊天请求"
 * 才把表填上（否则重启后第一眼看永远 0 条）。
 * @returns {{sessions: Array<object>, stats: object, size: number, persist: boolean}}
 */
const listSessions = () => {
    ensureLoaded()
    return {
        size: sessions.size,
        persist: persistEnabled(),
        stats: { ...stats },
        sessions: sessions.entries().map(({ key, session }) => ({
            key,
            keyShort: key.slice(0, 16),
            chatId: session.chatId || null,
            account: session.accountEmail || null,
            messages: Number(session.syncedCount) || 0,
            lastMode: session.lastMode || null,
            badTurn: session.badTurn === true,
            branchCount: Number(session.branchCount) || 0,
            updatedAt: session.updatedAt || null,
            taskAnchor: String(session.taskAnchor || '').slice(0, 120)
        }))
    }
}

module.exports = {
    conversationKeyFor,
    resolveConversationId,
    planForRequest,
    applyDelta,
    remember,
    abort,
    clearSessions,
    getSession,
    listSessions,
    // 落盘是 2 秒节流的（一轮一个文件写没意义）；测试要断言"真的写下去了"，得能手推一次。
    flush: flushSessions,
    CONVERSATION_ID_HEADER
}
