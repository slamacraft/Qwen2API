# TODO（测试会话优化）

> 完成一项就把 `[ ]` 改成 `[x]`，并补一行「怎么验证的」。

## 1. 测试会话能获取历史测试记录（多轮交叉排查）

- [x] 需求：刷新/重开页面后能看到之前的测试记录，并能在一轮轮测试之间交叉比对（而不是只能看到最后一段）。
- 现状（改前）：`public/src/views/chat.vue` 只把最近 50 条消息存在 `localStorage["chat.history"]` 的**单一槽位**；换话题或清空就把上一段测试记录冲掉，也没法回看更早的几次测试。
- 做法：改成**多会话历史**（`localStorage["chat.sessions"]`，最近 20 段 / 每段 100 条消息）。
  - 顶栏新增「历史记录 N」和「新对话」；「清空对话」只清空当前这段，其他记录保留。
  - 历史面板列出每段的标题（第一条用户消息）、更新时间、消息数；点一条即切回该段，可单条删除；当前段有勾选标记。
  - 消息区顶部显示当前会话标题 + 条数，切来切去不会搞混在测哪段。
  - 旧版 `chat.history` 首次启动时自动迁移成第一段会话，不丢老记录。
- 验证：真机（无头 Chrome）发两段对话 → 刷新页面记录仍在（正文 1029 字 + 思考块都恢复）；历史面板列出 2 段，点较早那段能切回（截图 `.tmp/chat-history.png`、`.tmp/chat-switched.png`）。

## 2. 测试会话显示思考内容（reasoning_content）

- [x] 需求：模型返回的思考过程要能看到（折叠块），而不是被丢掉。
- 现状（改前）：`streamRound` 只累加 `delta.content`，代理返回的 `delta.reasoning_content` 被完全忽略。
- 做法：流式时累积 `delta.reasoning_content`，渲染成可折叠的「思考过程 · N 字」块：
  - 思考阶段自动展开并显示「思考中…」；正文一开始自动收起（用户手动点过就不再自动收起）。
  - 思考内容一并写进历史会话，回看时默认收起。
- 验证：真机发问 → 7.8 秒出现思考块（74 字），完整回答后块收起为「思考过程 194 字」，点开可见全文（截图 `.tmp/chat-reasoning.png`）。

## 3. 测试会话流式显示

- [x] 需求：回答要一个字一个字出来，而不是等整段返回后一次性出现。
- 根因（改前）：不是代理没流式（实测 SSE 分 25 个 chunk 到达），而是页面**写错了响应式对象**——`state.messages.push(assistant)` 之后继续改那个原始对象，Vue 的代理收不到变更通知，于是整段内容要等到 `generating` 翻转（结束时）才渲染一次；顺带 `isStreamingMessage` 用 `===` 比较原始对象和代理，光标/占位也永远不显示。
- 做法：push 之后取回响应式代理再交给 `streamRound` 增量写入；`isStreamingMessage` 改成按 `id` 比较。
- 验证：真机 100ms 采样一次，正文长度出现 **32 个不同取值**（增量渲染），思考块 7.8s 出现，正文 29.7s 开始、结束 1029 字。

## 4. 国际化开关挪到右上角（下拉 + 美化）

- [x] 需求：侧边栏底部那组语言按钮在**菜单收起时会被顶出侧边栏**；把它挪到页面右上角，做成下拉选择并美化。
- 现状：`public/src/components/LangSwitcher.vue` 是三段式按钮组（EN/RU/ZH），放在 `AdminLayout.vue` 侧边栏底部、和退出按钮同一行；收起后侧栏只有 68px，按钮组撑不开。
- 做法：
  - `LangSwitcher.vue` 重写成下拉：地球图标 + 当前语言母语名 + 箭头；菜单列出 中文 / English / Русский，当前项打勾高亮；支持点外部关闭、Esc 关闭并回焦、↑/↓/Home/End 键盘导航、`role=menu` / `menuitemradio` + `aria-checked`。
  - `AdminLayout.vue`：侧栏底部删掉语言按钮组（只留「收起侧栏」「退出登录」两行），header 右侧 GitHub 左边放语言下拉；窄屏也一直可见。
  - `Icon.vue` 新增 `globe`；三份 `shell.*.json` 各加 `shell.language`。
- 验证：真机 1440/390 两种宽度——header 按钮显示「中文」、菜单三项且 checked 正确；选 English 后 `locale=en`、导航变英文、刷新后保持，切回中文正常；侧栏收起 68px 时 `aside.scrollWidth === clientWidth`、aside 内**零个**子元素越界、`documentElement` 无横向滚动；390px 下语言按钮仍可见（GitHub 按原设计隐藏）。

