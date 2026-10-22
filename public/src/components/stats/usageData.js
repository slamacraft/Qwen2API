// 用量统计页的数据工具：日期区间、按天聚合、环比与格式化。
// 所有区间都以接口返回的 today（YYYY-MM-DD）为锚点计算，不使用浏览器当前时间，
// 避免浏览器与容器时区不一致时月份边界漂移。

export const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/

export function isValidDateKey(value) {
  return typeof value === 'string' && DATE_KEY_REGEX.test(value)
}

// 把 YYYY-MM-DD 解析为本地日期（不经过 UTC，避免跨时区偏移一天）。
export function parseDateKey(key) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function formatDateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function addDays(date, delta) {
  const next = new Date(date)
  next.setDate(next.getDate() + delta)
  return next
}

export function daysInMonth(year, monthIndex0) {
  return new Date(year, monthIndex0 + 1, 0).getDate()
}

// 整月日期列表（monthIndex0 允许为负数或 >=12，Date 会自动进位）。
export function monthDateRange(year, monthIndex0) {
  const total = daysInMonth(year, monthIndex0)
  const dates = []
  for (let day = 1; day <= total; day++) {
    dates.push(formatDateKey(new Date(year, monthIndex0, day)))
  }
  return dates
}

// 当前周期：当月（1 号到今天，避免未来日期在图上留下空柱与断崖）/
// 上月（整月）/ 最近 90 天（含今天）。
export function buildDateRange(period, todayKey) {
  const today = parseDateKey(todayKey)
  if (period === 'last90') {
    const dates = []
    for (let offset = 89; offset >= 0; offset--) {
      dates.push(formatDateKey(addDays(today, -offset)))
    }
    return dates
  }
  if (period === 'prevMonth') {
    return monthDateRange(today.getFullYear(), today.getMonth() - 1)
  }
  const dates = []
  for (let day = 1; day <= today.getDate(); day++) {
    dates.push(formatDateKey(new Date(today.getFullYear(), today.getMonth(), day)))
  }
  return dates
}

// 对比周期：当月→上个月（整月，数据保留 90 天所以完整可见），
// 上月→上上个月（整月），最近 90 天→紧邻的前一个 90 天窗口。
export function buildPrevDateRange(period, todayKey) {
  const today = parseDateKey(todayKey)
  if (period === 'last90') {
    const end = addDays(today, -90)
    const dates = []
    for (let offset = 89; offset >= 0; offset--) {
      dates.push(formatDateKey(addDays(end, -offset)))
    }
    return dates
  }
  if (period === 'prevMonth') {
    return monthDateRange(today.getFullYear(), today.getMonth() - 2)
  }
  return monthDateRange(today.getFullYear(), today.getMonth() - 1)
}

export function createTotals() {
  return { chatInput: 0, chatOutput: 0, cliInput: 0, cliOutput: 0, cliCalls: 0, total: 0 }
}

export function dayTotal(day) {
  return (day.chatInput || 0) + (day.chatOutput || 0) + (day.cliInput || 0) + (day.cliOutput || 0)
}

// 按天汇总多个账号的历史；缺失日期补 0，保证图表 x 轴连续。
export function aggregateDaily(accounts, dates) {
  return dates.map((date) => {
    const day = { date, chatInput: 0, chatOutput: 0, cliInput: 0, cliOutput: 0, cliCalls: 0 }
    for (const account of accounts || []) {
      const entry = account?.history?.[date]
      if (!entry) continue
      const chat = entry.chat || {}
      const cli = entry.cli || {}
      day.chatInput += Number(chat.input) || 0
      day.chatOutput += Number(chat.output) || 0
      day.cliInput += Number(cli.input) || 0
      day.cliOutput += Number(cli.output) || 0
      day.cliCalls += Number(cli.calls) || 0
    }
    return day
  })
}

export function sumDaily(daily) {
  const totals = createTotals()
  for (const day of daily || []) {
    totals.chatInput += day.chatInput || 0
    totals.chatOutput += day.chatOutput || 0
    totals.cliInput += day.cliInput || 0
    totals.cliOutput += day.cliOutput || 0
    totals.cliCalls += day.cliCalls || 0
  }
  totals.total = totals.chatInput + totals.chatOutput + totals.cliInput + totals.cliOutput
  return totals
}

export function countActiveDays(daily) {
  return (daily || []).filter((day) => dayTotal(day) > 0).length
}

// 峰值日：单日总 Token 最大的一天；全为 0 时返回空日期。
export function findPeakDay(daily) {
  let peak = { date: '', value: 0 }
  for (const day of daily || []) {
    const total = dayTotal(day)
    if (total > peak.value) peak = { date: day.date, value: total }
  }
  return peak
}

// 环比百分比。上一周期为 0 时无法计算，返回 null（页面显示「—」而不是 Infinity）。
export function deltaPercent(current, previous) {
  const cur = Number(current) || 0
  const prev = Number(previous) || 0
  if (prev === 0) return cur === 0 ? 0 : null
  return Math.round(((cur - prev) / prev) * 1000) / 10
}

export function formatPercent(value, digits = 1) {
  if (value === null || value === undefined || value === '') return '—'
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  const abs = Math.abs(num)
  const rounded = abs >= 100 ? Math.round(abs) : Number(abs.toFixed(digits))
  return `${rounded}%`
}

// YYYY-MM-DD → MM-DD，用于坐标轴与紧凑列。
export function formatShortDate(key) {
  return typeof key === 'string' && key.length >= 10 ? key.slice(5) : key || ''
}
