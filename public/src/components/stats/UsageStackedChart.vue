<template>
  <Bar :data="chartData" :options="chartOptions" :plugins="[referenceLinesPlugin]" />
</template>

<script setup>
import { computed } from 'vue'
import { Bar } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend
} from 'chart.js'
import { formatCompact } from '../../utils/format.js'
import { formatShortDate } from './usageData.js'
import { useUsageFormat } from './useUsageFormat.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

// 四段颜色全部取自设计 token：brand-600/200（chat）、ok-600/100（cli）。
const COLORS = {
  chatInput: '#2563eb',
  chatOutput: '#bfd3fe',
  cliInput: '#039855',
  cliOutput: '#d1fadf'
}

const props = defineProps({
  // [{ date, chatInput, chatOutput, cliInput, cliOutput, cliCalls }]
  daily: { type: Array, required: true }
})

const { t, units } = useUsageFormat()

// 均值 / 峰值参考线：直接读 chart.data 现算，避免 options 更新时机导致的残留。
const referenceLinesPlugin = {
  id: 'usageReferenceLines',
  afterDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart
    if (!chartArea || !scales?.y) return
    const labels = chart.data.labels || []
    const datasets = chart.data.datasets || []
    if (!labels.length || !datasets.length) return

    const totals = labels.map((_, index) => datasets.reduce(
      (sum, dataset) => sum + (Number(dataset.data[index]) || 0),
      0
    ))
    const peak = Math.max(...totals)
    if (!Number.isFinite(peak) || peak <= 0) return
    // 均值按「有数据的天」计算，与 KPI 的日均 Token 口径保持一致（跳过空白天）。
    const activeTotals = totals.filter((value) => value > 0)
    const mean = activeTotals.reduce((sum, value) => sum + value, 0) / activeTotals.length

    const options = chart.options.plugins?.usageReferenceLines || {}
    const fmt = (value) => formatCompact(value, {
      unitK: options.unitK || 'K',
      unitM: options.unitM || 'M'
    })

    const drawReference = (value, color, dash, text, place) => {
      const y = scales.y.getPixelForValue(value)
      if (!Number.isFinite(y)) return
      ctx.save()
      ctx.beginPath()
      ctx.setLineDash(dash)
      ctx.lineWidth = 1
      ctx.strokeStyle = color
      ctx.moveTo(chartArea.left, Math.round(y) + 0.5)
      ctx.lineTo(chartArea.right, Math.round(y) + 0.5)
      ctx.stroke()
      ctx.setLineDash([])

      ctx.font = '11px Inter, -apple-system, "Segoe UI", sans-serif'
      const padding = 5
      const boxWidth = ctx.measureText(text).width + padding * 2
      const boxHeight = 17
      const x = chartArea.right - boxWidth - 2
      const top = place === 'above' ? y - boxHeight - 3 : y + 3
      const clampedTop = Math.min(Math.max(top, chartArea.top + 1), chartArea.bottom - boxHeight - 1)

      ctx.fillStyle = 'rgba(255, 255, 255, 0.94)'
      ctx.fillRect(x, clampedTop, boxWidth, boxHeight)
      ctx.strokeStyle = '#e6e8ec'
      ctx.lineWidth = 1
      ctx.strokeRect(x + 0.5, clampedTop + 0.5, boxWidth - 1, boxHeight - 1)

      ctx.fillStyle = '#4b5563'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, x + padding, clampedTop + boxHeight / 2 + 0.5)
      ctx.restore()
    }

    drawReference(peak, '#2563eb', [4, 4], `${options.peakLabel || 'peak'} ${fmt(peak)}`, 'above')
    drawReference(mean, '#9ca3af', [3, 3], `${options.meanLabel || 'mean'} ${fmt(mean)}`, 'below')
  }
}

const chartData = computed(() => ({
  labels: props.daily.map((day) => day.date),
  datasets: [
    {
      label: t('usage.chart.chatInput'),
      data: props.daily.map((day) => day.chatInput),
      backgroundColor: COLORS.chatInput,
      borderColor: COLORS.chatInput,
      borderWidth: 1,
      stack: 'usage'
    },
    {
      label: t('usage.chart.chatOutput'),
      data: props.daily.map((day) => day.chatOutput),
      backgroundColor: COLORS.chatOutput,
      // 输出通常只占输入的 1% 左右，浅色填充几乎不可见；加同色系深描边让细段可辨认。
      borderColor: COLORS.chatInput,
      borderWidth: 1,
      stack: 'usage'
    },
    {
      label: t('usage.chart.cliInput'),
      data: props.daily.map((day) => day.cliInput),
      backgroundColor: COLORS.cliInput,
      borderColor: COLORS.cliInput,
      borderWidth: 1,
      stack: 'usage'
    },
    {
      label: t('usage.chart.cliOutput'),
      data: props.daily.map((day) => day.cliOutput),
      backgroundColor: COLORS.cliOutput,
      borderColor: COLORS.cliInput,
      borderWidth: 1,
      stack: 'usage'
    }
  ]
}))

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 240 },
  interaction: { mode: 'index', intersect: false },
  layout: { padding: { top: 6, right: 2 } },
  plugins: {
    legend: {
      position: 'top',
      align: 'end',
      labels: {
        boxWidth: 10,
        boxHeight: 10,
        usePointStyle: true,
        pointStyle: 'rectRounded',
        padding: 14,
        color: '#4b5563',
        font: { size: 11 }
      }
    },
    tooltip: {
      backgroundColor: '#111827',
      padding: 10,
      cornerRadius: 8,
      titleFont: { size: 12, weight: '600' },
      bodyFont: { size: 12 },
      footerFont: { size: 12, weight: '600' },
      callbacks: {
        title: (items) => (items.length ? items[0].label : ''),
        label: (item) => ` ${item.dataset.label}: ${formatCompact(item.parsed.y, units.value)}`,
        footer: (items) => {
          if (!items.length) return ''
          const total = items.reduce((sum, item) => sum + (Number(item.parsed.y) || 0), 0)
          return `${t('usage.chart.total')}: ${formatCompact(total, units.value)}`
        }
      }
    },
    usageReferenceLines: {
      peakLabel: t('usage.chart.peak'),
      meanLabel: t('usage.chart.mean'),
      unitK: units.value.unitK,
      unitM: units.value.unitM
    }
  },
  scales: {
    x: {
      stacked: true,
      grid: { display: false },
      border: { color: '#e6e8ec' },
      ticks: {
        color: '#9ca3af',
        font: { size: 11 },
        maxRotation: 0,
        autoSkip: true,
        maxTicksLimit: 12,
        callback(value) {
          return formatShortDate(this.getLabelForValue(value))
        }
      }
    },
    y: {
      stacked: true,
      beginAtZero: true,
      grid: { color: '#e6e8ec' },
      border: { display: false },
      ticks: {
        color: '#9ca3af',
        font: { size: 11 },
        maxTicksLimit: 6,
        callback: (value) => formatCompact(value, units.value)
      }
    }
  }
}))
</script>
