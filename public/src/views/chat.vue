<template>
  <!-- 参考 Qwen 官网的布局：左侧会话栏贴边、右侧对话区通栏，中间不留缝、不套卡片 -->
  <div class="flex h-full min-h-0 bg-surface">
    <!-- 左：会话列表（桌面常驻；窄屏放进抽屉） -->
    <aside class="hidden w-[248px] shrink-0 flex-col bg-canvas md:flex">
      <SessionList
        :groups="sessionGroups"
        :active-id="state.activeSessionId"
        @new="newConversation"
        @select="loadSession"
        @delete="deleteSession"
      />
    </aside>

    <!-- 右：对话区（通栏，内容居中成阅读列） -->
    <div class="flex min-w-0 flex-1 flex-col">
      <!-- 顶栏：模型选择 + 当前会话 + 操作 -->
      <div class="flex h-14 shrink-0 items-center gap-2 px-4">
        <button
          type="button"
          class="btn-icon md:hidden"
          :aria-label="t('chatui.sessions')"
          :title="t('chatui.sessions')"
          @click="state.sessionsOpen = true"
        >
          <Icon name="menu" :size="18" />
        </button>

        <div class="relative flex min-w-0 items-center">
          <button
            type="button"
            class="flex h-9 max-w-[260px] items-center gap-1 rounded-control px-2 text-sm font-medium text-ink transition-colors hover:bg-canvas"
            :disabled="state.modelsLoading || state.models.length === 0"
            :aria-expanded="state.modelOpen"
            aria-haspopup="listbox"
            @click="state.modelOpen = !state.modelOpen"
          >
            <span class="truncate">{{ currentModelLabel }}</span>
            <Icon name="chevron-down" :size="14" class="shrink-0 text-ink-mute" />
          </button>

          <!-- 模型下拉：native select 的宽度会跟着最长选项走，箭头会飘很远，所以自己画一个 -->
          <template v-if="state.modelOpen">
            <div class="fixed inset-0 z-40" @click="state.modelOpen = false"></div>
            <div
              class="absolute left-0 top-full z-50 mt-1 max-h-[320px] w-[280px] overflow-y-auto rounded-card border border-line bg-surface p-1 shadow-pop"
              role="listbox"
            >
              <button
                v-for="opt in state.models"
                :key="opt.value"
                type="button"
                role="option"
                :aria-selected="opt.value === state.model"
                class="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-sm transition-colors"
                :class="opt.value === state.model ? 'bg-brand-50 text-brand-700' : 'text-ink-soft hover:bg-canvas hover:text-ink'"
                @click="selectModel(opt.value)"
              >
                <Icon v-if="opt.value === state.model" name="check" :size="14" class="shrink-0 text-brand-600" />
                <span v-else class="w-[14px] shrink-0"></span>
                <span class="truncate">{{ opt.label }}</span>
              </button>
            </div>
          </template>
        </div>

        <span v-if="state.generating" class="badge badge-brand shrink-0">
          <Icon name="spinner" :size="12" class="animate-spin" />
          {{ t("chatui.sending") }}
        </span>

        <div class="ml-auto flex shrink-0 items-center gap-1">
          <label
            class="hidden cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-control px-2 py-1 text-xs text-ink-soft hover:bg-canvas sm:flex"
            :title="t('chatui.toolsHint')"
          >
            <input v-model="state.toolsEnabled" type="checkbox" class="h-3.5 w-3.5 accent-brand-600" />
            {{ t("chatui.toolsToggle") }}
          </label>
          <button
            class="btn-icon h-9 w-9"
            :disabled="state.messages.length === 0 && !state.generating"
            :title="t('chatui.clear')"
            :aria-label="t('chatui.clear')"
            @click="clearConversation"
          >
            <Icon name="trash" :size="16" />
          </button>
        </div>
      </div>

      <!-- 消息区：通栏滚动，内容限宽居中 -->
      <div ref="messagesRef" class="min-h-0 flex-1 overflow-y-auto">
        <!-- 空状态引导 -->
        <div
          v-if="visibleMessages.length === 0"
          class="mx-auto flex h-full w-full max-w-[820px] flex-col items-center justify-center gap-4 px-6 py-10 text-center"
        >
          <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
            <Icon name="message" :size="24" />
          </div>
          <div>
            <p class="text-base font-semibold text-ink">{{ t("chatui.emptyTitle") }}</p>
            <p class="mt-1 text-xs text-ink-mute">{{ t("chatui.emptyHint") }}</p>
          </div>
          <div class="flex w-full max-w-[560px] flex-wrap justify-center gap-2">
            <button
              v-for="tip in suggestions"
              :key="tip"
              class="max-w-full rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
              @click="useSuggestion(tip)"
            >
              <span class="truncate">{{ tip }}</span>
            </button>
          </div>
        </div>

        <!-- 消息列表 -->
        <div v-else class="mx-auto flex w-full max-w-[820px] flex-col gap-6 px-4 py-6">
          <div v-for="message in visibleMessages" :key="message.id" class="group/message">
            <!-- 用户消息：右对齐气泡 -->
            <div v-if="message.role === 'user'" class="flex justify-end">
              <div class="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-canvas px-4 py-2.5 text-sm leading-6 text-ink">{{ message.content }}</div>
            </div>

            <!-- 助手消息：不加边框/气泡，直接排版（和 Qwen 一致） -->
            <div v-else class="min-w-0 text-sm leading-7 text-ink">
              <!-- 思考过程：可折叠，正文开始后自动收起 -->
              <div v-if="message.reasoning" class="mb-3 overflow-hidden rounded-xl bg-canvas">
                <button
                  type="button"
                  class="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] text-ink-soft hover:bg-canvas-2"
                  :aria-expanded="message.reasoningOpen !== false"
                  @click="toggleReasoning(message)"
                >
                  <Icon
                    name="chevron-down"
                    :size="12"
                    class="shrink-0 transition-transform"
                    :class="message.reasoningOpen === false ? '-rotate-90' : ''"
                  />
                  <span class="font-medium">{{ t("chatui.reasoning") }}</span>
                  <span class="text-ink-mute">{{ t("chatui.reasoningChars", { n: message.reasoning.length }) }}</span>
                  <span
                    v-if="isStreamingMessage(message) && !message.content"
                    class="ml-auto inline-flex items-center gap-1 text-ink-mute"
                  >
                    <Icon name="spinner" :size="11" class="animate-spin" />
                    {{ t("chatui.thinking") }}
                  </span>
                </button>
                <pre
                  v-show="message.reasoningOpen !== false"
                  class="mono max-h-64 overflow-y-auto whitespace-pre-wrap break-words border-t border-line/60 px-3 py-2 text-[11px] leading-5 text-ink-soft"
                >{{ message.reasoning }}</pre>
              </div>

              <!-- 工具调用 -->
              <div v-if="message.toolCalls?.length" class="mb-3 space-y-2">
                <div
                  v-for="call in message.toolCalls"
                  :key="call.id"
                  class="rounded-xl border border-line bg-canvas px-3 py-2"
                >
                  <div class="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-ink-soft">
                    <Icon name="settings" :size="13" class="shrink-0" />
                    <span>{{ t("chatui.toolCall") }}</span>
                    <span class="mono rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] text-ink">
                      {{ call.name }}
                    </span>
                  </div>
                  <pre class="mono mt-1.5 overflow-x-auto whitespace-pre text-[11px] leading-4 text-ink-soft">{{ prettyJson(call.arguments) }}</pre>
                  <div v-if="toolResultFor(call)" class="mt-1.5 border-t border-line pt-1.5">
                    <span class="text-[11px] text-ink-mute">{{ t("chatui.toolResult") }}</span>
                    <pre class="mono mt-0.5 overflow-x-auto whitespace-pre text-[11px] leading-4 text-ink-soft">{{ prettyJson(toolResultFor(call)) }}</pre>
                  </div>
                </div>
              </div>

              <div
                v-if="message.content"
                class="md-body"
                v-html="renderMessage(message, isStreamingMessage(message))"
              ></div>
              <span
                v-else-if="isStreamingMessage(message)"
                class="inline-flex items-center gap-1 text-sm text-ink-mute"
              >{{ t("chatui.thinking") }}<span class="md-cursor"></span></span>

              <!-- 消息操作：hover 才出现，保持画面干净 -->
              <div v-if="message.content" class="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100">
                <button
                  class="btn-icon h-7 w-7 text-ink-mute"
                  :title="t('chatui.copy')"
                  :aria-label="t('chatui.copy')"
                  @click="copyMessage(message)"
                >
                  <Icon name="copy" :size="14" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 错误条 -->
      <div v-if="state.error" class="shrink-0 px-4">
        <div
          class="mx-auto flex w-full max-w-[820px] items-start gap-2 rounded-xl border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700"
          role="alert"
        >
          <Icon name="alert" :size="16" class="mt-0.5 shrink-0" />
          <p class="flex-1 break-words">{{ state.error }}</p>
          <button
            class="btn-icon h-6 w-6 text-danger-600 hover:bg-danger-100 hover:text-danger-700"
            :aria-label="t('chatui.dismiss')"
            @click="state.error = ''"
          >
            <Icon name="x" :size="14" />
          </button>
        </div>
      </div>

      <!-- 输入区：悬浮圆角输入条（Qwen 风格） -->
      <div class="shrink-0 px-4 pb-4 pt-2">
        <div class="mx-auto w-full max-w-[820px]">
          <div
            class="flex items-end gap-2 rounded-[26px] border border-line bg-surface px-3 py-2 shadow-card transition-colors focus-within:border-brand-200"
          >
            <textarea
              ref="textareaRef"
              v-model="state.prompt"
              rows="1"
              class="max-h-[184px] min-h-[2.25rem] flex-1 resize-none border-0 bg-transparent px-1 py-1.5 text-sm leading-6 text-ink outline-none placeholder:text-ink-mute focus:ring-0"
              :placeholder="t('chatui.placeholder')"
              @keydown="onKeydown"
              @compositionstart="onCompositionStart"
              @compositionend="onCompositionEnd"
            ></textarea>
            <button
              v-if="state.generating"
              class="btn-danger h-9 shrink-0 rounded-full px-3"
              @click="stopGeneration"
            >
              <Icon name="stop" :size="15" />
              {{ t("chatui.stop") }}
            </button>
            <button
              v-else
              class="btn-primary h-9 w-9 shrink-0 rounded-full p-0"
              :disabled="!state.prompt.trim()"
              :title="t('chatui.send')"
              :aria-label="t('chatui.send')"
              @click="send"
            >
              <Icon name="send" :size="16" />
            </button>
          </div>
          <p class="mt-2 hidden text-center text-[11px] text-ink-mute sm:block">{{ t("chatui.enterHint") }}</p>
        </div>
      </div>
    </div>

    <!-- 窄屏会话抽屉：和左侧列表同一份组件，避免两套逻辑 -->
    <div v-if="state.sessionsOpen" class="fixed inset-0 z-40 md:hidden">
      <div class="absolute inset-0 bg-ink/40" @click="state.sessionsOpen = false"></div>
      <aside class="absolute inset-y-0 left-0 flex w-64 flex-col bg-surface shadow-pop">
        <div class="flex h-12 shrink-0 items-center justify-between border-b border-line px-3">
          <span class="text-sm font-semibold text-ink">{{ t("chatui.sessions") }}</span>
          <button
            class="btn-icon h-7 w-7"
            :aria-label="t('chatui.close')"
            @click="state.sessionsOpen = false"
          >
            <Icon name="x" :size="16" />
          </button>
        </div>
        <SessionList
          :groups="sessionGroups"
          :active-id="state.activeSessionId"
          @new="newConversation"
          @select="loadSession"
          @delete="deleteSession"
        />
      </aside>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Icon from "../components/ui/Icon.vue";
