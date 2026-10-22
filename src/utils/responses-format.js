/**
 * OpenAI Responses API（`/v1/responses`）的纯函数层：请求归一化 + 响应对象/SSE 事件构造。
 *
 * 为什么要独立一层：Responses API 的请求/响应形状和 Chat Completions 差别很大
 * （`input` 是 item 数组、`output` 是 item 数组、流式是一串 `response.*` 事件），
 * 但它底下仍然是同一套「把文本交给上游、把增量拿回来」。把纯逻辑放这里，
 * 控制器只管网络与状态机，测试也不用起服务。
 *
 * 参考：https://platform.openai.com/docs/api-reference/responses
 */

const crypto = require('node:crypto')

/** 生成 `resp_` / `msg_` / `rs_` / `fc_` 这类对象 id。 */
const newId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`

const OPENAI_ROLES = new Set(['user', 'assistant', 'system', 'tool'])

/**
 * Responses 的 role 映射到内部 chat 角色：`developer` 是新版里的 system。
 * 未知角色按 user 处理（宁可当作用户输入，也不要静默丢掉内容）。
 */
const normalizeRole = (role) => {
    const value = String(role || '').toLowerCase()
    if (value === 'developer') return 'system'
    return OPENAI_ROLES.has(value) ? value : 'user'
}

/**
 * 把一个 content（字符串 / 多段数组）压成纯文本。
 * 支持 `input_text`、`output_text`、`text` 三种段类型；图片等非文本段目前忽略
 * （多模态在 `/v1/chat/completions` 里已有完整链路，Responses 先只做文本）。
 */
const textFromContent = (content) => {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content
        .map((part) => {
            if (typeof part === 'string') return part
            if (!part || typeof part !== 'object') return ''
            if (typeof part.text === 'string') return part.text
            return ''
        })
        .join('')
}

const toArgumentsString = (value) => {
    if (typeof value === 'string') return value
    if (value === undefined || value === null) return '{}'
    try {
        return JSON.stringify(value)
    } catch {
        return '{}'
    }
}

const toOutputString = (value) => {
    if (typeof value === 'string') return value
    if (value === undefined || value === null) return ''
    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}

/**
 * 把 Responses 的 `input`（字符串或 item 数组）转成内部 chat 的 messages。
 *
 * item 支持：
 *   - `{role, content}` 或 `{type:'message', role, content}`（content 可以是字符串或多段）
 *   - `{type:'input_text', text}`
 *   - `{type:'function_call', call_id, name, arguments}` → assistant.tool_calls
 *   - `{type:'function_call_output', call_id, output}` → role:tool
 * 其余类型忽略（不报错：客户端可能带 `reasoning` 等只读 item 回来）。
 *
 * @param {string|Array} input
 * @returns {Array<{role: string, content: string, tool_calls?: Array, tool_call_id?: string}>}
 */
const normalizeInput = (input) => {
    if (typeof input === 'string') return [{ role: 'user', content: input }]
    if (!Array.isArray(input)) return []

    const messages = []
    for (const item of input) {
        if (typeof item === 'string') {
            messages.push({ role: 'user', content: item })
            continue
        }
        if (!item || typeof item !== 'object') continue

        const type = String(item.type || 'message')

        if (type === 'message' || (item.role && !type.startsWith('function_call'))) {
            messages.push({ role: normalizeRole(item.role), content: textFromContent(item.content) })
            continue
        }

        if (type === 'input_text') {
            messages.push({ role: 'user', content: textFromContent(item.text) })
            continue
        }

        if (type === 'function_call') {
            const call = {
                id: String(item.call_id || item.id || newId('call')),
                type: 'function',
                function: {
                    name: String(item.name || ''),
                    arguments: toArgumentsString(item.arguments)
                }
            }
            const last = messages[messages.length - 1]
            if (last && last.role === 'assistant') {
                last.tool_calls = Array.isArray(last.tool_calls) ? [...last.tool_calls, call] : [call]
            } else {
                messages.push({ role: 'assistant', content: '', tool_calls: [call] })
            }
            continue
        }

        if (type === 'function_call_output') {
            messages.push({
                role: 'tool',
                tool_call_id: String(item.call_id || ''),
                content: toOutputString(item.output)
            })
            continue
        }
        // 其它 item（reasoning / item_reference / web_search_call …）先忽略
    }
    return messages
}

/**
 * Responses 的 function 工具 → 内部 chat 的 tools 格式。
 * 已经是 `{type:'function', function:{...}}` 的也接受（幂等）。
 * 内置工具（web_search / file_search …）暂不支持，返回 null 跳过。
 */
const normalizeTool = (tool) => {
    if (!tool || typeof tool !== 'object') return null
    const type = String(tool.type || 'function')
    if (type !== 'function') return null
    const fn = tool.function && typeof tool.function === 'object' ? tool.function : tool
    if (!fn || typeof fn.name !== 'string' || !fn.name.trim()) return null
    return {
        type: 'function',
        function: {
            name: fn.name.trim(),
            description: typeof fn.description === 'string' ? fn.description : '',
            parameters: fn.parameters && typeof fn.parameters === 'object'
                ? fn.parameters
                : { type: 'object', properties: {} }
        }
    }
}

/** Responses 的 tool_choice → chat 的 tool_choice（字符串原样，函数选择要包一层）。 */
const normalizeToolChoice = (choice) => {
    if (choice === undefined || choice === null) return undefined
    if (typeof choice === 'string') return choice
    if (typeof choice === 'object') {
        if (choice.type === 'function' && typeof choice.name === 'string') {
            return { type: 'function', function: { name: choice.name } }
        }
        if (choice.type === 'function' && choice.function?.name) return choice
    }
    return undefined
}

/**
 * 把 Responses 请求体转成内部 chat 请求体（随后交给现有的 processRequestBody 中间件）。
 *
 * @param {object} body 原始请求体
 * @returns {{chatBody: object, meta: {model: string, stream: boolean, effort: string}}}
 */
const normalizeResponsesRequest = (body = {}) => {
    const messages = normalizeInput(body.input !== undefined ? body.input : body.messages)

    // instructions 等价于 system 提示，放在最前面
    const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : ''
    if (instructions) messages.unshift({ role: 'system', content: instructions })

    const chatBody = {
        model: body.model,
        messages,
        stream: body.stream === true
    }

    if (Number.isFinite(Number(body.max_output_tokens)) && Number(body.max_output_tokens) > 0) {
        chatBody.max_tokens = Number(body.max_output_tokens)
    }
    if (typeof body.temperature === 'number') chatBody.temperature = body.temperature
    if (typeof body.top_p === 'number') chatBody.top_p = body.top_p
    if (typeof body.user === 'string' && body.user) chatBody.user = body.user

    const tools = Array.isArray(body.tools) ? body.tools.map(normalizeTool).filter(Boolean) : []
    if (tools.length > 0) {
        chatBody.tools = tools
        const toolChoice = normalizeToolChoice(body.tool_choice)
        if (toolChoice !== undefined) chatBody.tool_choice = toolChoice
    }

    // reasoning.effort：none/minimal 明确关掉思考；其它值打开（Qwen 的思考由模型后缀/参数决定）
    const effort = body.reasoning && typeof body.reasoning.effort === 'string'
        ? body.reasoning.effort.toLowerCase()
        : ''
    if (effort === 'none' || effort === 'minimal') chatBody.enable_thinking = false
    else if (effort) chatBody.enable_thinking = true

    return {
        chatBody,
        meta: { model: body.model, stream: chatBody.stream, effort }
    }
}

/* ------------------------------------------------------------------ 响应 -- */

const buildUsage = ({ inputTokens = 0, outputTokens = 0 } = {}) => {
    const input = Math.max(0, Math.round(Number(inputTokens) || 0))
    const output = Math.max(0, Math.round(Number(outputTokens) || 0))
    return {
        input_tokens: input,
        output_tokens: output,
        total_tokens: input + output,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 }
    }
}

/** output 里的 assistant 文本 item。 */
const buildMessageItem = ({ id, text, status = 'completed' } = {}) => ({
    id: id || newId('msg'),
    type: 'message',
    status,
    role: 'assistant',
    content: [{ type: 'output_text', text: String(text ?? ''), annotations: [] }]
})

/** output 里的思考 item（OpenAI 用 summary 数组承载思考摘要）。 */
const buildReasoningItem = ({ id, text } = {}) => ({
    id: id || newId('rs'),
    type: 'reasoning',
    summary: [{ type: 'summary_text', text: String(text ?? '') }]
})

/** output 里的工具调用 item。 */
const buildFunctionCallItem = ({ id, callId, name, arguments: args, status = 'completed' } = {}) => ({
    id: id || newId('fc'),
    type: 'function_call',
    status,
    call_id: callId || newId('call'),
    name: String(name ?? ''),
    arguments: toArgumentsString(args)
})

/**
 * 构造 `response` 对象（流式的 response.created / response.completed 与非流式响应体共用）。
 */
const buildResponseObject = ({
    id,
    model,
    createdAt,
    status = 'completed',
    output = [],
    usage,
    error = null,
    incompleteDetails = null
} = {}) => ({
    id: id || newId('resp'),
    object: 'response',
    created_at: Number(createdAt) || Math.floor(Date.now() / 1000),
    status,
    model: model || '',
    output: Array.isArray(output) ? output : [],
    usage: usage || buildUsage(),
    error,
    incomplete_details: incompleteDetails
})

/** 一条 SSE 事件：`event: <type>` + `data: {type, ...}`。 */
const formatResponsesEvent = (type, payload = {}) =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`

/** OpenAI 风格的错误体（Responses 端点也用它，不是 chat 的 error.message 包装）。 */
const buildErrorBody = (message, { type = 'invalid_request_error', code = null, param = null } = {}) => ({
    error: { message: String(message || '请求失败'), type, code, param }
})

module.exports = {
    newId,
    normalizeRole,
    textFromContent,
    normalizeInput,
    normalizeTool,
    normalizeToolChoice,
    normalizeResponsesRequest,
    buildUsage,
    buildMessageItem,
    buildReasoningItem,
    buildFunctionCallItem,
    buildResponseObject,
    formatResponsesEvent,
    buildErrorBody
}
