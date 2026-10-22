// 会话复用状态机：决定这一轮是新建会话、续用、还是从上一轮的 user 消息重新分叉。
// 纯逻辑测试，不碰网络。
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildConversationKey,
  hashClientHistory,
  createConversationSessions,
  planTurn,
  recordTurn
} = require('../src/utils/conversation-session.js')

const user = (content) => ({ role: 'user', content })
const assistant = (content) => ({ role: 'assistant', content })
const tool = (content, id) => ({ role: 'tool', content, tool_call_id: id })

test('la clave de conversacion es estable y distingue conversaciones', () => {
  const base = { model: 'qwen3.8-max', system: 'sys', tools: [], firstMessage: user('hola') }
  assert.equal(buildConversationKey(base), buildConversationKey({ ...base }))
  assert.notEqual(buildConversationKey(base), buildConversationKey({ ...base, firstMessage: user('otra') }))
  assert.notEqual(buildConversationKey(base), buildConversationKey({ ...base, model: 'qwen3.7-plus' }))
  assert.notEqual(buildConversationKey(base), buildConversationKey({ ...base, tools: [{ name: 'x' }] }))
})

test('el hash del historial incluye tool_call_id y respeta el corte', () => {
  const history = [user('a'), tool('resultado', 'call-1')]
  assert.equal(hashClientHistory(history), hashClientHistory([...history]))
  assert.notEqual(hashClientHistory(history), hashClientHistory([user('a'), tool('resultado', 'call-2')]))
  assert.equal(hashClientHistory(history, 1), hashClientHistory([user('a')]))
})

test('sin sesion previa: modo new', () => {
  const plan = planTurn({ session: null, messages: [user('a')], accountEmail: 'a@x' })
  assert.equal(plan.mode, 'new')
  assert.equal(plan.reason, 'no-session')
})

test('cambio de cuenta: modo new (no se puede continuar el chat de otra cuenta)', () => {
  const plan = planTurn({
    session: { chatId: 'chat-1', accountEmail: 'a@x', syncedCount: 1, syncedHash: hashClientHistory([user('a')]) },
    messages: [user('a'), tool('r', 'c1')],
    accountEmail: 'b@x'
  })
  assert.equal(plan.mode, 'new')
  assert.equal(plan.reason, 'account-changed')
})

test('prefijo intacto: modo continue con el delta correcto', () => {
  const first = [user('a')]
  const session = {
    chatId: 'chat-1',
    accountEmail: 'a@x',
    syncedCount: 1,
    syncedHash: hashClientHistory(first),
    lastParentId: 'assistant-1',
    badTurn: false
  }
  const plan = planTurn({ session, messages: [...first, tool('r', 'c1')], accountEmail: 'a@x' })
  assert.equal(plan.mode, 'continue')
  assert.equal(plan.chatId, 'chat-1')
  assert.equal(plan.parentId, 'assistant-1')
  assert.equal(plan.deltaStart, 1)
})

test('cliente edito el historial: modo new', () => {
  const session = {
    chatId: 'chat-1',
    accountEmail: 'a@x',
    syncedCount: 1,
    syncedHash: hashClientHistory([user('original')]),
    badTurn: false
  }
  const plan = planTurn({ session, messages: [user('editado'), tool('r', 'c1')], accountEmail: 'a@x' })
  assert.equal(plan.mode, 'new')
  assert.equal(plan.reason, 'history-diverged')
})

test('historial mas corto que lo ya sincronizado: modo new', () => {
  const session = {
    chatId: 'chat-1',
    accountEmail: 'a@x',
    syncedCount: 3,
    syncedHash: hashClientHistory([user('a'), assistant('b'), user('c')]),
    badTurn: false
  }
  const plan = planTurn({ session, messages: [user('a')], accountEmail: 'a@x' })
  assert.equal(plan.mode, 'new')
  assert.equal(plan.reason, 'history-shortened')
})

test('turno anterior rechazado: modo branch desde su user message', () => {
  const messages = [user('a'), assistant('b')]
  const session = {
    chatId: 'chat-1',
    accountEmail: 'a@x',
    syncedCount: 1,
    syncedHash: hashClientHistory([user('a')]),
    lastUserMessageId: 'user-msg-9',
    lastParentId: 'assistant-bad',
    turnStartCount: 1,
    badTurn: true
  }
  const plan = planTurn({ session, messages, accountEmail: 'a@x' })
  assert.equal(plan.mode, 'branch')
  assert.equal(plan.parentId, 'user-msg-9', '分叉点是那条 user 消息，不是半截的 assistant')
  assert.equal(plan.deltaStart, 1)
})

test('recordTurn guarda el prefijo ya sincronizado y el parent de la proxima vez', () => {
  const messages = [user('a'), tool('r', 'c1')]
  const state = recordTurn({
    chatId: 'chat-1',
    accountEmail: 'a@x',
    messages,
    deltaStart: 1,
    userMessageId: 'user-msg-2',
    assistantMessageId: 'assistant-2',
    badTurn: false
  })
  assert.equal(state.syncedCount, 2)
  assert.equal(state.syncedHash, hashClientHistory(messages))
  assert.equal(state.lastParentId, 'assistant-2')
  assert.equal(state.lastUserMessageId, 'user-msg-2')
  assert.equal(state.turnStartCount, 1)
  assert.equal(state.badTurn, false)

  // 下一轮（客户端又追加了新的 tool 结果）应当 continue
  const plan = planTurn({ session: state, messages: [...messages, tool('r2', 'c2')], accountEmail: 'a@x' })
  assert.equal(plan.mode, 'continue')
  assert.equal(plan.parentId, 'assistant-2')
  assert.equal(plan.deltaStart, 2)
})

test('el cache LRU expira y desaloja', () => {
  let now = 1000
  const sessions = createConversationSessions({ ttlMs: 100, maxEntries: 2, now: () => now })
  sessions.set('k1', { chatId: 'c1' })
  sessions.set('k2', { chatId: 'c2' })
  sessions.set('k3', { chatId: 'c3' })
  assert.equal(sessions.size, 2)
  assert.equal(sessions.get('k1'), null, 'el mas viejo sale')

  now += 101
  assert.equal(sessions.get('k3'), null, 'expira por TTL')
})
