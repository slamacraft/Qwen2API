<template>
  <div class="page">
    <!-- 页头：区间说明 + 周期切换 / 刷新 / 导出（顶栏已有页面标题） -->
    <div class="page-head">
      <div class="min-w-0">
        <p class="page-sub">{{ t('usage.subtitle') }}</p>
        <p v-if="!loading && !error" class="mt-1 text-xs text-ink-mute">{{ rangeLabel }}</p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <div class="inline-flex items-center gap-0.5 rounded-control border border-line bg-surface p-0.5">
          <button
            v-for="option in periodOptions"
            :key="option.value"
            type="button"
            class="h-8 rounded-[6px] px-3 text-xs font-medium transition-colors"
            :class="period === option.value
              ? 'bg-brand-50 text-brand-700'
              : 'text-ink-soft hover:bg-canvas hover:text-ink'"
            :aria-pressed="period === option.value"
            @click="period = option.value"
          >
            {{ option.label }}
          </button>
        </div>

        <button
          class="btn-default btn-sm"
          :disabled="loading"
          :title="t('usage.actions.refresh')"
          :aria-label="t('usage.actions.refresh')"
          @click="load"
        >
          <Icon name="refresh" :size="14" :class="loading ? 'animate-spin' : ''" />
          <span class="hidden sm:inline">{{ t('usage.actions.refresh') }}</span>
        </button>
        <button
          class="btn-default btn-sm"
          :disabled="loading || !hasData"
          :title="t('usage.actions.exportDaily')"
          :aria-label="t('usage.actions.exportDaily')"
          @click="exportDaily"
        >
          <Icon name="download" :size="14" />
          <span class="hidden sm:inline">{{ t('usage.actions.exportDaily') }}</span>
        </button>
        <button
          class="btn-default btn-sm"
          :disabled="loading || !hasData"
          :title="t('usage.actions.exportAccounts')"
          :aria-label="t('usage.actions.exportAccounts')"
          @click="exportAccounts"
        >
          <Icon name="download" :size="14" />
          <span class="hidden sm:inline">{{ t('usage.actions.exportAccounts') }}</span>
        </button>
      </div>
    </div>

    <UsageSkeleton v-if="loading" />

    <!-- 加载失败：页内错误态 + 重试（同时弹 toast，不再用 alert） -->
    <div v-else-if="error" class="card">
      <div class="card-body flex flex-col items-center gap-3 py-14 text-center">
        <Icon name="alert" :size="24" class="text-danger-600" />
        <p class="text-sm text-ink-soft">{{ error }}</p>
        <button class="btn-primary btn-sm" @click="load">
          <Icon name="refresh" :size="14" />
          {{ t('common.retry') }}
        </button>
      </div>
    </div>

    <!-- 没有任何账号历史：整页空状态 -->
    <div v-else-if="!accounts.length" class="card">
      <div class="card-body flex flex-col items-center gap-2 py-16 text-center">
        <Icon name="chart" :size="24" class="text-ink-mute" />
        <p class="text-sm font-medium text-ink">{{ t('usage.empty.title') }}</p>
        <p class="text-xs text-ink-mute">{{ t('usage.empty.hint') }}</p>
        <button class="btn-default btn-sm mt-2" @click="load">
          <Icon name="refresh" :size="14" />
          {{ t('common.retry') }}
        </button>
      </div>
    </div>

    <template v-else>
      <StatsKpiRow :kpis="kpis" />

      <!-- 主图表：按天堆叠柱（chat/cli × 输入/输出），带峰值与均值参考线 -->
      <section class="card mt-4">
        <div class="card-header">
          <div class="min-w-0">
            <h2 class="card-title">{{ t('usage.chart.title') }}</h2>
            <p class="mt-0.5 truncate text-xs text-ink-mute">{{ t('usage.chart.subtitle') }}</p>
          </div>
          <div v-if="hasData" class="hidden items-center gap-4 text-xs text-ink-mute sm:flex">
            <span v-if="peakInfo.value > 0">
              {{ t('usage.chart.peakDay', { date: formatShortDate(peakInfo.date) }) }}
              · {{ fmt(peakInfo.value) }}
            </span>
            <span>{{ t('usage.chart.mean') }} · {{ fmt(meanDailyTotal) }}</span>
          </div>
        </div>
        <div class="card-body">
          <div v-if="hasData" class="relative h-[300px] sm:h-[340px]">
            <UsageStackedChart :daily="aggregateDailyRows" />
          </div>
          <div v-else class="flex flex-col items-center gap-2 py-14 text-center">
            <Icon name="chart" :size="22" class="text-ink-mute" />
            <p class="text-sm text-ink-mute">{{ t('usage.chart.empty') }}</p>
          </div>
        </div>
      </section>

      <!-- 按账号对比表：列头排序，点击行下钻 -->
      <AccountUsageTable
        class="mt-4"
        :rows="accountRows"
        :total="currentTotals.total"
        @select="openDrill"
      />
    </template>

    <!-- 下钻：单账号按天折线图 -->
    <Modal :open="drillOpen" :title="drillTitle" size="xl" @close="drillOpen = false">
      <template v-if="drillRow">
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div class="rounded-control border border-line bg-canvas/60 px-3 py-2">
            <div class="kpi-label">{{ t('usage.drill.total') }}</div>
            <div class="mt-0.5 truncate text-lg font-semibold tabular-nums text-ink" :title="String(drillRow.total)">
              {{ fmt(drillRow.total) }}
            </div>
          </div>
          <div class="rounded-control border border-line bg-canvas/60 px-3 py-2">
            <div class="kpi-label">{{ t('usage.drill.avg') }}</div>
            <div class="mt-0.5 truncate text-lg font-semibold tabular-nums text-ink" :title="String(Math.round(drillRow.avgDaily))">
              {{ fmt(drillRow.avgDaily) }}
            </div>
          </div>
          <div class="rounded-control border border-line bg-canvas/60 px-3 py-2">
            <div class="kpi-label">{{ t('usage.drill.peak') }}</div>
            <div class="mt-0.5 truncate text-lg font-semibold tabular-nums text-ink">
              {{ drillRow.peakValue > 0 ? formatShortDate(drillRow.peakDate) : '—' }}
            </div>
          </div>
          <div class="rounded-control border border-line bg-canvas/60 px-3 py-2">
            <div class="kpi-label">{{ t('usage.drill.activeDays') }}</div>
            <div class="mt-0.5 truncate text-lg font-semibold tabular-nums text-ink">
              {{ drillRow.activeDays }} / {{ dateRange.length }}
            </div>
          </div>
        </div>

        <div v-if="drillRow.total > 0" class="mt-4 h-[260px]">
          <AccountTrendChart :daily="drillRow.daily" />
        </div>
        <p v-else class="mt-8 text-center text-sm text-ink-mute">{{ t('usage.drill.empty') }}</p>
      </template>

      <template #footer>
        <button class="btn-default" @click="drillOpen = false">{{ t('common.close') }}</button>
        <button class="btn-primary" :disabled="!drillRow || drillRow.total === 0" @click="exportDrill">
          <Icon name="download" :size="14" />
          {{ t('usage.drill.export') }}
        </button>
      </template>
    </Modal>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'
