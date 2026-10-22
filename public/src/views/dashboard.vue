<template>
  <div class="page">
    <!-- 页头：说明 + 主操作（顶栏标题与语言切换由 AdminLayout 提供，这里不再重复标题） -->
    <div class="page-head">
      <div>
        <p class="page-sub">{{ t('accounts.subtitle', { n: totalAccounts }) }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" class="btn-default" @click="exportAccounts">
          <Icon name="download" :size="16" />
          {{ t('accounts.export') }}
        </button>
        <button type="button" class="btn-default" :disabled="isRefreshingAll" @click="refreshAllAccounts">
          <Icon name="refresh" :size="16" :class="isRefreshingAll ? 'animate-spin' : ''" />
          {{ isRefreshingAll ? t('accounts.refreshing') : t('accounts.refreshAll') }}
        </button>
        <button type="button" class="btn-default" :disabled="isForceRefreshingAll" @click="forceRefreshAllAccounts">
          <Icon name="refresh" :size="16" :class="isForceRefreshingAll ? 'animate-spin' : ''" />
          {{ isForceRefreshingAll ? t('accounts.forceRefreshing') : t('accounts.forceRefresh') }}
        </button>
        <!-- 一键补全会话：只在存在「缺会话且未禁用」的账号时出现 -->
        <button
          v-if="fingerprintQueue.length"
          type="button"
          class="btn-default"
          :disabled="isProvisioningAll"
          @click="provisionAllFingerprints"
        >
          <Icon name="refresh" :size="16" :class="isProvisioningAll ? 'animate-spin' : ''" />
          {{ isProvisioningAll
            ? t('accounts.provisioningAll', { done: provisionProgress.done, total: provisionProgress.total })
            : t('accounts.provisionAll', { n: fingerprintQueue.length }) }}
        </button>
        <button type="button" class="btn-primary" @click="showAddModal = true">
          <Icon name="plus" :size="16" />
          {{ t('accounts.addAccount') }}
        </button>
      </div>
    </div>

    <AccountToolbar
      v-model:search="search"
      v-model:status="statusFilter"
      v-model:sort="sortKey"
      v-model:view="view"
      :matching="filteredAccounts.length"
      :selected-count="selectedEmails.length"
      :all-selected="allFilteredSelected"
      @select-all="toggleAllFiltered"
      @clear-selection="clearSelection"
      @delete-selected="deleteSelected"
      @delete-all="deleteAllAccounts"
    />

    <!-- 加载骨架 -->
    <div v-if="isLoading && accounts.length === 0" class="space-y-3">
      <div v-if="view === 'table'" class="card p-4">
        <div class="space-y-3">
          <div v-for="i in 6" :key="i" class="flex items-center gap-4">
            <div class="skeleton h-4 w-4 rounded"></div>
            <div class="skeleton h-4 w-40"></div>
            <div class="skeleton h-4 w-24"></div>
            <div class="skeleton h-4 flex-1"></div>
            <div class="skeleton h-4 w-20"></div>
          </div>
        </div>
      </div>
      <div v-else class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div v-for="i in 3" :key="i" class="card space-y-3 p-4">
          <div class="skeleton h-4 w-2/3"></div>
          <div class="skeleton h-3 w-1/3"></div>
          <div class="skeleton h-3 w-full"></div>
          <div class="skeleton h-3 w-5/6"></div>
          <div class="skeleton h-8 w-full"></div>
        </div>
      </div>
    </div>

    <!-- 空状态：区分「没有账号」与「筛选无结果」 -->
    <div v-else-if="!filteredAccounts.length" class="card">
      <div class="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <div class="flex h-12 w-12 items-center justify-center rounded-full bg-canvas text-ink-mute">
          <Icon name="users" :size="22" />
        </div>
        <div>
          <p class="text-sm font-medium text-ink">
            {{ hasFilters ? t('accounts.emptyFilteredTitle') : t('accounts.emptyTitle') }}
          </p>
          <p class="mt-1 text-xs text-ink-mute">
            {{ hasFilters ? t('accounts.emptyFilteredHint') : t('accounts.emptyHint') }}
          </p>
        </div>
        <button v-if="hasFilters" type="button" class="btn-default btn-sm" @click="resetFilters">
          {{ t('accounts.clearFilters') }}
        </button>
        <button v-else type="button" class="btn-primary btn-sm" @click="showAddModal = true">
          <Icon name="plus" :size="14" />
          {{ t('accounts.addAccount') }}
        </button>
      </div>
    </div>

    <template v-else>
      <AccountTable
        v-if="view === 'table'"
        :rows="pageRows"
        :selected="selectedEmails"
        :refreshing="refreshingTokens"
        :toggling="togglingDisabled"
        :provisioning="provisioningFingerprints"
        :page-all-selected="pageAllSelected"
        :page-some-selected="pageSomeSelected"
        @toggle-select="toggleSelect"
        @toggle-page="togglePageSelection"
        @edit-proxy="openEditProxy"
        @refresh="refreshToken"
        @delete="deleteToken"
        @detail="openDetail"
        @toggle-disabled="toggleAccountDisabled"
        @provision-fingerprint="provisionFingerprint"
      />
      <div v-else class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <AccountCard
          v-for="row in pageRows"
          :key="row.email"
          :row="row"
          :selected="isSelected(row.email)"
          :refreshing="refreshingTokens.includes(row.email)"
          :toggling="togglingDisabled.includes(row.email)"
          :provisioning="provisioningFingerprints.includes(row.email)"
          @toggle-select="toggleSelect"
          @edit-proxy="openEditProxy"
          @refresh="refreshToken"
          @delete="deleteToken"
          @detail="openDetail"
          @toggle-disabled="toggleAccountDisabled"
          @provision-fingerprint="provisionFingerprint"
        />
      </div>

      <AccountPagination
        :page="currentPage"
        :page-size="pageSize"
        :total="filteredAccounts.length"
        :total-pages="totalPages"
        @update:page="changePage"
        @update:page-size="changePageSize"
      />
    </template>

    <AddAccountModal :open="showAddModal" @close="showAddModal = false" @saved="reloadAll" />
    <EditProxyModal
      :open="showProxyModal"
      :email="proxyTarget.email"
      :proxy="proxyTarget.proxy"
      @close="showProxyModal = false"
      @saved="reloadAll"
    />
    <AccountDetailModal
      :open="showDetailModal"
      :row="detailRow"
      :toggling="detailRow ? togglingDisabled.includes(detailRow.email) : false"
      :provisioning="detailRow ? provisioningFingerprints.includes(detailRow.email) : false"
      @close="showDetailModal = false"
      @toggle-disabled="toggleAccountDisabled"
      @provision-fingerprint="provisionFingerprint"
    />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Icon from '../components/ui/Icon.vue'
import AccountToolbar from '../components/accounts/AccountToolbar.vue'
import AccountTable from '../components/accounts/AccountTable.vue'
import AccountCard from '../components/accounts/AccountCard.vue'
import AccountPagination from '../components/accounts/AccountPagination.vue'
import AddAccountModal from '../components/accounts/AddAccountModal.vue'
import EditProxyModal from '../components/accounts/EditProxyModal.vue'
import AccountDetailModal from '../components/accounts/AccountDetailModal.vue'
import { confirm, toast } from '../ui/feedback.js'
import {
  DEFAULT_STATS,
  REFRESH_THRESHOLD_HOURS,
  buildCliTooltip,
  buildStatusTooltip,
  formatCountdown,
  getAuthHeaders,
  needsFingerprint,
  usageTotal
} from '../components/accounts/shared.js'

const { t } = useI18n()

const VIEW_KEY = 'accounts.view'
const PAGE_SIZE_KEY = 'accounts.pageSize'
const PAGE_SIZES = [10, 20, 50, 100, 200]

// ---------- 列表数据 ----------
// 一次拉全量：搜索/状态筛选/排序/跨页全选都需要看到整个账号池，
// 分页改在前端做（接口仍是同一个 GET /api/getAllAccounts，只是把 pageSize 取满）。
const accounts = ref([])
const totalAccounts = ref(0)
const isLoading = ref(false)

// ---------- 查询条件 ----------
const search = ref('')
const statusFilter = ref('all')
const sortKey = ref('expiresAsc')

// 视图偏好与每页条数记忆在 localStorage；首次进入按屏宽选默认视图
const storedView = localStorage.getItem(VIEW_KEY)
const view = ref(storedView === 'table' || storedView === 'cards'
  ? storedView
  : (window.innerWidth < 768 ? 'cards' : 'table'))
const storedPageSize = Number(localStorage.getItem(PAGE_SIZE_KEY))
const pageSize = ref(PAGE_SIZES.includes(storedPageSize) ? storedPageSize : 10)
const currentPage = ref(1)

// ---------- 多选 ----------
// 跨页保持选中：翻页不会清空选择，方便批量删除
const selectedEmails = ref([])

// ---------- 刷新状态 ----------
const isRefreshingAll = ref(false)
const isForceRefreshingAll = ref(false)
const refreshingTokens = ref([])
// 正在切换启用/禁用状态的邮箱：开关进入 busy 态，避免连点
const togglingDisabled = ref([])
// 正在生成浏览器会话的邮箱：行内按钮、卡片与详情面板共用同一个 pending 集合
const provisioningFingerprints = ref([])
// 「一键补全会话」进行中 + 串行进度（done/total 直接显示在工具栏按钮上）
const isProvisioningAll = ref(false)
const provisionProgress = ref({ done: 0, total: 0 })

// ---------- 账号状态 / 用量 ----------
const accountStats = ref({})
const cliQuotaLimit = ref(2000)
const nowTick = ref(Date.now())
let statsInterval = null
let tickInterval = null
// Map<email, cooldownEndsAt>：冷却到期后每账号只补拉一次，避免全局标志互相阻塞
const cooldownRefetched = new Map()

// ---------- 弹窗 ----------
const showAddModal = ref(false)
const showProxyModal = ref(false)
const proxyTarget = ref({ email: '', proxy: '' })
// 详情面板按邮箱打开：行数据由 accounts/accountStats 派生，避免持有过期快照
const showDetailModal = ref(false)
const detailEmail = ref('')

const errorText = (error) => error?.response?.data?.error || error?.message || ''

const getStatusKind = (email) => accountStats.value[email]?.status?.kind || 'active'

// ---------- 筛选 / 排序 / 分页 ----------
const hasFilters = computed(() => Boolean(search.value.trim()) || statusFilter.value !== 'all')

const filteredAccounts = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return accounts.value.filter((account) => {
    if (keyword && !account.email.toLowerCase().includes(keyword)) return false
    if (statusFilter.value === 'all') return true
    // 「已禁用」是独立分组：禁用账号只出现在「全部」和「已禁用」里，
    // 不会落进「可用 / 冷却 / 异常」，避免把一个手动移出轮换的账号误读成故障。
    if (statusFilter.value === 'disabled') return account.disabled === true
    if (account.disabled) return false
    const kind = getStatusKind(account.email)
    // 「可用」包含令牌临期：两者都还能正常发请求，只是后者需要尽快刷新
    if (statusFilter.value === 'active') return kind === 'active' || kind === 'token_expiring'
    if (statusFilter.value === 'expiring') return kind === 'token_expiring'
    return kind === statusFilter.value
  })
})

