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
 *
 * ── 身份（2026-10-23） ───────────────────────────────────────────────────────
 * 无状态客户端（OpenAI SDK / Claude Code / 各种 Agent 框架）每一轮都把整段历史重新
 * 打包发来，不会告诉我们"我还是上次那个会话"。以前的键是
 * `hash(user, model, hash(system), hash(tools), hash(firstMessage))`：system 里多一个
 * 时间戳、工具数组换个顺序、客户端压缩过一次历史，键就变了 → 每轮都新建一个上游窗口。
 * 现在：
 *   - 显式 id（`X-Conversation-Id` / `prompt_cache_key` / `metadata.user_id` / `user`）
 *     优先，见 session-reuse.js#resolveConversationId；
 *   - 指纹只取**稳定**字段：模型 + 排序后的工具名集合 + 首条用户消息文本。
 *     system 与工具描述故意不进键——它们最容易被客户端逐轮改动；
 *   - 键没命中时用**历史前缀匹配**（findSessionByPrefix）找已有会话，这才是真正的
 *     "自动切回那个窗口"。
 * 撞键的代价被 `planTurn` 的前缀哈希校验兜住：前缀不是逐字一致就退回 new，绝不
 * 拿着别人的上下文答非所问。
 */

const { createHash } = require('node:crypto')

/** 同一条 user 消息最多连续分叉几次；超过就全量重放（见 planTurn）。 */
const MAX_CONSECUTIVE_BRANCHES = 1

/** 任务锚点上限：够模型认出"原始任务是什么"即可，别把整段历史塞进增量。 */
const TASK_ANCHOR_MAX_CHARS = 2000

const hashText = (text) => createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex')

/**
 * 工具名集合。两种线格式都认（OpenAI `{type:'function',function:{name}}` / Anthropic
 * `{name}`），**排序后**只取名字：客户端换个顺序、改个 description 都不该换会话。
 * @param {unknown} tools
 * @returns {string[]}
 */
const toolNamesOf = (tools) => {
    const list = Array.isArray(tools) ? tools : []
    return list
        .map((tool) => String(tool?.function?.name ?? tool?.name ?? ''))
        .filter(Boolean)
        .sort()
}

/**
 * 一条消息里"算得上正文"的文本。多模态数组只取文本项：图片 base64 每轮都在变，
 * 放进身份等于每轮一个新会话。
 * @param {unknown} content
 * @returns {string}
 */
const textOfContent = (content) => {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content
        .map((item) => (typeof item === 'string' ? item : String(item?.text ?? '')))
        .filter(Boolean)
        .join('\n')
}

/**
 * 会话键：显式 id 之外的身份指纹。
 *
 * `system` 参数保留在签名里是为了让调用方一眼看出"它**不**参与身份"——那是刻意的：
 * 客户端常把时间戳/环境信息塞进 system，把它算进键就等于每轮换会话。
 * @param {{userId?: string, model?: string, system?: any, tools?: any, firstMessage?: any}} input
 * @returns {string}
 */
