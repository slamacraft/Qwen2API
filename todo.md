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

## 10. 服务器上「headless Chrome 提前退出（code 1）」

- 现象：Linux 服务器自动生成会话失败，日志只有 `headless Chrome 提前退出（code 1）`，没有任何细节。
- 根因：采集脚本 `launchHeadless` 用 `stdio: 'ignore'` 起 Chrome，把 Chrome 自己的 stderr（缺 .so、root 沙箱、snap 包装器）全丢了；只报退出码等于没报。
- 修复（`scripts/harvest-browser-profile.mjs`）：
  - 捕获 Chrome 的 stderr（保留最后 4KB），失败时把关键行拼进错误信息；
  - root 运行（`process.getuid() === 0`）或 `CHROME_NO_SANDBOX=1` 时自动加 `--no-sandbox --disable-setuid-sandbox`；
  - 恒定加 `--disable-dev-shm-usage`（小内存 VPS / 容器的 /dev/shm 只有 64MB 会直接崩）；
  - spawn 失败（ENOENT 等）单独报「启动 Chrome 失败（code）」；
  - 错误里直接给出三条排查建议（装库 / 关沙箱 / snap 包装器改 CHROME_PATH）。
- 验证：用 `CHROME_PATH=node.exe` 模拟起不来，错误里带出真实 stderr（`bad option: --disable-dev-shm-usage`）；真实 Chrome 采集仍然 3 秒完成、21 条 cookie、token 900s。
- README 三语 FAQ 各加一行（现象 + 三条处理办法）。

## 11. 上游「今日已达上限」通知 → 账户标记额度耗尽并移出轮换池，次日 09:00 恢复

- [x] 需求：出现「本账户今天这个模型额度用完了」的通知时，把该账户从**可用**改成**已达上限**、立刻踢出轮换池，第二天 09:00 之后自动恢复可用；客户端不要拿到「空 200」。
- 现象：`/v1/chat/completions` **快速结束且没有任何消息返回**（客户端看到一次空的成功响应）；Qwen 网页侧则显示本地化的配额通知，且是**两种语言各一条**：
  - `오늘의 Qwen3.8-Max 한도에 도달했습니다. 멤버십을 업그레이드하거나 위에서 다른 모델로 전환해 계속 사용하세요.`
  - `Qwen3.8-Max 今日已达上限，请升级会员或在上方切换其他模型继续使用。`
  - 附图（本次会话截图，2153×676）里这条通知是**当普通 assistant 正文**渲染出来的（还带「升级订阅」按钮），说明上游把配额通知塞进了正文/普通帧，而不是我们认的那个错误字段。
- 现状（改前，问题就出在这三处）：
  - 识别只看错误字段：`src/utils/upstream-error.js#assertNoUpstreamFailure` 只对 `payload.error`、`payload.success === false`、WAF 抛错；`isRateLimitError` 的文本兜底 `RATE_LIMIT_MESSAGE_RE` 虽然含 `已达上限`，但只匹配 `error.publicMessage / error.message`，**正文 delta 永远走不到这里**。所以通知以正文形式到达时：不抛错 → 不 `noteRateLimitedAccount` → 账户仍是可用 → 下一个请求继续烧它。
  - 静默空成功：流结束但一个 delta 都没有时没有告警，事后无法定位是哪个账号/哪个 chat 被拒。
  - 恢复时间是「1 小时」：`account-rotator.js#recordQuotaExhausted` 默认 `quotaCooldownPeriod = 60min`（上游给 `data.num` 小时时用它），与「次日 09:00」的口径不符；面板上 `cli-support.js#getAccountCliState` 把 `quotaCooldownEndsAt` 并进 `cooldownEndsAt`，于是只能显示「冷却」倒计时，看不出「今日额度已达上限」这个语义。
