/**
 * OpenAI Responses API（`/v1/responses`）控制器。
 *
 * 实现思路：**不重写一遍上游链路**，而是把请求交给现有的 `/v1/chat/completions`
 * 控制器（`handleChatCompletion`），用一个「假 res」把它写出的 OpenAI chunk 收下来，
 * 再翻译成 Responses 的 item / 事件流。
 *
 * 为什么这样做：chat 链路里已经有一大堆不是「翻译」能替代的东西——Agent 回合门禁、
 * 文本协议工具调用的流式解析（tool-prompt.js 上千行）、会话复用、换号/WAF 重试、
 * 心跳。把这些在 Responses 里重写一遍，只会多出一份会各自漂移的实现。
 * 于是这里只做两件事：
 *   1. 请求：`normalizeResponsesRequest` 把 `input`/`instructions`/`tools` 转成 chat 请求体；
 *   2. 响应：把 chat 的 `chat.completion(.chunk)` 翻译成 Responses 的 `response` 对象与事件。
 */

const { handleChatCompletion } = require('./chat.js')
const format = require('../utils/responses-format.js')
const { logger } = require('../utils/logger.js')

const SSE_HEADERS = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
}

/**
 * 采集用的假 res：只实现 chat 控制器真正会用到的几个方法。
 * `write` 拿到的每一段都是完整的 SSE 帧（chat 控制器按帧写），交给翻译层解析。
 */
const createCaptureResponse = (onChunk) => ({
    statusCode: 200,
    headers: {},
    headersSent: false,
    jsonBody: null,
    ended: false,
    set(name, value) {
        this.headers[name] = value
        return this
    },
    setHeader(name, value) {
        this.headers[name] = value
        return this
    },
    getHeader(name) {
        return this.headers[name]
    },
    removeHeader(name) {
        delete this.headers[name]
    },
    status(code) {
        this.statusCode = code
        return this
    },
    flushHeaders() {
        this.headersSent = true
        return this
    },
    write(chunk) {
        this.headersSent = true
        if (chunk) onChunk(String(chunk))
        return true
    },
    end() {
        this.ended = true
        return this
    },
    json(body) {
        this.jsonBody = body
        this.ended = true
        return this
    },
    send(body) {
        this.jsonBody = body
        this.ended = true
        return this
    }
})

/**
 * 流式翻译：chat 的 chunk → Responses 事件。
 *
 * 事件顺序与 OpenAI 一致：
 *   response.created → response.in_progress
 *   [思考] output_item.added(reasoning) → reasoning_summary_text.delta… → done → output_item.done
 *   [正文] output_item.added(message) → content_part.added → output_text.delta… → output_text.done
 *          → content_part.done → output_item.done
 *   [工具] output_item.added(function_call) → function_call_arguments.delta… → done → output_item.done
 *   response.completed（失败时 response.failed）
 */
class StreamTranslator {
    constructor({ model, res }) {
        this.model = model || ''
        this.res = res
        this.responseId = format.newId('resp')
        this.createdAt = Math.floor(Date.now() / 1000)
        this.messageItemId = format.newId('msg')
        this.reasoningItemId = format.newId('rs')

        this.buffer = ''
        this.text = ''
        this.reasoning = ''
        this.usage = null
        this.finishReason = null
        this.failed = false
        this.finished = false

        this.toolCalls = new Map()
        this.toolItems = []
        this.reasoningStarted = false
        this.reasoningDone = false
        this.messageStarted = false
        this.messageDone = false
        this.reasoningIndex = -1
        this.messageIndex = -1
        this.nextIndex = 0
    }

    event(type, payload) {
        this.res.write(format.formatResponsesEvent(type, payload))
    }

    start() {
        const base = { id: this.responseId, model: this.model, createdAt: this.createdAt, status: 'in_progress', output: [] }
        this.event('response.created', { response: format.buildResponseObject(base) })
        this.event('response.in_progress', { response: format.buildResponseObject(base) })
    }