import Icon from '../components/ui/Icon.vue'
import Modal from '../components/ui/Modal.vue'
import { toast } from '../ui/feedback.js'
import StatsKpiRow from '../components/stats/StatsKpiRow.vue'
import UsageStackedChart from '../components/stats/UsageStackedChart.vue'
import AccountUsageTable from '../components/stats/AccountUsageTable.vue'
import AccountTrendChart from '../components/stats/AccountTrendChart.vue'
import UsageSkeleton from '../components/stats/UsageSkeleton.vue'
import { useUsageFormat } from '../components/stats/useUsageFormat.js'
import {
  addDays,
  aggregateDaily,
  buildDateRange,
  buildPrevDateRange,
  countActiveDays,
  dayTotal,
  deltaPercent,
  findPeakDay,
  formatDateKey,
  formatShortDate,
  isValidDateKey,
  parseDateKey,
  sumDaily
} from '../components/stats/usageData.js'
import { buildCsv, downloadCsv, sanitizeFilenamePart } from '../components/stats/usageCsv.js'

const { t, fmt } = useUsageFormat()

const loading = ref(true)
const error = ref('')
const accounts = ref([])
// 服务端日期是全部区间的锚点：浏览器时区与容器不一致时，new Date() 会算错月份边界。
const serverToday = ref(new Date().toISOString().slice(0, 10))
const period = ref('currentMonth')
const drillOpen = ref(false)
const drillRow = ref(null)