- 做法：
  1. **先抓证据再改**：用现有探针（`.tmp/probe-frames.cjs`）或 `logs/` + `reqContent/` 复现一次，确认这条通知到底长在哪——是 `choices[].delta.content`（正文），还是某个没被 assert 的帧（`data.code` 藏在 SSE 的 `data:` 里）。把真实帧存成 `tests/fixtures/` 夹具，后面的判定都以它为准。
  2. 正文级识别：新增 `QUOTA_NOTICE_RE`（zh `今日已达上限|已达上限.*(升级|切换)`、ko `한도에 도달했습니다`、en `reached the upper limit|upgrade your membership`），命中即抛 `UpstreamResponseError(..., RATE_LIMIT_CODE)` → 走已有的 429 + `insufficient_quota` 出口和 `noteRateLimitedAccount`，客户端拿到的是 429 而不是空 200。
     - 误判护栏：只在**首帧**或**整段正文很短（如 ≤ 200 字）且没有 `finish_reason: stop` 的正常答复**时判定；用户问「什么叫已达上限」这种长回答不受影响。
  3. 「快速结束 + 零内容」兜底：流结束但零 delta 时打一条 `logger.warn`，带上 `account / chatId / model / 上游首帧摘要`，别再静默。
  4. 恢复时间：`recordQuotaExhausted` 的默认改成「下一个 09:00（Asia/Shanghai）」；上游给了 `data.num` 小时时取**更晚**的那个（宁可多等，不要提前回来又烧一轮）。新增 `QUOTA_RESET_HOUR`（默认 `9`）与 `QUOTA_RESET_TZ`（默认 `Asia/Shanghai`），写进 `.env.example`。
     - 口径确认点：「第二天 09:00」若按字面实现，08:30 耗尽要等到**次日** 09:00；当前实现取「下一个 09:00」（当天 08:30 → 当天 09:00）。先按字面（次日）实现，验收时让用户拍板。
  5. 状态语义：`kind` 增加 `quota_exhausted`（徽章文案「已达上限 · 明日 09:00 恢复」），`STATUS_META` / `accounts.status*` 三语各补 key；轮换池 `_isAccountAvailable` 逻辑不变（仍只按时间解禁，`resetFailures` 不解禁——那条注释别动）。
  6. 面板可见性：账号卡片 tooltip 写清「今日额度已达上限，YYYY-MM-DD 09:00 自动恢复」，并让 `/accountStats` 下发 `quotaCooldownEndsAt`（字段已有，只是前端没用）。
- 验证：
  - 单测 `tests/quota-notice.test.js`：三语正文各一条 → 429 + `insufficient_quota` + 账户被 mark，且 `quotaCooldownUntil` ≈ 次日 09:00；正常长回答**不**误判；`data.num = 5` 时取 5 小时（若晚于 09:00）；`QUOTA_RESET_HOUR` 覆盖生效（注入假时钟，不改系统时间）。
  - 真机：额度耗尽的账号发一条 → 客户端拿到 429（不再空 200）；面板该账号显示「已达上限 · 明日 09:00 恢复」；紧接着的下一个请求不再选它（日志里 `账户 … 额度已耗尽` 只出现一次）；把 `QUOTA_RESET_HOUR` 调到「1 分钟后」重启 → 自动回到可用、轮换重新选中它。
  - 回归：`tests/` 现有 rate-limit / anthropic 用例全绿（这条路径 Anthropic 面共用同一套判定，别只修 OpenAI 面）。

- 实际做法（2026-10-23 落地，与上面计划的差异）：
  - `upstream-error.js` 新增 `QUOTA_NOTICE_RE` / `isQuotaNoticeText` / `detectQuotaNotice`，并在 `assertNoUpstreamFailure` 里**先于** `noteChatAnswer` 抛 `RATE_LIMIT_CODE` —— 这样两个控制器（OpenAI / Anthropic）走同一道门，客户端拿到 429 `insufficient_quota`。
  - 误判护栏没用「首帧」，改成两条同时成立：**整段 ≤ 300 字** 且 **说法出现在开头 60 字内**。首帧判定挡不住分片，长度单判又误伤短回答。
  - **补了第二层**：通知若已当正文发出去（分片、或首帧没认出），状态码改不了了，但 `chat.js` / `anthropic.js` 在流结束处用 `isQuotaNoticeText(visibleText)` 补一次，命中就 `noteRateLimitedAccount` + `logger.warn`——否则账户还会留在池里被烧。
  - 恢复时间：`account-rotator.js#nextQuotaResetAt`（`Intl` 算目标时区墙钟，不依赖时区库），默认**字面次日 09:00**，与上游 `data.num` 取更晚者。`QUOTA_RESET_HOUR` / `QUOTA_RESET_TZ` / `QUOTA_RESET_SAME_DAY=1`（改成"下一个 09:00"）都进了 `.env.example`。
  - `quotaCooldownPeriod`（原来那 1 小时）**删掉了**：现在静默期只有一个来源（日重置/上游等待），可注入 `rotator.quotaResetAt` 供测试。
  - 状态语义：`cli-support.js#getAccountCliState` 新增 `kind: 'quota_exhausted'` + `status.quotaResetAt`；面板 `STATUS_META` / 筛选下拉 / tooltip（绝对时间「{at} 自动恢复」）/ 到期自动补拉，三语 key 都补齐了。
