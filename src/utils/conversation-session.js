/**
 * 会话复用（conversation → Qwen chat）的状态机。
 *
 * 背景：现在每个请求都新建一个 Qwen 会话，并把客户端发来的**整段历史**折叠成一条
 * user 消息塞进去。结果是上游自己的会话上下文（以及它的前缀缓存）一次都没用上，
 * agent 场景下每轮都在重传几万 token。
 *
 * 这里只做**纯逻辑**：给定客户端的消息数组和一个账号，决定这一轮该怎么发。
 * 网络、渲染、账号选择都在调用方。
 *
 * 三种模式：
 *   new      —— 新会话（或客户端历史分叉/换号）：新建 chat + 全量重放（现状行为）
 *   continue —— 历史前缀与上次一致：续用 chat_id，只发增量（新的工具结果/用户消息）
 *   branch   —— 上一轮被截断/被门禁拒绝：从**上一轮那条 user 消息**重新分叉（官方客户端
 *               "重新生成"的语义），把半截的 assistant 消息丢掉
 *
 * 换号一律回退成 new：Qwen 的会话属于某个账号，换个号无法续用同一个 chat。
 */

const { createHash } = require('node:crypto')

const hashText = (text) => createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex')

/**
 * 会话键：客户端没给会话 id 时，用「模型 + system + tools + 首条消息」作为身份。
 * 与 context-prefix-cache.js#buildContextPrefixKey 同一套思路（附件复用也用这个键）。
 * @param {{userId?: string, model?: string, system?: any, tools?: any, firstMessage?: any}} input
 * @returns {string}
 */
const buildConversationKey = ({ userId, model, system, tools, firstMessage } = {}) => hashText(JSON.stringify([
    userId ? String(userId) : '',
    String(model || ''),
    hashText(JSON.stringify(system ?? '')),
    hashText(JSON.stringify(tools ?? [])),
    hashText(JSON.stringify(firstMessage ?? ''))
]))

/**
 * 客户端历史的规范形式：只取「决定上游看到了什么」的字段。
 * 工具结果靠 tool_call_id 回链，所以它必须进哈希。
 * @param {Array} messages
 * @param {number} [count] 只算前 count 条
 * @returns {string}
 */
const hashClientHistory = (messages, count) => {
    const list = Array.isArray(messages) ? messages : []
    const upto = Number.isInteger(count) ? Math.max(0, Math.min(count, list.length)) : list.length
    return hashText(JSON.stringify(list.slice(0, upto).map((message) => ({
        role: message?.role ?? '',
        content: message?.content ?? '',
        tool_call_id: message?.tool_call_id ?? null,
        tool_calls: Array.isArray(message?.tool_calls)
            ? message.tool_calls.map(call => ({
                id: call?.id ?? null,
                name: call?.function?.name ?? '',
                arguments: call?.function?.arguments ?? ''
            }))
            : null
    }))))
}

/**
 * 会话状态缓存（LRU + TTL，无定时器：过期在读取时判断）。
 * @param {{ttlMs?: number, maxEntries?: number, now?: () => number}} [options]
 */
const createConversationSessions = ({ ttlMs = 30 * 60 * 1000, maxEntries = 200, now = Date.now } = {}) => {
    const map = new Map()
    const ttl = Math.max(0, Number(ttlMs) || 0)
    const cap = Math.max(1, Number(maxEntries) || 1)

    const fresh = (entry) => entry && !(ttl > 0 && now() - entry.updatedAt > ttl)

    return {
        /**
         * 取会话状态（过期/不存在返回 null）。
         * @param {string} key
         */
        get(key) {
            const entry = map.get(key)
            if (!entry) return null
            if (!fresh(entry)) {
                map.delete(key)
                return null
            }
            return entry
        },

        /**
         * 写入/更新会话状态。
         * @param {string} key
         * @param {object} entry
         */
        set(key, entry) {
            map.delete(key)
            map.set(key, { ...entry, updatedAt: now() })
            while (map.size > cap) map.delete(map.keys().next().value)
        },

        delete(key) { return map.delete(key) },
        clear() { map.clear() },
        get size() { return map.size }
    }
}

/**
 * 决定这一轮怎么发。纯函数（不读写缓存），便于测试。
 *
 * @param {object} input
 * @param {object|null} input.session  该会话的缓存状态（createConversationSessions().get(key)）
 * @param {Array} input.messages       客户端这次发来的完整消息数组
 * @param {string} input.accountEmail  本轮打算使用的账号
 * @returns {{mode: 'new'|'continue'|'branch', chatId?: string, parentId?: string|null, deltaStart?: number, reason: string}}
 */
const planTurn = ({ session, messages, accountEmail } = {}) => {
    const list = Array.isArray(messages) ? messages : []
    if (!session || !session.chatId) {
        return { mode: 'new', reason: 'no-session' }
    }
    // 换号：Qwen 的会话属于某个账号，续不了
    if (session.accountEmail && accountEmail && session.accountEmail !== accountEmail) {
        return { mode: 'new', reason: 'account-changed' }
    }
    // 上一轮被截断/被拒：从那条 user 消息重新分叉（官方"重新生成"语义）
    if (session.badTurn && session.lastUserMessageId) {
        return {
            mode: 'branch',
            chatId: session.chatId,
            parentId: session.lastUserMessageId,
            deltaStart: session.turnStartCount,
            reason: 'previous-turn-rejected'
        }
    }
    // 历史前缀必须逐字一致才敢续：客户端可能编辑/截断/换会话
    const expected = Number(session.syncedCount) || 0
    if (expected <= 0 || list.length < expected) {
        return { mode: 'new', reason: 'history-shortened' }
    }
    if (hashClientHistory(list, expected) !== session.syncedHash) {
        return { mode: 'new', reason: 'history-diverged' }
    }
    return {
        mode: 'continue',
        chatId: session.chatId,
        parentId: session.lastParentId || null,
        deltaStart: expected,
        reason: 'prefix-matched'
    }
}

/**
 * 一轮结束后记录状态。调用方把上游给出的 id 传进来。
 *
 * @param {object} input
 * @param {string} input.chatId
 * @param {string} input.accountEmail
 * @param {Array} input.messages         本轮客户端消息（完整数组）
 * @param {number} input.deltaStart      本轮从第几条开始是新内容
 * @param {string|null} input.userMessageId  本轮那条 user 消息在上游的 id（分叉用）
 * @param {string|null} input.assistantMessageId 上游 assistant 消息 id（下一轮 parent）
 * @param {boolean} input.badTurn        本轮被截断/被门禁拒绝
 * @returns {object} 可直接交给 sessions.set 的状态
 */
const recordTurn = ({ chatId, accountEmail, messages, deltaStart, userMessageId, assistantMessageId, badTurn }) => {
    const list = Array.isArray(messages) ? messages : []
    return {
        chatId: chatId || null,
        accountEmail: accountEmail || null,
        syncedCount: list.length,
        syncedHash: hashClientHistory(list),
        lastParentId: assistantMessageId || userMessageId || null,
        lastUserMessageId: userMessageId || null,
        turnStartCount: Number.isInteger(deltaStart) ? deltaStart : 0,
        badTurn: badTurn === true
    }
}

module.exports = {
    buildConversationKey,
    hashClientHistory,
    createConversationSessions,
    planTurn,
    recordTurn
}