import SessionList from "../components/chat/SessionList.vue";
import { toast, confirm, copyText } from "../ui/feedback.js";

defineOptions({
  name: "Chat",
});

const { t } = useI18n();

const apiKey = localStorage.getItem("apiKey") || "";
const typeKey = "Content-Type";
const tokenKey = "Authorization";
const token = `Bearer ${apiKey}`;

// 输入框最大高度：约 8 行，超出后内部滚动
const MAX_INPUT_HEIGHT = 184;
// 历史会话：多会话保存，方便多轮测试之间交叉排查（最多 20 个会话 / 每会话 100 条消息）
const SESSIONS_KEY = "chat.sessions";
// 旧版本只有一个「当前对话」槽位，首次启动时迁移成一条会话记录
const LEGACY_HISTORY_KEY = "chat.history";
const SESSION_LIMIT = 20;
const SESSION_MESSAGE_LIMIT = 100;
// 演示工具开关持久化
const TOOLS_KEY = "chat.tools";
// 工具调用循环上限：最多 3 轮，防止模型反复调用工具死循环
const MAX_TOOL_ROUNDS = 3;

// 演示工具定义：只提供 get_time，用来直观验证工具调用链路
const DEMO_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_time",
      description: "返回当前时间",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

const state = reactive({
  models: [],
  modelsLoading: true,
  messages: [],
  prompt: "",
  model: "",
  generating: false,
  error: "",
  toolsEnabled: localStorage.getItem(TOOLS_KEY) === "1",
  // 历史会话列表（元数据 + 消息体）与当前会话 id
  sessions: [],
  activeSessionId: "",
  // 窄屏下的会话抽屉
  sessionsOpen: false,
  // 模型下拉是否展开
  modelOpen: false,
});