    openReasoning() {
        if (this.reasoningStarted) return
        this.reasoningStarted = true
        this.reasoningIndex = this.nextIndex++
        this.event('response.output_item.added', {
            output_index: this.reasoningIndex,
            item: { id: this.reasoningItemId, type: 'reasoning', summary: [] }
        })
        this.event('response.reasoning_summary_part.added', {
            item_id: this.reasoningItemId,
            output_index: this.reasoningIndex,
            summary_index: 0,
            part: { type: 'summary_text', text: '' }
        })
    }

    closeReasoning() {
        if (!this.reasoningStarted || this.reasoningDone) return
        this.reasoningDone = true
        this.event('response.reasoning_summary_text.done', {
            item_id: this.reasoningItemId,
            output_index: this.reasoningIndex,
            summary_index: 0,
            text: this.reasoning
        })
        this.event('response.reasoning_summary_part.done', {
            item_id: this.reasoningItemId,
            output_index: this.reasoningIndex,
            summary_index: 0,
            part: { type: 'summary_text', text: this.reasoning }
        })
        this.event('response.output_item.done', {
            output_index: this.reasoningIndex,
            item: format.buildReasoningItem({ id: this.reasoningItemId, text: this.reasoning })
        })
    }

    openMessage() {
        if (this.messageStarted) return
        this.closeReasoning()
        this.messageStarted = true
        this.messageIndex = this.nextIndex++
        this.event('response.output_item.added', {
            output_index: this.messageIndex,
            item: { id: this.messageItemId, type: 'message', status: 'in_progress', role: 'assistant', content: [] }
        })
        this.event('response.content_part.added', {
            item_id: this.messageItemId,
            output_index: this.messageIndex,
            content_index: 0,
            part: { type: 'output_text', text: '', annotations: [] }
        })
    }

    closeMessage() {
        if (!this.messageStarted || this.messageDone) return
        this.messageDone = true
        this.event('response.output_text.done', {
            item_id: this.messageItemId,
            output_index: this.messageIndex,
            content_index: 0,
            text: this.text
        })
        this.event('response.content_part.done', {
            item_id: this.messageItemId,
            output_index: this.messageIndex,
            content_index: 0,
            part: { type: 'output_text', text: this.text, annotations: [] }
        })
        this.event('response.output_item.done', {
            output_index: this.messageIndex,
            item: format.buildMessageItem({ id: this.messageItemId, text: this.text })
        })
    }

    /** 工具调用分片：第一次见到某个 index 就发 output_item.added，参数增量照发。 */
    onToolCalls(toolCalls) {
        if (!Array.isArray(toolCalls) || toolCalls.length === 0) return
        // 工具调用是新的 output item：先把思考/正文收尾，保证 item 顺序是线性的
        // （OpenAI 的 output[] 就是按出现顺序排的，不能出现「思考还没 done 就插进一个调用」）
        if (this.toolCalls.size === 0) {
            this.closeReasoning()
            this.closeMessage()
        }
        toolCalls.forEach((call, position) => {
            const index = typeof call.index === 'number' ? call.index : position
            let entry = this.toolCalls.get(index)
            if (!entry) {
                entry = {
                    itemId: format.newId('fc'),
                    callId: call.id || format.newId('call'),
                    name: '',
                    arguments: '',
                    outputIndex: this.nextIndex++
                }
                this.toolCalls.set(index, entry)
                this.event('response.output_item.added', {
                    output_index: entry.outputIndex,
                    item: {
                        id: entry.itemId, type: 'function_call', status: 'in_progress',
                        call_id: entry.callId, name: '', arguments: ''
                    }
                })
            }
            if (call.id && !entry.callId.startsWith('call_')) entry.callId = call.id
            if (call.function?.name) entry.name += call.function.name
            if (call.function?.arguments) {
                entry.arguments += call.function.arguments
                this.event('response.function_call_arguments.delta', {
                    item_id: entry.itemId,
                    output_index: entry.outputIndex,
                    delta: call.function.arguments
                })
            }
        })
    }

