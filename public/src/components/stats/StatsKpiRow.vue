<template>
  <div class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
    <div v-for="kpi in kpis" :key="kpi.key" class="card min-w-0 p-4">
      <div class="flex items-start justify-between gap-2">
        <div class="kpi-label min-w-0 truncate" :title="kpi.label">{{ kpi.label }}</div>

        <!-- 环比：无对比数据时显示「—」，避免除以零得到 Infinity -->
        <span
          v-if="kpi.delta === null"
          class="shrink-0 text-xs text-ink-mute"
          :title="t('usage.kpi.noPrev')"
        >—</span>
        <span
          v-else
          class="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium tabular-nums"
          :class="deltaClass(kpi.delta)"
          :title="`${compareLabel(kpi)} ${formatPercent(kpi.delta)}`"
        >
          <Icon :name="deltaIcon(kpi.delta)" :size="12" />
          {{ formatPercent(kpi.delta) }}
        </span>
      </div>

      <div class="kpi-value mt-1 truncate" :title="kpi.raw === null ? '' : String(kpi.raw)">
        {{ kpi.value }}
      </div>
      <div class="mt-0.5 truncate text-xs text-ink-mute" :title="kpi.sub">{{ kpi.sub }}</div>
    </div>
  </div>
</template>

<script setup>
import Icon from '../ui/Icon.vue'
import { formatPercent } from './usageData.js'
import { useUsageFormat } from './useUsageFormat.js'

defineProps({
  // [{ key, label, value, sub, raw, delta: number|null, compare: 'prev'|'yesterday' }]
  kpis: { type: Array, required: true }
})

const { t } = useUsageFormat()

const deltaIcon = (delta) => {
  if (delta > 0) return 'arrow-up'
  if (delta < 0) return 'arrow-down'
  return 'activity'
}

const deltaClass = (delta) => {
  if (delta > 0) return 'text-ok-700'
  if (delta < 0) return 'text-danger-600'
  return 'text-ink-mute'
}

const compareLabel = (kpi) => (
  kpi.compare === 'yesterday' ? t('usage.kpi.vsYesterday') : t('usage.kpi.vsPrev')
)
</script>