const periodOptions = computed(() => [
  { value: 'currentMonth', label: t('usage.period.currentMonth') },
  { value: 'prevMonth', label: t('usage.period.prevMonth') },
  { value: 'last90', label: t('usage.period.last90') }
])

// ---------- 区间 ----------
const dateRange = computed(() => buildDateRange(period.value, serverToday.value))
const prevDateRange = computed(() => buildPrevDateRange(period.value, serverToday.value))

const rangeLabel = computed(() => {
  const dates = dateRange.value
  if (!dates.length) return ''
  return t('usage.range', {
    from: dates[0],
    to: dates[dates.length - 1],
    days: dates.length
  })
})

// ---------- 按天聚合 ----------
const aggregateDailyRows = computed(() => aggregateDaily(accounts.value, dateRange.value))
const prevAggregateDailyRows = computed(() => aggregateDaily(accounts.value, prevDateRange.value))

const currentTotals = computed(() => sumDaily(aggregateDailyRows.value))
const prevTotals = computed(() => sumDaily(prevAggregateDailyRows.value))

const todayTotals = computed(() => sumDaily(aggregateDaily(accounts.value, [serverToday.value])))
const yesterdayTotals = computed(() => {
  const yesterday = formatDateKey(addDays(parseDateKey(serverToday.value), -1))
  return sumDaily(aggregateDaily(accounts.value, [yesterday]))
})

const activeDays = computed(() => countActiveDays(aggregateDailyRows.value))
const prevActiveDays = computed(() => countActiveDays(prevAggregateDailyRows.value))
const avgDaily = computed(() => (activeDays.value > 0 ? currentTotals.value.total / activeDays.value : 0))
const prevAvgDaily = computed(() => (prevActiveDays.value > 0 ? prevTotals.value.total / prevActiveDays.value : 0))

const hasData = computed(() => currentTotals.value.total > 0)

const peakInfo = computed(() => findPeakDay(aggregateDailyRows.value))
// 均值参考线与图表插件、KPI 日均保持一致：按有数据的天数平均。
const meanDailyTotal = computed(() => (
  activeDays.value > 0 ? currentTotals.value.total / activeDays.value : 0
))

// ---------- 按账号 ----------
const accountSeries = computed(() => {
  const dates = dateRange.value
  const prevDates = prevDateRange.value
  return accounts.value.map((account) => {
    const history = account.history || {}
    const daily = dates.map((date) => {
      const entry = history[date] || {}
      const chat = entry.chat || {}
      const cli = entry.cli || {}
      return {
        date,
        chatInput: Number(chat.input) || 0,
        chatOutput: Number(chat.output) || 0,
        cliInput: Number(cli.input) || 0,
        cliOutput: Number(cli.output) || 0,
        cliCalls: Number(cli.calls) || 0
      }
    })
    return {
      email: account.email,
      daily,
      totals: sumDaily(daily),
      activeDays: countActiveDays(daily),
      peak: findPeakDay(daily),
      prevTotal: sumDaily(aggregateDaily([account], prevDates)).total
    }
  })
})

