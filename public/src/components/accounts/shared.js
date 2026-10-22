// 账号池共用的小工具：鉴权头、代理校验、状态/CLI 展示规则、时间与数字格式化。
// 只被 views/dashboard.vue 与 components/accounts/** 使用。
import { ref } from 'vue'

// 后端 adminKeyVerify 从 Authorization 头取管理密钥（与旧 dashboard.vue 一致）
export const getAuthHeaders = () => ({
  Authorization: localStorage.getItem('apiKey') || ''
})

// 与后端 src/utils/proxy-helper.js#PROXY_URL_REGEX 保持一致
export const PROXY_URL_REGEX = /^(https?|socks5h?):\/\/[^\s]+$/i

export const isValidProxy = (value) => {
  if (!value) return true
  const trimmed = String(value).trim()
  if (!trimmed) return true
  return PROXY_URL_REGEX.test(trimmed)
}

// 一键刷新只处理临期令牌；阈值同时用于请求和提示文案，避免两处不一致
export const REFRESH_THRESHOLD_HOURS = 24

export const DEFAULT_STATS = Object.freeze({
  chat: { input: 0, output: 0 },
  cli: { calls: 0, input: 0, output: 0 }
})

// 账号健康状态 → 文案 key / 徽章样式 / 图标。
// 注意：CLI 可用性是另一个维度（status.cli），不参与这里的健康判定，避免互相遮挡。
// disabled 不是健康状态，而是「管理员手动移出轮换」，由列表的 disabled 字段决定，优先级最高。
export const STATUS_META = Object.freeze({
  active: { label: 'accounts.statusActive', badge: 'badge-ok', icon: 'shield' },
  warn: { label: 'accounts.statusWarn', badge: 'badge-warn', icon: 'alert' },
  cooldown: { label: 'accounts.statusCooldown', badge: 'badge-danger', icon: 'clock' },
  token_expiring: { label: 'accounts.statusExpiring', badge: 'badge-warn', icon: 'key' },
  disabled: { label: 'accounts.statusDisabled', badge: 'badge-mute', icon: 'stop' }
})

// 账号可用性（「现在能不能真的发请求」）→ 文案 key / 徽章样式 / 图标。
// 与 STATUS_META 是两个维度：健康状态看请求结果，可用性看有没有自己的浏览器会话。
// 优先级：已禁用 > 缺会话 > 可用（禁用账号有没有指纹都无所谓）。
export const USABILITY_META = Object.freeze({
  usable: { label: 'accounts.usableYes', badge: 'badge-ok', icon: 'shield' },
  no_fingerprint: { label: 'accounts.usableNoSession', badge: 'badge-warn', icon: 'key' },
  disabled: { label: 'accounts.usableDisabled', badge: 'badge-mute', icon: 'stop' }
})

// CLI 不可用时的短标签：这类账号的「0 / 配额」没有意义，改为显示状态词
export const CLI_INACTIVE_LABELS = Object.freeze({
  unsupported: 'accounts.cliUnsupported',
  disabled: 'accounts.cliDisabled'
})