const sortedAccounts = computed(() => {
  const list = [...filteredAccounts.value]
  const usage = (email) => usageTotal(accountStats.value[email]?.stats)
  const comparators = {
    emailAsc: (a, b) => a.email.localeCompare(b.email),
    emailDesc: (a, b) => b.email.localeCompare(a.email),
    expiresAsc: (a, b) => (Number(a.expires) || 0) - (Number(b.expires) || 0),
    expiresDesc: (a, b) => (Number(b.expires) || 0) - (Number(a.expires) || 0),
    usageDesc: (a, b) => usage(b.email) - usage(a.email),
    usageAsc: (a, b) => usage(a.email) - usage(b.email)
  }
  return list.sort(comparators[sortKey.value] || comparators.expiresAsc)
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredAccounts.value.length / pageSize.value)))

// 列表行 → 展示模型：状态/用量/倒计时/禁用标记，1s tick 驱动倒计时
const enrichAccount = (account) => {
  const entry = accountStats.value[account.email]
  const status = entry?.status || {}
  const kind = status.kind || 'active'
  const stats = entry?.stats || DEFAULT_STATS
  const disabled = account.disabled === true
  const cooldownEndsAt = status.cooldownEndsAt
  return {
    ...account,
    disabled,
    // 可用性字段原样透传；后端未就绪时按「没有指纹」保守处理，
    // 宁可显示「缺会话」也不要让不可用账号看起来可用。
    hasFingerprint: account.hasFingerprint === true,
    fingerprintAt: account.fingerprintAt || null,
    usable: account.usable === true,
    unavailableCode: account.unavailableCode || null,
    stats,
    cliRequestNumber: entry?.cliRequestNumber || 0,
    cliQuotaLimit: typeof entry?.cliQuotaLimit === 'number' ? entry.cliQuotaLimit : cliQuotaLimit.value,
    // 已禁用优先于健康状态：移出轮换后冷却/异常已无意义，徽章统一显示「已禁用」
    statusKind: disabled ? 'disabled' : kind,
    cliState: status.cli || 'available',
    countdown: !disabled && kind === 'cooldown' && typeof cooldownEndsAt === 'number'
      ? formatCountdown(cooldownEndsAt - nowTick.value)
      : '',
    statusTooltip: disabled ? t('accounts.statusTooltipDisabled') : buildStatusTooltip(status, nowTick.value, t),
    cliTooltip: buildCliTooltip(status.cli || 'available', t)
  }
}