- 怎么验证的：
  - `tests/quota-notice.test.js`（7 例）：三语通知识别；长回答、60 字后才提到的短回答**不**误判；`detectQuotaNotice` 流式/非流式同形；`assertNoUpstreamFailure` 抛 → `describeUpstreamFailure().status === 429`；`nextQuotaResetAt` 四个时刻/时区用例（16:00→次日 09:00、08:00→次日 09:00、sameDay→当天 09:00、UTC 0 点）；注入 `quotaResetAt` 验证「到点自己回到池里」。
  - `tests/upstream-quota-429.test.js` 里两条旧断言按新口径改写（上游等待只在更晚时生效、日重置兜底），`cli-support` 的 kind 断言改成 `quota_exhausted` + `quotaResetAt`，45 例全绿。
  - **真机（2026-10-23，账号 yahahayo5@outlook.com）**：普通聊天与工具调用都正常返回 200，说明新的 `assertNoUpstreamFailure` 判定没有误伤正常帧。**「额度真的耗尽」这一态没有复现**（要烧掉当天额度），所以 429 + 次日 09:00 恢复 + 面板「已达上限」徽章仍只有单测覆盖。

## 12. 工具调用后丢掉原始任务 + 每次重试都「分叉」，最后 `<agent_blocked>` 说找不到任务

- [x] 需求：同一会话里用工具调用完，必须顺着原任务继续；不能因为一次重试就分叉、不能把原始任务挤出上下文、不能出现 `<agent_blocked>The original task or user goal is missing from the conversation history.</agent_blocked>`。
- 复现（用户实测，同一窗口内用工具即触发）：
  1. `user: 你好` → 2. `ai: 一个不准确的时间` → 3. `user: 告诉我现在几点了`（实际发出去的内容是 `{"role":"user","content":"告诉我现在几点了"}`，**并切换了分支**）→ 4. `ai: 写了 py 代码并调用，拿到一个错误的时间` → 5. `user(自动): {"role":"user","content":"告诉我现在几点了"}` + `# Agent turn recovery … The tool name(s) code_interpreter do not exist. Use ONLY these exact tool names: get_time.` → 6. `ai: [TOOL CALL]{"name":"get_time",...}` → 7. `user(自动，**又切换分支**): [TOOL RESULT #1: get_time] {...}` → 8. `ai: Got it! The current time is …` → 9. `user(自动): **同一段** [TOOL RESULT #1: get_time] + # Agent turn recovery（bare prose 版）` → 10. `ai: <agent_blocked>No original task was provided. The conversation only contains a time tool result…</agent_blocked>`
