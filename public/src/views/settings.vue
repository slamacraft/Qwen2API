<template>
  <div class="page py-4">
    <div class="page-head mb-3">
      <div class="min-w-0">
        <p class="page-sub">{{ t('settingsui.subtitle') }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span v-if="settings.dataSaveMode === 'none'" class="badge badge-warn">
          <Icon name="alert" :size="12" />
          {{ t('settingsui.memoryOnly') }}
        </span>
        <button class="btn-default btn-sm whitespace-nowrap" :disabled="loading" @click="loadSettings">
          <Icon name="refresh" :size="14" :class="{ 'animate-spin': loading }" />
          {{ t('settingsui.reload') }}
        </button>
      </div>
    </div>

    <div class="space-y-3">
      <!-- 模型映射（独立卡片：行内容多，需要空间） -->
      <section class="card">
        <div class="card-header px-4 py-2.5">
          <div class="min-w-0">
            <h2 class="card-title">{{ t('settingsui.modelMap.title') }}</h2>
            <p class="mt-0.5 text-xs text-ink-mute">{{ t('settingsui.modelMap.desc') }}</p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <button class="btn-default btn-sm whitespace-nowrap" :disabled="saving === 'modelMap'" @click="resetModelMap">
              <Icon name="refresh" :size="13" />
              {{ t('settingsui.modelMap.restoreEnv') }}
            </button>
            <button class="btn-primary btn-sm whitespace-nowrap" :disabled="saving === 'modelMap'" @click="saveModelMap">
              <Icon name="check" :size="13" />
              {{ saveLabel('modelMap') }}
            </button>
          </div>
        </div>

        <div class="card-body space-y-2.5 p-4">
          <div class="space-y-0.5 text-[11px] leading-4 text-ink-mute">
            <p>{{ t('settingsui.modelMap.rulesHint') }}</p>
            <p>{{ t('settingsui.modelMap.clusterHint') }}</p>
            <p v-if="settings.dataSaveMode === 'none'" class="text-warn-700">
              {{ t('settingsui.modelMap.noneModeHint') }}
            </p>
          </div>

          <!-- 映射行：入站名 -> Qwen 模型 -->
          <div class="space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-xs font-medium text-ink">
                {{ t('settingsui.modelMap.aliasLabel') }}
                <Icon name="chevron-right" :size="11" class="inline align-[-1px] text-ink-mute" />
                {{ t('settingsui.modelMap.targetLabel') }}
              </span>
              <button class="btn-default btn-sm whitespace-nowrap" @click="addModelMapRow()">
                <Icon name="plus" :size="13" />
                {{ t('settingsui.modelMap.addRow') }}
              </button>
            </div>

            <p
              v-if="modelMap.entries.length === 0"
              class="rounded-control border border-dashed border-line px-3 py-2 text-center text-[11px] text-ink-mute"
            >
              {{ t('settingsui.modelMap.noRows') }}
            </p>

            <div
              v-for="(row, index) in modelMap.entries"
              :key="row.key"
              class="flex flex-col gap-2 rounded-control border border-line bg-canvas p-2 md:flex-row md:items-center"
            >
              <input
                v-model="row.alias"
                type="text"
                class="input h-8 min-w-0 flex-1 md:max-w-[220px]"
                :placeholder="t('settingsui.modelMap.aliasLabel')"
                :aria-label="t('settingsui.modelMap.aliasLabel')"
                @input="modelMapDirty = true"
              />
              <Icon name="chevron-right" :size="13" class="hidden shrink-0 text-ink-mute md:block" />
              <select
                v-model="row.target"
                class="select h-8 min-w-0 flex-1"
                :aria-label="t('settingsui.modelMap.targetLabel')"
                @change="modelMapDirty = true"
              >
                <option value="">{{ t('settingsui.modelMap.pickTarget') }}</option>
                <option v-for="option in targetOptions(row.target)" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
              <span class="badge h-5 shrink-0 px-1.5 text-[11px]" :class="originClass(originOf(row.alias, row.target))">
                {{ originLabel(originOf(row.alias, row.target)) }}
              </span>
              <button class="btn-danger btn-sm h-7 shrink-0 px-2 text-[11px]" @click="removeModelMapRow(index)">
                <Icon name="trash" :size="12" />
                {{ t('settingsui.modelMap.remove') }}
              </button>
            </div>
          </div>

          <!-- 其余名字（回退） -->
          <div
            class="flex flex-col gap-2 rounded-control border border-warn-100 bg-warn-50 p-2 md:flex-row md:items-center"
          >
            <span class="shrink-0 text-xs font-medium text-warn-700">
              {{ t('settingsui.modelMap.fallback') }}
            </span>
            <Icon name="chevron-right" :size="13" class="hidden shrink-0 text-warn-600 md:block" />
            <select
              v-model="modelMap.fallback"
              class="select h-8 min-w-0 flex-1 md:max-w-[300px]"
              :aria-label="t('settingsui.modelMap.fallback')"
              @change="modelMapDirty = true"
            >
              <option value="">{{ t('settingsui.modelMap.fallbackNone') }}</option>
              <option v-for="option in targetOptions(modelMap.fallback)" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
            <span v-if="modelMap.fallback" class="badge h-5 shrink-0 px-1.5 text-[11px]" :class="originClass(fallbackOrigin())">
              {{ originLabel(fallbackOrigin()) }}
            </span>
          </div>

          <!-- 已出现但未分配：点击预填一行 -->
          <div v-if="unassignedChips.length > 0" class="space-y-1">
            <p class="text-xs font-medium text-ink">{{ t('settingsui.modelMap.unassigned') }}</p>
            <p class="text-[11px] text-ink-mute">{{ t('settingsui.modelMap.unassignedHint') }}</p>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="name in unassignedChips"
                :key="name"
                class="badge badge-brand h-5 px-1.5 text-[11px] transition-colors hover:bg-brand-100"
                @click="addModelMapRow(name)"
              >
                <Icon name="plus" :size="11" />
                {{ name }}
              </button>
            </div>
          </div>

          <p v-if="modelMapError" class="flex items-start gap-1.5 text-[11px] text-danger-600" role="alert">
            <Icon name="alert" :size="13" class="mt-0.5 shrink-0" />
            <span class="break-words">{{ modelMapError }}</span>
          </p>
        </div>
      </section>

      <!-- API Key 管理（独立卡片） -->
      <section class="card">
        <div class="card-header px-4 py-2.5">
          <div class="min-w-0">
            <h2 class="card-title">{{ t('settingsui.apiKey.title') }}</h2>
            <p class="mt-0.5 text-xs text-ink-mute">{{ t('settingsui.apiKey.desc') }}</p>
          </div>
          <button class="btn-primary btn-sm shrink-0 whitespace-nowrap" @click="openAddKey">
            <Icon name="plus" :size="13" />
            {{ t('settingsui.apiKey.add') }}
          </button>
        </div>

        <div class="card-body space-y-2.5 p-4">
          <!-- 管理员密钥（只读） -->
          <div class="flex flex-wrap items-center gap-2 rounded-control border border-warn-100 bg-warn-50 px-3 py-1.5">
            <Icon name="shield" :size="14" class="shrink-0 text-warn-700" />
            <span class="shrink-0 text-xs font-medium text-warn-700">{{ t('settingsui.apiKey.admin') }}</span>
            <span class="badge badge-warn h-5 px-1.5 text-[11px]">{{ t('settingsui.apiKey.readonly') }}</span>
            <input
              :value="settings.adminKey"
              type="text"
              readonly
              class="input mono h-8 min-w-0 flex-1 cursor-not-allowed border-warn-100 bg-surface text-ink-soft"
              :aria-label="t('settingsui.apiKey.admin')"
            />
            <button
              class="btn-default btn-sm h-8 shrink-0 px-2"
              :disabled="!settings.adminKey"
              @click="copyKey(settings.adminKey)"
            >
              <Icon name="copy" :size="13" />
              {{ t('common.copy') }}
            </button>
          </div>

          <!-- 普通密钥列表 -->
          <div class="space-y-1.5">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-medium text-ink-soft">{{ t('settingsui.apiKey.regular') }}</span>
              <span class="badge badge-mute h-5 px-1.5 text-[11px]">{{ settings.regularKeys.length }}</span>
            </div>

            <p v-if="settings.regularKeys.length === 0" class="text-[11px] text-ink-mute">
              {{ t('settingsui.apiKey.noKeys') }}
            </p>

            <div
              v-for="(key, index) in settings.regularKeys"
              :key="index"
              class="flex items-center gap-2 rounded-control border border-line bg-canvas px-2 py-1.5"
            >
              <Icon name="key" :size="14" class="shrink-0 text-ink-mute" />
              <input
                :value="key"
                type="text"
                readonly
                class="input mono h-8 min-w-0 flex-1 cursor-not-allowed bg-canvas text-ink-soft"
                :aria-label="t('settingsui.apiKey.regular')"
              />
              <button class="btn-default btn-sm h-8 shrink-0 px-2" @click="copyKey(key)">
                <Icon name="copy" :size="13" />
                {{ t('common.copy') }}
              </button>
              <button class="btn-danger btn-sm h-8 shrink-0 px-2" @click="deleteRegularKey(index)">
                <Icon name="trash" :size="13" />
                {{ t('common.delete') }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- 运行参数：所有简单配置合并成一张卡，两列紧凑网格 -->
      <section class="card">
        <div class="card-header px-4 py-2.5">
          <div class="min-w-0">
            <h2 class="card-title">{{ t('settingsui.runtime.title') }}</h2>
            <p class="mt-0.5 text-xs text-ink-mute">{{ t('settingsui.runtime.desc') }}</p>
          </div>
        </div>

        <div class="card-body p-4">
          <div class="grid grid-cols-1 gap-x-8 gap-y-2.5 md:grid-cols-2">
            <!-- 自动刷新 -->
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="text-sm text-ink-soft">{{ t('settingsui.autoRefresh.title') }}</p>
                <p class="text-[11px] text-ink-mute">{{ t('settingsui.autoRefresh.interval') }}</p>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <input
                  v-model="settings.autoRefresh"
                  type="checkbox"
                  class="h-3.5 w-3.5 accent-brand-600"
                  :aria-label="t('settingsui.autoRefresh.enable')"
                  :title="t('settingsui.autoRefresh.enable')"
                />
                <input
                  v-model.number="settings.autoRefreshInterval"
                  type="number"
                  class="input h-8 w-24"
                  :aria-label="t('settingsui.autoRefresh.interval')"
                />
                <button class="btn-default btn-sm h-8 px-2 whitespace-nowrap" :disabled="saving === 'autoRefresh'" @click="saveAutoRefresh">
                  {{ saveLabel('autoRefresh') }}
                </button>
              </div>
            </div>

            <!-- 批量并发 -->
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="text-sm text-ink-soft">{{ t('settingsui.batch.title') }}</p>
                <p class="truncate text-[11px] text-ink-mute" :title="t('settingsui.batch.hint')">{{ t('settingsui.batch.hint') }}</p>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <input
                  v-model.number="settings.batchLoginConcurrency"
                  type="number"
                  min="1"
                  max="20"
                  class="input h-8 w-20"
                  :aria-label="t('settingsui.batch.label')"
                />
                <button class="btn-default btn-sm h-8 px-2 whitespace-nowrap" :disabled="saving === 'batch'" @click="saveBatchLoginConcurrency">
                  {{ saveLabel('batch') }}
                </button>
              </div>
            </div>

            <!-- 思考输出 -->
            <div class="flex items-center justify-between gap-3">
              <p class="min-w-0 text-sm text-ink-soft">{{ t('settingsui.think.title') }}</p>
              <div class="flex shrink-0 items-center gap-2">
                <input
                  v-model="settings.outThink"
                  type="checkbox"
                  class="h-3.5 w-3.5 accent-brand-600"
                  :aria-label="t('settingsui.think.enable')"
                  :title="t('settingsui.think.desc')"
                />
                <button class="btn-default btn-sm h-8 px-2 whitespace-nowrap" :disabled="saving === 'think'" @click="saveOutThink">
                  {{ saveLabel('think') }}
                </button>
              </div>
            </div>

            <!-- 推理输出格式 -->
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="text-sm text-ink-soft">{{ t('settingsui.reasoning.title') }}</p>
                <p class="truncate text-[11px] text-ink-mute" :title="t('settingsui.reasoning.hint')">{{ t('settingsui.reasoning.hint') }}</p>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <input
                  v-model="settings.legacyReasoningInContent"
                  type="checkbox"
                  class="h-3.5 w-3.5 accent-brand-600"
                  :aria-label="t('settingsui.reasoning.enable')"
                  :title="t('settingsui.reasoning.enable')"
                />
                <button class="btn-default btn-sm h-8 px-2 whitespace-nowrap" :disabled="saving === 'reasoning'" @click="saveLegacyReasoning">
                  {{ saveLabel('reasoning') }}
                </button>
              </div>
            </div>

            <!-- 搜索信息显示模式 -->
            <div class="flex items-center justify-between gap-3">
              <p class="min-w-0 text-sm text-ink-soft">{{ t('settingsui.search.title') }}</p>
              <div class="flex shrink-0 items-center gap-2">
                <select v-model="settings.searchInfoMode" class="select h-8 w-28" :aria-label="t('settingsui.search.label')">
                  <option value="table">{{ t('settingsui.search.table') }}</option>
                  <option value="text">{{ t('settingsui.search.text') }}</option>
                </select>
                <button class="btn-default btn-sm h-8 px-2 whitespace-nowrap" :disabled="saving === 'search'" @click="saveSearchInfoMode">
                  {{ saveLabel('search') }}
                </button>
              </div>
            </div>

            <!-- 简化模型映射 -->
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="text-sm text-ink-soft">{{ t('settingsui.simpleMap.title') }}</p>
                <p class="truncate text-[11px] text-ink-mute" :title="t('settingsui.simpleMap.desc')">{{ t('settingsui.simpleMap.desc') }}</p>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <input
                  v-model="settings.simpleModelMap"
                  type="checkbox"
                  class="h-3.5 w-3.5 accent-brand-600"
                  :aria-label="t('settingsui.simpleMap.enable')"
                  :title="t('settingsui.simpleMap.enable')"
                />
                <button class="btn-default btn-sm h-8 px-2 whitespace-nowrap" :disabled="saving === 'simpleMap'" @click="saveSimpleModelMap">
                  {{ saveLabel('simpleMap') }}
                </button>
              </div>
            </div>

            <!-- 聊天请求网络重试 -->
            <div class="flex items-center justify-between gap-3 md:col-span-2">
              <div class="min-w-0">
                <p class="text-sm text-ink-soft">{{ t('settingsui.retry.title') }}</p>
                <p class="truncate text-[11px] text-ink-mute" :title="t('settingsui.retry.hint')">{{ t('settingsui.retry.hint') }}</p>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <input
                  v-model.number="settings.chatRetryCount"
                  type="number"
                  min="0"
                  max="10"
                  class="input h-8 w-16"
                  :aria-label="t('settingsui.retry.count')"
                  :title="t('settingsui.retry.count')"
                />
                <input
                  v-model.number="settings.chatRetryBackoffMs"
                  type="number"
                  min="0"
                  max="60000"
                  class="input h-8 w-20"
                  :aria-label="t('settingsui.retry.backoff')"
                  :title="t('settingsui.retry.backoff')"
                />
                <button class="btn-default btn-sm h-8 px-2 whitespace-nowrap" :disabled="saving === 'retry'" @click="saveRetryConfig">
                  {{ saveLabel('retry') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 添加 API Key 弹窗 -->
    <Modal :open="showAddKeyModal" :title="t('settingsui.apiKey.addTitle')" size="sm" @close="closeAddKey">
      <div class="space-y-2">
        <label class="label" for="new-api-key">{{ t('settingsui.apiKey.addPlaceholder') }}</label>
        <input
          id="new-api-key"
          v-model="newApiKey"
          type="text"
          class="input"
          :placeholder="t('settingsui.apiKey.addPlaceholder')"
          @keydown.enter="addRegularKey"
        />
        <p class="text-xs text-ink-mute">{{ t('settingsui.apiKey.addHint') }}</p>
      </div>
      <template #footer>
        <button class="btn-default" @click="closeAddKey">{{ t('common.cancel') }}</button>
        <button class="btn-primary" :disabled="saving === 'addKey' || !newApiKey.trim()" @click="addRegularKey">
          <Icon v-if="saving === 'addKey'" name="spinner" :size="14" class="animate-spin" />
          {{ t('settingsui.apiKey.add') }}
        </button>
      </template>
    </Modal>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Icon from '../components/ui/Icon.vue'
import Modal from '../components/ui/Modal.vue'
import { toast, confirm, copyText } from '../ui/feedback.js'

const { t } = useI18n()

const settings = ref({
  apiKey: localStorage.getItem('apiKey'),
  adminKey: '',
  regularKeys: [],
  defaultHeaders: '',
  defaultCookie: '',
  autoRefresh: false,
  autoRefreshInterval: 21600,
  batchLoginConcurrency: 5,
  outThink: false,
  legacyReasoningInContent: false,
  searchInfoMode: 'table',
  simpleModelMap: false,
  chatRetryCount: 1,
  chatRetryBackoffMs: 400,
  dataSaveMode: ''
})

const loading = ref(false)
// 当前正在保存的动作：既防止重复点击，也用来切换按钮文案
const saving = ref('')
const showAddKeyModal = ref(false)
const newApiKey = ref('')

// 逐项保存按钮的文案：保存中 / 保存
const saveLabel = (key) => (saving.value === key ? t('settingsui.saving') : t('settingsui.save'))


const authHeaders = () => ({ Authorization: localStorage.getItem('apiKey') || '' })
const errorText = (error) => error?.response?.data?.error || error?.message || ''

// --- 模型映射 ---
// 与后端 parseModelMap 同一规则：逗号分项，第一个 '=' 分隔，alias 去尾部 [..] 并小写，target 原样 trim。
// 服务端保存时再用 buildModelMap 规范化并校验；这里负责展示和提交前的粗检。
const stripBracketSuffix = (name) => String(name || '').trim().replace(/(\s*\[[^\]]*\])+$/, '').trim()
const normalizeAlias = (name) => stripBracketSuffix(name).toLowerCase()
const RESERVED_ALIAS_CHARS = /[,=*]/
const parseModelMap = (raw) => {
  const map = Object.create(null)
  for (const entry of String(raw || '').split(',')) {
    const eq = entry.indexOf('=')
    if (eq < 0) continue
    const alias = normalizeAlias(entry.slice(0, eq))
    const target = entry.slice(eq + 1).trim()
    if (!alias || !target) continue
    map[alias] = target
  }
  return map
}

let modelMapRowSeq = 0
const newModelMapRow = (alias = '', target = '') => ({ key: ++modelMapRowSeq, alias, target })

const modelMap = ref({
  entries: [],                 // [{ key, alias, target }]，不含 '*'
  fallback: '',                // '*' 的目标，'' 表示未设置
  active: Object.create(null), // 服务端当前生效的 map：判定「已保存」
  env: Object.create(null),    // MODEL_MAP env 解析结果：判定「env」
  targets: [],                 // 可选目标（服务端从上游列表算好的聊天模型 id）
  unmapped: []                 // getUnmappedModels()：落到回退的入站名
})
const modelMapDirty = ref(false)  // 有未保存的编辑：loadSettings 不能覆盖行
const modelMapError = ref('')     // 卡片里的可见错误行

const applyModelMapFromServer = (data) => {
  const targets = Array.isArray(data.modelMapTargets) ? data.modelMapTargets : []
  const unmapped = Array.isArray(data.unmappedModels) ? data.unmappedModels : []
  modelMapError.value = targets.length === 0 ? t('settingsui.modelMap.noTargets') : ''
  if (modelMapDirty.value) {
    // 有未保存的编辑（比如刚在别的卡片增删了 API Key 触发的重载）：只刷新下拉和芯片，行保持不动
    modelMap.value.targets = targets
    modelMap.value.unmapped = unmapped
    return
  }
  const active = parseModelMap(data.modelMap)
  const env = parseModelMap(data.modelMapEnv)
  modelMap.value = {
    entries: Object.entries(active)
      .filter(([alias]) => alias !== '*')
      .map(([alias, target]) => newModelMapRow(alias, target)),
    fallback: active['*'] || '',
    active,
    env,
    targets,
    unmapped
  }
}

// 下拉选项 = 服务端给的目标；当前值不在列表里（大小写不敏感）时也保留一项，env 里的过期目标不能被静默清掉
const targetOptions = (current) => {
  const options = modelMap.value.targets.map(id => ({ value: id, label: id }))
  const wanted = String(current || '').toLowerCase()
  if (wanted && !modelMap.value.targets.some(id => id.toLowerCase() === wanted)) {
    options.unshift({ value: current, label: `${current} ${t('settingsui.modelMap.notUpstream')}` })
  }
  return options
}

// 来源：Env = 这对 alias=target 同时在 env 和当前生效 map 里；Saved = 只在当前生效 map 里；其余 Unsaved
const originOfKey = (key, target) => {
  if (!key || !target) return 'Unsaved'
  const inActive = modelMap.value.active[key] === target
  if (inActive && modelMap.value.env[key] === target) return 'Env'
  return inActive ? 'Saved' : 'Unsaved'
}
const originOf = (alias, target) => {
  const key = normalizeAlias(alias)
  return (!key || key === '*') ? 'Unsaved' : originOfKey(key, target)
}
const fallbackOrigin = () => originOfKey('*', modelMap.value.fallback)
// 来源徽章文案查表，不拼键名：拼出来的键在静态 i18n 检查里是盲区
const ORIGIN_LABEL_KEY = {
  Env: 'settingsui.modelMap.originEnv',
  Saved: 'settingsui.modelMap.originSaved',
  Unsaved: 'settingsui.modelMap.originUnsaved'
}
const originLabel = (origin) => t(ORIGIN_LABEL_KEY[origin] || ORIGIN_LABEL_KEY.Unsaved)
// 徽章配色走设计系统的 badge-*，不再用旧色板
const originClass = (origin) => ({
  Env: 'badge-warn',
  Saved: 'badge-ok',
  Unsaved: 'badge-mute'
}[origin] || 'badge-mute')

// 芯片 = 落到回退的名字 − 已有别名 − 永远存不成别名的名字（含 , = *）
const unassignedChips = computed(() => {
  const taken = new Set(modelMap.value.entries.map(row => normalizeAlias(row.alias)).filter(Boolean))
  return modelMap.value.unmapped.filter(name => !RESERVED_ALIAS_CHARS.test(name) && !taken.has(normalizeAlias(name)))
})

const addModelMapRow = (alias = '') => {
  modelMap.value.entries.push(newModelMapRow(alias, ''))
  modelMapDirty.value = true
}
const removeModelMapRow = (index) => {
  modelMap.value.entries.splice(index, 1)
  modelMapDirty.value = true
}

// 提交前的粗检：空别名/目标、保留字符、规范化后重复。服务端仍会完整校验一遍。
const validateModelMapRows = () => {
  const seen = new Set()
  const problems = []
  modelMap.value.entries.forEach((row, index) => {
    const alias = normalizeAlias(row.alias)
    const n = index + 1
    if (!alias) problems.push(t('settingsui.modelMap.rowEmptyAlias', { n }))
    else if (RESERVED_ALIAS_CHARS.test(alias)) problems.push(t('settingsui.modelMap.rowReservedAlias', { n }))
    else if (seen.has(alias)) problems.push(t('settingsui.modelMap.rowDuplicateAlias', { n, alias }))
    if (alias) seen.add(alias)
    if (!String(row.target || '').trim()) problems.push(t('settingsui.modelMap.rowEmptyTarget', { n }))
  })
  return problems
}

const formatModelMapError = (item) => {
  const where = typeof item.index === 'number' ? `#${item.index + 1} ${item.field}` : item.field
  return `${where}: ${item.message}`
}

// persisted:false 有两种：none 模式（预期内，只在内存里）和持久化失败（要看日志）
const persistFailedText = (data) => (data?.dataSaveMode === 'none'
  ? t('settingsui.modelMap.savedNotPersisted')
  : t('settingsui.modelMap.savedPersistFailed'))

const saveModelMap = async () => {
  if (saving.value) return
  const problems = validateModelMapRows()
  if (problems.length > 0) {
    modelMapError.value = problems.join('；')
    toast.error(t('settingsui.modelMap.failed'))
    return
  }
  saving.value = 'modelMap'
  try {
    const res = await axios.post('/api/setModelMap', {
      entries: modelMap.value.entries.map(({ alias, target }) => ({ alias, target })),
      fallback: modelMap.value.fallback
    }, { headers: authHeaders() })
    modelMapDirty.value = false
    modelMapError.value = ''
    toast.success(res.data?.persisted === false ? persistFailedText(res.data) : t('settingsui.modelMap.savedToast'))
    await loadSettings()
  } catch (error) {
    const data = error.response?.data
    const details = Array.isArray(data?.errors) && data.errors.length > 0
      ? data.errors.map(formatModelMapError).join('；')
      : (data?.error || error.message)
    modelMapError.value = details
    toast.error(t('settingsui.modelMap.failed'))
  } finally {
    saving.value = ''
  }
}

// 恢复 env：清掉 dashboard 保存的映射，MODEL_MAP 环境变量重新生效
const resetModelMap = async () => {
  if (saving.value) return
  const ok = await confirm({
    title: t('settingsui.modelMap.confirmResetTitle'),
    message: t('settingsui.modelMap.confirmReset'),
    confirmText: t('settingsui.modelMap.restoreEnv'),
    danger: true
  })
  if (!ok) return
  saving.value = 'modelMap'
  try {
    const res = await axios.post('/api/setModelMap', { reset: true }, { headers: authHeaders() })
    modelMapDirty.value = false
    toast.success(res.data?.persisted === false && res.data?.dataSaveMode !== 'none'
      ? persistFailedText(res.data)
      : t('settingsui.modelMap.resetToast'))
    await loadSettings()
  } catch (error) {
    toast.error(`${t('settingsui.modelMap.failed')}: ${errorText(error)}`)
  } finally {
    saving.value = ''
  }
}

const loadSettings = async () => {
  if (loading.value) return
  loading.value = true
  try {
    const res = await axios.get('/api/settings', { headers: authHeaders() })
    settings.value.apiKey = res.data.apiKey
    settings.value.adminKey = res.data.adminKey || ''
    settings.value.regularKeys = res.data.regularKeys || []
    settings.value.defaultHeaders = JSON.stringify(res.data.defaultHeaders)
    settings.value.defaultCookie = res.data.defaultCookie
    settings.value.autoRefresh = res.data.autoRefresh
    settings.value.autoRefreshInterval = res.data.autoRefreshInterval
    settings.value.batchLoginConcurrency = res.data.batchLoginConcurrency
    settings.value.outThink = res.data.outThink
    settings.value.legacyReasoningInContent = res.data.legacyReasoningInContent
    settings.value.searchInfoMode = res.data.searchInfoMode
    settings.value.simpleModelMap = res.data.simpleModelMap
    if (res.data.chatRetryCount !== undefined) settings.value.chatRetryCount = res.data.chatRetryCount
    if (res.data.chatRetryBackoffMs !== undefined) settings.value.chatRetryBackoffMs = res.data.chatRetryBackoffMs
    settings.value.dataSaveMode = res.data.dataSaveMode || ''
    applyModelMapFromServer(res.data)
  } catch (error) {
    console.error('loadSettings error:', error)
    modelMapError.value = t('settingsui.modelMap.loadFailed')
    toast.error(t('settingsui.loadFailed'))
  } finally {
    loading.value = false
  }
}

const saveApiKey = async () => {
  try {
    await axios.post('/api/setApiKey', { apiKey: settings.value.apiKey }, { headers: authHeaders() })
    toast.success(t('settingsui.apiKey.saved'))
  } catch (error) {
    toast.error(`${t('settingsui.apiKey.failed')}: ${errorText(error)}`)
  }
}

const saveAutoRefresh = async () => {
  if (saving.value) return
  saving.value = 'autoRefresh'
  try {
    await axios.post('/api/setAutoRefresh', {
      autoRefresh: settings.value.autoRefresh,
      autoRefreshInterval: settings.value.autoRefreshInterval
    }, { headers: authHeaders() })
    toast.success(t('settingsui.autoRefresh.saved'))
  } catch (error) {
    toast.error(`${t('settingsui.autoRefresh.failed')}: ${errorText(error)}`)
  } finally {
    saving.value = ''
  }
}

const saveBatchLoginConcurrency = async () => {
  if (saving.value) return
  saving.value = 'batch'
  try {
    await axios.post('/api/setBatchLoginConcurrency', {
      batchLoginConcurrency: settings.value.batchLoginConcurrency
    }, { headers: authHeaders() })
    toast.success(t('settingsui.batch.saved'))
  } catch (error) {
    toast.error(`${t('settingsui.batch.failed')}: ${errorText(error)}`)
  } finally {
    saving.value = ''
  }
}

const saveOutThink = async () => {
  if (saving.value) return
  saving.value = 'think'
  try {
    await axios.post('/api/setOutThink', { outThink: settings.value.outThink }, { headers: authHeaders() })
    toast.success(t('settingsui.think.saved'))
  } catch (error) {
    toast.error(`${t('settingsui.think.failed')}: ${errorText(error)}`)
  } finally {
    saving.value = ''
  }
}

const saveLegacyReasoning = async () => {
  if (saving.value) return
  saving.value = 'reasoning'
  try {
    await axios.post('/api/setLegacyReasoning', {
      legacyReasoningInContent: settings.value.legacyReasoningInContent
    }, { headers: authHeaders() })
    toast.success(t('settingsui.reasoning.saved'))
  } catch (error) {
    toast.error(`${t('settingsui.reasoning.failed')}: ${errorText(error)}`)
  } finally {
    saving.value = ''
  }
}

const saveSearchInfoMode = async () => {
  if (saving.value) return
  saving.value = 'search'
  try {
    await axios.post('/api/search-info-mode', { searchInfoMode: settings.value.searchInfoMode }, { headers: authHeaders() })
    toast.success(t('settingsui.search.saved'))
  } catch (error) {
    toast.error(`${t('settingsui.search.failed')}: ${errorText(error)}`)
  } finally {
    saving.value = ''
  }
}

const saveSimpleModelMap = async () => {
  if (saving.value) return
  saving.value = 'simpleMap'
  try {
    await axios.post('/api/simple-model-map', { simpleModelMap: settings.value.simpleModelMap }, { headers: authHeaders() })
    toast.success(t('settingsui.simpleMap.saved'))
  } catch (error) {
    toast.error(`${t('settingsui.simpleMap.failed')}: ${errorText(error)}`)
  } finally {
    saving.value = ''
  }
}

const saveRetryConfig = async () => {
  if (saving.value) return
  saving.value = 'retry'
  try {
    await axios.post('/api/setRetryConfig', {
      chatRetryCount: settings.value.chatRetryCount,
      chatRetryBackoffMs: settings.value.chatRetryBackoffMs
    }, { headers: authHeaders() })
    toast.success(t('settingsui.retry.saved'))
  } catch (error) {
    toast.error(`${t('settingsui.retry.failed')}: ${errorText(error)}`)
  } finally {
    saving.value = ''
  }
}

// API Key 管理相关函数
const openAddKey = () => {
  newApiKey.value = ''
  showAddKeyModal.value = true
}

const closeAddKey = () => {
  showAddKeyModal.value = false
  newApiKey.value = ''
}

const addRegularKey = async () => {
  if (saving.value) return
  if (!newApiKey.value.trim()) {
    toast.warn(t('settingsui.apiKey.enterKey'))
    return
  }

  saving.value = 'addKey'
  try {
    await axios.post('/api/addRegularKey', { apiKey: newApiKey.value.trim() }, { headers: authHeaders() })
    toast.success(t('settingsui.apiKey.added'))
    newApiKey.value = ''
    showAddKeyModal.value = false
    await loadSettings()
  } catch (error) {
    toast.error(`${t('settingsui.apiKey.addFailed')}: ${errorText(error)}`)
  } finally {
    saving.value = ''
  }
}

const deleteRegularKey = async (index) => {
  const keyToDelete = settings.value.regularKeys[index]
  if (!keyToDelete) return
  const ok = await confirm({
    title: t('settingsui.apiKey.confirmDeleteTitle'),
    message: t('settingsui.apiKey.confirmDelete'),
    confirmText: t('common.delete'),
    danger: true
  })
  if (!ok) return

  try {
    await axios.post('/api/deleteRegularKey', { apiKey: keyToDelete }, { headers: authHeaders() })
    toast.success(t('settingsui.apiKey.deleted'))
    await loadSettings()
  } catch (error) {
    toast.error(`${t('settingsui.apiKey.deleteFailed')}: ${errorText(error)}`)
  }
}

const copyKey = async (key) => {
  const ok = await copyText(key)
  if (ok) {
    toast.success(t('common.copied'))
  } else {
    toast.error(t('settingsui.copyFailed'))
  }
}

onMounted(() => {
  loadSettings()
})
</script>