const pageRows = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return sortedAccounts.value.slice(start, start + pageSize.value).map(enrichAccount)
})

// 详情面板的行：始终从最新 accounts 派生，切换启用/禁用后立刻反映到面板
const detailRow = computed(() => {
  if (!detailEmail.value) return null
  const account = accounts.value.find((item) => item.email === detailEmail.value)
  return account ? enrichAccount(account) : null
})

// 缺浏览器会话且未禁用：工具栏「一键补全会话」只处理这批账号
const fingerprintQueue = computed(() => accounts.value.filter((account) => needsFingerprint(account)))

const isSelected = (email) => selectedEmails.value.includes(email)
const allFilteredSelected = computed(() => (
  filteredAccounts.value.length > 0 &&
  filteredAccounts.value.every((account) => isSelected(account.email))
))
const pageAllSelected = computed(() => (
  pageRows.value.length > 0 && pageRows.value.every((row) => isSelected(row.email))
))
const pageSomeSelected = computed(() => (
  !pageAllSelected.value && pageRows.value.some((row) => isSelected(row.email))
))

// 分页越界自动回到最后一页（删除/筛选后常见）
watch([filteredAccounts, pageSize], () => {
  if (currentPage.value > totalPages.value) currentPage.value = totalPages.value
})

// 查询条件变化回到第 1 页
watch([search, statusFilter, sortKey], () => {
  currentPage.value = 1
})