// 顶栏显示的模型名：没加载完时给占位文案，避免按钮空着
const currentModelLabel = computed(() => {
  const found = state.models.find((opt) => opt.value === state.model);
  if (found) return found.label;
  if (state.modelsLoading) return t("chatui.modelsLoading");
  return t("chatui.modelPlaceholder");
});

const selectModel = (value) => {
  state.model = value;
  state.modelOpen = false;
};

const messagesRef = ref(null);
const textareaRef = ref(null);

// 当前请求的中断句柄；停止生成 / 清空对话 / 卸载时都会用到
let abortController = null;
// 清空对话时丢弃「已停止生成」提示，避免打扰
let discardOutput = false;
// 中文输入法组合期标记：组合期回车不能触发发送
let composing = false;
// 消息自增 id：列表 key 与 Markdown 缓存都用它
let messageSeq = 0;
let persistTimer = 0;

const suggestions = computed(() => [
  t("chatui.suggest1"),
  t("chatui.suggest2"),
  t("chatui.suggest3"),
]);

// 只展示对话消息；role=tool 是回传给模型的内部消息，不单独渲染
const visibleMessages = computed(() => state.messages.filter((message) => message.role !== "tool"));

const createMessage = (role, content = "", extra = {}) => ({
  id: ++messageSeq,
  role,
  content,
  ...extra,
});

// 是否最后一条正在流式输出（用于光标与「生成中」占位）。
// 必须按 id 比较：模板里拿到的是响应式代理，和 push 进去的原始对象不是同一个引用。
const isStreamingMessage = (message) => {
  if (!state.generating) return false;
  const last = state.messages[state.messages.length - 1];
  return Boolean(last && message.id === last.id);
};

// 当前会话标题（浏览器标签页标题用；没有用户消息时显示「未命名」）
const activeTitle = computed(() => {
  const session = state.sessions.find((item) => item.id === state.activeSessionId);
  return session?.title || t("chatui.untitled");
});

// 标签页标题跟着当前会话走：开多个标签页做交叉排查时能分清哪个是哪个
const DEFAULT_TITLE = "Qwen2API Dashboard";
watch(
  activeTitle,
  (title) => {
    document.title = title ? `${title} · Qwen2API` : DEFAULT_TITLE;
  },
  { immediate: true },
);