- 根因（代码层面已能对上，三步叠加）：
  - **每次重试都分叉，父节点还是同一条 user 消息**：`src/utils/conversation-session.js#planTurn` 里 `session.badTurn && session.lastUserMessageId` → `mode: 'branch'`，`parentId = lastUserMessageId`、`deltaStart = turnStartCount`；而 `session-reuse.js#remember` 把 `badTurn: finished !== true`，Agent 回合只要没有明确 `finished`（工具轮、被门禁拒绝都算）就是 badTurn。于是第 5、7、9 步各分叉一次，父节点都是第 3 步那条 user 消息 —— 每分叉一次，上一轮的 assistant 回复**和上一轮注入的 recovery 提示**一起被丢掉。
  - **分叉/续用只发增量，原始任务不在增量里**：`session-reuse.js#applyDelta` 把 `raw.slice(deltaStart)` 渲染成**一条** user 消息，并且过滤掉所有 assistant 消息。父链一旦断（`recordTurn` 里 `lastUserMessageId: userMessageId || null`，分叉轮上游不给 user id 就变成 null → 下一轮 `parentId: null`，等于从根分叉），上游能看到的就只有 `[TOOL RESULT #1]`，第 10 步那句「只有工具结果、没有原始任务」是**准确描述**，不是模型幻觉。
  - **同一份工具结果被发两遍**：门禁把「重试」实现成一条**新的 user 消息**（`src/utils/agent-turn.js#buildAgentRetryHint`），而客户端每次又把完整历史再发一次；第 7 步与第 9 步因此是同一段 `[TOOL RESULT #1]`。加上第 3 步那个 `{"role":"user","content":"…"}` 的二次 JSON 包装（消息体被当字符串塞进 content），上游看到的历史形状是乱的。
- 做法：
  1. **分叉只允许一次**：`recordTurn` 记 `branchCount` / `lastBranchParentId`；同一条 `lastUserMessageId` 连续分叉 >1 次就强制回退 `mode: 'new'`（全量重放）。宁可多烧一点前缀缓存，也不能把任务弄丢。
  2. **增量永远带任务锚点**：`applyDelta` 在增量开头拼一段 `[ORIGINAL TASK] <首条 user 消息原文>`（存进 session 的 `taskAnchor`），保证父链断了任务也还在。
  3. **recovery 不当新 user 消息**：`buildAgentRetryHint` 的结果走「同一 parent 的续写」或并入 system，不再产生一条会分叉的 user 消息；同时把「工具轮」从 `badTurn` 里摘出去（按 `finish_reason` 判定，见 `docs/dev-state.md` 待办 4）。
  4. **工具结果去重**：同一 `tool_call_id` 的 `[TOOL RESULT]` 在同一会话里只渲染一次（`chat-middleware.js` 的 `tool_history_calls` 台账已有，扩到 delta 渲染这一层）。
  5. **查清 `{"role":"user","content":…}` 双重包装**：对照 `req.raw_messages` 与实际上游 body，确认是 `formatHistoryMessages` 还是客户端把 JSON 当字符串发；前者改渲染，后者写进 README FAQ。
  6. 日志补一条：每次 `分叉重生成` 打印 `parentId / deltaStart / delta 条数 / 首 80 字`，下次能直接看出父链断在哪。
- 验证：
  - 单测（`tests/conversation-session.test.js` 新增）：`badTurn` 连续两轮 → 第二次 `mode === 'new'`；branch 增量里含 `[ORIGINAL TASK]`；同一 `tool_call_id` 只渲染一次；`parentId` 为 null 时不进 branch。
  - 端到端（改造 `.tmp/tool-rounds.mjs` / `.tmp/tool-multiturn.mjs`）：照抄上面 1–10 步 —— 期望 `分叉重生成` 日志只出现 **1** 次、第 9 步的重复工具结果被吞掉、全程**不出现** `<agent_blocked>`、最终正常给出时间。
  - 回归：纯多轮（无工具）仍走 `continue` 且前缀哈希不变；`tests/agent-protocol.test.js` 全绿。