    closeToolCalls() {
        for (const [, entry] of [...this.toolCalls.entries()].sort((a, b) => a[0] - b[0])) {
            if (!entry.name) continue
            this.event('response.function_call_arguments.done', {
                item_id: entry.itemId,
                output_index: entry.outputIndex,
                arguments: entry.arguments || '{}'
            })
            const item = format.buildFunctionCallItem({
                id: entry.itemId, callId: entry.callId, name: entry.name, arguments: entry.arguments || '{}'
            })
            this.event('response.output_item.done', { output_index: entry.outputIndex, item })
            this.toolItems.push(item)
        }
    }

    onChatChunk(frame) {
        const data = String(frame || '').trim()
        if (!data.startsWith('data:')) return // 心跳 / 注释帧
        const payload = data.slice(5).trim()
        if (!payload || payload === '[DONE]') return

        const chunk = (() => {
            try {
                return JSON.parse(payload)
            } catch {
                return null
            }
        })()
        if (!chunk) return

        if (chunk.error) {
            this.fail(chunk.error.message || 'upstream error', chunk.error.code || 'upstream_error')
            return
        }

        if (chunk.usage) {
            this.usage = {
                inputTokens: chunk.usage.prompt_tokens ?? chunk.usage.input_tokens ?? 0,
                outputTokens: chunk.usage.completion_tokens ?? chunk.usage.output_tokens ?? 0
            }
        }

        const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : null
        if (!choice) return
        const delta = choice.delta || {}
        if (choice.finish_reason) this.finishReason = choice.finish_reason

        if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
            this.reasoning += delta.reasoning_content
            this.openReasoning()
            this.event('response.reasoning_summary_text.delta', {
                item_id: this.reasoningItemId,
                output_index: this.reasoningIndex,
                summary_index: 0,
                delta: delta.reasoning_content
            })
        }

        if (typeof delta.content === 'string' && delta.content) {
            this.text += delta.content
            this.openMessage()
            this.event('response.output_text.delta', {
                item_id: this.messageItemId,
                output_index: this.messageIndex,
                content_index: 0,
                delta: delta.content
            })
        }

        this.onToolCalls(delta.tool_calls)
    }

    /** chat 控制器写进来的原始文本，可能一次多帧。 */
    push(raw) {
        this.buffer += raw
        let index
        while ((index = this.buffer.indexOf('\n\n')) >= 0) {
            const frame = this.buffer.slice(0, index)
            this.buffer = this.buffer.slice(index + 2)
            this.onChatChunk(frame)
        }
    }

    fail(message, code) {
        if (this.failed || this.finished) return
        this.failed = true
        this.event('response.failed', {
            response: format.buildResponseObject({
                id: this.responseId,
                model: this.model,
                createdAt: this.createdAt,
                status: 'failed',
                output: [],
                error: { code: code || 'upstream_error', message: String(message || 'upstream error') }
            })
        })
    }

    finish() {
        if (this.finished) return
        this.finished = true
        if (this.buffer.trim()) {
            this.onChatChunk(this.buffer)
            this.buffer = ''
        }
        if (this.failed) {
            this.res.end()
            return
        }

        if (this.text) {
            this.openMessage()
            this.closeMessage()
        }
        this.closeReasoning()
        this.closeToolCalls()

        const output = []
        if (this.reasoning) output.push(format.buildReasoningItem({ id: this.reasoningItemId, text: this.reasoning }))
        if (this.text) output.push(format.buildMessageItem({ id: this.messageItemId, text: this.text }))
        output.push(...this.toolItems)

        this.event('response.completed', {
            response: format.buildResponseObject({
                id: this.responseId,
                model: this.model,
                createdAt: this.createdAt,
                status: 'completed',
                output,
                usage: format.buildUsage(this.usage || {})
            })
        })
        this.res.end()

        logger.info(
            `Responses 完成：${this.model} 正文 ${this.text.length} 字 / 思考 ${this.reasoning.length} 字 / 工具 ${this.toolItems.length} 个` +
            `${this.finishReason ? ` / finish=${this.finishReason}` : ''}`,
            'RESPONSES'
        )
    }
}

