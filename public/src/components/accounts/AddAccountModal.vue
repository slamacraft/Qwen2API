<template>
  <!-- 添加账号：单账号 / 批量两个页签，批量任务在后台继续轮询 -->
  <Modal
    :open="open"
    :title="t('accounts.addTitle')"
    :size="mode === 'batch' ? 'lg' : 'sm'"
    @close="requestClose"
  >
    <div class="mb-4 flex gap-1 rounded-control border border-line bg-canvas p-1">
      <button
        v-for="tab in tabs"
        :key="tab.value"
        type="button"
        class="h-8 flex-1 rounded-control text-sm font-medium transition-colors"
        :class="mode === tab.value ? 'bg-surface text-ink shadow-card' : 'text-ink-mute hover:text-ink'"
        :disabled="isBatchAdding"
        @click="mode = tab.value"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- 单账号 -->
    <div v-if="mode === 'single'" class="space-y-3">
      <div>
        <label class="label" for="account-email">{{ t('accounts.emailLabel') }}</label>
        <input
          id="account-email"
          v-model="form.email"
          type="email"
          class="input"
          autocomplete="off"
          :placeholder="t('accounts.emailPlaceholder')"
        />
      </div>
      <div>
        <label class="label" for="account-password">{{ t('accounts.passwordLabel') }}</label>
        <input
          id="account-password"
          v-model="form.password"
          type="password"
          class="input"
          autocomplete="new-password"
        />
      </div>
      <div>
        <label class="label" for="account-proxy">{{ t('accounts.proxyLabel') }}</label>
        <input
          id="account-proxy"
          v-model="form.proxy"
          type="text"
          class="input"
          :class="proxyValid ? '' : 'border-danger-200'"
          :placeholder="t('accounts.proxyPlaceholder')"
        />
        <p v-if="!proxyValid" class="mt-1 text-xs text-danger-600">{{ t('accounts.proxyInvalid') }}</p>
      </div>
    </div>

    <!-- 批量 -->
    <div v-else class="space-y-3">
      <div>
        <label class="label" for="account-batch">{{ t('accounts.batchLabel') }}</label>
        <textarea
          id="account-batch"
          v-model="batchText"
          rows="6"
          class="textarea font-mono text-xs"
          :disabled="isBatchAdding"
        ></textarea>
        <p class="mt-1 text-xs text-ink-mute">{{ t('accounts.batchHint') }}</p>
      </div>

      <!-- 批量任务进度 -->
      <div v-if="task" class="space-y-3 rounded-control border border-line bg-canvas p-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="text-xs text-ink-mute">{{ t('accounts.taskStatus') }}</span>
            <span class="badge" :class="statusBadge">{{ statusLabel }}</span>
            <span class="text-xs text-ink-soft">{{ task.message }}</span>
          </div>
          <span class="mono text-ink-mute">{{ t('accounts.taskId') }} {{ task.taskId }}</span>
        </div>

        <div>
          <div class="mb-1 flex items-center justify-between text-xs text-ink-mute">
            <span>{{ t('accounts.progress') }}</span>
            <span class="tabular-nums">{{ task.completed }}/{{ task.total }} · {{ progressPct.toFixed(0) }}%</span>
          </div>
          <div class="h-1.5 overflow-hidden rounded-full bg-line">
            <div class="h-full rounded-full bg-brand-600 transition-all" :style="{ width: progressPct + '%' }"></div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <div v-for="item in taskCounters" :key="item.key" class="rounded-control bg-surface px-2.5 py-1.5">
            <div class="text-[11px] text-ink-mute">{{ item.label }}</div>
            <div class="text-sm font-semibold tabular-nums text-ink">{{ task[item.key] }}</div>
          </div>
        </div>

        <div v-if="task.activeEmails?.length">
          <div class="mb-1 text-xs text-ink-mute">{{ t('accounts.processing') }}</div>
          <div class="flex flex-wrap gap-1.5">
            <span v-for="email in task.activeEmails" :key="email" class="badge badge-brand">{{ email }}</span>
          </div>
        </div>

        <div v-if="task.recentResults?.length">
          <div class="mb-1 text-xs text-ink-mute">{{ t('accounts.recentResults') }}</div>
          <div class="max-h-40 space-y-1.5 overflow-y-auto pr-1">
            <div
              v-for="item in task.recentResults"
              :key="`${item.email}-${item.status}-${item.message}`"
              class="flex items-start justify-between gap-3 rounded-control bg-surface px-2.5 py-1.5"
            >
              <div class="min-w-0">
                <div class="truncate text-xs font-medium text-ink">{{ item.email }}</div>
                <div class="truncate text-[11px] text-ink-mute">{{ item.message }}</div>
              </div>
              <span class="badge shrink-0" :class="item.status === 'success' ? 'badge-ok' : 'badge-danger'">
                {{ item.status === 'success' ? t('accounts.success') : t('accounts.failed') }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <button type="button" class="btn-default" @click="requestClose">
        {{ isBatchAdding ? t('accounts.continueBackground') : t('common.cancel') }}
      </button>
      <button
        v-if="mode === 'single'"
        type="button"
        class="btn-primary"
        :disabled="!canSubmit"
        @click="submitSingle"
      >
        {{ submitting ? t('accounts.adding') : t('accounts.add') }}
      </button>
      <button v-else type="button" class="btn-primary" :disabled="isBatchAdding" @click="submitBatch">
        {{ isBatchAdding ? t('accounts.batchRunning') : t('accounts.batchStart') }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Modal from '../ui/Modal.vue'
import { toast } from '../../ui/feedback.js'
import { getAuthHeaders, isValidProxy } from './shared.js'

defineProps({
  open: { type: Boolean, default: false }
})

const emit = defineEmits(['close', 'saved'])

const { t } = useI18n()

const mode = ref('single')
const tabs = computed(() => [
  { value: 'single', label: t('accounts.addTabSingle') },
  { value: 'batch', label: t('accounts.addTabBatch') }
])

// ---------- 单账号 ----------
const form = ref({ email: '', password: '', proxy: '' })
const submitting = ref(false)
const proxyValid = computed(() => isValidProxy(form.value.proxy))
const canSubmit = computed(() => Boolean(
  !submitting.value && form.value.email.trim() && form.value.password && proxyValid.value
))

// 后端错误体里的中文/英文说明比 axios 的 "Request failed with status code 409" 更有用
const errorText = (error) => error?.response?.data?.error || error?.message || ''

const submitSingle = async () => {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    await axios.post('/api/setAccount', {
      email: form.value.email.trim(),
      password: form.value.password,
      proxy: form.value.proxy.trim() || null
    }, {
      headers: getAuthHeaders()
    })
    toast.success(t('accounts.toastAddSuccess'))
    form.value = { email: '', password: '', proxy: '' }
    emit('saved')
    emit('close')
  } catch (error) {
    toast.error(t('accounts.toastAddFailed', { error: errorText(error) }))
  } finally {
    submitting.value = false
  }
}

// ---------- 批量 ----------
const batchText = ref('')
const isBatchAdding = ref(false)
const task = ref(null)
let pollTimer = null
let notified = false

const taskCounters = computed(() => [
  { key: 'total', label: t('accounts.total') },
  { key: 'success', label: t('accounts.success') },
  { key: 'failed', label: t('accounts.failed') },
  { key: 'skipped', label: t('accounts.skipped') },
  { key: 'invalid', label: t('accounts.invalid') }
])

const progressPct = computed(() => {
  const value = Number(task.value?.progress)
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
})

const statusLabel = computed(() => {
  const status = task.value?.status
  if (status === 'completed') return t('accounts.statusCompleted')
  if (status === 'failed') return t('accounts.statusFailed')
  if (status === 'running') return t('accounts.statusRunning')
  if (status === 'pending') return t('accounts.statusPending')
  return t('accounts.statusNotStarted')
})

const statusBadge = computed(() => ({
  completed: 'badge-ok',
  failed: 'badge-danger',
  running: 'badge-brand',
  pending: 'badge-warn'
}[task.value?.status] || 'badge-mute'))

const clearPolling = () => {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

const resetTask = (clearInput = false) => {
  clearPolling()
  task.value = null
  notified = false
  isBatchAdding.value = false
  if (clearInput) batchText.value = ''
}

// 批量结果摘要：成功/失败/跳过/无效 + 前 10 个失败账号
const batchMessage = (result) => {
  let message = t('accounts.toastBatchComplete', { n: result.success })
  if (result.failed > 0) message += ' · ' + t('accounts.toastBatchFailed', { n: result.failed })
  if (result.skipped > 0) message += ' · ' + t('accounts.toastBatchSkipped', { n: result.skipped })
  if (result.invalid > 0) message += ' · ' + t('accounts.toastBatchInvalid', { n: result.invalid })
  if (result.failedEmails?.length > 0) {
    message += '\n' + t('accounts.toastFailedAccounts') + ' ' + result.failedEmails.slice(0, 10).join(', ')
  }
  return message
}

const finalize = async (result) => {
  clearPolling()
  task.value = result
  isBatchAdding.value = false
  if (result.success > 0) emit('saved')
  if (!notified) {
    notified = true
    const message = batchMessage(result)
    if (result.failed > 0 || result.invalid > 0) toast.warn(message)
    else toast.success(message)
  }
}

const poll = async (taskId) => {
  clearPolling()
  try {
    const res = await axios.get(`/api/batchTasks/${taskId}`, { headers: getAuthHeaders() })
    task.value = res.data
    if (res.data.status === 'completed' || res.data.status === 'failed') {
      await finalize(res.data)
      return
    }
    pollTimer = setTimeout(() => poll(taskId), 800)
  } catch (error) {
    console.error('pollBatchTask error:', error)
    if (task.value) task.value = { ...task.value, message: t('accounts.toastProgressRetry') }
    pollTimer = setTimeout(() => poll(taskId), 1500)
  }
}

const submitBatch = async () => {
  if (isBatchAdding.value) return
  if (!batchText.value.trim()) {
    toast.error(t('accounts.toastEnterAccounts'))
    return
  }

  notified = false
  clearPolling()
  isBatchAdding.value = true

  try {
    const res = await axios.post('/api/setAccounts', {
      accounts: batchText.value,
      async: true
    }, {
      headers: getAuthHeaders()
    })

    task.value = res.data
    mode.value = 'batch'

    if (res.data.status === 'completed' || res.data.status === 'failed') {
      await finalize(res.data)
      return
    }
    poll(res.data.taskId)
  } catch (error) {
    console.error('addBatchTokens error:', error)
    toast.error(t('accounts.toastBatchAddFailed', { error: errorText(error) }))
    isBatchAdding.value = false
  }
}

// 关闭只收起弹窗：批量任务继续在后台轮询，完成后仍会 toast 并刷新列表
const requestClose = () => {
  emit('close')
  if (!isBatchAdding.value && mode.value === 'batch' && task.value?.status === 'completed') {
    resetTask(task.value.failed === 0 && task.value.invalid === 0)
  }
}

onBeforeUnmount(clearPolling)
</script>