- 实际做法（2026-10-23 落地，比计划多挖出三个真根因）：
  1. **分叉只允许一次**：`recordTurn` 记 `branchCount` / `lastBranchParentId`，同一条 user 消息连续分叉 >1 次 → `planTurn` 返回 `mode:'new'`（`reason: 'branch-exhausted'`）。
  2. **任务锚点**：`conversation-session.js#taskAnchorOf` + `applyDelta` 拼 `[ORIGINAL TASK]`；Anthropic 面走 `buildInternalRequest` 的 `prefixParts`（同一条规则，两个渲染点）。
  3. **真正的主因不是「分叉」，是 `applyDelta` 把工具协议整段覆盖掉了**：中间件把 `toolPrompt + ledger + directive` 拼在 `messages[0].content` 里，`applyDelta` 直接 `message.content = 增量文本` —— 续用轮模型看不到工具协议、也看不到「继续同一任务」的指令，只能吐裸正文。现在抽出 `chat-middleware.js#composeAgentContent`（信封 → 前缀 → 指令）作为**唯一**拼装点，`applyDelta` 复用它。
  4. **工具轮不算 badTurn**：`finished` 原来只认 `delta.status === 'finished'`，而工具轮只带 `finish_reason=tool_calls` → 每个工具轮都是 badTurn → 每轮都分叉。现在 `finish_reason` 也算证据（`chat.js` 流式/非流式、`anthropic.js#consumeUpstream`）。
  5. **agent 运行时才是工具轮的真身**：有工具时走 `openai-agent-runtime.js`，chat.js 自己的流式循环根本不跑，所以 `response.created` 的 `parent_id` / `response_id` 从来没人记 → `lastParentId` 恒为 null → 下一轮从根分叉。已在运行时帧循环里回填 `upstream_context`，并在回合被门禁**接受**时置 `finished`。
  6. **工具结果去重**：`session-reuse.js#deltaIndexesOf` 按 `tool_call_id` 去掉已同步的工具结果（返回**下标**——`foldToolMessages` 是 1:1 保序的，折叠后 `tool_call_id` 就没了，先折叠再按 id 去重行不通；这条也顺手修了原来「折叠后 slice 错位」的隐患）。
  7. recovery 提示**本来就**是追加到当前消息内容里（`agent-turn-gate.js#appendRetryHint` 改的是 clone 的 `messages[last].content`），不是新 user 消息；第 3 步那个 `{"role":"user","content":…}` 也不是双重包装——那就是我们折叠历史时给上游看的 JSONL 形态。
- 怎么验证的：
  - `tests/session-identity.test.js`：`badTurn` 连续两轮 → 第二次 `new/branch-exhausted`；`recordTurn` 记 `branchCount`/`taskAnchor`；`applyDelta` 保住前缀+指令+锚点、且不再带旧历史。
  - `tests/session-reuse-e2e.test.js`（假上游，真走中间件+控制器）：5 轮工具调用 → 上游只出现 **1 个** chat、`parentId` 逐轮推进 `assistant-1..4`；续用轮内容含 `[ORIGINAL TASK]` + 工具协议 + `# Agent loop control` + 新工具结果，且**不含**旧的全量历史；同一 `tool_call_id` 重发不会出现两遍。
  - 回归：`agent-protocol`(74)、`anthropic-native-parity`(48)、`openai-agent-turn-cutoff`(42)、`anthropic-interception-retry`(70) 全绿。
  - **真机（2026-10-23，账号 yahahayo5@outlook.com，qwen3.8-max）**：`get_time` 工具轮 → 上游返回 `finish_reason: tool_calls`，回填工具结果后第二轮 `continue（prefix-matched）` **续用同一个 chat（e36fd072…）**，日志里**没有** `分叉重生成`，模型正常答出工具给的时间。旧代码在这里正是每轮分叉 + `<agent_blocked>`。

## 13. 无状态客户端的会话身份：别再靠猜、别每轮新建上游窗口

