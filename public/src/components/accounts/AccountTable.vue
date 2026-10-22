<template>
  <!-- 表格视图：宽屏信息密度高，窄屏交给 .table-wrap 横向滚动 -->
  <div class="card overflow-hidden">
    <div class="table-wrap">
      <table class="data-table min-w-[1040px]">
        <thead>
          <tr>
            <th class="w-9">
              <input
                ref="headerBox"
                type="checkbox"
                class="h-4 w-4 accent-brand-600"
                :checked="pageAllSelected"
                :aria-label="t('accounts.selectAll')"
                @change="$emit('toggle-page')"
              />
            </th>
            <th class="w-[220px]">{{ t('accounts.colAccount') }}</th>
            <th class="w-[130px]">{{ t('accounts.colUsability') }}</th>
            <th class="w-[130px]">{{ t('accounts.colExpires') }}</th>
            <th class="w-[150px] hidden xl:table-cell">{{ t('accounts.colUsage') }}</th>
            <th class="w-[110px]">{{ t('accounts.colStatus') }}</th>
            <th class="w-[70px]">{{ t('accounts.colEnabled') }}</th>
            <th class="w-[150px] text-right">{{ t('common.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.email"
            :class="[
              isSelected(row.email) ? 'bg-brand-50/60' : '',
              row.disabled ? 'opacity-60' : ''
            ]"
          >
            <td>
              <input
                type="checkbox"
                class="h-4 w-4 accent-brand-600"
                :checked="isSelected(row.email)"
                :aria-label="row.email"
                @change="$emit('toggle-select', row.email)"
              />
            </td>

            <!-- 账号：邮箱 + 代理（过长省略，title 保留完整值）；凭据只在「详情」里 -->
            <td>
              <div class="truncate font-medium text-ink" :title="row.email">{{ row.email }}</div>
              <div class="mono truncate text-[11px] text-ink-mute" :title="row.proxy || ''">
                {{ row.proxy || t('accounts.noProxy') }}
              </div>
            </td>

            <!-- 可用性：能不能真的发请求；缺浏览器会话时就地给「生成」 -->
            <td class="whitespace-nowrap">
              <UsabilityBadge
                :row="row"
                :busy="provisioning.includes(row.email)"
                @provision="$emit('provision-fingerprint', row)"
              />
            </td>

            <td class="whitespace-nowrap text-xs text-ink-soft">{{ formatExpires(row.expires) }}</td>

            <!-- 今日用量：Chat 入/出 + CLI 调用数（CLI 不可用时显示状态词） -->
            <td class="hidden xl:table-cell">
              <div class="whitespace-nowrap text-xs">
                <div class="text-ink-mute">
                  {{ t('accounts.chatToday') }}
                  <span class="tabular-nums text-ink" :title="`${row.stats.chat.input} in / ${row.stats.chat.output} out`">
                    {{ compact(row.stats.chat.input) }} / {{ compact(row.stats.chat.output) }}
                  </span>
                </div>
                <div class="text-ink-mute" :title="row.cliTooltip">
                  {{ t('accounts.cliToday') }}
                  <span v-if="cliInactive(row)" class="text-ink-mute">{{ cliLabel(row) }}</span>
                  <span v-else-if="row.cliState === 'pending'" class="text-ink-mute">{{ t('accounts.cliPending') }}</span>
                  <span v-else class="tabular-nums text-ink">
                    {{ t('accounts.cliCalls', { n: row.cliRequestNumber, limit: row.cliQuotaLimit }) }}
                  </span>
                </div>
              </div>
            </td>

            <td class="whitespace-nowrap">
              <StatusBadge :kind="row.statusKind" :countdown="row.countdown" :tooltip="row.statusTooltip" />
            </td>

            <!-- 启用/禁用：禁用后不参与轮换 -->
            <td>
              <AccountDisabledSwitch
                :disabled="row.disabled"
                :busy="toggling.includes(row.email)"
                @toggle="$emit('toggle-disabled', row)"
              />
            </td>

            <td>
              <div class="flex items-center justify-end gap-0.5">
                <button
                  type="button"
                  class="btn-icon"
                  :title="t('accounts.detail')"
                  :aria-label="t('accounts.detail')"
                  @click="$emit('detail', row)"
                >
                  <Icon name="info" :size="15" />
                </button>
                <button
                  type="button"
                  class="btn-icon"
                  :title="t('accounts.editProxy')"
                  :aria-label="t('accounts.editProxy')"
                  @click="$emit('edit-proxy', row)"
                >
                  <Icon name="server" :size="15" />
                </button>
                <button
                  type="button"
                  class="btn-icon"
                  :disabled="refreshing.includes(row.email)"
                  :title="t('accounts.refreshToken')"
                  :aria-label="t('accounts.refreshToken')"
                  @click="$emit('refresh', row.email)"
                >
                  <Icon
                    name="refresh"
                    :size="15"
                    :class="refreshing.includes(row.email) ? 'animate-spin' : ''"
                  />
                </button>
                <button
                  type="button"
                  class="btn-icon hover:text-danger-600"
                  :title="t('accounts.deleteAccount')"
                  :aria-label="t('accounts.deleteAccount')"
                  @click="$emit('delete', row)"
                >
                  <Icon name="trash" :size="15" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '../ui/Icon.vue'
import StatusBadge from './StatusBadge.vue'
import UsabilityBadge from './UsabilityBadge.vue'
import AccountDisabledSwitch from './AccountDisabledSwitch.vue'
import { formatCompact } from '../../utils/format.js'
import { CLI_INACTIVE_LABELS, formatExpires } from './shared.js'

const props = defineProps({
  rows: { type: Array, default: () => [] },
  selected: { type: Array, default: () => [] },
  refreshing: { type: Array, default: () => [] },
  // 正在切换禁用状态的邮箱：开关进入 busy 态
  toggling: { type: Array, default: () => [] },
  // 正在生成浏览器会话的邮箱：行内「生成」按钮进入 busy 态
  provisioning: { type: Array, default: () => [] },
  pageAllSelected: { type: Boolean, default: false },
  pageSomeSelected: { type: Boolean, default: false }
})

defineEmits([
  'toggle-select',
  'toggle-page',
  'edit-proxy',
  'refresh',
  'delete',
  'detail',
  'toggle-disabled',
  'provision-fingerprint'
])

const { t } = useI18n()

// 表头复选框的半选态只能用 DOM 属性表达
const headerBox = ref(null)
watchEffect(() => {
  if (headerBox.value) headerBox.value.indeterminate = props.pageSomeSelected
})

const isSelected = (email) => props.selected.includes(email)

const compact = (n) => formatCompact(n, { unitK: t('accounts.unitK'), unitM: t('accounts.unitM') })

const cliInactive = (row) => Boolean(CLI_INACTIVE_LABELS[row.cliState])
const cliLabel = (row) => t(CLI_INACTIVE_LABELS[row.cliState])
</script>

<style scoped>
/* 收窄单元格内边距：让 8 列在 1280px 内容宽度内放得下（共享 .data-table 仍保持 16px） */
.data-table th,
.data-table td {
  padding-left: 10px;
  padding-right: 10px;
}
</style>