// 毫秒 → mm:ss 倒计时
export const formatCountdown = (ms) => {
  const sec = Math.max(0, Math.floor(ms / 1000))
  const mm = String(Math.floor(sec / 60)).padStart(2, '0')
  const ss = String(sec % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

// 毫秒 → 「N 秒 / N 分」相对时间（用于「最近有错误」提示）
export const formatAgo = (ms, t) => {
  const sec = Math.max(0, Math.floor(ms / 1000))
  if (sec < 60) return `${sec} ${t('accounts.unitSec')}`
  return `${Math.floor(sec / 60)} ${t('accounts.unitMin')}`
}

// 秒级时间戳 → 本地时间字符串
export const formatExpires = (seconds) => {
  if (!seconds) return '—'
  return new Date(seconds * 1000).toLocaleString()
}

// ISO 时间字符串 → 本地时间（无效值返回空串，避免 tooltip 里出现 Invalid Date）
export const formatIsoTime = (iso) => {
  if (!iso) return ''
  const time = new Date(iso)
  return Number.isNaN(time.getTime()) ? '' : time.toLocaleString()
}

// 账号健康状态的 tooltip：冷却给倒计时，异常给错误码与多久以前，临期提示令牌
export const buildStatusTooltip = (status, now, t) => {
  const kind = status?.kind || 'active'
  if (kind === 'cooldown' && typeof status?.cooldownEndsAt === 'number') {
    return t('accounts.statusTooltipCooldown', { until: formatCountdown(status.cooldownEndsAt - now) })
  }
  if (kind === 'warn') {
    const ago = typeof status?.lastErrorAt === 'number' ? formatAgo(now - status.lastErrorAt, t) : ''
    const code = status?.lastErrorCode
    if (code !== null && code !== undefined && code !== '') {
      return t('accounts.statusTooltipWarn', { code, ago })
    }
    return t('accounts.statusTooltipWarnNoCode', { ago })
  }
  if (kind === 'token_expiring') return t('accounts.statusTooltipExpiring')
  return t('accounts.statusTooltipActive')
}

// CLI 行的 tooltip —— 与账号健康状态互相独立，避免两个维度互相遮挡
export const buildCliTooltip = (cliState, t) => {
  if (cliState === 'unsupported') return t('accounts.cliTooltipUnsupported')
  if (cliState === 'disabled') return t('accounts.cliTooltipDisabled')
  if (cliState === 'pending') return t('accounts.cliTooltipPending')
  return ''
}

// 账号对象 → 可用性 key。以后端 unavailableCode 为准；字段缺失时按 usable / hasFingerprint 兜底，
// 保证后端还没下发新字段时也不会把不可用账号显示成「可用」。
export const usabilityKind = (row) => {
  if (!row) return 'usable'
  if (row.disabled === true || row.unavailableCode === 'disabled') return 'disabled'
  if (row.unavailableCode === 'no_fingerprint') return 'no_fingerprint'
  if (row.usable === false) return 'no_fingerprint'
  if (row.usable === true) return 'usable'
  return row.hasFingerprint === false ? 'no_fingerprint' : 'usable'
}

// 缺浏览器会话且未禁用 → 可以就地生成（行内按钮与「一键补全」共用同一判定）
export const needsFingerprint = (row) => usabilityKind(row) === 'no_fingerprint'

// 可用性 tooltip：说明服务器会用账号邮箱密码自己登录采集，无需本机 Chrome。
// 旧部署可能只有全局兜底会话（viaGlobalFingerprint），这时指纹时间是空的，单独给一句说明。
export const buildUsabilityTooltip = (kind, row, t) => {
  if (kind === 'disabled') return t('accounts.usableTooltipDisabled')
  if (kind === 'no_fingerprint') return t('accounts.usableTooltipNoSession')
  if (row?.viaGlobalFingerprint === true) return t('accounts.usableTooltipGlobal')
  const at = formatIsoTime(row?.fingerprintAt)
  return at ? t('accounts.usableTooltipOk', { at }) : t('accounts.usableTooltipOkNoTime')
}

// 单条账号的今日用量（chat + cli 的入/出 token 之和），用于「今日用量」排序
export const usageTotal = (stats) => {
  const s = stats || DEFAULT_STATS
  return (Number(s.chat?.input) || 0) + (Number(s.chat?.output) || 0) +
    (Number(s.cli?.input) || 0) + (Number(s.cli?.output) || 0)
}

// CLI 详情折叠状态：沿用旧页面的 localStorage 键，升级后保留用户的选择。
// 放在模块作用域，所有卡片共享同一状态（旧页面同样是全局共享）。
const CLI_EXPANDED_KEY = 'cliExpanded'
export const cliExpanded = ref(localStorage.getItem(CLI_EXPANDED_KEY) === '1')

export const toggleCliExpanded = () => {
  cliExpanded.value = !cliExpanded.value
  localStorage.setItem(CLI_EXPANDED_KEY, cliExpanded.value ? '1' : '0')
}
