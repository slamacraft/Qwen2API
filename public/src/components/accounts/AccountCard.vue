<template>
  <!-- 卡片视图：窄屏（单列）也保持字段对齐，长文本一律省略号 + title；凭据只在「详情」里 -->
  <div
    class="card flex flex-col overflow-hidden transition-colors"
    :class="[
      selected ? 'border-brand-200 ring-1 ring-brand-100' : '',
      row.disabled ? 'opacity-60' : ''
    ]"
  >
    <div class="flex items-start gap-2 border-b border-line px-4 py-3">
      <input
        type="checkbox"
        class="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
        :checked="selected"
        :aria-label="row.email"
        @change="$emit('toggle-select', row.email)"
      />
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-medium text-ink" :title="row.email">{{ row.email }}</div>
        <div class="mt-1 flex flex-wrap items-center gap-1.5">
          <StatusBadge :kind="row.statusKind" :countdown="row.countdown" :tooltip="row.statusTooltip" />
        </div>
      </div>
      <!-- 启用/禁用：禁用后移出轮换队列 -->
      <AccountDisabledSwitch
        :disabled="row.disabled"
        :busy="toggling"
        @toggle="$emit('toggle-disabled', row)"
      />
    </div>

    <div class="space-y-2 px-4 py-3">
      <!-- 可用性：能不能真的发请求；缺会话时就地生成，无需本机 Chrome -->
      <div class="flex items-center gap-2">
        <span class="w-14 shrink-0 text-xs text-ink-mute">{{ t('accounts.colUsability') }}</span>
        <UsabilityBadge
          class="min-w-0 flex-1"
          :row="row"
          :busy="provisioning"
          @provision="$emit('provision-fingerprint', row)"
        />
      </div>

      <div class="flex items-center gap-2">
        <span class="w-14 shrink-0 text-xs text-ink-mute">{{ t('accounts.colExpires') }}</span>
        <span class="min-w-0 flex-1 truncate text-xs text-ink-soft">{{ formatExpires(row.expires) }}</span>
      </div>

      <div class="flex items-center gap-2">
        <span class="w-14 shrink-0 text-xs text-ink-mute">{{ t('accounts.colProxy') }}</span>
        <span v-if="row.proxy" class="mono min-w-0 flex-1 truncate text-ink-soft" :title="row.proxy">{{ row.proxy }}</span>
        <span v-else class="min-w-0 flex-1 truncate text-xs text-ink-mute">{{ t('accounts.noProxy') }}</span>
        <button
          v-if="row.proxy"
          type="button"
          class="btn-icon h-7 w-7 shrink-0"
          :title="t('common.copy')"
          :aria-label="t('common.copy')"
          @click="copy(row.proxy)"
        >
          <Icon name="copy" :size="14" />
        </button>
      </div>
    </div>

    <!-- 今日用量 + CLI 配额 -->
    <div class="mt-auto border-t border-line bg-canvas px-4 py-2.5">
      <div class="flex items-center justify-between gap-3 text-xs">
        <span class="text-ink-mute">{{ t('accounts.chatToday') }}</span>
        <span class="tabular-nums text-ink" :title="`${row.stats.chat.input} in / ${row.stats.chat.output} out`">
          {{ compact(row.stats.chat.input) }} in / {{ compact(row.stats.chat.output) }} out
        </span>
      </div>

      <div class="mt-1 flex items-center justify-between gap-3 text-xs">
        <span class="text-ink-mute underline decoration-dotted underline-offset-2">{{ t('accounts.cliToday') }}</span>
        <span v-if="cliInactive" class="text-ink-mute" :title="row.cliTooltip">{{ cliLabel }}</span>
        <span v-else-if="row.cliState === 'pending'" class="text-ink-mute" :title="row.cliTooltip">
          {{ t('accounts.cliPending') }}
        </span>
        <button
          v-else
          type="button"
          class="flex items-center gap-1 tabular-nums text-ink"
          :title="row.cliTooltip"
          @click="toggleCliExpanded"
        >
          {{ t('accounts.cliCalls', { n: row.cliRequestNumber, limit: row.cliQuotaLimit }) }}
          <Icon
            name="chevron-down"
            :size="12"
            class="text-ink-mute transition-transform"
            :class="cliExpanded ? 'rotate-180' : ''"
          />
        </button>
      </div>

      <div v-if="cliExpanded && row.cliState === 'available'" class="mt-1.5 space-y-1">
        <div class="flex items-center justify-between text-[11px] text-ink-mute">
          <span>{{ t('accounts.cliSuccess', { n: row.stats.cli.calls }) }}</span>
          <span class="tabular-nums" :title="`${row.stats.cli.input} in / ${row.stats.cli.output} out`">
            {{ compact(row.stats.cli.input) }} in / {{ compact(row.stats.cli.output) }} out
          </span>
        </div>
        <div class="h-1.5 overflow-hidden rounded-full bg-line">
          <div class="h-full rounded-full transition-all" :class="cliProgressColor" :style="{ width: cliProgressPct + '%' }"></div>
        </div>
      </div>
    </div>

    <!-- 操作：详情（文字）+ 代理/刷新/删除（图标 + title，三语都不会撑破卡片） -->
    <div class="flex items-center justify-between gap-1 border-t border-line px-3 py-2">
      <button type="button" class="btn-default btn-sm" :title="t('accounts.detail')" @click="$emit('detail', row)">
        <Icon name="info" :size="14" />
        <span>{{ t('accounts.detail') }}</span>
      </button>
      <div class="flex items-center gap-0.5">
        <button
          type="button"
          class="btn-icon"
          :title="t('accounts.editProxy')"
          :aria-label="t('accounts.editProxy')"
          @click="$emit('edit-proxy', row)"
        >
          <Icon name="server" :size="16" />
        </button>
        <button
          type="button"
          class="btn-icon"
          :disabled="refreshing"
          :title="t('accounts.refreshToken')"
          :aria-label="t('accounts.refreshToken')"
          @click="$emit('refresh', row.email)"
        >
          <Icon name="refresh" :size="16" :class="refreshing ? 'animate-spin' : ''" />
        </button>
        <button
          type="button"
          class="btn-icon hover:text-danger-600"
          :title="t('accounts.deleteAccount')"
          :aria-label="t('accounts.deleteAccount')"
          @click="$emit('delete', row)"
        >
          <Icon name="trash" :size="16" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '../ui/Icon.vue'