## 5. 测试会话改成正式的 Agent 对话窗口（左侧会话列表）

- [x] 需求：像 Qwen 官网那样——左侧可选会话 / 新建会话，右侧是对话窗口，让本项目可以直接当聊天工具用。
- 做法：
  - 新增 `public/src/components/chat/SessionList.vue`：顶部「新对话」，会话按 今天 / 近 7 天 / 更早 分组，每项显示标题 + 时间 + 条数，当前项高亮，hover 出删除按钮，底部显示「共 N 段 · 仅保存在本机浏览器」。
  - `chat.vue` 改成两栏：左 240px 会话侧栏（桌面常驻）+ 右侧对话区（工具栏 / 消息 / 输入）；窄屏侧栏收进抽屉（工具栏左侧菜单按钮打开）；去掉原来右上角的「历史记录」弹窗。
  - 消息区从「限高 560px」改成占满剩余高度内部滚动，更像正式对话窗口；顶部保留会话标题 + 条数，窄屏没有侧栏时靠它确认在测哪段。
  - 三语补 `groupToday / groupWeek / groupEarlier / sessions / sessionsStoredLocally` 等 key（各 53 个，三份一致）。
- 验证：真机——侧栏 240px、发消息后自动生成标题进列表；「新对话」清空右侧并新增一项；点列表里较早那段能切回（标题栏 + 思考块 + 正文都恢复）；hover 删除 → 确认弹窗 → 删除后剩 1 段；390px 下侧栏隐藏、菜单按钮打开抽屉、无横向溢出；控制台 0 error。

## 6. 布局按 Qwen 官网重做（去掉卡片缝隙）- [x] 需求：第一版太丑——中间留缝太宽、到处是卡片边框，学 Qwen 官网那种通栏布局。
- 做法：
  - 去掉 `.page` 内边距和所有卡片框：会话侧栏（248px，`bg-canvas`）**贴边**接对话区（`bg-surface`），中间不再有 gap / 圆角卡片。
  - 消息区通栏滚动，内容限宽 `max-w-[820px]` 居中；助手消息**不套气泡**（直接排版），用户消息右对齐浅灰气泡；复制按钮改成 hover 才出现。
  - 输入框改成 Qwen 那种悬浮圆角输入条（`rounded-[26px]` + 阴影，发送键在条内右侧圆形按钮），不再是一整块卡片。
  - 顶栏：模型名从原生 `<select>`（箭头会飘到很远的右边）换成自绘下拉（按钮 + 菜单，当前项打勾），右侧只留工具开关和清空。
  - 标签页标题跟着当前会话走（开多个标签做交叉排查时能分清）。
- 验证：真机 1440/390 截图（`.tmp/look-chat.png`、`.tmp/look-sessions.png`、`.tmp/look-mobile.png`）；侧栏右边缘 x=488、正文列从 x=554 开始（居中留白 66px，不再是缝）；流式/思考块/会话切换/抽屉均正常，控制台 0 error，390px 无横向溢出。



## 7. 支持 OpenAI Responses API（`/v1/responses`）

- [x] 需求：支持 OpenAI 新版解耦格式 `/v1/responses`（`input` / `instructions` / `output` / `response.*` 事件流），并把改动同步进 README。
- 做法：
  - `src/utils/responses-format.js`（纯函数）：`input` 归一化（字符串 / message 数组 / `input_text` / `function_call` + `function_call_output`）、`instructions`→system、`developer`→system、`tools` 转 chat 形状（只收 `type:"function"`）、`tool_choice`、`max_output_tokens`→`max_tokens`、`reasoning.effort`→思考开关；以及 `response` 对象 / output item / usage / SSE 事件 / 错误体的构造。
  - `src/routes/responses.js`：`POST /v1/responses`，先 `normalizeResponsesBody` 转成 chat 请求体，再复用 `processRequestBody`（模型映射、工具提示词、思考、多模态解析都在里面）。
  - `src/controllers/responses.js`：**不重写上游链路**——把请求交给现有 `handleChatCompletion`，用一个「假 res」收下它写出的 OpenAI chunk，再翻译成 Responses 的 item / 事件。这样 Agent 回合门禁、文本协议工具调用的流式解析、会话复用、换号/WAF 重试全部自动继承。
  - `src/middlewares/authorization.js`：`/v1/responses` 加入重端点限流名单。