watch(view, (value) => localStorage.setItem(VIEW_KEY, value))

// 列表刷新后清掉已经不存在的选中项
watch(accounts, () => {
  const existing = new Set(accounts.value.map((account) => account.email))
  selectedEmails.value = selectedEmails.value.filter((email) => existing.has(email))
})

// ---------- 数据加载 ----------
const fetchAccountStats = async () => {
  try {
    const res = await axios.get('/api/accountStats', { headers: getAuthHeaders() })
    const map = {}
    for (const entry of res.data?.accounts || []) {
      if (entry?.email) map[entry.email] = entry
    }
    accountStats.value = map
    if (typeof res.data?.cliQuotaLimit === 'number') {
      cliQuotaLimit.value = res.data.cliQuotaLimit
    }
    // 冷却结束或进入新一轮冷却时，解除该账号的补拉抑制
    for (const [email, cachedEndsAt] of cooldownRefetched) {
      const status = map[email]?.status
      if (status?.kind !== 'cooldown' || status?.cooldownEndsAt !== cachedEndsAt) {
        cooldownRefetched.delete(email)
      }
    }
  } catch (error) {
    console.error('fetchAccountStats error:', error)
  }
}

const getAccounts = async () => {
  isLoading.value = true
  try {
    const res = await axios.get('/api/getAllAccounts', {
      params: { page: 1, pageSize: 10000 },
      headers: getAuthHeaders()
    })
    accounts.value = res.data?.data || []
    totalAccounts.value = typeof res.data?.total === 'number' ? res.data.total : accounts.value.length
  } catch (error) {
    console.error('getAccounts error:', error)
    toast.error(t('accounts.toastFetchFailed', { error: errorText(error) }))
  } finally {
    isLoading.value = false
  }
}

const reloadAll = async () => {
  await getAccounts()
  await fetchAccountStats()
}

// ---------- 多选操作 ----------
const toggleSelect = (email) => {
  if (isSelected(email)) selectedEmails.value = selectedEmails.value.filter((item) => item !== email)
  else selectedEmails.value = [...selectedEmails.value, email]
}