// 会话列表按时间分组（今天 / 近 7 天 / 更早），和主流聊天客户端一致
const sessionGroups = computed(() => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayStart = startOfToday.getTime();
  const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;
  const groups = [
    { key: "chatui.groupToday", sessions: [] },
    { key: "chatui.groupWeek", sessions: [] },
    { key: "chatui.groupEarlier", sessions: [] },
  ];
  for (const session of state.sessions) {
    const updatedAt = Number(session.updatedAt) || 0;
    if (updatedAt >= todayStart) groups[0].sessions.push(session);
    else if (updatedAt >= weekStart) groups[1].sessions.push(session);
    else groups[2].sessions.push(session);
  }
  return groups;
});

/* ---------------- 轻量 Markdown 渲染（零依赖，先转义再替换） ---------------- */

const escapeHtml = (text) =>
  String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// 链接只放行 http(s) / 站内路径 / 锚点 / mailto，其余一律降级成纯文本
const safeUrl = (url) => {
  const value = String(url || "").trim();
  return /^(https?:\/\/|\/|#|mailto:)/i.test(value) ? value : "";
};

// 行内语法：行内代码先抽出来占位，避免其中的 * _ 被误解析
const renderInline = (text) => {
  const codes = [];
  let output = String(text).replace(/`([^`]+)`/g, (match, code) => {
    codes.push(`<code class="md-code">${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  output = output
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, url) => {
      const href = safeUrl(url);
      return href
        ? `<a href="${href}" target="_blank" rel="noreferrer noopener">${label}</a>`
        : label;
    });
  return output.replace(/\u0000(\d+)\u0000/g, (match, index) => codes[Number(index)] || "");
};

const TABLE_SEPARATOR = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/;
const splitTableRow = (line) =>
  line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());

// 块级解析：标题 / 代码块 / 引用 / 列表 / 表格 / 分隔线 / 段落
const renderMarkdown = (raw) => {
  const source = escapeHtml(String(raw ?? "")).replace(/\r\n?/g, "\n");
  if (!source) return "";
  const lines = source.split("\n");
  const output = [];
  let index = 0;
  let paragraph = [];
  let list = null;
  let quote = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      output.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      output.push(
        `<${list.type}>${list.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${list.type}>`,
      );
      list = null;
    }
  };
  const flushQuote = () => {
    if (quote.length) {
      output.push(`<blockquote>${renderInline(quote.join(" "))}</blockquote>`);
      quote = [];
    }
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    // ``` 代码块：内容保持转义后的原文，等宽 + 横向滚动
    const fence = trimmed.match(/^```\s*([\w-]*)\s*$/);
    if (fence) {
      flushAll();
      const code = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index].trim())) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1; // 跳过结束围栏（缺失时自然到结尾）
      output.push(`<pre class="md-pre"><code>${code.join("\n")}</code></pre>`);
      continue;
    }

    if (!trimmed) {
      flushAll();
      index += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      output.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushAll();
      output.push("<hr />");
      index += 1;
      continue;
    }

    // 表格：表头行 + |---| 分隔行
    if (trimmed.includes("|") && index + 1 < lines.length && TABLE_SEPARATOR.test(lines[index + 1].trim())) {
      flushAll();
      const header = splitTableRow(trimmed);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].trim().includes("|")) {
        rows.push(splitTableRow(lines[index].trim()));
        index += 1;
      }
      const head = header.map((cell) => `<th>${renderInline(cell)}</th>`).join("");
      const body = rows
        .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`)
        .join("");
      output.push(
        `<div class="md-table-wrap"><table class="md-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
      );
      continue;
    }

    // 引用：转义后 ">" 变成 "&gt;"
    const quoteLine = trimmed.match(/^&gt;\s?(.*)$/);
    if (quoteLine) {
      flushParagraph();
      flushList();
      quote.push(quoteLine[1]);
      index += 1;
      continue;
    }

    const ordered = trimmed.match(/^(\d{1,3})[.)]\s+(.*)$/);
    const bullet = trimmed.match(/^[-*+]\s+(.*)$/);
    if (ordered || bullet) {
      flushParagraph();
      flushQuote();
      const type = ordered ? "ol" : "ul";
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push(ordered ? ordered[2] : bullet[1]);
      index += 1;
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(trimmed);
    index += 1;
  }

  flushAll();
  return output.join("");
};

// 流式光标用独立 span 拼进 HTML，保证光标紧跟最后一段文字而不是另起一行
const MD_CURSOR = '<span class="md-cursor"></span>';

// 每段内容只渲染一次：内容没变时直接命中缓存，流式过程中只重算变化的那条
const markdownCache = new WeakMap();
const renderMessage = (message, streaming = false) => {
  const cached = markdownCache.get(message);
  if (cached && cached.content === message.content && cached.streaming === streaming) {
    return cached.html;
  }
  const html = renderMarkdown(message.content) + (streaming ? MD_CURSOR : "");
  markdownCache.set(message, { content: message.content, streaming, html });
  return html;
};

/* ---------------- 历史测试记录（多会话） ---------------- */

// 为什么改成多会话：测试代理的多轮/工具/会话复用行为时，往往要跑好几段对话再交叉比对。
// 旧实现只有一个槽位（chat.history），换话题或清空就把上一段测试记录冲掉了。
// 现在每次测试是一段独立会话，列表里保留最近 SESSION_LIMIT 段，可随时切回去看。

const newSessionId = () => `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const createEmptySession = () => ({
  id: newSessionId(),
  title: "",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  messages: [],
});

// 会话标题 = 第一条用户消息（单行、截断），和大多数聊天客户端一致
const sessionTitleFrom = (messages) => {
  const firstUser = messages.find((message) => message.role === "user" && message.content);
  return firstUser ? firstUser.content.replace(/\s+/g, " ").trim().slice(0, 40) : "";
};

const serializeMessage = (message) => ({
  role: message.role,
  content: message.content,
  // 思考内容一并存下来：回看历史时要能复盘模型的推理过程
  ...(message.reasoning ? { reasoning: message.reasoning } : {}),
  ...(message.toolCalls?.length ? { toolCalls: message.toolCalls } : {}),
  ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
  ...(message.toolName ? { toolName: message.toolName } : {}),
});

const serializeMessages = () => {
  const recent = state.messages.slice(-SESSION_MESSAGE_LIMIT);
  // 截断可能让开头的 tool 回执失去对应的 assistant 调用，丢掉这些孤立回执
  while (recent.length > 0 && recent[0].role === "tool") recent.shift();
  return recent.map(serializeMessage);
};

const deserializeMessage = (item) => {
  const message = createMessage(item.role, String(item.content ?? ""));
  if (typeof item.reasoning === "string" && item.reasoning) {
    message.reasoning = item.reasoning;
    // 历史记录里的思考默认收起，避免一屏全是推理过程
    message.reasoningOpen = false;
  }
  if (Array.isArray(item.toolCalls)) {
    message.toolCalls = item.toolCalls
      .filter((call) => call && call.name)
      .map((call) => ({
        id: String(call.id || ""),
        name: String(call.name),
        arguments: String(call.arguments ?? ""),
      }));
  }
  if (item.toolCallId) message.toolCallId = String(item.toolCallId);
  if (item.toolName) message.toolName = String(item.toolName);
  return message;
};

const readSessions = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSIONS_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((session) => session && typeof session.id === "string" && Array.isArray(session.messages))
      .map((session) => ({
        id: session.id,
        title: typeof session.title === "string" ? session.title : "",
        createdAt: Number(session.createdAt) || Date.now(),
        updatedAt: Number(session.updatedAt) || Date.now(),
        messages: session.messages,
      }));
  } catch (error) {
    return [];
  }
};

