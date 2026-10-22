// OpenAI Responses API（/v1/responses）。
//
// 为什么需要这组测试：Responses 和 Chat Completions 的**形状完全不同**（input 是 item
// 数组、output 是 item 数组、流式是一串 response.* 事件），而底下复用的还是同一条 chat
// 链路。翻译层写错了不会有异常：客户端只是收到一个「看起来像 Responses、但事件顺序/字段
// 不对」的流，SDK 解析失败或静默丢内容。所以这里把纯逻辑和事件序列钉死。

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
    normalizeResponsesRequest,
    normalizeInput,
    normalizeTool,
    normalizeToolChoice,
    buildUsage,
    buildMessageItem,
    buildReasoningItem,
    buildFunctionCallItem,
    buildResponseObject,
    formatResponsesEvent,
    buildErrorBody
} = require('../src/utils/responses-format.js')
const { StreamTranslator, translateChatCompletion } = require('../src/controllers/responses.js')

// ---------------------------------------------------------------------------
// 1) 请求归一化：input / instructions / tools / reasoning
// ---------------------------------------------------------------------------

test('input 是字符串时变成一条 user 消息', () => {
    const { chatBody } = normalizeResponsesRequest({ model: 'qwen3.7-plus', input: '你好' })
    assert.deepEqual(chatBody.messages, [{ role: 'user', content: '你好' }])
    assert.equal(chatBody.model, 'qwen3.7-plus')
    assert.equal(chatBody.stream, false, '不传 stream 时默认非流式')
})

test('instructions 变成最前面的 system 消息，developer 角色也映射成 system', () => {
    const { chatBody } = normalizeResponsesRequest({
        model: 'm',
        instructions: '你是简洁的助手',
        input: [
            { role: 'developer', content: '补充规则' },
            { role: 'user', content: '问题' }
        ]
    })
    assert.deepEqual(chatBody.messages.map(m => m.role), ['system', 'system', 'user'])
    assert.equal(chatBody.messages[0].content, '你是简洁的助手')
})

test('input 数组里的 input_text / output_text 段被压成文本', () => {
    const messages = normalizeInput([
        { role: 'user', content: [{ type: 'input_text', text: '前半' }, { type: 'input_text', text: '后半' }] },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '答' }] },
        { type: 'input_text', text: '独立的输入段' }
    ])
    assert.deepEqual(messages, [
        { role: 'user', content: '前半后半' },
        { role: 'assistant', content: '答' },
        { role: 'user', content: '独立的输入段' }
    ])
})

test('function_call + function_call_output 能拼回 chat 的 tool_calls / tool 消息', () => {
    const messages = normalizeInput([
        { role: 'user', content: '现在几点' },
        { type: 'function_call', call_id: 'call_1', name: 'get_time', arguments: '{}' },
        { type: 'function_call_output', call_id: 'call_1', output: '{"time":"17:30"}' }
    ])
    assert.equal(messages[1].role, 'assistant')
    assert.equal(messages[1].tool_calls[0].id, 'call_1')
    assert.equal(messages[1].tool_calls[0].function.name, 'get_time')
    assert.deepEqual(messages[2], { role: 'tool', tool_call_id: 'call_1', content: '{"time":"17:30"}' })
})

test('连续两个 function_call 归到同一条 assistant 上', () => {
    const messages = normalizeInput([
        { role: 'user', content: '查两个' },
        { type: 'function_call', call_id: 'call_1', name: 'a', arguments: '{}' },
        { type: 'function_call', call_id: 'call_2', name: 'b', arguments: '{}' }
    ])
    assert.equal(messages.length, 2)
    assert.deepEqual(messages[1].tool_calls.map(c => c.function.name), ['a', 'b'])
})

test('tools 从 Responses 形状转成 chat 形状，非 function 工具忽略', () => {
    assert.deepEqual(normalizeTool({
        type: 'function', name: 'get_time', description: '返回时间',
        parameters: { type: 'object', properties: {} }
    }), {
        type: 'function',
        function: { name: 'get_time', description: '返回时间', parameters: { type: 'object', properties: {} } }
    })
    assert.equal(normalizeTool({ type: 'web_search' }), null)
    assert.equal(normalizeTool({ type: 'function', name: '' }), null)

    const { chatBody } = normalizeResponsesRequest({
        model: 'm', input: 'hi',
        tools: [
            { type: 'function', name: 'get_time', parameters: { type: 'object', properties: {} } },
            { type: 'web_search' }
        ]
    })
    assert.equal(chatBody.tools.length, 1)
    assert.equal(chatBody.tools[0].function.name, 'get_time')
})

test('tool_choice：字符串原样，{type:function,name} 包成 chat 形状', () => {
    assert.equal(normalizeToolChoice('auto'), 'auto')
    assert.equal(normalizeToolChoice('required'), 'required')
    assert.deepEqual(normalizeToolChoice({ type: 'function', name: 'get_time' }), {
        type: 'function', function: { name: 'get_time' }
    })
    assert.equal(normalizeToolChoice(undefined), undefined)
})

