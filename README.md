<div align="center">

> [中文](README.md) | [🇷🇺 Русская версия](README-ru.md) | [English](README-en.md)

# 🚀 Qwen-Proxy

[![Version](https://img.shields.io/badge/version-26.10.19.00.34-blue.svg)](https://github.com/Rfym21/Qwen2API)
[![Bun](https://img.shields.io/badge/Bun-1.3.14+-green.svg)](https://bun.sh/)
[![Docker](https://img.shields.io/badge/Docker-supported-blue.svg)](https://hub.docker.com/r/rfym21/qwen2api)

[🔗 加入交流群](https://t.me/nodejs_project) | [📖 文档](#api-文档) | [🐳 Docker 部署](#docker-部署)

</div>

## 🛠️ 快速开始

### 项目说明

Qwen-Proxy 是一个将 `https://chat.qwen.ai` 和 `Qwen Code / Qwen Cli` 转换为 OpenAI 兼容 API 的代理服务。通过本项目，您只需要一个账户，即可以使用任何支持 OpenAI API 的客户端（如 ChatGPT-Next-Web、LobeChat 等）来调用 `https://chat.qwen.ai` 和 `Qwen Code / Qwen Cli`的各种模型。其中 `/cli` 端点下的模型由 `Qwen Code / Qwen Cli` 提供，支持256k上下文，原生 tools 参数支持

**主要特性：**
- 兼容 OpenAI API 格式，无缝对接各类客户端
- 兼容 Anthropic Messages API（`/v1/messages`），支持 Claude Code、Anthropic SDK 等客户端
- 兼容 OpenAI Responses API（`/v1/responses`），支持流式/非流式、思考过程与工具调用，可直接对接 OpenAI SDK、Codex CLI
- 支持 Function Calling（OpenAI `tools` / Anthropic `tools`），含流式 `arguments` 增量分片与 `tool_choice=required` 强校验重试
- 支持多账户轮询，提高可用性
- 支持流式/非流式响应
- 支持多模态（图片识别、视频理解、图片/视频生成）
- 支持 OpenAI 风格资源端点：`/v1/images/generations`、`/v1/images/edits`、`/v1/videos`
- 支持智能搜索、深度思考等高级功能
- 支持 CLI 端点，提供 256K 上下文和工具调用能力
- 提供 Web 管理界面，方便配置和监控
- 批量添加账号支持实时进度展示，可在系统设置中调整登录并发数

### 🚀 一步步部署与服务管理（Bun 源码，推荐）

本项目是 **Bun 优先**的：仓库里只有 `bun.lock`（根目录和 `public/` 各一份），`packageManager` 与 `engines` 都要求 `bun >= 1.3.14`。用 npm/pnpm 会现解依赖、和锁文件漂移，所以推荐用 **Bun 从源码运行**（也是能让浏览器会话自动续期的运行方式；编译版二进制里没有采集脚本，续期方式见「独立二进制」一节）。

下面按顺序做，每步都能单独验证。

#### 1. 安装 Bun

```bash
curl -fsSL https://bun.sh/install | bash
exec $SHELL                 # 让 ~/.bun/bin 进入 PATH
bun --version               # 需要 >= 1.3.14
```

#### 2. 取代码

```bash
git clone https://github.com/Rfym21/Qwen2API.git
cd Qwen2API
```

#### 3. 装依赖并构建前端

```bash
bun install --frozen-lockfile                  # 服务端依赖（生产机可加 --production）
bun install --cwd public --frozen-lockfile     # 前端依赖（vite 在 devDependencies 里，别加 --production）
bun run build:frontend                         # 生成 public/dist，服务端直接读盘
```

#### 4. 写配置（`.env`）

```bash
cp .env.example .env
```

**必须改的两项：**

| 变量 | 建议值 | 说明 |
|---|---|---|
| `API_KEY` | `sk-你的密钥` | 管理密钥；逗号分隔时第一个是管理员。调用 API 也用它 |
| `DATA_SAVE_MODE` | `file` | **要在管理面板里加账号就必须设 `file`**。默认 `none` 是「纯环境变量模式」，面板里的改动不会落盘 |

**常用可选项：**

| 变量 | 说明 |
|---|---|
| `SERVICE_PORT` | 监听端口，默认 3000 |
| `ACCOUNTS` | 环境变量模式的账号，`邮箱:密码` 逗号分隔，可写 `邮箱:密码\|http://代理`；用 `file` 模式时留空即可，账号在面板里加 |
| `CHROME_PATH` | Chrome 可执行文件路径；留空按平台自动找 `/usr/bin/chromium`、`google-chrome` |
| `PROXY_URL` | 全局出站代理（单账号代理在面板里单独配） |

改完可以用 `grep -E '^(API_KEY|DATA_SAVE_MODE|SERVICE_PORT)=' .env` 复核一遍。

> `DATA_SAVE_MODE=none` 时面板照样能打开，但「添加账号」会直接返回 400 并提示你先改 `file`（以前是静默保存失败，只留三行看不懂的日志）。

#### 5. 安装 Chromium（会话续期必需）

`chat.qwen.ai` 的 access token 只有 15 分钟寿命，代理靠无头浏览器自己换新 token。服务器上没有浏览器时，token 过期后上游就会开始拒绝请求（日志里是 `unauthorized`）。

```bash
sudo apt install -y chromium        # Debian / Ubuntu；CentOS: dnf install chromium
# 装完用这个确认路径，和 .env 里的 CHROME_PATH 对得上：
command -v chromium || command -v chromium-browser || command -v google-chrome
```

#### 6. 首次启动并验证

```bash
bun run start        # 前台运行，Ctrl+C 停止；等价于 bun --no-env-file src/server.js
```

另开一个终端：

```bash
curl -s http://127.0.0.1:3000/api/health                                  # 返回 200
curl -s -H "Authorization: Bearer sk-你的密钥" http://127.0.0.1:3000/v1/models | head -c 300
```

浏览器打开 `http://<服务器IP>:3000` → 用管理员密钥登录 → 账号池 → 添加账号。第一次加账号会自动用无头浏览器登录并采集会话（3~15 秒），状态列的「可用性」变成绿色「可用」就可以发请求了。发一条测试对话确认整条链路：

```bash
curl -s http://127.0.0.1:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-你的密钥" -H "Content-Type: application/json" \
  -d '{"model":"qwen3.7-plus","messages":[{"role":"user","content":"只回答两个字：你好"}]}'
```

#### 7. 配置开机自启（可选，生产建议）

```bash
# 一次性准备：专用用户 + 目录 + 该用户下的 Bun（供 ExecStart 使用）
sudo useradd --system --create-home --home-dir /home/qwen2api --shell /usr/sbin/nologin qwen2api
sudo mkdir -p /opt/qwen2api
sudo -u qwen2api -H bash -c 'curl -fsSL https://bun.sh/install | bash'
```

把项目放到 `/opt/qwen2api`（`git clone` 或 `rsync` 过来，注意 `/opt/qwen2api/.env` 和 `data/` 的属主是 `qwen2api`），然后写服务单元：

```ini
# /etc/systemd/system/qwen2api.service
[Unit]
Description=Qwen2API (Bun)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=qwen2api
WorkingDirectory=/opt/qwen2api
Environment=PATH=/home/qwen2api/.bun/bin:/usr/local/bin:/usr/bin:/bin
# 采集脚本会自动找 /usr/bin/chromium 或 google-chrome；找不到时再显式指定：
# Environment=CHROME_PATH=/usr/bin/chromium
ExecStart=/home/qwen2api/.bun/bin/bun --no-env-file src/server.js
Restart=always
RestartSec=3
TimeoutStopSec=20
# 账号统计/限流/会话复用都是进程内状态：必须单实例，不要开多份

[Install]
WantedBy=multi-user.target
```

```bash
sudo chown -R qwen2api:qwen2api /opt/qwen2api
sudo systemctl daemon-reload
sudo systemctl enable --now qwen2api
curl -s http://127.0.0.1:3000/api/health        # 200 即启动成功
```

#### 更新到新版本

```bash
cd /opt/qwen2api
sudo systemctl stop qwen2api                             # 先停，避免构建时半天不响应
sudo git pull --ff-only                                  # 或 rsync 新代码过来
sudo -u qwen2api bun install --frozen-lockfile --production
sudo -u qwen2api bun install --cwd public --frozen-lockfile
sudo -u qwen2api bun run build:frontend
sudo systemctl start qwen2api
```

注意：`data/` 和 `.env` 不在 git 里，`pull` 不会覆盖，放心更新。

#### 用脚本管理服务（不装 systemd 时）

仓库自带一个控制脚本，只依赖 `bash` + `bun`，PID 和日志都放在 `logs/` 下：

```bash
./scripts/qwen2api.sh start      # 后台启动（写 logs/qwen2api.pid，日志 logs/qwen2api.out）
./scripts/qwen2api.sh status     # 状态 + 健康检查
./scripts/qwen2api.sh restart    # 重启
./scripts/qwen2api.sh stop       # 停止（先 TERM，15 秒不退再 KILL）
./scripts/qwen2api.sh logs       # 跟踪日志（默认最近 100 行）
```

它顺手挡掉几个常见错误：重复启动（同一份数据不能起两个实例）、没有 `.env`（自动从模板复制并提示要改什么）、`.env` 里没有 `API_KEY`、前端没构建、以及检测到 systemd 服务已在运行时拒绝再起一份。

#### 停止 / 重启 / 看日志

```bash
sudo systemctl stop qwen2api                     # 停止
sudo systemctl restart qwen2api                  # 重启
sudo systemctl status qwen2api                   # 状态
sudo journalctl -u qwen2api -f                   # 实时日志（Ctrl+C 退出）
sudo journalctl -u qwen2api --since '10 min ago' # 最近 10 分钟
```

前台运行时直接 `Ctrl+C` 停止；不想装 systemd 可以 `nohup bun run start > qwen2api.log 2>&1 &` 放后台，`kill <PID>` 停止。

#### 数据与备份

- `data/`：账号、浏览器会话指纹（`browser-profile.<邮箱>.json`）、统计 —— **必须备份**
- `.env`：密钥与配置 —— 也要备份
- `public/dist/`：前端构建产物，可随时重建

换端口改 `.env` 的 `SERVICE_PORT`；多副本部署前必须先解决进程内状态共享，否则统计/限流各算各的。

#### 常见问题

| 现象 | 原因与处理 |
|---|---|
| 加账号提示「保存失败」，日志有 `环境变量模式不支持保存账户数据` | `DATA_SAVE_MODE` 还是 `none`。改成 `file` 重启（现在面板会直接提示这条） |
| 启动即报 `请务必设置 API_KEY 环境变量` | 没有 `.env`，或不在项目根目录启动 |
| 账号状态列一直「缺会话」/ 请求报 `unauthorized` | 服务器没装 Chromium，或该账号密码不对；点「可用性」列旁的「生成」看具体报错 |
| 端口被占用 | 改 `.env` 的 `SERVICE_PORT`，或 `ss -lntp \| grep 3000` 找占用进程 |
| 前端页面 404 / 空白 | 没跑 `bun run build:frontend`，`public/dist` 不存在 |

### 🌐 账号级代理 / Per-account proxy

每个账号可以配置自己专属的出站代理，从而让多个账号通过不同的 IP 同时使用，规避 `chat.qwen.ai` 基于 IP 的关联封禁。

**优先级：** `account.proxy` > 全局 `PROXY_URL` > 不使用代理

**支持的代理协议：** HTTP / HTTPS / SOCKS5 / SOCKS5H（与 `PROXY_URL` 一致）

**前端配置（推荐）：**
打开管理面板 → 添加账号时填写 "代理地址" 字段，或在已有账号卡片上点击 "修改代理" 按钮。

**ENV 配置（DATA_SAVE_MODE=none）：**

```bash
# 旧格式（向后兼容，账号级代理留空）
ACCOUNTS=user1@mail.com:pass1,user2@mail.com:pass2

# 新格式（用 | 分隔代理 URL，可与旧格式混用）
ACCOUNTS=user1@mail.com:pass1|http://10.0.0.1:8080,user2@mail.com:pass2|socks5://10.0.0.2:1080
```

**file 模式 (`data/data.json`) schema：**

```json
{
  "accounts": [
    {
      "email": "user@mail.com",
      "password": "...",
      "token": "...",
      "expires": 1234567890,
      "proxy": "http://10.0.0.1:8080"
    }
  ]
}
```

`proxy` 字段为 `null` 或缺失时，账号回退到全局 `PROXY_URL`（若配置）。

> ⚠️ **注意：** 接口返回的代理 URL 不做脱敏处理。本项目假设运行在受信任的本地或私有网络环境中，由单一管理员使用。

### 环境要求

- Bun 1.3.14+ (源码部署时需要，Docker 固定使用 1.3.14)
- Node.js 24+ (仅开发时运行现有回归测试及 lint，生产镜像不需要)
- Docker (可选)
- Redis (可选，用于数据持久化)

### ⚙️ 环境配置

创建 `.env` 文件并配置以下参数：

```bash
# 🌐 服务配置
LISTEN_ADDRESS=localhost       # 监听地址
SERVICE_PORT=3000             # 服务端口

# 🔐 安全配置
API_KEY=sk-123456,sk-456789   # API 密钥 (必填，支持多密钥)
ACCOUNTS=                     # 账户配置 (格式: user1:pass1[|proxy_url],user2:pass2[|proxy_url])

# 🔍 功能配置
SEARCH_INFO_MODE=table        # 搜索信息展示模式 (table/text)
OUTPUT_THINK=true             # 是否输出思考过程 (true/false)
LEGACY_REASONING_IN_CONTENT=false # 推理输出格式，false=reasoning_content字段，true=旧版<think>并入content (true/false)
SIMPLE_MODEL_MAP=false        # 简化模型映射 (true/false)
MODELS_CACHE_TTL=3600         # 模型列表缓存有效期（秒），0=永不过期
AGENT_TURN_MAX_ATTEMPTS=3     # 单个 Agent 回合生成有效工具调用/最终态的最大尝试数（2-6）
AGENT_TURN_MAX_TOOL_CALLS=24  # Anthropic 路径单轮文本通道 tool_use 上限（4-256），到数即截断上游
AGENT_TURN_ALLOW_PROSE_WITH_TOOLS=false  # 允许工具调用回合同时带可见正文（Anthropic 客户端）
AGENT_TURN_ACCEPT_BARE_FINAL=false       # 允许没有 <agent_final> 包装的可见正文作为正常结束
AGENT_CONTEXT_FILE_THRESHOLD_BYTES=92160 # 超过阈值时外置完整 Agent 上下文
AGENT_CONTEXT_LIVE_PROMPT_BYTES=49152     # 外置后仍内联保留的关键任务状态大小

# 🌐 代理与反代配置
QWEN_CHAT_PROXY_URL=          # 自定义 Chat API 反代URL (默认: https://chat.qwen.ai)
QWEN_CLI_PROXY_URL=           # 自定义 CLI API 反代URL (默认: https://portal.qwen.ai)
PROXY_URL=                    # HTTP/HTTPS/SOCKS5/SOCKS5H 代理地址 (例如: http://127.0.0.1:7890)

# 🗄️ 数据存储
DATA_SAVE_MODE=none           # 数据保存模式 (none/file/redis)
REDIS_URL=                    # Redis 连接地址 (可选，使用TLS时为rediss://)
BATCH_LOGIN_CONCURRENCY=5     # 批量添加账号时的登录并发数

# 📸 缓存配置
CACHE_MODE=default            # 图片缓存模式 (default/file)
```

#### 📋 配置说明

| 参数 | 说明 | 示例 |
|------|------|------|
| `LISTEN_ADDRESS` | 服务监听地址 | `localhost` 或 `0.0.0.0` |
| `SERVICE_PORT` | 服务运行端口 | `3000` |
| `API_KEY` | API 访问密钥，支持多密钥配置。第一个为管理员密钥（可访问前端管理页面），其他为普通密钥（仅可调用API）。多个密钥用逗号分隔 | `sk-admin123,sk-user456,sk-user789` |
| `SEARCH_INFO_MODE` | 搜索结果展示格式 | `table` 或 `text` |
| `OUTPUT_THINK` | 是否显示 AI 思考过程 | `true` 或 `false` |
| `LEGACY_REASONING_IN_CONTENT` | 推理输出格式。默认 `false`=推理走独立的 `reasoning_content` 字段；`true`=旧版行为（`<think>` 并入 `content`） | `true` 或 `false` |
| `SIMPLE_MODEL_MAP` | 简化模型映射，只返回基础模型不包含变体 | `true` 或 `false` |
| `MODEL_MAP` | 入站模型名映射：`alias=qwen-id,...,*=fallback`。精确匹配优先（末尾 `[..]` 先去掉、不区分大小写），上游已有的 Qwen id 原样透传，其余走 `*`；只作用于 `/v1/chat/completions`、`/v1/messages` 与 `/v1/responses`。也可在管理面板「系统设置 → 模型映射」里在线编辑，面板保存的映射优先于本变量；详见 `.env.example` | `*=qwen3.8-max-thinking` |
| `MODELS_CACHE_TTL` | 模型列表缓存有效期（秒），过期后下次请求自动向上游刷新；`0` 表示永不过期 | `3600` |
| `AGENT_TURN_ALLOW_PROSE_WITH_TOOLS` | 放宽回合门禁：允许同一回合既有有效工具调用又有可见正文。Anthropic Messages API 允许 `text` 与 `tool_use` 共存，Claude Code 等客户端因此会被严格模式反复判为 `invalid_tool_call` | `false` |
| `AGENT_TURN_ACCEPT_BARE_FINAL` | 放宽回合门禁：把有可见正文但缺少 `<agent_final>` 包装的回合按 `finish_reason=stop` 接受，而不是判为 `bare` 并重试 | `false` |
| `AGENT_TURN_MAX_ATTEMPTS` | 工具请求在一次 HTTP 回合内生成有效 `tool_calls`、明确完成态或阻塞态的最大尝试数；范围 2–6，耗尽后非流式请求返回 HTTP 429/503，SSE 请求返回显式错误帧，绝不伪装成正常 `stop` | `3` |
| `AGENT_TURN_MAX_TOOL_CALLS` | Anthropic 路径：一轮 Agent 回合里文本通道 `tool_use` 的上限（4–256）。模型在叙述的 `[TOOL CALL]` 之后失控（同一调用重复上百次、幻想整段会话）时，第 N 个已放行的调用之后立刻终止上游，已放行的调用以 `stop_reason=tool_use` 交付；更早的 delta 里已放行过调用之后再出现重复、被拒绝的调用或正文/思考同样截断 | `24` |
| `AGENT_CONTEXT_FILE_THRESHOLD_BYTES` | Agent 请求体超过此大小时，将完整工具定义和历史自动外置为 Qwen 文本文档，避免触发约 128 KiB 的 WAF 限制 | `92160`（90 KiB） |
| `AGENT_CONTEXT_LIVE_PROMPT_BYTES` | 上下文外置后，实时请求中保留的工具协议、system/developer 指令、原始任务、最近工具进度和当前结果的最大大小 | `49152`（48 KiB） |
| `QWEN_CHAT_PROXY_URL` | 自定义 Chat API 反代地址 | `https://your-proxy.com` |
| `QWEN_CLI_PROXY_URL` | 自定义 CLI API 反代地址 | `https://your-cli-proxy.com` |
| `PROXY_URL` | 出站请求代理地址，支持 HTTP/HTTPS/SOCKS5/SOCKS5H | `http://127.0.0.1:7890` |
| `DATA_SAVE_MODE` | 数据持久化方式 | `none`/`file`/`redis` |
| `REDIS_URL` | Redis 数据库连接地址，使用TLS加密时需使用 `rediss://` 协议 | `redis://localhost:6379` 或 `rediss://xxx.upstash.io` |
| `BATCH_LOGIN_CONCURRENCY` | 批量添加账号时的登录并发数，可在前端系统设置中动态调整 | `5` |
| `CACHE_MODE` | 图片缓存存储方式 | `default`/`file` |
| `LOG_LEVEL` | 日志级别 | `DEBUG`/`INFO`/`WARN`/`ERROR` |
| `ENABLE_FILE_LOG` | 是否启用文件日志 | `true` 或 `false` |
| `LOG_DIR` | 日志文件目录 | `./logs` |
| `MAX_LOG_FILE_SIZE` | 最大日志文件大小(MB) | `10` |
| `MAX_LOG_FILES` | 保留的日志文件数量 | `5` |

> 💡 **提示**: 可以在 [Upstash](https://upstash.com/) 免费创建 Redis 实例，使用 TLS 协议时地址格式为 `rediss://...`
<div>
<img src="./docs/images/upstash.png" alt="Upstash Redis" width="600">
</div>

#### 🔑 多API_KEY配置说明

`API_KEY` 环境变量支持配置多个API密钥，用于实现不同权限级别的访问控制：

**配置格式:**
```bash
# 单个密钥（管理员权限）
API_KEY=sk-admin123

# 多个密钥（第一个为管理员，其他为普通用户）
API_KEY=sk-admin123,sk-user456,sk-user789
```

**权限说明:**

| 密钥类型 | 权限范围 | 功能描述 |
|----------|----------|----------|
| **管理员密钥** | 完整权限 | • 访问前端管理页面<br>• 修改系统设置<br>• 调用所有API接口<br>• 添加/删除普通密钥 |
| **普通密钥** | API调用权限 | • 仅可调用API接口<br>• 无法访问前端管理页面<br>• 无法修改系统设置 |

**使用场景:**
- **团队协作**: 为不同团队成员分配不同权限的API密钥
- **应用集成**: 为第三方应用提供受限的API访问权限
- **安全隔离**: 将管理权限与普通使用权限分离

**注意事项:**
- 第一个API_KEY自动成为管理员密钥，拥有最高权限
- 管理员可以通过前端页面动态添加或删除普通密钥
- 所有密钥都可以正常调用API接口，权限差异仅体现在管理功能上

#### 📸 CACHE_MODE 缓存模式说明

`CACHE_MODE` 环境变量控制图片缓存的存储方式，用于优化图片上传和处理性能：

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| `default` | 内存缓存模式 (默认) | 单进程部署，重启后缓存丢失 |
| `file` | 文件缓存模式 | 多进程部署，缓存持久化到 `./caches/` 目录 |

**推荐配置:**
- **单进程部署**: 使用 `CACHE_MODE=default`，性能最佳
- **多进程/集群部署**: 使用 `CACHE_MODE=file`，确保进程间缓存共享
- **Docker 部署**: 建议使用 `CACHE_MODE=file` 并挂载 `./caches` 目录

**文件缓存目录结构:**
```
caches/
├── [signature1].txt    # 缓存文件，包含图片URL
├── [signature2].txt
└── ...
```

---

## 🚀 部署方式

### 🐳 Docker 部署

#### 方式一：直接运行

```bash
docker run -d \
  -p 3000:3000 \
  -e API_KEY=sk-admin123,sk-user456,sk-user789 \
  -e DATA_SAVE_MODE=none \
  -e CACHE_MODE=file \
  -e ACCOUNTS= \
  -v ./caches:/app/caches \
  --name qwen2api \
  rfym21/qwen2api:latest
```

#### 方式二：Docker Compose

```bash
# 下载配置文件
curl -o docker-compose.yml https://raw.githubusercontent.com/Rfym21/Qwen2API/refs/heads/main/docker/docker-compose.yml

# 启动服务
docker compose pull && docker compose up -d
```

### 📦 本地部署

推荐照前文「🚀 一步步部署与服务管理」走一遍：从装 Bun 到配 systemd 都有对应步骤。

手动部署的最小步骤：

```bash
git clone https://github.com/Rfym21/Qwen2API.git && cd Qwen2API
bun install --frozen-lockfile
bun install --cwd public --frozen-lockfile
bun run build:frontend
cp .env.example .env          # 至少填 API_KEY 和账号
bun run start                 # = bun --no-env-file src/server.js
bun run dev                   # 开发模式（--watch）
```

### 运行与验证

服务使用 Bun 单进程运行，已移除 PM2 和自动 cluster 启动。旧的
`PM2_INSTANCES`、`PM2_MAX_MEMORY` 不再生效。容器重启由 Compose 的
`restart: always` 管理；内存上限可使用 Compose 的 `mem_limit` 配置。
账户统计、限流和运行时设置含进程内状态，多副本部署前需要先解决共享与同步。

`bun run test` 保留 Node 测试运行器，以继续执行原有回归测试；
`bun run test:bun` 则启动真实 Bun 服务和本地模拟上游，检查登录、前端、WASM
及 OpenAI/Anthropic 的 JSON 和 SSE 响应，不使用真实账户。
默认以源码运行，也可使用 `node src/server.js` 临时对照验证。

### 独立二进制

```bash
# 当前系统/架构；自动构建前端，输出到 pkg_dist/
bun run build:binary

# 可选：交叉编译 Linux x64（Alpine 使用 bun-linux-x64-musl）
bun run build:binary --target bun-linux-x64

# Windows 产物的隔离验证
bun run test:bun --binary pkg_dist/qwen2api-windows-x64.exe
```

可执行文件内含 Bun 运行时、后端、前端静态资源和 tiktoken WASM，无需另装
Node、Bun 或 node_modules。Windows x64 产物为 `pkg_dist/qwen2api-windows-x64.exe`。
目标系统必须与编译目标一致；交叉编译完成不代表已在该系统验证。

启动前进入一个可写目录，在该目录配置 `.env`（或直接设置环境变量），再运行可执行文件。
`.env` 和账户凭据不会打包进产物。二进制默认将 `data/`、`logs/`、`caches/`
放在当前工作目录；可用 `QWEN2API_RUNTIME_DIR` 指定其他可写根目录。
`--version` 可查看版本，不会启动服务。Docker 使用 Alpine + musl 二进制，
不再复制源码、node_modules 或单独的 Bun CLI。

### CI 与发布工作流

- `ci.yml`：推送和 PR 调用验证流程，只上传 Actions artifacts，不发布。
- `verify.yml`：可复用验证。Node 24 执行 lint 与完整回归，Bun 版本取自
  `package.json` 的 `packageManager`；前端只构建一次。Windows x64、Linux x64/arm64
  在各自原生 runner 编译并测试二进制，Linux 额外测试实际的 Alpine 容器。
- `release.yml`：仅监听 `main` 的 `package.json`。比较推送前后的 `version`，
  未变化就跳过产物构建和发布；新建分支没有比较基准时也跳过，可手动构建。
  普通源码提交、PR、标签推送均不触发发布。

手动操作：Actions → Release → Run workflow。不勾选 `publish` 只验证并生成 artifacts；
勾选后只允许从 `main` 发布，且仍必须完整通过验证。

发布产物为 Windows x64、Linux x64/arm64 的 `.tar.gz`（可执行文件、`.env.example`、
运行说明）和 `SHA256SUMS`，以及 `linux/amd64`、`linux/arm64` 多架构 Docker 镜像。
Linux 下载包为 glibc 版，Docker 为 musl 版。发布直接加载验证任务导出的镜像，
不重新构建；自动生成 `v<version>` 标签。只有 main 仍为同一版本、且发布提交仍在
main 历史中时才更新 `latest`，后续普通文档提交不会阻止更新。

首次启用需要配置 `DOCKERHUB_USERNAME`、`DOCKERHUB_TOKEN` secrets，并确保 Docker Hub
目标仓库可写。发布使用 `release` environment，可设置 main 分支限制和人工审批；
只有发布 job 具有 `contents: write` 权限，其他验证任务不接触发布凭据。

已发布版本不能覆盖。Git 标签或 Docker 版本标签指向其他提交时，必须提升版本号。
中途失败会保留草稿，允许在同一提交上重跑；多个外部服务的发布不是原子事务，
失败时可能已出现部分镜像标签。当前版本曾发布过旧镜像，首次正式发布应使用新版本。
发布 job 使用 GitHub 的 `queue: max` 保留等待任务（最多 100 个），不会因新的
普通 package.json 提交而替换掉待发布版本。验证任务可以并行，发布阶段串行执行。

本地构建二进制镜像仍可直接运行：
```bash
docker build -f docker/Dockerfile -t qwen2api:local .
# Linux 上测试实际容器（使用本地模拟上游，不使用真实账户）
bun run test:bun --docker-image qwen2api:local
```

### ☁️ Hugging Face 部署

快速部署到 Hugging Face Spaces：

[![Deploy to Hugging Face](https://img.shields.io/badge/🤗%20Hugging%20Face-Deploy-yellow)](https://huggingface.co/spaces/devme/q2waepnilm)

<div>
<img src="./docs/images/hf.png" alt="Hugging Face Deployment" width="600">
</div>

### ☁️ Vercel 部署

快速部署到 Vercel：

此平台入口仍保留 Node/Express 兼容方式；Bun 运行时迁移适用于本地和 Docker。

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FRfym21%2FQwen2API)

需要配置环境变量：
```
ACCOUNTS=email:password
SERVICE_PORT=80
API_KEY=sk-xxx
DATA_SAVE_MODE=none
```


---

## 📁 项目结构

```
Qwen2API/
├── README.md
├── bun.lock                         # Bun依赖锁文件
├── package.json
│
├── docker/                          # Docker配置目录
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── docker-compose-redis.yml
│
├── caches/                          # 缓存文件目录
├── data/                            # 数据文件目录
│   ├── data.json
│   └── data_template.json
├── scripts/                         # 脚本目录
│   └── fingerprint-injector.js      # 浏览器指纹注入脚本
│
├── src/                             # 后端源代码目录
│   ├── server.js                    # 主服务器文件
│   ├── config/
│   │   └── index.js                 # 配置文件
│   ├── controllers/                 # 控制器目录
│   │   ├── chat.js                  # 聊天控制器
│   │   ├── chat.image.video.js      # 图片/视频生成控制器
│   │   ├── cli.chat.js              # CLI聊天控制器
│   │   └── models.js                # 模型控制器
│   ├── middlewares/                 # 中间件目录
│   │   ├── authorization.js         # 授权中间件
│   │   └── chat-middleware.js       # 聊天中间件
│   ├── models/                      # 模型目录
│   │   └── models-map.js            # 模型映射配置
│   ├── routes/                      # 路由目录
│   │   ├── accounts.js              # 账户路由
│   │   ├── chat.js                  # 聊天路由
│   │   ├── cli.chat.js              # CLI聊天路由
│   │   ├── models.js                # 模型路由
│   │   ├── settings.js              # 设置路由
│   │   └── verify.js                # 验证路由
│   └── utils/                       # 工具函数目录
│       ├── account-rotator.js       # 账户轮询器
│       ├── account.js               # 账户管理
│       ├── chat-helpers.js          # 聊天辅助函数
│       ├── cli.manager.js           # CLI管理器
│       ├── cookie-generator.js      # Cookie生成器
│       ├── data-persistence.js      # 数据持久化
│       ├── fingerprint.js           # 浏览器指纹生成
│       ├── img-caches.js            # 图片缓存
│       ├── logger.js                # 日志工具
│       ├── precise-tokenizer.js     # 精确分词器
│       ├── proxy-helper.js          # 代理辅助函数
│       ├── redis.js                 # Redis连接
│       ├── request.js               # HTTP请求封装
│       ├── setting.js               # 设置管理
│       ├── ssxmod-manager.js        # ssxmod参数管理
│       ├── token-manager.js         # Token管理器
│       ├── tools.js                 # 工具调用处理
│       └── upload.js                # 文件上传
│
└── public/                          # 前端项目目录
    ├── dist/                        # 编译后的前端文件
    │   ├── assets/                  # 静态资源
    │   ├── favicon.png
    │   └── index.html
    ├── src/                         # 前端源代码
    │   ├── App.vue                  # 主应用组件
    │   ├── main.js                  # 入口文件
    │   ├── style.css                # 全局样式
    │   ├── assets/                  # 静态资源
    │   │   └── background.mp4
    │   ├── routes/                  # 路由配置
    │   │   └── index.js
    │   └── views/                   # 页面组件
    │       ├── auth.vue             # 认证页面
    │       ├── dashboard.vue        # 仪表板页面
    │       └── settings.vue         # 设置页面
    ├── package.json                 # 前端依赖配置
    ├── package-lock.json
    ├── index.html                   # 前端入口HTML
    ├── postcss.config.js            # PostCSS配置
    ├── tailwind.config.js           # TailwindCSS配置
    ├── vite.config.js               # Vite构建配置
    └── public/                      # 公共静态资源
        └── favicon.png
```

## 📖 API 文档

### 🔐 API 认证说明

本API支持多密钥认证机制，所有API请求都需要在请求头中包含有效的API密钥：

```http
Authorization: Bearer sk-your-api-key
```

**支持的密钥类型:**
- **管理员密钥**: 第一个配置的API_KEY，拥有完整权限
- **普通密钥**: 其他配置的API_KEY，仅可调用API接口

**认证示例:**
```bash
# 使用管理员密钥
curl -H "Authorization: Bearer sk-admin123" http://localhost:3000/v1/models

# 使用普通密钥
curl -H "Authorization: Bearer sk-user456" http://localhost:3000/v1/chat/completions
```

### 🔍 获取模型列表

获取所有可用的 AI 模型列表。

```http
GET /v1/models
Authorization: Bearer sk-your-api-key
```

```http
GET /models (免认证)
```

**说明:**
- `id`: 推荐直接作为请求里的 `model` 使用，优先展示更易读的模型名称
- `name`: 上游原始模型 ID，便于与官方接口或日志对照
- `upstream_id`: 不带能力后缀的上游模型 ID
- `display_name`: 不带能力后缀的展示名
- 当 `SIMPLE_MODEL_MAP=false` 时，会额外返回 `-thinking`、`-search`、`-image`、`-video`、`-image-edit` 等能力变体

**响应示例:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "Qwen3-Omni-Flash-image",
      "name": "qwen3-omni-flash-2025-12-01-image",
      "upstream_id": "qwen3-omni-flash-2025-12-01",
      "display_name": "Qwen3-Omni-Flash",
      "object": "model",
      "created": 1677610602,
      "owned_by": "qwen"
    }
  ]
}
```

### 💬 聊天对话

发送聊天消息并获取 AI 回复。

```http
POST /v1/chat/completions
Content-Type: application/json
Authorization: Bearer sk-your-api-key
```

**请求体:**
```json
{
  "model": "Qwen3.6-Plus",
  "messages": [
    {
      "role": "system",
      "content": "你是一个有用的助手。"
    },
    {
      "role": "user",
      "content": "你好，请介绍一下自己。"
    }
  ],
  "stream": false,
  "temperature": 0.7,
  "max_tokens": 2000
}
```

**响应示例:**
```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "qwen3.6-plus",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "你好！我是一个AI助手..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 50,
    "total_tokens": 70
  }
}
```

### 🛠️ Function Calling（工具调用）

`/v1/chat/completions` 支持完整的 OpenAI Function Calling 协议。即便上游 Web 接口本身不具备原生 tools 能力，本服务通过提示词注入与流式状态机解析，使其行为与 OpenAI API 一致：

- 自动将 `tools[]` 压缩为 TS 风格签名注入提示词，节省约 70% token 开销
- 流式输出按 OpenAI 规范分片：先发 `function.name + 空 arguments` 头块，随后多个 `arguments` 切片
- 历史消息中的 `assistant.tool_calls` 与 `role:"tool"` 自动折叠回链，`tool_call_id` 精确关联
- `tool_choice` 全四态：`"auto"` / `"required"` / `{type:"function",function:{name:"..."}}` / `"none"`
- 携带工具的请求启用严格三态回合门禁：未完成必须返回真实 `tool_calls`；只有显式确认全部完成或确实阻塞时才能返回 `stop`
- 每个上游生成尝试的裸正文、工具调用和结束状态保持门禁隔离；安全 thinking 与合法 `agent_final` / `agent_blocked` 包装体内的正式正文都会实时显示，但只有闭标签验证通过后才发送 `finish_reason=stop`
- 默认最多执行 3 次协议纠正（可用 `AGENT_TURN_MAX_ATTEMPTS` 配置为 2–6）；耗尽后非流式请求返回真正的 HTTP 429/503，已经建立的 SSE 则发送标准错误帧和 `[DONE]`，两者都不会伪造 `finish_reason=stop`
- 流式请求立即建立真正的 SSE，按上游节奏分别发送 `reasoning_content` 和正式 `content`，并用 SSE 注释帧保活；非流式门禁仍使用 HTTP `102 Processing` 保活，以保留最终真实状态码
- 协议纠正会复用同一个 Qwen `chatId`，并使用主回答（`response_index=0`）的 `response_id` 作为下一次 `parentId`，避免一次回合制造多个 `New chat`
- thinking 通道若只包含一个完整、合法的工具调用块，也会安全转换为标准 OpenAI `tool_calls`，不会因“只有思考”而中断 Agent
- Qwen Web 以干净 HTTP EOF 正常结束时会正确映射为 `stop` / `tool_calls`；只有连接重置等真实传输异常才返回流错误
- Agent 请求体超过安全阈值时，完整上下文会通过 Qwen 官方文件接口外置，同时内联保留 system/developer 指令、原始任务、最近工具链和当前结果；附件失败时也使用同样的关键状态压缩策略
- Qwen 返回 HTTP 200 的 WAF/captcha 业务帧时，会显式返回 `upstream_waf_challenge`，不再伪装为空成功或普通 502

> 对 Codex、Claude Code、OpenClaw 等长时间运行的 Agent，建议保持默认的 90 KiB / 48 KiB 阈值。若反代还会附加较大的请求头或正文，可适当下调 `AGENT_CONTEXT_FILE_THRESHOLD_BYTES`。

**请求示例：**

```json
{
  "model": "qwen3-coder-plus",
  "stream": true,
  "messages": [
    {"role": "user", "content": "查一下北京的天气"}
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "获取城市天气",
        "parameters": {
          "type": "object",
          "properties": { "city": { "type": "string" } },
          "required": ["city"]
        }
      }
    }
  ],
  "tool_choice": "required"
}
```

**流式响应（节选）：**

```
data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_xxx","type":"function","function":{"name":"get_weather","arguments":""}}]}}]}

data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"city\":\"Beijing\"}"}}]}}]}