import StatusBadge from './StatusBadge.vue'
import UsabilityBadge from './UsabilityBadge.vue'
import AccountDisabledSwitch from './AccountDisabledSwitch.vue'
import { formatCompact } from '../../utils/format.js'
import { copyText, toast } from '../../ui/feedback.js'
import {
  CLI_INACTIVE_LABELS,
  cliExpanded,
  formatExpires,
  toggleCliExpanded
} from './shared.js'

const props = defineProps({
  row: { type: Object, required: true },
  selected: { type: Boolean, default: false },
  refreshing: { type: Boolean, default: false },
  // 禁用开关请求进行中
  toggling: { type: Boolean, default: false },
  // 浏览器会话生成中：可用性行内的「生成」按钮进入 busy 态
  provisioning: { type: Boolean, default: false }
})

defineEmits([
  'toggle-select',
  'edit-proxy',
  'refresh',
  'delete',
  'detail',
  'toggle-disabled',
  'provision-fingerprint'
])

const { t } = useI18n()

const compact = (n) => formatCompact(n, { unitK: t('accounts.unitK'), unitM: t('accounts.unitM') })

const cliInactive = computed(() => Boolean(CLI_INACTIVE_LABELS[props.row.cliState]))
const cliLabel = computed(() => t(CLI_INACTIVE_LABELS[props.row.cliState]))

const cliProgressPct = computed(() => {
  const limit = Number(props.row.cliQuotaLimit) || 0
  if (limit <= 0) return 0
  return Math.min(100, (Number(props.row.cliRequestNumber) || 0) / limit * 100)
})

const cliProgressColor = computed(() => {
  if (cliProgressPct.value >= 80) return 'bg-danger-600'
  if (cliProgressPct.value >= 50) return 'bg-warn-600'
  return 'bg-ok-600'
})

const copy = async (text) => {
  if (!text) return
  const ok = await copyText(text)
  if (ok) toast.success(t('accounts.toastCopied'))
  else toast.error(t('accounts.toastCopyFailed'))
}
</script>