const accountRows = computed(() => {
  const series = accountSeries.value
  const grandTotal = series.reduce((sum, item) => sum + item.totals.total, 0)
  return series.map((item) => ({
    email: item.email,
    daily: item.daily,
    input: item.totals.chatInput + item.totals.cliInput,
    output: item.totals.chatOutput + item.totals.cliOutput,
    total: item.totals.total,
    sharePct: grandTotal > 0 ? (item.totals.total / grandTotal) * 100 : 0,
    activeDays: item.activeDays,
    avgDaily: item.activeDays > 0 ? item.totals.total / item.activeDays : 0,
    peakDate: item.peak.date,
    peakValue: item.peak.value,
    changePct: deltaPercent(item.totals.total, item.prevTotal)
  }))
})

const activeAccounts = computed(() => accountRows.value.filter((row) => row.total > 0).length)
const prevActiveAccounts = computed(() => accountSeries.value.filter((item) => item.prevTotal > 0).length)

// ---------- KPI ----------
const kpis = computed(() => {
  const current = currentTotals.value
  const previous = prevTotals.value
  const today = todayTotals.value
  const yesterday = yesterdayTotals.value

  return [
    {
      key: 'total',
      label: t('usage.kpi.total'),
      value: fmt(current.total),
      raw: current.total,
      sub: t('usage.kpi.inOut', {
        input: fmt(current.chatInput + current.cliInput),
        output: fmt(current.chatOutput + current.cliOutput)
      }),
      delta: deltaPercent(current.total, previous.total),
      compare: 'prev'
    },
    {
      key: 'today',
      label: t('usage.kpi.today'),
      value: fmt(today.total),
      raw: today.total,
      sub: t('usage.kpi.inOut', {
        input: fmt(today.chatInput + today.cliInput),
        output: fmt(today.chatOutput + today.cliOutput)
      }),
      delta: deltaPercent(today.total, yesterday.total),
      compare: 'yesterday'
    },
    {
      key: 'cliCalls',
      label: t('usage.kpi.cliCalls'),
      value: fmt(current.cliCalls),
      raw: current.cliCalls,
      sub: t('usage.kpi.inOut', { input: fmt(current.cliInput), output: fmt(current.cliOutput) }),
      delta: deltaPercent(current.cliCalls, previous.cliCalls),
      compare: 'prev'
    },
    {
      key: 'activeAccounts',
      label: t('usage.kpi.activeAccounts'),
      value: String(activeAccounts.value),
      raw: activeAccounts.value,
      sub: t('usage.kpi.ofAccounts', { n: accounts.value.length }),
      delta: deltaPercent(activeAccounts.value, prevActiveAccounts.value),
      compare: 'prev'
    },
    {
      key: 'trackedDays',
      label: t('usage.kpi.trackedDays'),
      value: String(activeDays.value),
      raw: activeDays.value,
      sub: t('usage.kpi.rangeDays', { n: dateRange.value.length }),
      delta: deltaPercent(activeDays.value, prevActiveDays.value),
      compare: 'prev'
    },
    {
      key: 'avgDaily',
      label: t('usage.kpi.avgDaily'),
      value: fmt(avgDaily.value),
      raw: Math.round(avgDaily.value),
      sub: t('usage.kpi.perActiveDay', { n: activeDays.value }),
      delta: deltaPercent(avgDaily.value, prevAvgDaily.value),
      compare: 'prev'
    }
  ]
})

// ---------- 下钻 ----------
const openDrill = (row) => {
  drillRow.value = row
  drillOpen.value = true
}

const drillTitle = computed(() => (
  drillRow.value ? t('usage.drill.title', { email: drillRow.value.email }) : ''
))