- [x] 需求：无状态客户端（OpenAI SDK / Claude Code / 各家 Agent 框架，每次把整段历史重新打包发来）应该**持续续用同一个上游 Qwen 会话**，而不是每轮新建一个 chat；同一会话的并发请求不能建出两个 chat。
- 结论：**不需要新造一套缓存**——会话登记簿已经有了（`src/utils/session-reuse.js` + `src/utils/conversation-session.js`，`SESSION_REUSE_ENABLED` 默认开），缺的是「身份」和「可见性」这两块。
- 现状（三个真实缺口）：
  1. **Anthropic 面根本没接**：`session-reuse.js#planForRequest` 只有 `src/controllers/chat.js:1262` 一个调用点；`src/controllers/anthropic.js` 里 `chatId: null` / `parentId: null`（895、924、928 行）是写死的 → `/v1/messages` 每轮都新建。Claude Code 这类客户端走的就是这条路，**这就是「每次一个新窗口」的主因**（`docs/dev-state.md` 待办 3 也是这条）。
  2. **身份是猜的、且极易漂移**：`conversation-session.js#buildConversationKey` = `hash(user, model, hash(system), hash(tools), hash(firstMessage))`。无状态客户端通常不传 `user`，于是全靠 system/tools/首条消息的**逐字哈希**：system 里多一个时间戳、工具数组顺序变了、历史被客户端压缩过 → 键就变了 → `planTurn` 返回 `mode:'new'`（`no-session` / `history-diverged` / `history-shortened`）。反过来，两个不同会话若 system + 首条消息相同（例如都是「你好」开头的两次脚本运行）会**撞同一个键、串会话**。
  3. **看不见也存不住**：`createConversationSessions` 是纯内存 LRU + TTL（默认 1800s / 200 条），进程重启即全丢（重启后第一轮必然新建）；没有任何接口能看到「这轮到底是续用还是新建」，`new` 的**原因**也没打日志（只有 `分叉重生成`/`续用会话` 两种日志，见 chat.js:1269）；`.env.example` 里连 `SESSION_REUSE_*` 都没写。
- 做法：
  1. **显式 id 优先，指纹兜底**：会话键取值顺序 `X-Conversation-Id` 请求头 → OpenAI `prompt_cache_key` → Anthropic `metadata.user_id`（+ 会话级 `session_id`）→ `body.user` → 内容指纹。给客户端一个「我要续哪个窗口」的确定手段，而不是让我们猜。
  2. **指纹只取稳定字段**：`model + 排序后的工具名集合 + 首条 user 消息文本`；**不要把整段 system 和工具描述塞进键**（这两样最容易被客户端逐轮改动）。配套测试：「system 里加一个时间戳仍命中同一会话」「工具数组换序仍命中」。
  3. **键没命中时按「历史前缀」找会话**——这才是真正的「自动切到对应窗口」：给已同步会话建二级索引（`hashClientHistory(前 k 条)`），客户端历史与某个会话的已同步前缀**逐字一致且更长**时，直接 `continue`（或按 12 的规则 `branch`）；找不到才 `new`。误配护栏：只在前缀完全一致时命中，宁可新建也不要答非所问。
  4. **Anthropic 面接同一套**：`/v1/messages` 复用 `planForRequest` / `applyDelta` / `remember`；注意它的 tools 形状和 `tool_result` 折叠规则与 OpenAI 面不同，`applyDelta` 要把「渲染增量的函数」参数化，别复制一份。
  5. **持久化**：`data/sessions.json`（file 模式，节流写盘）或复用 `src/utils/redis.js`；重启后仍能续。TTL / 上限 / 开关三项补进 `.env.example`（`SESSION_REUSE_ENABLED`、`SESSION_REUSE_TTL_SECONDS`、`SESSION_REUSE_MAX_ENTRIES`）。
  6. **并发保护**：同一会话键加 in-flight 锁——第二个请求等待或直接退回全量重放，绝不并发建两个 chat。
  7. **可观测**：`GET /sessions`（管理面板加一栏：键摘要 / chatId / 账号 / 上次活动 / 已同步条数 / 可删除），加计数器 `created / continued / branched / diverged`；每轮打一条带 `mode + reason` 的日志（现在 `new` 是静默的，排查全靠猜）。
  8. **与 11 的联动**：账号被额度踢出后 `account-changed` 必然 `new`（会话属于账号，无法跨号续），这不算 bug，但要在日志/计数里单独标出来，否则看起来像「身份又没命中」。
- 验证：
  - 单测（`tests/conversation-session.test.js` / 新增 `session-identity.test.js`）：system 加时间戳仍命中；工具换序仍命中；`X-Conversation-Id` 覆盖指纹；前缀匹配命中（客户端历史 = 已同步前缀 + 新增，逐字一致）；并发同键只产生一个 `new`。
  - 端到端：一个无状态客户端（OpenAI SDK 脚本）+ Claude Code 各跑 5 轮带工具调用 → Qwen 侧只出现 **1 个** chat（用 `/sessions` 与网页会话列表双确认），计数 `created=1 / continued=4`；重启服务再发一轮仍续用；给 system 塞一个时间戳再发仍续用。
  - 回归：`SESSION_REUSE_ENABLED=false` 退回「每轮全量重放」一切照旧。