- 实测：
  - 非流式返回 `{id:"resp_…", object:"response", status:"completed", output:[reasoning, message], usage:{input_tokens:1236, output_tokens:84, total_tokens:1320}}`；
  - 流式事件顺序与 OpenAI 一致（created → in_progress → reasoning item → message item → completed，无 `[DONE]`）；
  - 带 `tools` 时返回 `function_call` item + `function_call_arguments.delta/done`；下一轮用 `function_call` + `function_call_output` 回填能正常续答；
  - 空 `input` / 缺 `model` → 400 OpenAI 形状错误体。
- 测试：`tests/responses-api.test.js`（18 个用例：请求归一化、item/usage 形状、事件顺序、工具调用、错误、路由接线）。
- 文档：`README.md` / `README-en.md` / `README-ru.md` 三份都新增「OpenAI Responses API」章节，并更新特性列表与 `MODEL_MAP` 作用范围说明。

## 8. 思考过程流式下发 + 工具调用报错优化

- [x] 1) 思考过程不是流式的、要等对话完成才显示
  - 根因：工具轮（Agent 运行时）的实时思考通道 `onReasoningDelta` 被 `enableThinking &&` 挡住了。`enable_thinking` 只表示「我们有没有主动要求思考」，而 qwen3.7-plus 这类模型默认就会返回 `reasoning_content`；于是思考被憋到轮末随最终交付一起发出。非工具轮没有这个门（`writeReasoningDelta` 无条件写），所以只有开了演示工具时才明显。
  - 修复：`src/controllers/chat.js` 里去掉 `enableThinking &&` 条件（保留 `legacyReasoningInContent` 保护，那个模式下思考并进正文，不能重复发）。
  - 回归防护：`tests/agent-protocol.test.js` 新增「工具轮的思考内容实时下发，不依赖 enable_thinking 开关」（把条件绑回去就会红）。
- [x] 2) 工具调用报错「上游连续返回残缺、非法或不存在的工具调用」
  - 根因：这是 Agent 门禁的**策略**结果，不是协议坏了。OpenAI 面默认 `AGENT_TURN_ALLOW_PROSE_WITH_TOOLS=false`，要求工具调用**单独成轮**；Qwen 经常先说一句「我看一下」再调用，于是被判 `prose_with_tools` → 重试 3 次 → 报错。Anthropic 面本来就允许这种形态，所以两条路径行为不一致。
  - 优化：把这条错误从和 `tool_error` 共用的一句话改成可执行的说明——直接告诉你把 `AGENT_TURN_ALLOW_PROSE_WITH_TOOLS=true` 打开即可（`src/utils/agent-turn-gate.js`）。协议真坏（`tool_error`）仍保留原文案。
  - 规避：客户端能处理「正文 + tool_calls 同一条消息」时（OpenAI SDK / 本项目的测试会话都行），设置 `AGENT_TURN_ALLOW_PROSE_WITH_TOOLS=true` 即可；默认严格模式保留给需要干净工具轮的 agentic 客户端。
  - 说明：本机两个账号当日额度已用尽（RateLimited 冷却），修复后的**真机**复测没做，恢复额度后按 `docs/dev-state.md` 的步骤复验。

## 9. 首次部署的两个坑（2026-10-23）

- [x] 1) `bun run start` 后管理面板「添加账号」报「保存失败」
  - 根因：`DATA_SAVE_MODE` 默认 `none`（纯环境变量模式），`data-persistence.saveAccount` 直接返回 false，前端只看到一句「保存失败」，日志是 `环境变量模式不支持保存账户数据` + `持久化失败，已回滚内存数据`，用户完全不知道该改什么。
  - 修复：启动时若 `none` 且没配 `ACCOUNTS` 就打一条明确告警；`/setAccount`、`/setAccounts`、`/deleteAccount`、`/updateAccountProxy` 在 `none` 模式下直接返回 400，错误体写明「把 .env 里的 DATA_SAVE_MODE 改成 file 后重启；或用 ACCOUNTS 环境变量」。
  - 例外：`/setAccountDisabled` **不拦** —— 它在 `none` 模式下本来就是「只改内存」的语义（`account.js` 有明确分支）。
  - 测试：`tests/accounts-env-mode.test.js`（5 个用例，含「file 模式不再拦」和「禁用/启用不被拦」）。
- [x] 2) README 的部署章节从「一键脚本」改成「一步一步教」
  - 原因：脚本仍要求用户改 `.env`（API_KEY、DATA_SAVE_MODE、CHROME_PATH 等），一次性脚本反而掩盖了这些必改项。
  - 现在按 7 步走：装 Bun → 取代码 → 装依赖+构建前端 → **写 .env（表格列出必须改的两项）** → 装 Chromium → 启动并验证（health / models / 一条改完即用的冒烟命令）→ 配 systemd；另有「更新」「停止/重启/日志」「数据与备份」「常见问题」四节，三语同步。