test('max_output_tokens / temperature / top_p / user 透传，reasoning.effort 控制思考开关', () => {
    const { chatBody } = normalizeResponsesRequest({
        model: 'm', input: 'hi', max_output_tokens: 256, temperature: 0.3, top_p: 0.9, user: 'u-1'
    })
    assert.equal(chatBody.max_tokens, 256)
    assert.equal(chatBody.temperature, 0.3)
    assert.equal(chatBody.top_p, 0.9)
    assert.equal(chatBody.user, 'u-1')

    assert.equal(normalizeResponsesRequest({ model: 'm', input: 'x', reasoning: { effort: 'none' } }).chatBody.enable_thinking, false)
    assert.equal(normalizeResponsesRequest({ model: 'm', input: 'x', reasoning: { effort: 'minimal' } }).chatBody.enable_thinking, false)
    assert.equal(normalizeResponsesRequest({ model: 'm', input: 'x', reasoning: { effort: 'medium' } }).chatBody.enable_thinking, true)
    assert.equal('enable_thinking' in normalizeResponsesRequest({ model: 'm', input: 'x' }).chatBody, false,
        '没给 reasoning 时不要替用户做决定')
})

// ---------------------------------------------------------------------------
// 2) 响应形状：item / usage / 事件格式
// ---------------------------------------------------------------------------

test('usage 按 Responses 的字段名输出，total 是两者之和', () => {
    assert.deepEqual(buildUsage({ inputTokens: 1236, outputTokens: 84 }), {
        input_tokens: 1236,
        output_tokens: 84,
        total_tokens: 1320,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 }
    })
    assert.equal(buildUsage().total_tokens, 0)
    assert.equal(buildUsage({ inputTokens: -5, outputTokens: 'x' }).input_tokens, 0)
})

test('output item 形状：message / reasoning / function_call', () => {
    const message = buildMessageItem({ id: 'msg_1', text: '你好' })
    assert.equal(message.type, 'message')
    assert.equal(message.role, 'assistant')
    assert.deepEqual(message.content, [{ type: 'output_text', text: '你好', annotations: [] }])

    const reasoning = buildReasoningItem({ id: 'rs_1', text: '想一想' })
    assert.deepEqual(reasoning.summary, [{ type: 'summary_text', text: '想一想' }])

    const call = buildFunctionCallItem({ id: 'fc_1', callId: 'call_1', name: 'get_time', arguments: '{}' })
    assert.equal(call.type, 'function_call')
    assert.equal(call.call_id, 'call_1')
    assert.equal(call.arguments, '{}')
})

test('response 对象顶层字段齐全（SDK 会按 object 字段判断类型）', () => {
    const response = buildResponseObject({ id: 'resp_1', model: 'm', createdAt: 1700000000 })
    assert.equal(response.object, 'response')
    assert.equal(response.status, 'completed')
    assert.equal(response.error, null)
    assert.equal(response.incomplete_details, null)
    assert.ok(Array.isArray(response.output))
})

test('SSE 事件：event 行 + data 里的 type 一致', () => {
    const frame = formatResponsesEvent('response.output_text.delta', { delta: '你' })
    assert.match(frame, /^event: response\.output_text\.delta\n/)
    const dataLine = frame.split('\n').find(line => line.startsWith('data: '))
    const payload = JSON.parse(dataLine.slice(6))
    assert.equal(payload.type, 'response.output_text.delta')
    assert.equal(payload.delta, '你')
    assert.ok(frame.endsWith('\n\n'))
})

test('错误体是 OpenAI 形状，不是 chat 的字符串 error', () => {
    const body = buildErrorBody('input 不能为空', { param: 'input', code: 'invalid_input' })
    assert.equal(body.error.message, 'input 不能为空')
    assert.equal(body.error.param, 'input')
    assert.equal(body.error.code, 'invalid_input')
})

// ---------------------------------------------------------------------------
// 3) 流式翻译：chat chunk → Responses 事件（顺序是契约的一部分）
// ---------------------------------------------------------------------------

const chatChunk = (delta, finish = null) => `data: ${JSON.stringify({
    id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 1,
    choices: [{ index: 0, delta, finish_reason: finish }]
})}\n\n`

const runTranslator = (frames) => {
    const events = []
    const fakeRes = { write: (text) => events.push(text), end: () => events.push('[END]') }
    const translator = new StreamTranslator({ model: 'qwen3.7-plus', res: fakeRes })
    translator.start()
    for (const frame of frames) translator.push(frame)
    translator.finish()
    const parsed = events
        .filter((e) => e !== '[END]')
        .map((raw) => {
            const dataLine = raw.split('\n').find(line => line.startsWith('data: '))
            return JSON.parse(dataLine.slice(6))
        })
    return { events, parsed, ended: events[events.length - 1] === '[END]' }
}