/** 非流式：把 chat.completion 翻译成 response 对象。 */
const translateChatCompletion = (completion, { model }) => {
    const choice = Array.isArray(completion?.choices) ? completion.choices[0] : null
    const message = choice?.message || {}
    const output = []

    if (typeof message.reasoning_content === 'string' && message.reasoning_content) {
        output.push(format.buildReasoningItem({ text: message.reasoning_content }))
    }
    if (typeof message.content === 'string' && message.content) {
        output.push(format.buildMessageItem({ text: message.content }))
    }
    if (Array.isArray(message.tool_calls)) {
        for (const call of message.tool_calls) {
            output.push(format.buildFunctionCallItem({
                callId: call.id,
                name: call.function?.name || '',
                arguments: call.function?.arguments || '{}'
            }))
        }
    }

    const usage = completion?.usage || {}
    return format.buildResponseObject({
        model,
        status: 'completed',
        output,
        usage: format.buildUsage({
            inputTokens: usage.prompt_tokens ?? usage.input_tokens ?? 0,
            outputTokens: usage.completion_tokens ?? usage.output_tokens ?? 0
        })
    })
}

/**
 * POST /v1/responses
 * 请求体已由 `normalizeResponsesRequest` + `processRequestBody` 处理成内部 chat 请求。
 */
const handleResponses = async (req, res) => {
    const meta = req.responses_meta || {}
    const model = meta.model || req.body.model
    const stream = meta.stream === true

    if (stream) {
        const translator = new StreamTranslator({ model, res })
        const capture = createCaptureResponse((chunk) => translator.push(chunk))

        res.status(200)
        for (const [key, value] of Object.entries(SSE_HEADERS)) res.set(key, value)
        res.flushHeaders?.()
        translator.start()

        try {
            await handleChatCompletion(req, capture)
        } catch (error) {
            logger.error(`Responses 流式处理异常: ${error && error.message ? error.message : error}`, 'RESPONSES')
            translator.fail(error?.publicMessage || 'upstream stream interrupted')
        }

        if (capture.jsonBody) {
            // chat 控制器在流式下仍可能用 json 报错（比如拿不到账号）
            translator.fail(capture.jsonBody.error?.message || capture.jsonBody.error || 'request failed', 'upstream_error')
        }
        translator.finish()
        return
    }

    const capture = createCaptureResponse(() => { })
    try {
        await handleChatCompletion(req, capture)
    } catch (error) {
        logger.error('Responses 处理失败', 'RESPONSES', '', error)
        return res.status(500).json(format.buildErrorBody(
            error?.publicMessage || error?.message || '请求失败',
            { type: 'server_error', code: 'internal_error' }
        ))
    }

    if (capture.jsonBody && capture.jsonBody.error) {
        const message = capture.jsonBody.error?.message || capture.jsonBody.error
        return res.status(capture.statusCode >= 400 ? capture.statusCode : 502).json(
            format.buildErrorBody(message, { type: 'upstream_error', code: 'upstream_error' })
        )
    }
    if (!capture.jsonBody) {
        return res.status(502).json(format.buildErrorBody('上游没有返回结果', { type: 'upstream_error', code: 'empty_response' }))
    }

    res.status(200).json(translateChatCompletion(capture.jsonBody, { model }))
}

module.exports = { handleResponses, StreamTranslator, translateChatCompletion, createCaptureResponse }