- 实际做法（2026-10-23 落地）：
  - `conversation-session.js`：`buildConversationKey` 改成 `model + 排序后的工具名集合 + 首条用户消息文本`（**system 与工具描述不再进键**，多模态只取文本项）；新增 `findSessionByPrefix`（前缀匹配）、`taskAnchorOf`、`branchCount` 记账、`sessions.entries()`。
  - `session-reuse.js`：新增 `resolveConversationId`（`X-Conversation-Id` → `prompt_cache_key` → `metadata.user_id` / `session_id` → `user`）、前缀匹配 + 键迁移、`stats{created,continued,branched,diverged,prefixMatched}`、每轮 `mode+reason` 日志、in-flight 等待（2 秒上限，只挡「同一会话并发首轮」）、落盘 `data/session-reuse.json`（`DATA_SAVE_MODE=file` 时，2 秒节流）、`listSessions()` 只读快照。
  - **Anthropic 面接上了**：`handleAnthropicMessages` 先 `flattenAnthropicMessages` 出原始历史 → `planForRequest` → 把 `deltaStart` 作为 `buildInternalRequest({ historyStart, taskAnchor })` 传进去（在折叠/媒体收割/台账之前切），`chatId`/`parentId` 走 `upstreamOptions`；`consumeUpstream` 统一抓 `response.created` 的 `parent_id` / `response_id` 和 `finish_reason`。
  - 观测：`GET /api/sessions`（只读快照）/ `DELETE /api/sessions`（清空），`adminKeyVerify` 保护；管理面板底部新增可折叠的「会话复用」一栏（`SessionReusePanel.vue`：计数 + 会话表 + 清空），三语 key 已补齐。
- 怎么验证的：
  - `tests/session-identity.test.js`（12 例）：system 加时间戳仍命中、工具换序仍命中、多模态图片不进键、显式 id 优先级四档、前缀匹配命中/不命中、分叉一次上限、锚点、`applyDelta` 保前缀、`listSessions` 不含正文、路由已挂。
  - `tests/session-reuse-e2e.test.js`（5 例，假上游但走真的中间件+控制器）：**OpenAI 面** 5 轮工具调用只建 1 个 chat 且 `parentId` 逐轮推进；续用轮只发增量；重复工具结果不重发；**`/v1/messages` 第二轮带 chatId + parentId + `[ORIGINAL TASK]` + system**（这条以前恒为 null）。`X-Conversation-Id` 下工具换序仍续用。
  - 回归：`tests/expected-counts.json` 1410 → 1434（新增 24 例），全量 gate 绿。
  - **真机（2026-10-23，账号 yahahayo5@outlook.com）**：
    - `/v1/chat/completions` 两轮：`new（no-session）` → `continue（prefix-matched）`，同一个 chat `125ec16f…`；带工具的两轮同样续用 `e36fd072…`。
    - **`/v1/messages`（Claude Code 那条路）两轮：`[ANTHROPIC] 续用会话（chat=e1d7790a…，跳过 1 条历史）`** —— 这条以前恒为 `chatId: null`，即"每句话一个新窗口"的主因，现已修掉。
    - `GET /api/sessions` 返回 3 个会话，`created=4 / continued=3 / branched=0 / diverged=0`，`persist=true`，`data/session-reuse.json` 落盘 1733 字节。
    - **重启验证**：重启服务后 `/api/sessions` 立刻显示 3 条（顺手修了懒加载——之前要等第一个聊天请求才填表），再发一轮仍 `续用会话（chat=e1d7790a…，跳过 3 条历史）`，模型答出上一轮问过的城市（上下文没丢，只发了增量）。
  - 未做：面板的浏览器目视验收（本机没有浏览器自动化工具；`bun run build:frontend` 通过、字符串已进 dashboard/index 两个 bundle、`GET /api/sessions` 在真起的服务上返回 200）。