test('流式：思考 → 正文 → 完成，事件顺序与 OpenAI 一致', () => {
    const { parsed, ended } = runTranslator([
        chatChunk({ reasoning_content: '先想一下' }),
        chatChunk({ content: '你' }),
        chatChunk({ content: '好' }),
        chatChunk({}, 'stop'),
        `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } })}\n\n`,
        'data: [DONE]\n\n'
    ])
    assert.deepEqual(parsed.map(e => e.type), [
        'response.created',
        'response.in_progress',
        'response.output_item.added',        // reasoning
        'response.reasoning_summary_part.added',
        'response.reasoning_summary_text.delta',
        // 正文第一次出现时先把思考 item 收尾，再开 message item
        'response.reasoning_summary_text.done',
        'response.reasoning_summary_part.done',
        'response.output_item.done',         // reasoning
        'response.output_item.added',        // message
        'response.content_part.added',
        'response.output_text.delta',
        'response.output_text.delta',
        'response.output_text.done',
        'response.content_part.done',
        'response.output_item.done',         // message
        'response.completed'
    ])
    assert.ok(ended, '最后要 res.end()')

    const completed = parsed.find(e => e.type === 'response.completed')
    assert.equal(completed.response.status, 'completed')
    assert.deepEqual(completed.response.output.map(i => i.type), ['reasoning', 'message'])
    assert.equal(completed.response.output[1].content[0].text, '你好')
    assert.equal(completed.response.usage.total_tokens, 15)
    assert.equal(parsed.filter(e => e.type === 'response.output_text.delta').map(e => e.delta).join(''), '你好')
})

test('流式：工具调用生成 function_call item，且不再产出正文 item', () => {
    const { parsed } = runTranslator([
        chatChunk({ reasoning_content: '要调工具' }),
        chatChunk({
            tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_time', arguments: '{}' } }]
        }),
        chatChunk({}, 'tool_calls'),
        'data: [DONE]\n\n'
    ])
    const types = parsed.map(e => e.type)
    assert.ok(types.includes('response.function_call_arguments.delta'))
    assert.ok(types.includes('response.function_call_arguments.done'))

    const completed = parsed.find(e => e.type === 'response.completed')
    const call = completed.response.output.find(item => item.type === 'function_call')
    assert.ok(call, '工具调用要出现在 output 里')
    assert.equal(call.name, 'get_time')
    assert.equal(call.call_id, 'call_1')
    assert.ok(!completed.response.output.some(item => item.type === 'message'), '协议文本不能变成正文')
})

test('流式：上游报错时以 response.failed 结束，且不再发 completed', () => {
    const { parsed } = runTranslator([
        chatChunk({ content: '部分' }),
        `data: ${JSON.stringify({ error: { message: '上游炸了', code: 'upstream_error' } })}\n\n`
    ])
    const types = parsed.map(e => e.type)
    assert.ok(types.includes('response.failed'))
    assert.ok(!types.includes('response.completed'))
    const failed = parsed.find(e => e.type === 'response.failed')
    assert.equal(failed.response.status, 'failed')
    assert.equal(failed.response.error.message, '上游炸了')
})

// ---------------------------------------------------------------------------
// 4) 非流式翻译 + 路由接线
// ---------------------------------------------------------------------------

test('非流式：chat.completion → response 对象（思考/正文/工具都映射）', () => {
    const response = translateChatCompletion({
        choices: [{
            message: {
                content: '你好',
                reasoning_content: '想一下',
                tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_time', arguments: '{}' } }]
            }
        }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
    }, { model: 'qwen3.7-plus' })

    assert.equal(response.object, 'response')
    assert.equal(response.model, 'qwen3.7-plus')
    assert.deepEqual(response.output.map(i => i.type), ['reasoning', 'message', 'function_call'])
    assert.equal(response.usage.input_tokens, 100)
    assert.equal(response.usage.output_tokens, 20)
})

test('路由接线：/v1/responses 已挂载，并进入重端点限流名单', () => {
    const routeSource = fs.readFileSync(path.join(__dirname, '../src/routes/responses.js'), 'utf8')
    assert.match(routeSource, /router\.post\('\/v1\/responses'/)
    assert.match(routeSource, /normalizeResponsesBody/)
    assert.match(routeSource, /processRequestBody/, '要复用 chat 的请求体处理，不要另写一份')

    const serverSource = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8')
    assert.match(serverSource, /responsesRouter/, 'server.js 必须挂载 responses 路由')

    const authSource = fs.readFileSync(path.join(__dirname, '../src/middlewares/authorization.js'), 'utf8')
    assert.match(authSource, /'\/v1\/responses'/, '重端点限流名单要包含 /v1/responses')
})
