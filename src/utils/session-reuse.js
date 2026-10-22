/**
 * 会话复用：把「客户端会话」映射到「上游 Qwen 会话」，续聊只发增量。
 *
 * 纯状态机在 conversation-session.js；这里负责把它接进请求/响应：
 *   - 选号：已有会话 → 粘住它所属的账号；新会话 → 最少使用（均摊）
 *   - 续用/分叉：只渲染增量，不再重发整段历史
 *   - 记录：从上游 `response.created` 拿到 user/assistant 消息 id，供下一轮续用
 *
 * 只有上游明确 `status: "finished"` 的回合才会被记录成"可续用"；被截断/中断的回合
 * 记成 badTurn，下一轮从那条 user 消息重新分叉（官方"重新生成"语义）。
 */

const { buildConversationKey, createConversationSessions, planTurn, recordTurn } = require('./conversation-session')
const { logger } = require('./logger')
const config = require('../config/index.js')

const sessions = createConversationSessions({
    ttlMs: Math.max(60, Number(config.sessionReuseTtlSeconds) || 1800) * 1000,
    maxEntries: Math.max(1, Number(config.sessionReuseMaxEntries) || 200)
})

/** 客户端会话身份：模型 + system + tools + 首条消息（与附件前缀缓存同一套思路）。 */
const conversationKeyFor = (req) => {
    const raw = Array.isArray(req.raw_messages) ? req.raw_messages : []
    return buildConversationKey({
        userId: req.body && req.body.user,
        model: req.body && req.body.model,
        system: raw.find(message => message && message.role === 'system')?.content ?? '',
        tools: req.body && req.body.tools,
        firstMessage: raw.find(message => message && message.role !== 'system') ?? null
    })
}

/**
 * 决定这一轮怎么发，并选好账号。
 * @param {object} req
 * @returns {{key: string, plan: object, account: object|null, session: object|null}|null}
 */
const planForRequest = (req) => {
    if (!config.sessionReuseEnabled) return null
    const accountManager = require('./account.js')
    const raw = Array.isArray(req.raw_messages) ? req.raw_messages : []
    if (raw.length === 0) return null

    const key = conversationKeyFor(req)
    const session = sessions.get(key)

    // 已有会话：优先它所属的账号（会话不能跨号续）
    let account = null
    if (session && session.chatId && session.accountEmail) {
        account = accountManager.accountRotator.getAccountByEmail(session.accountEmail) || null
    }
    if (!account) account = accountManager.getLeastUsedAccount()

    const plan = planTurn({ session, messages: raw, accountEmail: account && account.email })
    return { key, plan, account, session }
}

/**
 * 续用/分叉时，把请求体里的"全量历史 + 台账"换成"只有增量"。
 * 工具结果按与全量路径相同的折叠规则渲染，只是从 deltaStart 开始切。
 * @param {object} req
 * @param {{deltaStart?: number}} plan
 * @returns {boolean} 是否成功替换（没有增量时返回 false，调用方回退全量重放）
 */
const applyDelta = (req, plan) => {
    const raw = Array.isArray(req.raw_messages) ? req.raw_messages : []
    const start = Math.max(0, Number(plan && plan.deltaStart) || 0)
    // 增量里要丢掉 assistant 消息：那是**我们自己生成的**回复，上游会话里已经有了。
    // 剩下的才是真正的新内容（用户新消息 / 工具结果）。
    const delta = raw.slice(start).filter(message => message && message.role !== 'assistant')
    if (delta.length === 0) return false

    let folded
    try {
        // 折叠需要完整数组（工具结果靠 tool_call_id 回链到 assistant 消息），再切增量；
        // assistant 消息要丢掉——那是我们自己生成的回复，上游会话里已经有了
        const { foldToolMessages } = require('./tool-prompt.js')
        folded = foldToolMessages(raw)
            .slice(start)
            .filter(message => message && message.role !== 'assistant')
    } catch (_) {
        folded = delta
    }

    const { formatHistoryMessages } = require('./chat-helpers.js')
    const text = String(formatHistoryMessages(folded) || '').trim()
    if (!text) return false

    const message = req.body && Array.isArray(req.body.messages) ? req.body.messages[0] : null
    if (!message) return false
    message.content = text
    return true
}

/**
 * 一轮结束后记录状态。只在拿到上游消息 id 时记录；没拿到的回合当作 badTurn，
 * 下一轮会从这条 user 消息重新分叉。
 * @param {object} input
 */
const remember = ({ key, plan, accountEmail, chatId, userMessageId, assistantMessageId, raw, finished }) => {
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
        badTurn: finished !== true
    }))
    logger.debug(
        `会话复用：${plan && plan.mode === 'branch' ? '分叉' : '续用'}已记录（chat=${chatId}, 已同步 ${messages.length} 条）`,
        'CHAT'
    )
}

const clearSessions = () => sessions.clear()
const getSession = (key) => sessions.get(key)

module.exports = {
    conversationKeyFor,
    planForRequest,
    applyDelta,
    remember,
    clearSessions,
    getSession
}
