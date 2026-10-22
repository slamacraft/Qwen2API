<template>
  <!-- 账号详情：列表不再下发凭据，密码 / Token 只在打开本面板时按需拉取 -->
  <Modal :open="open" :title="t('accounts.detailTitle')" size="md" @close="$emit('close')">
    <!-- 加载骨架 -->
    <div v-if="loading" class="space-y-3">
      <div class="skeleton h-5 w-1/3"></div>
      <div class="skeleton h-4 w-2/3"></div>
      <div class="skeleton h-4 w-full"></div>
      <div class="skeleton h-16 w-full"></div>
      <div class="skeleton h-4 w-1/2"></div>
    </div>

    <!-- 错误态：给出重试入口 -->
    <div v-else-if="error" class="space-y-3">
      <div class="flex items-start gap-2 rounded-control border border-danger-100 bg-danger-50 px-3 py-2 text-sm text-danger-700">
        <Icon name="alert" :size="16" class="mt-0.5 shrink-0" />
        <span class="min-w-0 break-words">{{ t('accounts.detailFailed', { error }) }}</span>
      </div>
      <div class="flex justify-end">
        <button type="button" class="btn-default btn-sm" @click="load">
          <Icon name="refresh" :size="14" />
          {{ t('accounts.retry') }}
        </button>
      </div>
    </div>

    <div v-else-if="detail && row" class="space-y-3">
      <p class="text-xs text-ink-mute">{{ t('accounts.detailHint') }}</p>

      <!-- 状态 + 启用开关 -->
      <div class="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line bg-canvas px-3 py-2">
        <div class="flex items-center gap-2">
          <span class="text-xs text-ink-mute">{{ t('accounts.colStatus') }}</span>
          <StatusBadge :kind="row.statusKind" :countdown="row.countdown" :tooltip="row.statusTooltip" />
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs text-ink-mute">{{ row.disabled ? t('accounts.statusDisabled') : t('accounts.colEnabled') }}</span>
          <AccountDisabledSwitch
            :disabled="row.disabled"
            :busy="toggling"
            @toggle="$emit('toggle-disabled', row)"
          />
        </div>
      </div>

      <!-- 可用性：缺浏览器会话时可在面板里直接生成（服务器自动登录采集，无需本机 Chrome） -->
      <div class="flex flex-wrap items-center gap-2 rounded-control border border-line bg-canvas px-3 py-2">
        <span class="text-xs text-ink-mute">{{ t('accounts.colUsability') }}</span>
        <UsabilityBadge :row="row" :busy="provisioning" @provision="$emit('provision-fingerprint', row)" />
        <span v-if="row.fingerprintAt" class="ml-auto text-[11px] text-ink-mute">
          {{ t('accounts.fingerprintAt', { at: formatIsoTime(row.fingerprintAt) }) }}
        </span>
      </div>

      <!-- 邮箱 -->
      <div class="flex items-start gap-2">
        <span class="w-20 shrink-0 pt-1.5 text-xs text-ink-mute">{{ t('accounts.emailLabel') }}</span>
        <div class="mono min-w-0 flex-1 break-all rounded-control border border-line bg-canvas px-3 py-1.5 text-ink-soft">
          {{ detail.email }}
        </div>
        <button
          type="button"
          class="btn-icon shrink-0"
          :title="t('common.copy')"
          :aria-label="t('common.copy')"
          @click="copy(detail.email)"
        >
          <Icon name="copy" :size="14" />
        </button>
      </div>

      <!-- 密码：默认掩码，点眼睛显示，复制仅在显示后可用 -->
      <div class="flex items-center gap-2">
        <span class="w-20 shrink-0 text-xs text-ink-mute">{{ t('accounts.colPassword') }}</span>
        <div class="mono min-w-0 flex-1 truncate rounded-control border border-line bg-canvas px-3 py-1.5" :class="revealedPassword ? 'text-ink' : 'text-ink-soft'">
          {{ revealedPassword ? detail.password : MASK }}
        </div>
        <button
          type="button"
          class="btn-icon shrink-0"
          :title="revealedPassword ? t('accounts.hidePassword') : t('accounts.showPassword')"
          :aria-label="revealedPassword ? t('accounts.hidePassword') : t('accounts.showPassword')"
          @click="revealedPassword = !revealedPassword"
        >
          <Icon :name="revealedPassword ? 'eye-off' : 'eye'" :size="14" />
        </button>
        <button
          type="button"
          class="btn-icon shrink-0"
          :disabled="!revealedPassword"
          :title="t('common.copy')"
          :aria-label="t('common.copy')"
          @click="copy(detail.password)"
        >
          <Icon name="copy" :size="14" />
        </button>
      </div>

      <!-- Token：完整 JWT，等宽 + 换行，框内滚动不横向溢出 -->
      <div class="flex items-start gap-2">
        <span class="w-20 shrink-0 pt-1.5 text-xs text-ink-mute">{{ t('accounts.colToken') }}</span>
        <div class="mono max-h-32 min-w-0 flex-1 overflow-y-auto break-all rounded-control border border-line bg-canvas px-3 py-1.5 text-[11px] leading-5 text-ink-soft">
          {{ detail.token || '—' }}
        </div>
        <button
          type="button"
          class="btn-icon shrink-0"
          :disabled="!detail.token"
          :title="t('common.copy')"
          :aria-label="t('common.copy')"
          @click="copy(detail.token)"
        >
          <Icon name="copy" :size="14" />
        </button>
      </div>

      <!-- 到期时间 -->
      <div class="flex items-center gap-2">
        <span class="w-20 shrink-0 text-xs text-ink-mute">{{ t('accounts.colExpires') }}</span>
        <div class="min-w-0 flex-1 truncate rounded-control border border-line bg-canvas px-3 py-1.5 text-xs text-ink-soft">
          {{ formatExpires(detail.expires) }}
        </div>
      </div>

      <!-- 代理 -->
      <div class="flex items-center gap-2">
        <span class="w-20 shrink-0 text-xs text-ink-mute">{{ t('accounts.colProxy') }}</span>
        <div class="mono min-w-0 flex-1 truncate rounded-control border border-line bg-canvas px-3 py-1.5 text-ink-soft" :title="detail.proxy || ''">
          {{ detail.proxy || t('accounts.noProxy') }}
        </div>
        <button
          v-if="detail.proxy"
          type="button"
          class="btn-icon shrink-0"
          :title="t('common.copy')"
          :aria-label="t('common.copy')"
          @click="copy(detail.proxy)"
        >
          <Icon name="copy" :size="14" />
        </button>
      </div>

      <!-- 今日用量 -->
      <div class="rounded-control border border-line bg-canvas px-3 py-2 text-xs">
        <div class="flex items-center justify-between gap-3">
          <span class="text-ink-mute">{{ t('accounts.chatToday') }}</span>
          <span class="tabular-nums text-ink" :title="`${stats.chat.input} in / ${stats.chat.output} out`">
            {{ compact(stats.chat.input) }} in / {{ compact(stats.chat.output) }} out
          </span>
        </div>
        <div class="mt-1 flex items-center justify-between gap-3">
          <span class="text-ink-mute">{{ t('accounts.cliToday') }}</span>
          <span v-if="cliInactive" class="text-ink-mute">{{ cliLabel }}</span>
          <span v-else-if="row.cliState === 'pending'" class="text-ink-mute">{{ t('accounts.cliPending') }}</span>
          <span v-else class="tabular-nums text-ink">
            {{ t('accounts.cliCalls', { n: row.cliRequestNumber, limit: row.cliQuotaLimit }) }}
          </span>
        </div>
      </div>
    </div>

    <template #footer>
      <button type="button" class="btn-default" @click="$emit('close')">
        {{ t('common.close') }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Modal from '../ui/Modal.vue'
import Icon from '../ui/Icon.vue'
import StatusBadge from './StatusBadge.vue'
import UsabilityBadge from './UsabilityBadge.vue'
import AccountDisabledSwitch from './AccountDisabledSwitch.vue'
import { formatCompact } from '../../utils/format.js'
import { copyText, toast } from '../../ui/feedback.js'
import {
  CLI_INACTIVE_LABELS,
  DEFAULT_STATS,
  formatExpires,
  formatIsoTime,
  getAuthHeaders
} from './shared.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  // 父级传入的当前行（含状态/用量/禁用标记），凭据从 /accountDetail 单独取
  row: { type: Object, default: null },
  toggling: { type: Boolean, default: false },
  // 浏览器会话生成中：可用性行内的「生成」按钮进入 busy 态
  provisioning: { type: Boolean, default: false }
})