data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}

data: [DONE]
```

OpenAI SDK、LangChain、Cline、Continue 等遵循 OpenAI 工具协议的客户端可直接接入。

### 🤖 Anthropic Messages API

提供 **Anthropic-compatible bridge** 的 `/v1/messages` 端点，可直接对接 Claude Code、Anthropic SDK、aider 等常见客户端。

> 说明：Qwen2API 是兼容桥接层，不是 Anthropic 官方等价实现。对未支持字段，本项目当前采用**尽量宽松**的策略：尽可能接受请求，并通过响应头与服务端日志显式提示，而不是继续静默忽略。对 `system`、多轮 `messages`、`tools`、`tool_choice`、`thinking` 等字段，当前为**近似兼容**，并非官方原生语义。

```http
POST /v1/messages
Content-Type: application/json
Authorization: Bearer sk-your-api-key
```

**兼容矩阵：**

| 字段 / 能力 | 状态 | 当前行为 | 备注 / 客户端影响 |
|---|---|---|---|
| `model` | Supported | 映射到 Qwen 模型名 | 可用任意可解析的 Qwen 模型 ID |
| `messages.text` | Supported | 支持基础文本消息 | 基础聊天可用 |
| `messages.image` | Supported | 支持图片块并转译到内部图片格式 | 适合常见多模态客户端 |
| `messages.tool_use` | Partial | 接收 Anthropic 风格 `tool_use` 历史块，但内部会转译并折叠 | 不是上游原生工具调用语义 |
| `messages.tool_result` | Partial | 接收 `tool_result`，内部转为桥接层工具结果文本 | `is_error` 等细节不保证保真 |
| `system` | Partial | 会被合并进提示前缀 | 不是独立的原生 system 层 |
| `messages`（多轮） | Partial | 多轮历史会被压缩/转译 | 结构化上下文语义为近似兼容 |
| `tools[]` | Partial | 支持基础 `{name,input_schema,description}` | 通过 prompt/XML 模拟，不是原生 upstream tool execution |
| `tool_choice` | Partial | 支持 `auto` / `any` / `tool` / `none` 基础形态 | 依赖提示词与 retry hint，不是上游强保证 |
| `thinking` | Partial | 当前接受旧式 `thinking: {type:"enabled", budget_tokens:N}` 并近似映射 | 不等价官方新式 adaptive thinking / effort 语义 |
| `stream` | Supported | 返回 Anthropic 风格 SSE 事件序列 | 适合 Claude Code 等流式客户端 |
| `max_tokens` | Ignored with warning | 当前不会真实限制上游输出 | 会通过 warning headers / logs 显式提示 |
| `stop_sequences` | Ignored with warning | 当前未映射到上游停止序列 | 会通过 warning headers / logs 显式提示 |
| `metadata` | Ignored with warning | 当前不参与上游请求 | 会通过 warning headers / logs 显式提示 |
| `temperature` / `top_p` / `top_k` | Ignored with warning | 当前不参与上游采样控制 | 会通过 warning headers / logs 显式提示 |
| `service_tier` | Ignored with warning | 当前不支持 | 会通过 warning headers / logs 显式提示 |
| `container` | Ignored with warning | 当前不支持 | 会通过 warning headers / logs 显式提示 |
| `output_config` | Ignored with warning | 当前不支持 structured outputs / effort 等官方语义 | 会通过 warning headers / logs 显式提示 |
| `mcp_servers` | Not supported yet | 当前不支持 Anthropic MCP runtime 语义 | 当前仅提示风险，后续版本可能改为显式报错 |
| `context_management` | Not supported yet | 当前不支持 compaction / context editing 等官方语义 | 当前仅提示风险，后续版本可能改为显式报错 |

当请求包含近似支持或未支持字段时，响应可能带有以下 header：

- `X-Qwen2API-Anthropic-Compatibility`
- `X-Qwen2API-Anthropic-Warnings`

这些 header 用于提示当前请求中哪些 Anthropic 能力是 **Partial**、哪些字段被 **Ignored with warning**，不会改变成功响应 body 的基本结构。

**请求示例（含工具调用）：**

```json
{
  "model": "qwen3-coder-plus",
  "max_tokens": 1024,
  "messages": [
    {"role": "user", "content": "查广州天气"}
  ],
  "tools": [
    {
      "name": "get_weather",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "tool_choice": { "type": "any" }
}
```

> 注意：上例中的 `max_tokens` 当前会被接受，但仍属于 **Ignored with warning**，不会像官方 Anthropic API 那样真实约束上游输出。

**非流式响应：**

```json
{
  "id": "msg_xxx",
  "type": "message",
  "role": "assistant",
  "model": "qwen3-coder-plus",
  "content": [
    {
      "type": "tool_use",
      "id": "call_xxx",
      "name": "get_weather",
      "input": { "city": "广州" }
    }
  ],
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "usage": { "input_tokens": 233, "output_tokens": 25 }
}
```

**流式 SSE 事件序列：**

```
event: message_start
data: {"type":"message_start","message":{...}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call_xxx","name":"get_weather","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"city\":\"广州\"}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"input_tokens":234,"output_tokens":25}}

event: message_stop
data: {"type":"message_stop"}
```

### 🔌 OpenAI Responses API

提供 **OpenAI Responses API** 的 `/v1/responses` 端点。它采用 OpenAI 新版的「解耦」格式：输入是 `input` 条目，输出是 `output` 条目，流式响应是一串 `response.*` 事件。该端点与 `/v1/chat/completions` 相互独立、可以并存；OpenAI 官方 SDK 的 `client.responses.create()`、Codex CLI 等遵循该协议的客户端可直接接入。

```http
POST /v1/responses
Content-Type: application/json
Authorization: Bearer sk-your-api-key
```

**请求示例（流式）：**

```bash
curl -N http://localhost:3000/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-api-key" \
  -d '{
    "model": "qwen3.7-plus",
    "input": "用一句话解释什么是向量数据库",
    "instructions": "你是简洁的助手，回答不超过三句话。",
    "stream": true,
    "max_output_tokens": 1024,
    "temperature": 0.7,
    "reasoning": { "effort": "medium" }
  }'
```

**`input` 的写法：**

纯字符串，等价于一条 user 消息：

```json
{ "input": "你好" }
```

消息数组，`content` 可以是字符串，也可以是分段数组：

```json
{
  "input": [
    { "role": "user", "content": "你好" }
  ]
}
```

```json
{
  "input": [
    { "role": "user", "content": [{ "type": "input_text", "text": "你好" }] }
  ]
}
```

工具结果回填，通常与上一轮的 `function_call` 条目一起发回：

```json
{
  "input": [
    { "type": "function_call", "call_id": "call_xxx", "name": "get_time", "arguments": "{}" },
    { "type": "function_call_output", "call_id": "call_xxx", "output": "{\"time\":\"12:00\"}" }
  ]
}
```

**请求字段：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `model` | string | 模型 ID，取值同 `/v1/models` 返回的 `id` |
| `input` | string \| array | 字符串或条目数组，写法见上 |
| `instructions` | string | 等价于 `system`，会放在对话最前面 |
| `stream` | boolean | `true` 时返回 SSE 事件流，默认 `false` |
| `max_output_tokens` | number | 输出长度上限 |
| `temperature` / `top_p` | number | 采样参数 |
| `tools[]` | array | 函数工具，形状为 `{type:"function",name,description,parameters}`（比 `/v1/chat/completions` 少一层 `function` 包装） |
| `tool_choice` | string \| object | `auto` / `required` / `none`，或 `{type:"function",name:"..."}` 指定函数 |
| `reasoning.effort` | string | `none` / `minimal` 关闭思考，其余取值开启思考 |
| `user` | string | 终端用户标识，随请求透传 |

**非流式请求：**

```json
{
  "model": "qwen3.7-plus",
  "input": "你好",
  "instructions": "只用两个字回答，不要解释。"
}
```

**非流式响应：**

```json
{
  "id": "resp_d2beb5aef96b4826a58e36a920630467",
  "object": "response",
  "created_at": 1792661279,
  "status": "completed",
  "model": "qwen3.7-plus",
  "output": [
    {
      "id": "rs_2c68fffeb3e34ebe8d8b9c0f81677704",
      "type": "reasoning",
      "summary": [
        { "type": "summary_text", "text": "我仔细审视了用户的明确要求，即仅以两个字进行回应。……" }
      ]
    },
    {
      "id": "msg_f2f5eeb079c14b83a8bb0f91591b3f03",
      "type": "message",
      "status": "completed",
      "role": "assistant",
      "content": [
        { "type": "output_text", "text": "你好", "annotations": [] }
      ]
    }
  ],
  "usage": {
    "input_tokens": 1236,
    "output_tokens": 84,
    "total_tokens": 1320,
    "input_tokens_details": { "cached_tokens": 0 },
    "output_tokens_details": { "reasoning_tokens": 0 }
  },
  "error": null,
  "incomplete_details": null
}
```

`output` 是条目数组，按顺序可能出现三类条目：

- `reasoning`：思考摘要，文本在 `summary[0].text`
- `message`：正式回答，文本在 `content[0].text`（`type` 为 `output_text`）
- `function_call`：工具调用，字段为 `call_id` / `name` / `arguments`，其中 `arguments` 是 JSON 字符串

**工具调用（多轮）：**

`tools[]` 使用 Responses 的扁平形状。第一轮请求：

```json
{
  "model": "qwen3-coder-plus",
  "input": "现在几点？",
  "tools": [
    {
      "type": "function",
      "name": "get_time",
      "description": "返回当前时间",
      "parameters": { "type": "object", "properties": {} }
    }
  ]
}
```

响应的 `output` 中出现 `function_call` 条目：

```json
{
  "id": "fc_xxx",
  "type": "function_call",
  "status": "completed",
  "call_id": "call_abc123",
  "name": "get_time",
  "arguments": "{}"
}
```

第二轮把这次调用和工具结果一起放进 `input`，即可拿到正常正文：

```json
{
  "model": "qwen3-coder-plus",
  "input": [
    { "type": "function_call", "call_id": "call_abc123", "name": "get_time", "arguments": "{}" },
    { "type": "function_call_output", "call_id": "call_abc123", "output": "{\"time\":\"2026-10-22 17:30\"}" }
  ]
}
```

实测第二轮返回正文「现在是 2026年10月22日 17:30。」。工具调用由服务端解析完成，客户端只会看到标准 `function_call` 条目，看不到内部协议文本。

**流式事件（节选）：**

```
event: response.created
data: {"type":"response.created","response":{...}}

event: response.in_progress
data: {"type":"response.in_progress","response":{...}}

event: response.output_item.added
data: {"type":"response.output_item.added","output_index":0,"item":{"id":"rs_xxx","type":"reasoning","summary":[]}}

event: response.reasoning_summary_part.added
data: {"type":"response.reasoning_summary_part.added","item_id":"rs_xxx","output_index":0,"summary_index":0,"part":{"type":"summary_text","text":""}}

event: response.reasoning_summary_text.delta
data: {"type":"response.reasoning_summary_text.delta","item_id":"rs_xxx","output_index":0,"summary_index":0,"delta":"先说明用途"}

event: response.output_item.added
data: {"type":"response.output_item.added","output_index":1,"item":{"id":"msg_xxx","type":"message","status":"in_progress","role":"assistant","content":[]}}

event: response.content_part.added
data: {"type":"response.content_part.added","item_id":"msg_xxx","output_index":1,"content_index":0,"part":{"type":"output_text","text":"","annotations":[]}}

event: response.output_text.delta
data: {"type":"response.output_text.delta","item_id":"msg_xxx","output_index":1,"content_index":0,"delta":"向量数据库"}

event: response.content_part.done
data: {"type":"response.content_part.done","item_id":"msg_xxx","output_index":1,"content_index":0,"part":{"type":"output_text","text":"向量数据库把文本…","annotations":[]}}

event: response.output_item.done
data: {"type":"response.output_item.done","output_index":1,"item":{"id":"msg_xxx","type":"message","status":"completed","role":"assistant","content":[...]}}

event: response.completed
data: {"type":"response.completed","response":{...}}
```

**事件顺序：**

1. `response.created` → `response.in_progress`
2. 有思考时：`response.output_item.added`（reasoning）→ `response.reasoning_summary_part.added` → `response.reasoning_summary_text.delta` × N → `response.reasoning_summary_text.done` → `response.reasoning_summary_part.done` → `response.output_item.done`（reasoning）
3. 正式回答：`response.output_item.added`（message）→ `response.content_part.added` → `response.output_text.delta` × N → `response.output_text.done` → `response.content_part.done` → `response.output_item.done`（message）
4. 有工具调用时：`response.output_item.added`（function_call）→ `response.function_call_arguments.delta` × N → `response.function_call_arguments.done` → `response.output_item.done`
5. 结束：`response.completed`；出错时改为 `response.failed`
6. 没有 `[DONE]` 结束帧，请以 `response.completed` / `response.failed` 判断流是否结束

**与 `/v1/chat/completions` 的差异：**

| 维度 | `/v1/chat/completions` | `/v1/responses` |
|---|---|---|
| 输入 | `messages[]`，system 用 `role:"system"` | `input`（字符串或条目数组），system 用 `instructions` |
| 工具定义 | `{type:"function",function:{name,...}}` | `{type:"function",name,...}`（少一层 `function`） |
| 工具结果 | `role:"tool"` + `tool_call_id` | `{type:"function_call_output",call_id,output}` 条目 |
| 输出 | `choices[0].message.content` | `output[]` 条目数组（`reasoning` / `message` / `function_call`） |
| 用量 | `prompt_tokens` / `completion_tokens` / `total_tokens` | `input_tokens` / `output_tokens` / `total_tokens`，另含 `input_tokens_details` / `output_tokens_details` |
| 流式 | `data: {"choices":[{"delta":...}]}`，以 `[DONE]` 结束 | `event: response.*` + `data: {"type":...}`，以 `response.completed` 结束 |

**客户端接入：**

OpenAI 官方 Python SDK 直接可用：

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:3000/v1", api_key="sk-your-api-key")

resp = client.responses.create(
    model="qwen3.7-plus",
    input="用一句话解释什么是向量数据库",
)
print(resp.output_text)
```

Codex CLI 只需在 `~/.codex/config.toml` 里把自定义 provider 的 `wire_api` 设为 `"responses"`、`base_url` 指向 `http://localhost:3000/v1`（具体字段以 Codex CLI 文档为准）。

**说明：**

- 目前 Responses 链路按文本处理：图片、视频等非文本 `content` 分段会被忽略，多模态请继续使用 `/v1/chat/completions`
- `usage` 中的 `input_tokens_details.cached_tokens` 与 `output_tokens_details.reasoning_tokens` 目前固定为 `0`（暂未透出该粒度）
- `tools[]` 只接受 `type:"function"`；`web_search`、`file_search` 等内置工具暂不支持
- 请求体不合法时返回 `400`：`input` 为空（`code` 为 `invalid_input`）、缺少 `model`（`code` 为 `invalid_model`）；上游失败返回 `502` 或上游状态码，错误体统一为 `{"error":{"message","type","code","param"}}`
- 流式失败时发送 `response.failed`，其 `response.status` 为 `failed`，`error` 字段带 `code` / `message`

### 🎨 图像与视频生成

当前支持两种调用方式：
- 使用 `/v1/chat/completions` + 模型后缀：`-image`、`-image-edit`、`-video`
- 使用 OpenAI 风格资源端点：`/v1/images/generations`、`/v1/images/edits`、`/v1/videos`

以下示例中的模型名请以 `/v1/models` 返回的 `id` 字段为准。

#### 方式一：通过 `/v1/chat/completions`

文本生图：

```json
{
  "model": "Qwen3-Omni-Flash-image",
  "messages": [
    {
      "role": "user",
      "content": "画一只在花园里玩耍的小猫咪，卡通风格"
    }
  ],
  "size": "1:1",
  "stream": false
}
```

图片编辑：

```json
{
  "model": "Qwen3-Omni-Flash-image-edit",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "把这张图片改成浅蓝色科技风海报"
        },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/png;base64,..."
          }
        }
      ]
    }
  ],
  "stream": false
}
```

视频生成：

```json
{
  "model": "Qwen3-Omni-Flash-video",
  "messages": [
    {
      "role": "user",
      "content": "生成一个 3 秒夜景延时视频，城市街道霓虹灯闪烁"
    }
  ],
  "size": "9:16",
  "stream": false
}
```

**支持的尺寸参数:**
- `/v1/chat/completions` 下的图片/视频生成支持 `1:1`、`4:3`、`3:4`、`16:9`、`9:16`
- `/v1/images/generations`、`/v1/images/edits`、`/v1/videos` 兼容 `1024x1024`、`1536x1024`、`1024x1536`、`1792x1024`、`1024x1792`

#### 方式二：OpenAI 风格资源端点

图像生成：

```http
POST /v1/images/generations
Content-Type: application/json
Authorization: Bearer sk-your-api-key
```

```json
{
  "model": "Qwen3-Omni-Flash",
  "prompt": "一只橘猫坐在木桌上看向镜头，写实风格",
  "size": "1024x1024",
  "response_format": "url"
}
```

图像编辑：

```http
POST /v1/images/edits
Content-Type: multipart/form-data
Authorization: Bearer sk-your-api-key
```

表单字段：
- `model`: 可选，不传时自动选择支持图片编辑的默认模型
- `prompt`: 可选，默认为 `请基于上传图片完成编辑`
- `image`: 必填，支持 multipart 文件上传，也支持 JSON 字符串形式的图片 URL / data URI
- `size`: 可选，支持 OpenAI 风格尺寸写法
- `response_format`: 可选，支持 `url`、`b64_json`

视频生成：

```http
POST /v1/videos
Content-Type: application/json
Authorization: Bearer sk-your-api-key
```

```json
{
  "model": "Qwen3-Omni-Flash",
  "prompt": "一个简短的 3 秒夜景延时视频，城市街道霓虹灯闪烁",
  "size": "1024x1792"
}
```

图像生成响应示例：

```json
{
  "created": 1776126402,
  "data": [
    {
      "url": "https://cdn.qwenlm.ai/output/example/generated-image.png"
    }
  ]
}
```

视频生成响应示例：

```json
{
  "id": "video_1776126509490",
  "object": "video",
  "created": 1776126509,
  "model": "qwen3-omni-flash-2025-12-01",
  "status": "completed",
  "data": [
    {
      "url": "https://cdn.qwenlm.ai/output/example/generated-video.mp4"
    }
  ]
}
```

### 🎯 高级功能

#### 🔍 智能搜索模式

在模型名称后添加 `-search` 后缀启用搜索功能：

```json
{
  "model": "Qwen3.6-Plus-search",
  "messages": [...]
}
```

#### 🧠 推理模式

在模型名称后添加 `-thinking` 后缀启用思考过程输出：

```json
{
  "model": "Qwen3.6-Plus-thinking",
  "messages": [...]
}
```

#### 🔍🧠 组合模式

同时启用搜索和推理功能：

```json
{
  "model": "Qwen3.6-Plus-thinking-search",
  "messages": [...]
}
```

#### 🖼️ 多模态支持

API 自动处理图片和视频上传，支持在对话中发送图片、视频 URL 或 Base64 data URI。

图片理解示例：

```json
{
  "model": "Qwen3.5-Omni-Plus",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "这张图片里有什么？"
        },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/jpeg;base64,..."
          }
        }
      ]
    }
  ]
}
```

视频理解示例：

```json
{
  "model": "Qwen3.5-Omni-Plus",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "请用一句话描述这个视频"
        },
        {
          "type": "input_video",
          "input_video": {
            "url": "data:video/mp4;base64,..."
          }
        }
      ]
    }
  ]
}
```

支持的视频字段：
- `input_video`
- `video_url`
- `video`

### 🖥️ CLI 端点

CLI 端点使用 Qwen Code / Qwen Cli 的 OAuth 令牌访问，支持 256K 上下文和工具调用（Function Calling）。

**支持的模型：**

| 模型 ID | 说明 |
|---------|------|
| `qwen3-coder-plus` | Qwen3 Coder Plus |
| `qwen3-coder-flash` | Qwen3 Coder Flash（速度更快） |
| `coder-model` | Qwen 3.5 Plus（带思维链，256K 上下文） |
| `qwen3.5-plus` | `coder-model` 的别名，自动重定向 |

#### 💬 CLI 聊天对话

通过 CLI 端点发送聊天请求，支持流式和非流式响应。

```http
POST /cli/v1/chat/completions
Content-Type: application/json
Authorization: Bearer API_KEY
```

**请求体:**
```json
{
  "model": "qwen3-coder-plus",
  "messages": [
    {
      "role": "user",
      "content": "你好，请介绍一下自己。"
    }
  ],
  "stream": false,
  "temperature": 0.7,
  "max_tokens": 2000
}
```

使用 `coder-model`（即 Qwen 3.5 Plus）或其别名 `qwen3.5-plus`：
```json
{
  "model": "coder-model",
  "messages": [
    {
      "role": "user",
      "content": "写一个快速排序算法。"
    }
  ],
  "stream": false
}
```

**流式请求:**
```json
{
  "model": "qwen3-coder-flash",
  "messages": [
    {
      "role": "user",
      "content": "写一首关于春天的诗。"
    }
  ],
  "stream": true
}
```

**响应格式:**

非流式响应与标准 OpenAI API 格式相同：
```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "qwen3-coder-plus",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "你好！我是一个AI助手..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 50,
    "total_tokens": 70
  }
}
```

流式响应使用 Server-Sent Events (SSE) 格式：
```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"qwen3-coder-flash","choices":[{"index":0,"delta":{"content":"你好"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"qwen3-coder-flash","choices":[{"index":0,"delta":{"content":"！"},"finish_reason":null}]}

data: [DONE]
```

---

## ⚠️ 免责声明

1. 本项目仅供学习交流使用，**严禁用于任何商业用途**。
2. 使用本项目所产生的一切后果由使用者自行承担，项目开发者不承担任何责任。
3. 本项目不对 `chat.qwen.ai` 及 `Qwen Code / Qwen Cli` 的服务可用性、稳定性作任何保证。
4. 使用者应遵守所在地区的法律法规，以及通义千问的服务条款和使用政策。
5. 如有侵权，请联系作者删除。

## 🚫 禁止商用

本项目采用 **仅限个人学习与研究** 的使用许可：

- 禁止将本项目或其衍生作品用于任何商业目的，包括但不限于：出售、出租、提供付费服务、嵌入商业产品等。
- 禁止利用本项目进行任何违反通义千问服务条款的行为。
- 禁止将本项目用于大规模自动化调用、恶意攻击或滥用上游服务。