// 表头复选框：只作用于当前页
const togglePageSelection = () => {
  const pageEmails = pageRows.value.map((row) => row.email)
  if (pageAllSelected.value) {
    selectedEmails.value = selectedEmails.value.filter((email) => !pageEmails.includes(email))
  } else {
    selectedEmails.value = [...new Set([...selectedEmails.value, ...pageEmails])]
  }
}

// 工具栏复选框：跨页全选当前筛选结果
const toggleAllFiltered = () => {
  if (allFilteredSelected.value) {
    selectedEmails.value = []
  } else {
    selectedEmails.value = filteredAccounts.value.map((account) => account.email)
  }
}

const clearSelection = () => {
  selectedEmails.value = []
}

const resetFilters = () => {
  search.value = ''
  statusFilter.value = 'all'
}

// ---------- 分页 ----------
const changePage = (page) => {
  if (page >= 1 && page <= totalPages.value) currentPage.value = page
}

const changePageSize = (size) => {
  pageSize.value = size
  currentPage.value = 1
  localStorage.setItem(PAGE_SIZE_KEY, String(size))
}

// ---------- 删除 ----------
const deleteSelected = async () => {
  const emails = [...selectedEmails.value]
  if (emails.length === 0) return

  const ok = await confirm({
    title: t('accounts.confirmDeleteSelectedTitle'),
    message: t('accounts.confirmDeleteSelected', { n: emails.length }),
    confirmText: t('common.delete'),
    danger: true
  })
  if (!ok) return

  try {
    await Promise.all(emails.map((email) => axios.delete('/api/deleteAccount', {
      data: { email },
      headers: getAuthHeaders()
    })))
    clearSelection()
    await reloadAll()
    toast.success(t('accounts.toastDeleted', { n: emails.length }))
  } catch (error) {
    console.error('deleteSelected error:', error)
    toast.error(t('accounts.toastDeleteFailed', { error: errorText(error) }))
  }
}

const deleteAllAccounts = async () => {
  const n = totalAccounts.value
  if (n === 0) {
    toast.warn(t('accounts.emptyTitle'))
    return
  }

  const ok = await confirm({
    title: t('accounts.confirmDeleteAllTitle'),
    message: t('accounts.confirmDeleteAll', { n }),
    confirmText: t('common.delete'),
    danger: true
  })
  if (!ok) return

  try {
    // 先取全量邮箱再逐个删除：与旧实现一致，避免删到一半列表已经变化
    const res = await axios.get('/api/getAllAccounts', {
      params: { page: 1, pageSize: 10000 },
      headers: getAuthHeaders()
    })
    const allEmails = (res.data?.data || []).map((item) => item.email)
    await Promise.all(allEmails.map((email) => axios.delete('/api/deleteAccount', {
      data: { email },
      headers: getAuthHeaders()
    })))
    clearSelection()
    currentPage.value = 1
    await reloadAll()
    toast.success(t('accounts.toastAllDeleted', { n: allEmails.length }))
  } catch (error) {
    console.error('deleteAllAccounts error:', error)
    toast.error(t('accounts.toastDeleteFailed', { error: errorText(error) }))
  }
}

const deleteToken = async (row) => {
  const ok = await confirm({
    title: t('accounts.confirmDeleteOneTitle'),
    message: t('accounts.confirmDeleteOne', { email: row.email }),
    confirmText: t('common.delete'),
    danger: true
  })
  if (!ok) return

  try {
    await axios.delete('/api/deleteAccount', {
      data: { email: row.email },
      headers: getAuthHeaders()
    })
    selectedEmails.value = selectedEmails.value.filter((email) => email !== row.email)
    await reloadAll()
    toast.success(t('accounts.toastDeleted', { n: 1 }))
  } catch (error) {
    console.error('deleteToken error:', error)
    toast.error(t('accounts.toastDeleteFailed', { error: errorText(error) }))
  }
}

// ---------- 刷新 ----------
const refreshToken = async (email) => {
  if (refreshingTokens.value.includes(email)) return
  refreshingTokens.value = [...refreshingTokens.value, email]
  try {
    await axios.post('/api/refreshAccount', { email }, { headers: getAuthHeaders() })
    await reloadAll()
    toast.success(t('accounts.toastRefreshSuccess', { email }))
  } catch (error) {
    console.error('refreshToken error:', error)
    toast.error(t('accounts.toastRefreshFailed', { error: errorText(error) }))
  } finally {
    refreshingTokens.value = refreshingTokens.value.filter((item) => item !== email)
  }
}

