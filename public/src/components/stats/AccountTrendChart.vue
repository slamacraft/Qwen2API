<template>
  <Line :data="chartData" :options="chartOptions" />
</template>

<script setup>
import { computed } from 'vue'
import { Line } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend
} from 'chart.js'
import { formatCompact } from '../../utils/format.js'
import { formatShortDate } from './usageData.js'
import { useUsageFormat } from './useUsageFormat.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend)

// 与堆叠柱状图共用同一套语义色：chat=brand，cli=ok。
// 输出量通常远小于输入，用同色虚线区分，避免浅色细线在白色背景上看不见。
const COLORS = {
  chatInput: '#2563eb',
  chatOutput: '#2563eb',
  cliInput: '#039855',
  cliOutput: '#039855'
}

const props = defineProps({
  // [{ date, chatInput, chatOutput, cliInput, cliOutput, cliCalls }]
  daily: { type: Array, required: true }
})

const { t, units } = useUsageFormat()

const series = [
  { key: 'chatInput', labelKey: 'usage.chart.chatInput', color: COLORS.chatInput, dash: [] },
  { key: 'chatOutput', labelKey: 'usage.chart.chatOutput', color: COLORS.chatOutput, dash: [5, 3] },
  { key: 'cliInput', labelKey: 'usage.chart.cliInput', color: COLORS.cliInput, dash: [] },
  { key: 'cliOutput', labelKey: 'usage.chart.cliOutput', color: COLORS.cliOutput, dash: [5, 3] }
]

const chartData = computed(() => ({
  labels: props.daily.map((day) => day.date),
  datasets: series.map((item) => ({
    label: t(item.labelKey),
    data: props.daily.map((day) => day[item.key]),
    borderColor: item.color,
    backgroundColor: item.color,
    borderWidth: 2,
    borderDash: item.dash,
    pointRadius: 2,
    pointHoverRadius: 4,
    tension: 0.25,
    fill: false
  }))
}))

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 220 },
  interaction: { mode: 'index', intersect: false },
  layout: { padding: { top: 6 } },
  plugins: {
    legend: {
      position: 'top',
      align: 'end',
      labels: {
        boxWidth: 18,
        boxHeight: 2,
        usePointStyle: true,
        pointStyle: 'line',
        padding: 14,
        color: '#4b5563',
        font: { size: 11 },
        // 自定义图例：输出序列是虚线，图例里也要画出虚线才能区分输入/输出。
        generateLabels(chart) {
          return chart.data.datasets.map((dataset, index) => ({
            text: dataset.label,
            fillStyle: dataset.borderColor,
            strokeStyle: dataset.borderColor,
            lineWidth: 2,
            lineDash: dataset.borderDash || [],
            pointStyle: 'line',
            hidden: !chart.isDatasetVisible(index),
            datasetIndex: index
          }))
        }
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
    }
  },
  scales: {
    x: {
      grid: { display: false },
      border: { color: '#e6e8ec' },
      ticks: {
        color: '#9ca3af',
        font: { size: 11 },
        maxRotation: 0,
        autoSkip: true,
        maxTicksLimit: 10,
        callback(value) {
          return formatShortDate(this.getLabelForValue(value))
        }
      }
    },
    y: {
      beginAtZero: true,
      grid: { color: '#e6e8ec' },
      border: { display: false },
      ticks: {
        color: '#9ca3af',
        font: { size: 11 },
        maxTicksLimit: 5,
        callback: (value) => formatCompact(value, units.value)
      }
    }
  }
}))
</script>