const writeSessions = (sessions) => {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch (error) {
    // 存储写满 / 隐私模式：历史只是便利功能，失败不影响对话
  }
};

// 把当前消息写回当前会话，并按「最近更新」排序 + 修剪
const persistActiveSession = () => {
  const index = state.sessions.findIndex((session) => session.id === state.activeSessionId);
  if (index === -1) return;
  const messages = serializeMessages();
  const session = state.sessions[index];
  session.messages = messages;
  session.title = sessionTitleFrom(messages);
  session.updatedAt = Date.now();

  const ordered = [...state.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  // 保留最近更新的 SESSION_LIMIT 段，但当前会话一定留着（刚更新过，正常就在最前）
  const kept = ordered.slice(0, SESSION_LIMIT);
  if (!kept.some((item) => item.id === session.id)) kept[kept.length - 1] = session;
  state.sessions = kept;
  writeSessions(kept);
};

const persistNow = () => {
  window.clearTimeout(persistTimer);
  persistTimer = 0;
  persistActiveSession();
};

// 流式输出时内容每帧都在变，防抖后写 localStorage，避免每个 token 都写一次
const schedulePersist = () => {
  if (persistTimer) return;
  persistTimer = window.setTimeout(persistNow, 400);
};

// 启动：读会话列表；老版本的单槽历史迁移成第一段会话；没有就新建一段
const bootSessions = () => {
  let sessions = readSessions();

  if (sessions.length === 0) {
    let legacy = null;
    try {
      legacy = JSON.parse(localStorage.getItem(LEGACY_HISTORY_KEY) || "[]");
    } catch (error) {
      legacy = null;
    }
    if (Array.isArray(legacy) && legacy.length > 0) {
      const messages = legacy
        .filter((item) => item && ["user", "assistant", "tool"].includes(item.role))
        .slice(-SESSION_MESSAGE_LIMIT);
      if (messages.length > 0) {
        sessions = [{
          ...createEmptySession(),
          title: sessionTitleFrom(messages),
          messages,
        }];
      }
      localStorage.removeItem(LEGACY_HISTORY_KEY);
    }
  }

  if (sessions.length === 0) sessions = [createEmptySession()];
  state.sessions = sessions;
  const latest = sessions[0];
  state.activeSessionId = latest.id;
  state.messages = latest.messages.map(deserializeMessage);
};

// 切换会话：先把当前写盘，再加载目标（正在生成时先中断，避免把两段对话混在一起）
const loadSession = (id) => {
  if (id === state.activeSessionId) {
    state.sessionsOpen = false;
    return;
  }
  if (state.generating) {
    discardOutput = true;
    stopGeneration();
  }
  persistActiveSession();
  const session = state.sessions.find((item) => item.id === id);
  if (!session) return;
  state.activeSessionId = id;
  state.messages = session.messages.map(deserializeMessage);
  state.error = "";
  state.sessionsOpen = false;
  nextTick(scrollToBottom);
};

// 新建一段测试会话（当前这段保留在历史里）
const newConversation = async () => {
  if (state.generating) {
    const ok = await confirm({
      title: t("chatui.newChat"),
      message: t("chatui.newChatConfirm"),
      confirmText: t("chatui.newChat"),
    });
    if (!ok) return;
    discardOutput = true;
    stopGeneration();
  }
  persistActiveSession();
  const session = createEmptySession();
  state.sessions = [session, ...state.sessions];
  state.activeSessionId = session.id;
  state.messages = [];
  state.error = "";
  writeSessions(state.sessions);
  state.sessionsOpen = false;
  nextTick(() => textareaRef.value?.focus());
};

const deleteSession = async (id) => {
  const ok = await confirm({
    title: t("chatui.deleteSession"),
    message: t("chatui.deleteSessionConfirm"),
    confirmText: t("chatui.deleteSession"),
    danger: true,
  });
  if (!ok) return;

  const remaining = state.sessions.filter((session) => session.id !== id);
  state.sessions = remaining.length > 0 ? remaining : [createEmptySession()];
  writeSessions(state.sessions);
  if (id === state.activeSessionId) {
    const next = state.sessions[0];
    state.activeSessionId = next.id;
    state.messages = next.messages.map(deserializeMessage);
    state.error = "";
  }
};

// 思考块展开/收起：用户手动点过后不再自动收起
const toggleReasoning = (message) => {
  message.reasoningOpen = message.reasoningOpen === false;
  message.reasoningTouched = true;
};

/* ---------------- 滚动与输入框自适应 ---------------- */

let scrollFrame = 0;
const scrollToBottom = () => {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    const el = messagesRef.value;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  });
};