const refreshAllAccounts = async () => {
  if (isRefreshingAll.value) return
  const ok = await confirm({
    title: t('accounts.refreshAll'),
    message: t('accounts.confirmRefreshAll', { hours: REFRESH_THRESHOLD_HOURS })
  })
  if (!ok) return

  isRefreshingAll.value = true
  try {
    const response = await axios.post('/api/refreshAllAccounts', {
      thresholdHours: REFRESH_THRESHOLD_HOURS
    }, {
      headers: getAuthHeaders()
    })
    await reloadAll()
    const { refreshedCount, expiringCount } = response.data
    // 令牌有效期远长于阈值，多数时候没有临期账号；直接报「刷新了 0 个」会被当成按钮失效
    if (expiringCount === 0) {
      toast.warn(t('accounts.toastRefreshAllNone', { hours: REFRESH_THRESHOLD_HOURS }))
    } else if (refreshedCount < expiringCount) {
      toast.warn(t('accounts.toastRefreshAllComplete', { n: refreshedCount, total: expiringCount }))
    } else {
      toast.success(t('accounts.toastRefreshAllComplete', { n: refreshedCount, total: expiringCount }))
    }
  } catch (error) {
    console.error('refreshAllAccounts error:', error)
    toast.error(t('accounts.toastRefreshAllFailed', { error: errorText(error) }))
  } finally {
    isRefreshingAll.value = false
  }
}

const forceRefreshAllAccounts = async () => {
  if (isForceRefreshingAll.value) return
  const ok = await confirm({
    title: t('accounts.forceRefresh'),
    message: t('accounts.confirmForceRefreshAll'),
    confirmText: t('accounts.forceRefresh')
  })
  if (!ok) return

  isForceRefreshingAll.value = true
  try {
    const response = await axios.post('/api/forceRefreshAllAccounts', {}, { headers: getAuthHeaders() })
    await reloadAll()
    toast.success(t('accounts.toastForceRefreshComplete', { n: response.data.refreshedCount }))
  } catch (error) {
    console.error('forceRefreshAllAccounts error:', error)
    toast.error(t('accounts.toastForceRefreshFailed', { error: errorText(error) }))
  } finally {
    isForceRefreshingAll.value = false
  }
}

// ---------- 浏览器会话（baxia 指纹） ----------
// 服务端会拉起无头 Chrome，用账号邮箱密码登录 chat.qwen.ai 再采集会话，最长约 60 秒；
// 默认 axios 超时会把它误判成失败，这里单独放大到 90 秒。
const PROVISION_TIMEOUT_MS = 90000

// 单个账号的生成请求（不发 toast，供单点与「一键补全」共用，避免批量时刷屏）
const runProvision = async (email) => {
  if (provisioningFingerprints.value.includes(email)) return { ok: false, error: '' }
  provisioningFingerprints.value = [...provisioningFingerprints.value, email]
  try {
    await axios.post('/api/provisionFingerprint', { email }, {
      headers: getAuthHeaders(),
      timeout: PROVISION_TIMEOUT_MS
    })
    return { ok: true, error: '' }
  } catch (error) {
    console.error('provisionFingerprint error:', error)
    return { ok: false, error: errorText(error) }
  } finally {
    provisioningFingerprints.value = provisioningFingerprints.value.filter((item) => item !== email)
  }
}

const provisionFingerprint = async (row) => {
  const email = row?.email || row
  if (!email || provisioningFingerprints.value.includes(email)) return false
  const result = await runProvision(email)
  if (result.ok) {
    await getAccounts()
    toast.success(t('accounts.toastProvisionSuccess', { email }))
  } else if (result.error) {
    toast.error(t('accounts.toastProvisionFailed', { email, error: result.error }))
  }
  return result.ok
}

