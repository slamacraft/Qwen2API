# 开发状态交接（2026-10-22）

> 用途：会话上下文快用完时把「做到哪了、下一步怎么接」落到文件里，新会话直接读这份继续。
> 读完后先 `git status` 确认工作区，再按「进行中」一节接手。

## 一、运行环境（本机）

| 项 | 值 |
|---|---|
| 代理服务 | `node src/server.js`，`127.0.0.1:3000`，管理 key `<你的管理密钥>`，`DATA_SAVE_MODE=file` |
| 前端 | `cd public && node node_modules/vite/bin/vite.js build` 产出 `public/dist`（服务端直接读盘，重建即生效） |
| 测试门禁 | 本机 Node 20 跑不了（`--test-isolation=none` 要 ≥22.8），用便携 Node 24：`.tmp/node24/node-v24.22.1-win-x64/node.exe tools/test-gate.js`；当前基线 **1374 tests / 138 suites** |
| 浏览器指纹 | 采集脚本 `scripts/harvest-browser-profile.mjs`；**不再需要常挂可见窗口**——浏览器关掉后代理自己起临时 profile 的无头 Chrome、注入 cookie 续期（见下） |
| 模型 | `qwen3.8-max` 该账号当日额度已用尽，测试用 `qwen3.7-plus` |

## 二、已完成（按主题）

1. **上游修复**：`Version` 头必须发（`0.3.20`）；`bx-ua`/`bx-umidtoken`/浏览器 cookie 必须带——见 `src/utils/browser-profile.js`、`src/utils/header-profile.js`。
2. **浏览器指纹机制**：每账号一份 `data/browser-profile.<email>.json`（cookie / token / bx-ua / port / userDataDir / UA 等）；token 15 分钟过期，代理自动重采（`ensureFreshProfileToken`）。
3. **多账号**：按账号指纹 + 选号策略 `priority`（默认粘住主号）/ `balanced`；新会话按「最少使用」均摊（`getLeastUsedAccount`）；没有自己指纹的账号被排除出轮换（`canUseAccountForUpstream`），并在 `getUnavailableReason` 里给出明确提示。
4. **会话复用**（OpenAI `/v1/chat/completions`）：`src/utils/conversation-session.js`（状态机）+ `src/utils/session-reuse.js`（接线）；新会话/续用/分叉三种模式；增量 = 折叠后跳过 assistant 消息；`req.raw_messages` 在 middleware 里深拷贝保存。
5. **前端**：全新管理后台（P0–P5：侧栏、账号池、用量统计、设置、测试会话 Markdown/历史/工具调用测试、设置页紧凑化）。
6. **测试**：1374 个用例全绿，`tests/expected-counts.json` 已 bless。
7. **A：headless + cookie 注入续期（2026-10-22 15:20 修完并端到端验证）**——浏览器窗口关掉后代理仍能自动续 token。

   - 机制：`ensureFreshProfileToken` 先用真实浏览器端口采一次；失败则带 `--headless --inject-from` 重跑。采集脚本起临时 profile 的无头 Chrome，把指纹里的 cookie 注入进去，打开 `chat.qwen.ai`，页面自己用 `refresh_token` 换新 `access_token` 写进 `localStorage.token`，脚本再采 baxia 指纹并写回指纹文件，最后关掉浏览器。
   - **根因（卡了半天的那个）**：cookie 原先注入成 host-only 的 `chat.qwen.ai`，而前端换 token 打的是 **`GET https://auth.qwen.ai/api/v2/auths/refresh`**（`withCredentials: true`）。host-only cookie 不会发到 `auth` 子域 → 服务端回 `{"success":false,"data":{"code":"Unauthorized"}}` → `localStorage` 永远没有 `token` → 脚本报「没有登录 Qwen」。改成域 cookie `domain=.qwen.ai` + `secure` + `sameSite=None` 后一次通过。
   - 其它两处修复：无头模式下先注入再导航（原来 `findTarget` 会先开一个 `chat.qwen.ai` 页、白等 8s 还可能把「已登出」写进 localStorage）；等 token 改成轮询（最多 20s）而不是固定 sleep 9s。
   - 回归防护：`tests/harvest-cookie-domain.test.js` 钉住注入域名/属性与 `cookiePairs` 解析（脚本被 import 时不执行采集，靠 `isEntryPoint()` 守卫）。
   - 实测：整段采集 **3–5 秒**；代理日志 `🔄 token 已过期` → `🌐 改用 headless + 注入 cookie 续期` → `🔄 指纹已刷新` → `/v1/chat/completions` HTTP 200（`qwen3.7-plus`，整条请求 9–10s）。
   - 顺手清理：删掉 `browser-profile.js` 里已无人调用的 `chromeExecutable/isPortOpen/launchHeadlessChrome` 与 `config.chromeExecutable`（`CHROME_PATH` 现在只由采集脚本读）；修掉 `isProfileModeActive` 的 `no-useless-assignment`，`eslint src scripts tests` 已全绿。
   - 顺手修掉的挂死：`Cdp` 原先没有超时，连到一个正在退出的浏览器时 ws 既不 `open` 也不 `error`，脚本会**永久挂住**（实测复现过一次，被外部 kill 才结束）。现在连接 15s、每条 CDP 命令 20s 超时，且 ws `close` 时把 pending 全部 reject；代理侧 headless 重试的超时也从 25s 提到 45s。

