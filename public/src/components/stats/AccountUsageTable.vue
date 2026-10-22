<template>
  <section class="card">
    <div class="card-header">
      <div class="min-w-0">
        <h2 class="card-title">{{ t('usage.table.title') }}</h2>
        <p class="mt-0.5 truncate text-xs text-ink-mute">{{ t('usage.table.subtitle') }}</p>
      </div>
      <div v-if="rows.length" class="hidden text-xs text-ink-mute sm:block">
        {{ t('usage.table.summary', { n: rows.length, total: fmt(total) }) }}
      </div>
    </div>

    <div v-if="!rows.length" class="flex flex-col items-center gap-2 px-5 py-14 text-center">
      <Icon name="users" :size="22" class="text-ink-mute" />
      <p class="text-sm text-ink-mute">{{ t('usage.table.empty') }}</p>
    </div>

    <div v-else class="table-wrap">
      <table class="data-table min-w-[880px]">
        <thead>
          <tr>
            <th
              v-for="column in columns"
              :key="column.key"
              :class="column.align === 'right' ? 'text-right' : ''"
            >
              <button
                v-if="column.sortable"
                type="button"
                class="inline-flex items-center gap-1 text-inherit transition-colors hover:text-ink"
                :title="t('usage.table.sortHint')"
                @click="toggleSort(column.key)"
              >
                {{ t(column.labelKey) }}
                <Icon
                  v-if="sortKey === column.key"
                  :name="sortDir === 'asc' ? 'arrow-up' : 'arrow-down'"
                  :size="12"
                  class="text-brand-600"
                />
                <Icon v-else name="chevron-down" :size="12" class="opacity-30" />
              </button>
              <span v-else>{{ t(column.labelKey) }}</span>
            </th>
          </tr>
        </thead>

        <tbody>
          <tr
            v-for="row in sortedRows"
            :key="row.email"
            class="cursor-pointer"
            tabindex="0"
            role="button"
            :aria-label="`${row.email} — ${t('usage.table.subtitle')}`"
            @click="emit('select', row)"
            @keydown.enter.prevent="emit('select', row)"
            @keydown.space.prevent="emit('select', row)"
          >
            <td class="max-w-[260px]">
              <div class="flex items-center gap-2">
                <span class="truncate font-medium text-ink" :title="row.email">{{ row.email }}</span>
                <span v-if="row.total === 0" class="badge badge-mute shrink-0">{{ t('usage.table.noData') }}</span>
              </div>
            </td>
            <td class="text-right tabular-nums text-ink-soft" :title="String(row.input)">{{ fmt(row.input) }}</td>
            <td class="text-right tabular-nums text-ink-soft" :title="String(row.output)">{{ fmt(row.output) }}</td>
            <td class="text-right font-medium tabular-nums text-ink" :title="String(row.total)">{{ fmt(row.total) }}</td>
            <td>
              <div class="flex items-center justify-end gap-2">
                <div class="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-canvas">
                  <div
                    class="h-full rounded-full bg-brand-500"
                    :style="{ width: `${Math.max(row.sharePct > 0 ? 2 : 0, Math.min(100, row.sharePct))}%` }"
                  ></div>
                </div>
                <span class="w-12 text-right text-xs tabular-nums text-ink-soft">{{ row.sharePct.toFixed(1) }}%</span>
              </div>
            </td>
            <td class="text-right tabular-nums text-ink-soft" :title="t('usage.kpi.perActiveDay', { n: row.activeDays })">
              {{ fmt(row.avgDaily) }}
            </td>
            <td class="text-right">
              <template v-if="row.peakValue > 0">
                <div class="mono text-ink-soft">{{ formatShortDate(row.peakDate) }}</div>
                <div class="text-xs tabular-nums text-ink-mute">{{ fmt(row.peakValue) }}</div>
              </template>
              <span v-else class="text-ink-mute">—</span>
            </td>
            <td class="text-right">
              <span
                v-if="row.changePct === null"
                class="text-xs text-ink-mute"
                :title="t('usage.kpi.noPrev')"
              >—</span>
              <span
                v-else
                class="inline-flex items-center gap-0.5 text-xs font-medium tabular-nums"
                :class="changeClass(row.changePct)"
                :title="`${t('usage.kpi.vsPrev')} ${formatPercent(row.changePct)}`"
              >
                <Icon :name="changeIcon(row.changePct)" :size="12" />
                {{ formatPercent(row.changePct) }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'
import Icon from '../ui/Icon.vue'
import { formatPercent, formatShortDate } from './usageData.js'
import { useUsageFormat } from './useUsageFormat.js'

const props = defineProps({
  // [{ email, input, output, total, sharePct, avgDaily, activeDays, peakDate, peakValue, changePct, daily }]
  rows: { type: Array, required: true },
  total: { type: Number, default: 0 }
})

const emit = defineEmits(['select'])
const { t, fmt } = useUsageFormat()

const columns = [
  { key: 'email', labelKey: 'usage.table.account', align: 'left', sortable: true },
  { key: 'input', labelKey: 'usage.table.input', align: 'right', sortable: true },
  { key: 'output', labelKey: 'usage.table.output', align: 'right', sortable: true },
  { key: 'total', labelKey: 'usage.table.total', align: 'right', sortable: true },
  { key: 'share', labelKey: 'usage.table.share', align: 'right', sortable: true },
  { key: 'avgDaily', labelKey: 'usage.table.avgDaily', align: 'right', sortable: true },
  { key: 'peak', labelKey: 'usage.table.peakDay', align: 'right', sortable: true },
  { key: 'change', labelKey: 'usage.table.change', align: 'right', sortable: true }
]

const sortKey = ref('total')
const sortDir = ref('desc')

const toggleSort = (key) => {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
    return
  }
  sortKey.value = key
  sortDir.value = key === 'email' ? 'asc' : 'desc'
}

// 环比为 null（无对比数据）时排在最后，避免排序时把 null 当成 0。
const sortValue = (row) => {
  switch (sortKey.value) {
    case 'email':
      return row.email
    case 'input':
      return row.input
    case 'output':
      return row.output
    case 'total':
      return row.total
    case 'share':
      return row.sharePct
    case 'avgDaily':
      return row.avgDaily
    case 'peak':
      return row.peakValue
    case 'change':
      return row.changePct === null ? Number.NEGATIVE_INFINITY : row.changePct
    default:
      return row.total
  }
}

const sortedRows = computed(() => {
  const direction = sortDir.value === 'asc' ? 1 : -1
  return [...props.rows].sort((left, right) => {
    const a = sortValue(left)
    const b = sortValue(right)
    if (typeof a === 'string' || typeof b === 'string') {
      return String(a).localeCompare(String(b)) * direction
    }
    if (a === b) return String(left.email).localeCompare(String(right.email))
    return (a - b) * direction
  })
})

const changeIcon = (value) => {
  if (value > 0) return 'arrow-up'
  if (value < 0) return 'arrow-down'
  return 'activity'
}

const changeClass = (value) => {
  if (value > 0) return 'text-ok-700'
  if (value < 0) return 'text-danger-600'
  return 'text-ink-mute'
}
</script>