// 一键补全：串行执行（每个会话都要起一次无头 Chrome，并发只会互相抢资源），工具栏显示进度
const provisionAllFingerprints = async () => {
  if (isProvisioningAll.value) return
  // 先取快照：执行期间列表会被刷新，队列以点击那一刻为准
  const targets = [...fingerprintQueue.value]
  if (!targets.length) return

  const ok = await confirm({
    title: t('accounts.provisionAll', { n: targets.length }),
    message: t('accounts.confirmProvisionAll', { n: targets.length })
  })
  if (!ok) return

  isProvisioningAll.value = true
  provisionProgress.value = { done: 0, total: targets.length }
  let okCount = 0
  try {
    for (const account of targets) {
      const result = await runProvision(account.email)
      if (result.ok) {
        okCount += 1
        // 逐个刷新：徽章立刻从「缺会话」变「可用」，用户能看到进度
        await getAccounts()
      }
      provisionProgress.value = { done: provisionProgress.value.done + 1, total: targets.length }
    }
    if (okCount === targets.length) {
      toast.success(t('accounts.toastProvisionAllComplete', { n: okCount }))
    } else {
      toast.warn(t('accounts.toastProvisionAllPartial', { n: okCount, total: targets.length }))
    }
  } finally {
    isProvisioningAll.value = false
    provisionProgress.value = { done: 0, total: 0 }
  }
}

// ---------- 代理 ----------
const openEditProxy = (row) => {
  proxyTarget.value = { email: row.email, proxy: row.proxy || '' }
  showProxyModal.value = true
}

// ---------- 详情 ----------
const openDetail = (row) => {
  detailEmail.value = row.email
  showDetailModal.value = true
}

// ---------- 启用 / 禁用 ----------
// 禁用后账号移出轮换队列（账号、令牌、统计都保留，重新启用立刻可用）。
// 乐观更新 + 失败回滚：开关点下去立刻有反馈，接口失败时把状态还原并 toast。
const toggleAccountDisabled = async (row) => {
  if (togglingDisabled.value.includes(row.email)) return
  const target = accounts.value.find((item) => item.email === row.email)
  if (!target) return

  const previous = target.disabled === true
  const next = !previous
  togglingDisabled.value = [...togglingDisabled.value, row.email]
  target.disabled = next

  try {
    await axios.post('/api/setAccountDisabled', {
      email: row.email,
      disabled: next
    }, {
      headers: getAuthHeaders()
    })
    if (next) toast.success(t('accounts.toastAccountDisabled', { email: row.email }))
    else toast.success(t('accounts.toastAccountEnabled', { email: row.email }))
  } catch (error) {
    console.error('toggleAccountDisabled error:', error)
    target.disabled = previous
    toast.error(t('accounts.toastToggleDisabledFailed', { error: errorText(error) }))
  } finally {
    togglingDisabled.value = togglingDisabled.value.filter((email) => email !== row.email)
  }
}

// ---------- 导出 ----------
// 列表接口已不下发密码，导出必须走服务端 /exportAccounts（text/plain，附件下载）
const exportAccounts = async () => {
  try {
    const res = await axios.get('/api/exportAccounts', {
      headers: getAuthHeaders(),
      responseType: 'blob'
    })

    const blob = res.data instanceof Blob
      ? res.data
      : new Blob([res.data ?? ''], { type: 'text/plain;charset=utf-8' })

    if (blob.size === 0) {
      toast.warn(t('accounts.toastExportEmpty'))
      return
    }

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'qwen2api-accounts.txt'
    document.body.appendChild(link)
    link.click()

    setTimeout(() => {
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    }, 100)

    toast.success(t('accounts.toastExportSuccess'))
  } catch (error) {
    console.error('exportAccounts error:', error)
    toast.error(t('accounts.toastExportFailed', { error: errorText(error) }))
  }
}

// 冷却到期后补拉一次状态（每账号一次，避免轮询风暴）
watch([nowTick, accountStats], () => {
  const stats = accountStats.value
  let shouldRefetch = false
  for (const email of Object.keys(stats)) {
    const status = stats[email]?.status
    if (status?.kind !== 'cooldown' || typeof status?.cooldownEndsAt !== 'number') continue
    if (nowTick.value >= status.cooldownEndsAt && cooldownRefetched.get(email) !== status.cooldownEndsAt) {
      cooldownRefetched.set(email, status.cooldownEndsAt)
      shouldRefetch = true
    }
  }
  if (shouldRefetch) fetchAccountStats()
})

onMounted(() => {
  getAccounts()
  fetchAccountStats()
  statsInterval = setInterval(fetchAccountStats, 30000)
  // 1s tick 驱动倒计时重绘与冷却到期判定
  tickInterval = setInterval(() => { nowTick.value = Date.now() }, 1000)
})

onBeforeUnmount(() => {
  if (statsInterval) {
    clearInterval(statsInterval)
    statsInterval = null
  }
  if (tickInterval) {
    clearInterval(tickInterval)
    tickInterval = null
  }
})
</script>