defineEmits(['close', 'toggle-disabled', 'provision-fingerprint'])

const { t } = useI18n()

const MASK = '••••••••'

const loading = ref(false)
const error = ref('')
const detail = ref(null)
const revealedPassword = ref(false)

const errorText = (e) => e?.response?.data?.error || e?.message || ''

const load = async () => {
  const email = props.row?.email
  if (!email) return
  loading.value = true
  error.value = ''
  detail.value = null
  revealedPassword.value = false
  try {
    const res = await axios.get('/api/accountDetail', {
      params: { email },
      headers: getAuthHeaders()
    })
    detail.value = res.data || null
  } catch (e) {
    console.error('accountDetail error:', e)
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}

// 每次打开（或换了账号）都重新拉一次，避免展示上一次的凭据。
// 注意：只监听「是否打开 + 邮箱」这两个值，不能监听 row 对象本身——
// 父级行对象每秒（倒计时 tick）都会重建，监听对象会导致每秒重复请求并把密码重新掩码。
const detailKey = computed(() => (props.open ? (props.row?.email || '') : ''))

watch(detailKey, (key) => {
  if (key) load()
})

const stats = computed(() => props.row?.stats || detail.value?.stats || DEFAULT_STATS)
const cliInactive = computed(() => Boolean(CLI_INACTIVE_LABELS[props.row?.cliState]))
const cliLabel = computed(() => t(CLI_INACTIVE_LABELS[props.row?.cliState]))

const compact = (n) => formatCompact(n, { unitK: t('accounts.unitK'), unitM: t('accounts.unitM') })

const copy = async (text) => {
  if (!text) return
  const ok = await copyText(text)
  if (ok) toast.success(t('accounts.toastCopied'))
  else toast.error(t('accounts.toastCopyFailed'))
}
</script>