8. **服务端自备浏览器会话（2026-10-22 15:50）——服务器部署不再需要用户本机 Chrome**

   - 采集脚本新增 `--login-account`：无头 Chrome 打开 `chat.qwen.ai`，**在页面里**用账号邮箱/密码打 `POST /api/v1/auths/signin`（同源 fetch + `credentials: include`，baxia 自动挂 `bx-ua`；密码做 sha256 十六进制，与 `tools.js#sha256Encrypt` 一致），服务端下发 `refresh_token` cookie，再重载让应用自己换 `access_token`，然后照常采 cookie + baxia 头。
   - `src/utils/browser-profile.js#provisionProfile`：进程内串行（无头 Chrome 共用调试端口，并发会串号）、同账号并发共享同一次采集、失败冷却 10 分钟；`describeAccountUsability` 给出「是否真的可用」。
   - 入口：`POST /api/provisionFingerprint {email}`（面板按钮）、**加账号后自动后台补**、**请求时自愈**（`request.js#provisionMissingFingerprint`：没有可用账号时先补一个再重试）。
   - 管理面板账号列表新增「可用性」列（可用 / 缺会话+生成按钮 / 已禁用），`GET /api/getAllAccounts` 返回 `hasFingerprint / fingerprintAt / usable / unavailableCode`。
   - 实测：单个账号生成 **3 秒**；删掉指纹后直接发聊天请求 → 自动补会话 → HTTP 200（整条 10s）；假账号（example.com）返回人话错误 `账号登录失败（HTTP 400）：{"detail":"email not found"}`。
   - 回归防护：`tests/fingerprint-provision.test.js`（可用性判定 / 错误路径 / 同账号并发去重 / 提示文案不再指向命令行）、`tests/harvest-cookie-domain.test.js`（登录表达式必须同源 + credentials + sha256）。
   - **部署前提**：服务器上要有 Chrome/Chromium（`CHROME_PATH` 可指定；Linux 找 `/usr/bin/google-chrome|chromium`）。没有浏览器时自动生成会返回「找不到 Chrome」，面板照旧显示「缺会话」——此时仍可走老办法：在任意有 Chrome 的机器上采集一份 `browser-profile.<邮箱>.json` 放进 `data/`。
   - 实测（真机 UI）：无头 Chrome 打开后台 → 账号表出现「可用性」列；`user@example.com` 显示「缺会话 + 生成」→ 点「生成」→ 约 3 秒变「可用」+ toast「浏览器会话已生成」；随后 `/v1/chat/completions` HTTP 200（6s）。

9. **测试会话页三项优化（2026-10-22 16:40，详见 `todo.md`）**
   - **多会话历史**：`localStorage["chat.sessions"]` 保存最近 20 段测试对话（每段 100 条消息），顶栏「历史记录 / 新对话」，可切回/删除单段；旧版单槽 `chat.history` 自动迁移。为多轮交叉排查准备。
   - **思考内容**：流式累积 `delta.reasoning_content`，渲染成可折叠「思考过程 · N 字」块（思考时展开、正文开始自动收起、历史里默认收起）。
   - **流式显示修复**：根因是页面 push 原始对象后继续改它，Vue 代理收不到变更 → 内容要等结束才一次性渲染；改为取回响应式代理再增量写入，`isStreamingMessage` 改按 id 比较。真机实测正文长度有 32 次增量变化。