const resizeInput = () => {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = "auto";
  const next = Math.min(el.scrollHeight, MAX_INPUT_HEIGHT);
  el.style.height = `${next}px`;
  el.style.overflowY = el.scrollHeight > MAX_INPUT_HEIGHT ? "auto" : "hidden";
};

// 任何来源的输入变化（键盘、粘贴、点击建议）都重新计算高度
watch(
  () => state.prompt,
  () => nextTick(resizeInput),
);

// 消息变化（含流式增量）防抖落盘；工具开关单独持久化
watch(
  () => state.messages,
  () => {
    schedulePersist();
  },
  { deep: true },
);
watch(
  () => state.toolsEnabled,
  (enabled) => localStorage.setItem(TOOLS_KEY, enabled ? "1" : "0"),
);

/* ---------------- SSE 解析（保留原有解析规则） ---------------- */

function createSseTransformer() {
  function pushMessage(block, controller) {
    const regLine = /(data|event|id|retry):\s?(.*)/;
    const message = { data: "", event: "", id: "", retry: "" };

    const lines = block.split("\n");

    lines.forEach(function (line) {
      if (!line) return;

      const match = regLine.exec(line);
      if (match) {
        const key = match[1];
        const value = match[2];
        message[key] += value;
      }
    });

    if (message.data.length > 0) {
      controller.enqueue(message);
    }
  }

  let buffer = "";
  const boundary = "\n\n";

  function start() {}

  function transform(chunk, controller) {
    buffer += chunk;

    function check() {
      check.boundary = buffer.indexOf(boundary);
      return check.boundary > -1;
    }

    while (check()) {
      const block = buffer.slice(0, check.boundary);
      pushMessage(block, controller);
      buffer = buffer.slice(check.boundary + boundary.length);
    }
  }

  function flush(controller) {
    // 流结束时可能还有一段没有结尾空行的数据，别丢掉
    if (buffer.trim().length > 0) {
      pushMessage(buffer, controller);
      buffer = "";
    }
  }

  return { start, transform, flush };
}

/**
 * 发起流式请求。非 2xx 或非 SSE 响应会抛出带状态码与上游信息的错误，
 * 交给调用方用错误条 + toast 呈现，而不是直接抛到控制台。
 * 兼容两种响应：text/event-stream 增量流，以及 application/json 一次性响应（工具调用可能走这种）。
 */
async function fetchSSE(url, body, callbacks, signal) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      [typeKey]: "application/json",
      [tokenKey]: token,
    },
    body: JSON.stringify(body),
    signal,
  });

  const contentType = response.headers.get(typeKey);
  if (!response.ok) {
    let detail = "";
    try {
      const text = await response.text();
      try {
        const parsed = JSON.parse(text);
        detail =
          parsed?.error?.message ||
          (typeof parsed?.error === "string" ? parsed.error : "") ||
          parsed?.message ||
          "";
      } catch (parseError) {
        detail = text.slice(0, 200);
      }
    } catch (readError) {
      detail = "";
    }
    const error = new Error(detail || `${response.status} - ${response.statusText}`);
    error.status = response.status;
    throw error;
  }

  if (contentType?.includes("application/json")) {
    const text = await response.text();
    callbacks.write?.({ data: text, event: "", id: "", retry: "" });
    callbacks.close?.();
    return;
  }

  if (!contentType?.includes("text/event-stream")) {
    const error = new Error(`${response.status} - ${response.statusText}`);
    error.status = response.status;
    throw error;
  }

  await response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TransformStream(createSseTransformer()))
    .pipeTo(new WritableStream(callbacks));
}

/* ---------------- 工具调用 ---------------- */

// 演示工具只有 get_time：返回固定结构，方便在卡片里核对
const executeDemoTool = (call) => {
  if (call.name === "get_time") {
    return JSON.stringify({ time: new Date().toLocaleString() });
  }
  return JSON.stringify({ error: `unknown tool: ${call.name}` });
};

const toolResultFor = (call) => {
  const found = state.messages.find(
    (message) => message.role === "tool" && message.toolCallId === call.id,
  );
  return found ? found.content : "";
};

const prettyJson = (text) => {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch (error) {
    return String(text ?? "");
  }
};