// ---------- CSV 导出 ----------
const periodFileSuffix = computed(() => {
  const dates = dateRange.value
  if (!dates.length) return 'usage'
  return `${dates[0]}_${dates[dates.length - 1]}`
})

const dailyCsvRows = (daily) => daily.map((day) => [
  day.date,
  day.chatInput,
  day.chatOutput,
  day.cliCalls,
  day.cliInput,
  day.cliOutput,
  dayTotal(day)
])

const csvHeader = () => [
  t('usage.csv.date'),
  t('usage.csv.chatInput'),
  t('usage.csv.chatOutput'),
  t('usage.csv.cliCalls'),
  t('usage.csv.cliInput'),
  t('usage.csv.cliOutput'),
  t('usage.csv.total')
]

const exportDaily = () => {
  if (!hasData.value) {
    toast.warn(t('usage.status.exportEmpty'))
    return
  }
  const totals = currentTotals.value
  const rows = dailyCsvRows(aggregateDailyRows.value)
  rows.push([t('usage.csv.total'), totals.chatInput, totals.chatOutput, totals.cliCalls, totals.cliInput, totals.cliOutput, totals.total])
  const filename = `usage-daily-${periodFileSuffix.value}.csv`
  downloadCsv(filename, buildCsv([csvHeader(), ...rows]))
  toast.success(t('usage.status.exported', { file: filename }))
}

const exportAccounts = () => {
  const rows = accountRows.value
    .filter((row) => row.total > 0)
    .sort((left, right) => right.total - left.total)
  if (!rows.length) {
    toast.warn(t('usage.status.exportEmpty'))
    return
  }
  const header = [
    t('usage.csv.account'),
    t('usage.csv.input'),
    t('usage.csv.output'),
    t('usage.csv.total'),
    t('usage.csv.share'),
    t('usage.csv.avgDaily'),
    t('usage.csv.peakDay'),
    t('usage.csv.peak'),
    t('usage.csv.change')
  ]
  const body = rows.map((row) => [
    row.email,
    row.input,
    row.output,
    row.total,
    `${row.sharePct.toFixed(2)}%`,
    Math.round(row.avgDaily),
    row.peakDate,
    row.peakValue,
    row.changePct === null ? '' : `${row.changePct}%`
  ])
  const filename = `usage-accounts-${periodFileSuffix.value}.csv`
  downloadCsv(filename, buildCsv([header, ...body]))
  toast.success(t('usage.status.exported', { file: filename }))
}

const exportDrill = () => {
  const row = drillRow.value
  if (!row || row.total === 0) return
  const totals = sumDaily(row.daily)
  const body = dailyCsvRows(row.daily)
  body.push([t('usage.csv.total'), totals.chatInput, totals.chatOutput, totals.cliCalls, totals.cliInput, totals.cliOutput, totals.total])
  const filename = `usage-${sanitizeFilenamePart(row.email)}-${periodFileSuffix.value}.csv`
  downloadCsv(filename, buildCsv([csvHeader(), ...body]))
  toast.success(t('usage.status.exported', { file: filename }))
}

// ---------- 加载 ----------
const load = async () => {
  loading.value = true
  error.value = ''
  try {
    const response = await axios.get('/api/statsHistory', {
      headers: { Authorization: localStorage.getItem('apiKey') || '' }
    })
    const data = response.data || {}
    if (isValidDateKey(data.today)) serverToday.value = data.today
    const list = Array.isArray(data.accounts) ? data.accounts : []
    accounts.value = list
      .filter((account) => account && typeof account.email === 'string' && account.email)
      .map((account) => ({
        email: account.email,
        history: account.history && typeof account.history === 'object' ? account.history : {}
      }))
  } catch (err) {
    console.error('Failed to load statsHistory', err)
    error.value = t('usage.status.loadFailed')
    const detail = err?.message ? `（${err.message}）` : ''
    toast.error(`${t('usage.status.loadFailed')}${detail}`)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>