10. **语言切换挪到右上角 + 测试会话改成 Agent 对话窗口（2026-10-22 17:00，详见 `todo.md` 第 4/5 项）**
    - 语言下拉：侧边栏底部那组三语按钮在收起（68px）时会溢出，已从 `AdminLayout` 侧栏移除，改到 header 右侧（GitHub 左边）做下拉（globe + 母语名 + 箭头，`role=menu`/`menuitemradio`、键盘导航、点外部/Esc 关闭）。`Icon.vue` 新增 `globe`，`shell.*.json` 加 `shell.language`。
    - 测试会话：新增 `public/src/components/chat/SessionList.vue`，`chat.vue` 改成两栏（左 248px 会话侧栏 + 右对话区），会话按 今天/近 7 天/更早 分组、当前项高亮、hover 删除；窄屏侧栏进抽屉。原「历史记录」弹窗移除；消息区改成占满剩余高度。
    - **布局按 Qwen 官网重做（同日 17:30）**：去掉 `.page` 内边距与所有卡片框——侧栏贴边接对话区（无 gap）、消息区通栏滚动 + 内容 `max-w-[820px]` 居中、助手消息不套气泡、输入改成悬浮圆角输入条、模型名换成自绘下拉（原生 select 箭头会飘远）、标签页标题跟随当前会话。

11. **OpenAI Responses API（`/v1/responses`）（2026-10-22 17:40，详见 `todo.md` 第 7 项）**
    - 实现：`src/utils/responses-format.js`（请求归一化 + response/item/usage/SSE 事件构造，纯函数）、`src/routes/responses.js`（`POST /v1/responses`，先转 chat 请求体再复用 `processRequestBody`）、`src/controllers/responses.js`（把请求交给现有 `handleChatCompletion`，用「假 res」收 chunk 再翻译成 Responses 事件——Agent 门禁、工具协议解析、会话复用、WAF 重试全部继承）。
    - 支持：`input`（字符串 / message 数组 / `input_text` / `function_call` + `function_call_output`）、`instructions`、`tools`（`type:"function"`）、`tool_choice`、`max_output_tokens`、`reasoning.effort`、流式与非流式、思考内容（reasoning item）、工具调用（`function_call` item + 参数增量事件）。
    - 已加入重端点限流名单；三份 README 已同步（`README.md` / `README-en.md` / `README-ru.md` 的「OpenAI Responses API」章节）。
    - 未做：会话复用（每轮按新会话全量重放，正确但不省 token）、图片等非文本 content 段、内置工具（web_search 等）。

12. **思考过程流式 + 工具调用报错（2026-10-22 17:55，详见 `todo.md` 第 8 项）**
    - 思考不流式：工具轮的实时思考通道 `onReasoningDelta` 被 `enableThinking &&` 挡住（模型自己思考时 `enable_thinking=false`，思考被憋到轮末一次性发出）。已去掉该条件，保留 `legacyReasoningInContent` 保护；`tests/agent-protocol.test.js` 加了回归守卫。
    - 工具调用报错「上游连续返回残缺、非法或不存在的工具调用」：Agent 门禁的**策略**结果——OpenAI 面默认 `AGENT_TURN_ALLOW_PROSE_WITH_TOOLS=false`，模型「先说一句再调用」会被判 `prose_with_tools`，重试 3 次后报错。已把这条错误改成可执行说明（告诉用户打开 `AGENT_TURN_ALLOW_PROSE_WITH_TOOLS=true`）；协议真坏的 `tool_error` 文案不动。
    - 待办：两个账号当日额度用尽（RateLimited 冷却约 1 小时），修复后的真机复测等额度恢复。

## 三、进行中（下一步接手）

**B. CLI 通道（服务器部署的正解，未通）**
- `POST https://chat.qwen.ai/api/v1/oauth2/device/code` ✅ 能拿到 device_code / user_code / `https://chat.qwen.ai/authorize?user_code=…&client=qwen-code`；
- 换 token 的 `POST/GET /api/v1/oauth2/token` ❌ 一律 405 + 阿里 WAF 的 HTML 页（仓库 `cli.manager.js` 里的写法曾经是对的，现在被拦）；
- 下一步：装官方 `qwen-code` CLI 跑一次登录，抓它换 token 的真实 URL/方法/请求头，再复刻。