// 组装请求体：assistant 的工具调用与 tool 回执按 OpenAI 兼容格式还原
const buildApiMessages = () =>
  state.messages.map((message) => {
    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    }
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    }
    return { role: message.role, content: message.content };
  });

/**
 * 跑一轮流式补全：把正文增量写进 assistant，把 tool_calls 增量按 index 累积。
 * 返回本轮收集到的工具调用（无则空数组）。
 */
async function streamRound(assistant, payloadMessages, signal) {
  const toolCalls = new Map();
  const payload = {
    model: state.model,
    messages: payloadMessages,
    stream: true,
  };
  if (state.toolsEnabled) {
    payload.tools = DEMO_TOOLS;
  }

  await fetchSSE(
    "/v1/chat/completions",
    payload,
    {
      start() {},
      write(data) {
        let parsed = null;
        try {
          parsed = JSON.parse(data.data);
        } catch (error) {
          return; // 心跳 / 非 JSON 行按原逻辑忽略
        }
        const detail =
          parsed?.error?.message ||
          (typeof parsed?.error === "string" ? parsed.error : "");
        if (detail && !state.error) {
          state.error = `${t("chatui.requestFailed")}: ${detail}`;
        }

        parsed.choices?.forEach((choice) => {
          // 流式用 delta，非流式一次性响应用 message
          const delta = choice?.delta || choice?.message || {};
          // 思考内容：代理把推理放在 reasoning_content（legacy 模式才并进 content）
          const reasoning = delta?.reasoning_content || delta?.reasoning;
          if (reasoning) {
            assistant.reasoning = (assistant.reasoning || "") + reasoning;
            scrollToBottom();
          }
          const content = delta?.content;
          if (content) {
            assistant.content += content;
            // 正文一开始就把思考块自动收起（用户手动展开过就不再动它）
            if (assistant.reasoning && assistant.reasoningOpen !== false && !assistant.reasoningTouched) {
              assistant.reasoningOpen = false;
            }
            scrollToBottom();
          }
          if (Array.isArray(delta?.tool_calls)) {
            delta.tool_calls.forEach((call, callIndex) => {
              const index = typeof call.index === "number" ? call.index : callIndex;
              const current = toolCalls.get(index) || { id: "", name: "", arguments: "" };
              if (call.id) current.id = call.id;
              if (call.function?.name) current.name += call.function.name;
              if (call.function?.arguments) current.arguments += call.function.arguments;
              toolCalls.set(index, current);
            });
          }
        });
      },
      close() {},
    },
    signal,
  );

  return [...toolCalls.entries()]
    .filter(([, call]) => call.name)
    .map(([index, call]) => ({
      id: call.id || `call_${Date.now()}_${index}`,
      name: call.name,
      arguments: call.arguments || "{}",
    }));
}

/* ---------------- 发送 / 停止 / 清空 ---------------- */

const send = async () => {
  if (state.generating) return;
  const prompt = state.prompt.trim();
  if (!prompt) return;

  state.error = "";
  discardOutput = false;
  state.messages.push(createMessage("user", prompt));
  state.prompt = "";
  await nextTick();
  resizeInput();
  scrollToBottom();

  state.generating = true;
  const controller = new AbortController();
  abortController = controller;

  try {
    let toolRounds = 0;
    // 工具调用循环：模型要工具就回执并继续请求，最多 3 轮
    while (true) {
      const payloadMessages = buildApiMessages();
      // 注意：push 进去的是原始对象，state.messages 里读出来的才是响应式代理。
      // 直接改原始对象不会触发渲染（这就是「内容要等结束才一次性出现」的原因），
      // 所以这里取回代理再交给 streamRound 增量写入。
      state.messages.push(createMessage("assistant", "", { reasoningOpen: true }));
      const assistant = state.messages[state.messages.length - 1];
      scrollToBottom();

      const calls = await streamRound(assistant, payloadMessages, controller.signal);

      if (calls.length === 0) {
        if (!state.error && !assistant.content) {
          state.error = t("chatui.emptyResponse");
        }
        break;
      }

      assistant.toolCalls = calls;
      toolRounds += 1;
      if (toolRounds > MAX_TOOL_ROUNDS) {
        state.error = t("chatui.toolLimit");
        toast.warn(t("chatui.toolLimit"));
        break;
      }

      calls.forEach((call) => {
        state.messages.push(
          createMessage("tool", executeDemoTool(call), {
            toolCallId: call.id,
            toolName: call.name,
          }),
        );
      });
      scrollToBottom();
    }
  } catch (error) {
    const aborted = controller.signal.aborted || error.name === "AbortError";
    // 失败或中断时移除空的助手占位，避免留下空气泡（已输出部分则保留）
    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage?.role === "assistant" && !lastMessage.content && !lastMessage.toolCalls?.length) {
      state.messages.pop();
    }
    if (aborted) {
      if (!discardOutput) toast.info(t("chatui.stopped"));
    } else {
      state.error = error.message
        ? `${t("chatui.requestFailed")}: ${error.message}`
        : t("chatui.requestFailed");
    }
  } finally {
    if (abortController === controller) abortController = null;
    state.generating = false;
    discardOutput = false;
    scrollToBottom();
    persistNow();
  }
};

const stopGeneration = () => {
  if (abortController) abortController.abort();
};