const buildConversationKey = ({ userId, model, tools, firstMessage } = {}) => hashText(JSON.stringify([
    userId ? String(userId) : '',
    String(model || ''),
    toolNamesOf(tools).join(','),
    hashText(textOfContent(firstMessage && typeof firstMessage === 'object' ? firstMessage.content : ''))
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
 * 原始任务锚点：第一条用户消息的正文。
 *
 * 增量只发新内容时，一旦父链断了（分叉轮拿不到上游 user 消息 id → parentId 变 null），
 * 上游看到的就是"只有一个工具结果"，模型于是合理地回一句"没有原始任务"。把这条锚点
 * 拼在增量开头，父链断了任务也还在。见 session-reuse.js#applyDelta。
 * @param {Array} messages
 * @returns {string}
 */
const taskAnchorOf = (messages) => {
    const list = Array.isArray(messages) ? messages : []
    for (const message of list) {
        if (!message || message.role === 'system' || message.role === 'assistant') continue
        if (message.role !== 'user') continue
        const text = textOfContent(message.content).trim()
        if (text) return text.slice(0, TASK_ANCHOR_MAX_CHARS)
    }
    return ''
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

        /**
         * 快照：前缀匹配与 /sessions 都要遍历。新→旧（LRU 顺序反过来）。
         * @returns {Array<{key: string, session: object}>}
         */
        entries() {
            const list = []
            for (const [key, session] of map) {
                if (fresh(session)) list.push({ key, session })
            }
            return list.reverse()
        },

        delete(key) { return map.delete(key) },
        clear() { map.clear() },
        get size() { return map.size }
    }
}

/**
 * 按「历史前缀」找会话：键没命中时的第二道门。
 *
 * 客户端这次发来的历史，若**逐字**包含了某个已同步会话的全部前缀，就是同一个会话
 * （客户端只是又追加了新的工具结果/用户消息）。取匹配最长的那条。
 * 逐字比对是刻意的：宁可新建，也不要拿着别人的上下文答非所问。
 * @param {Array<{key: string, session: object}>} entries
 * @param {Array} messages
 * @returns {{key: string, session: object}|null}
 */
const findSessionByPrefix = (entries, messages) => {
    const list = Array.isArray(messages) ? messages : []
    if (list.length === 0) return null
    let best = null
    for (const entry of Array.isArray(entries) ? entries : []) {
        const session = entry?.session
        const count = Number(session?.syncedCount) || 0
        if (!entry?.key || !session?.chatId || count <= 0 || count > list.length) continue
        if (best && count <= (Number(best.session.syncedCount) || 0)) continue
        if (hashClientHistory(list, count) !== session.syncedHash) continue
        best = entry
    }
    return best
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
        // 但只允许一次。同一条 user 消息连着分叉，每次都会把上一轮的 assistant 回复
        // （以及上一轮注入的 recovery 提示）一起丢掉，几轮之后上游就只剩一个工具结果，
        // 模型只能回 <agent_blocked>没有原始任务</agent_blocked>——正是 2026-10-23 用户
        // 复现的那 10 步。分叉用尽就全量重放：多烧一点前缀缓存，换任务不丢。
        const branched = Number(session.branchCount) || 0
        if (branched >= MAX_CONSECUTIVE_BRANCHES && session.lastBranchParentId === session.lastUserMessageId) {
            return { mode: 'new', reason: 'branch-exhausted' }
        }
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
 * @param {'new'|'continue'|'branch'} [input.mode] 本轮实际用的模式（决定分叉计数）
 * @param {object|null} [input.previous] 本轮规划时的会话状态（用来累计分叉次数）
 * @returns {object} 可直接交给 sessions.set 的状态
 */
const recordTurn = ({ chatId, accountEmail, messages, deltaStart, userMessageId, assistantMessageId, badTurn, mode, previous }) => {
    const list = Array.isArray(messages) ? messages : []
    const isBranch = mode === 'branch'
    const branchedBefore = Number(previous?.branchCount) || 0
    return {
        chatId: chatId || null,
        accountEmail: accountEmail || null,
        syncedCount: list.length,
        syncedHash: hashClientHistory(list),
        lastParentId: assistantMessageId || userMessageId || null,
        lastUserMessageId: userMessageId || null,
        turnStartCount: Number.isInteger(deltaStart) ? deltaStart : 0,
        badTurn: badTurn === true,
        // 分叉记账：连续分叉到上限就由 planTurn 判 branch-exhausted（见那里）。
        branchCount: isBranch ? branchedBefore + 1 : 0,
        lastBranchParentId: isBranch ? (previous?.lastUserMessageId || null) : null,
        // 任务锚点：增量里永远带着它（见 taskAnchorOf 的注释）。
        taskAnchor: String(previous?.taskAnchor || taskAnchorOf(list) || ''),
        lastMode: mode || null
    }
}

module.exports = {
    buildConversationKey,
    hashClientHistory,
    createConversationSessions,
    findSessionByPrefix,
    taskAnchorOf,
    toolNamesOf,
    planTurn,
    recordTurn,
    MAX_CONSECUTIVE_BRANCHES
}