**A 的验证方法（回归时照做）**：
1. 关掉所有 Chrome（确认 `http://127.0.0.1:9333/json/version` 连不上）；
2. 把 `data/browser-profile.<email>.json` 里的 `token` 改成过期假 JWT（`payload {"exp":1}` 即可，`tokenExpiresAt` 只看 exp）；
3. 重启代理（`API_KEY=<你的管理密钥> DATA_SAVE_MODE=file node src/server.js`）并发一条 `/v1/chat/completions`；
4. 期望日志顺序见上，且 `harvestedAt` 被刷新。

## 四、待办清单

1. B：抓官方 CLI 的 token 交换请求，验证 `portal.qwen.ai/v1/chat/completions` 能否对话。
2. OpenAI **Responses API**（`/v1/responses`）：`input`/`instructions`/`output`/SSE 事件序列，独立于现有链路。
3. **Anthropic 路径**（`/v1/messages`，Claude Code）接同一套会话复用。
4. 会话复用：工具轮次上限目前第 4 次 HTTP 才停（改按 `finish_reason` 预判）；截断分叉（badTurn）未做端到端验证；流式工具调用未单独验证。
5. 指纹可用性还可以再进一步：面板现在能一键生成，但「生成失败的原因」只 toast 一次，可以考虑在详情面板留一条最近一次失败原因/时间。

## 五、关键决策（别再翻案）

- **会话复用**：正常轮次线性续用；上一轮被截断/被拒 → 从那条 user 消息分叉；客户端改历史/换会话/换号 → 新会话全量重放。开关 `SESSION_REUSE_ENABLED=false` 可整体回退。
- **换号**：上下文重置（不做历史迁移）。
- **新会话选号**：最少使用（均摊）；老会话粘住自己的账号。
- **每个参与轮换的账号都必须有自己的浏览器指纹**，否则会被排除（防止串号烧别人额度）。
- **换 token 在浏览器里做，代理不自己换**：前端刷新打的是 `GET https://auth.qwen.ai/api/v2/auths/refresh`（`withCredentials`，读 `refresh_token` cookie）。所以无头注入的 cookie 必须是**域 cookie `.qwen.ai`**（host-only 的 `chat.qwen.ai` 到不了 auth 子域），见 `scripts/harvest-browser-profile.mjs#QWEN_COOKIE_DOMAIN`，别改回去。
- **headless 续期用临时 profile + 注入 cookie**，不用真实 profile 目录：用真实目录起 headless 会被 Chrome 拒（`Multiple targets are not supported in headless mode`）。
- **指纹由服务端自己生成，不要再让用户跑命令行**：账号里存着邮箱+密码，服务端起无头 Chrome 在页面里登录一次就能拿到 cookie + baxia 头（`provisionProfile`）。服务器部署时用户没有 Chrome 可用，命令行方案只作为「机器上正好有 Chrome」时的备选。
- **自动补会话的三条路径**：加账号后自动补（后台、失败不影响加账号）、面板「生成」按钮（手动重试，清掉冷却）、请求时自愈（`provisionMissingFingerprint`，失败冷却 10 分钟，避免每个请求都去登录）。

## 六、未提交改动

工作区有大量未提交改动（前端重做、会话复用、指纹机制、测试）。`git status` 里 `.tmp/` 是临时目录、`reqContent/` 是用户的抓包（**含真实 token，不要提交**）。

本轮（A）新增/修改、还没提交的：
- 新增未跟踪：`scripts/harvest-browser-profile.mjs`、`src/utils/browser-profile.js`、`tests/harvest-cookie-domain.test.js`（前两个是上一会话新建的）；
- 已跟踪有改动：`src/config/index.js`（删 `chromeExecutable`）、`tests/expected-counts.json`（1370/137 → 1374/138）。
- 跑门禁前记得给 shell 设 `API_KEY`：有 50+ 个测试文件自己不设 `process.env.API_KEY`，靠环境变量；没设会成批报 `请务必设置 API_KEY 环境变量`（每个文件都「no summary」）。