const clearConversation = async () => {
  if (state.messages.length === 0 && !state.generating) return;
  const ok = await confirm({
    title: t("chatui.clearTitle"),
    message: t("chatui.clearConfirm"),
    confirmText: t("chatui.clear"),
    danger: true,
  });
  if (!ok) return;

  discardOutput = state.generating;
  stopGeneration();
  state.messages = [];
  state.error = "";
  state.generating = false;
  // 只清空当前这段测试会话，历史里的其他记录保留（要删整段用「历史记录」里的删除）
  window.clearTimeout(persistTimer);
  persistTimer = 0;
  persistActiveSession();
  toast.success(t("chatui.cleared"));
};

/* ---------------- 模型列表 ---------------- */

const loadModels = async () => {
  state.modelsLoading = true;
  try {
    const response = await fetch("/v1/models", {
      method: "GET",
      headers: {
        [tokenKey]: token,
      },
    });
    if (!response.ok) {
      throw new Error(`${response.status} - ${response.statusText}`);
    }
    const payload = await response.json();
    const list = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload)
        ? payload
        : [];
    state.models = list
      .map((item) => ({
        label: item?.name || item?.id,
        value: item?.id,
      }))
      .filter((option) => option.value);

    if (state.models.length === 0) {
      toast.warn(t("chatui.noModels"));
    } else if (!state.models.some((option) => option.value === state.model)) {
      state.model = state.models[0].value;
    }
  } catch (error) {
    // 模型列表失败不阻塞页面：给 toast + 占位下拉，仍可用默认模型发送
    state.models = [];
    toast.error(t("chatui.modelsFailed"));
  } finally {
    state.modelsLoading = false;
  }
};

/* ---------------- 输入交互 ---------------- */

const onCompositionStart = () => {
  composing = true;
};

const onCompositionEnd = () => {
  composing = false;
};

const onKeydown = (event) => {
  if (event.key !== "Enter") return;
  // Shift + Enter 换行；输入法组合期间的回车交给输入法处理
  if (event.shiftKey) return;
  if (composing || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  send();
};

const useSuggestion = (text) => {
  state.prompt = text;
  nextTick(() => {
    resizeInput();
    textareaRef.value?.focus();
  });
};

const copyMessage = async (message) => {
  const ok = await copyText(message.content);
  if (ok) {
    toast.success(t("chatui.copied"));
  } else {
    toast.error(t("chatui.copyFailed"));
  }
};

/* ---------------- 生命周期 ---------------- */

onMounted(async () => {
  bootSessions();
  resizeInput();
  await loadModels();
  scrollToBottom();
  textareaRef.value?.focus();
});

onBeforeUnmount(() => {
  if (abortController) abortController.abort();
  if (scrollFrame) cancelAnimationFrame(scrollFrame);
  persistNow();
  // 离开页面时把标签页标题还回去，别把会话名留在别的页面上
  document.title = DEFAULT_TITLE;
});
</script>

<style scoped>
/* Markdown 正文：全部用设计 token，深色/浅色都跟随组件 */
.md-body > :deep(:first-child) {
  @apply mt-0;
}

.md-body > :deep(:last-child) {
  @apply mb-0;
}

.md-body :deep(p) {
  @apply my-1.5 leading-6;
}

.md-body :deep(h1) {
  @apply mb-2 mt-3 text-base font-semibold text-ink;
}

.md-body :deep(h2) {
  @apply mb-2 mt-3 text-[15px] font-semibold text-ink;
}

.md-body :deep(h3),
.md-body :deep(h4),
.md-body :deep(h5),
.md-body :deep(h6) {
  @apply mb-1.5 mt-2.5 text-sm font-semibold text-ink;
}

.md-body :deep(ul) {
  @apply my-1.5 list-disc pl-5;
}

.md-body :deep(ol) {
  @apply my-1.5 list-decimal pl-5;
}

.md-body :deep(li) {
  @apply my-0.5 leading-6;
}

.md-body :deep(li > p) {
  @apply my-0;
}

.md-body :deep(blockquote) {
  @apply my-2 border-l-2 border-brand-200 pl-3 text-ink-soft;
}

.md-body :deep(a) {
  @apply text-brand-600 underline underline-offset-2 hover:text-brand-700;
}

.md-body :deep(hr) {
  @apply my-3 border-line;
}

.md-body :deep(.md-code) {
  @apply rounded border border-line bg-canvas px-1 py-0.5 font-mono text-[12px] text-ink;
}

.md-body :deep(.md-pre) {
  @apply my-2 overflow-x-auto rounded-control border border-line bg-canvas p-3;
}

.md-body :deep(.md-pre code) {
  @apply block whitespace-pre font-mono text-xs leading-5 text-ink;
}

.md-body :deep(.md-table-wrap) {
  @apply my-2 overflow-x-auto;
}

.md-body :deep(.md-table) {
  @apply w-full border-collapse text-xs;
}

.md-body :deep(.md-table th) {
  @apply border border-line bg-canvas px-2 py-1 text-left font-medium text-ink;
}

.md-body :deep(.md-table td) {
  @apply border border-line px-2 py-1 align-top text-ink-soft;
}

.md-body :deep(strong) {
  @apply font-semibold text-ink;
}

.md-body :deep(em) {
  @apply italic;
}

/* 流式光标：拼在最后一段文字后面闪烁 */
:deep(.md-cursor) {
  @apply ml-0.5 inline-block h-4 w-1.5 rounded-sm bg-brand-600 align-[-2px];
  animation: md-blink 1s steps(2, start) infinite;
}

@keyframes md-blink {
  50% {
    opacity: 0.15;
  }
}
</style>
