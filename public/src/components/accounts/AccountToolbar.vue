<template>
  <!-- 工具栏：搜索 + 状态筛选 + 排序 + 视图切换 + 批量操作 -->
  <div class="card mb-4">
    <div class="card-body flex flex-col gap-3 py-3">
      <div class="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div class="relative min-w-0 flex-1">
          <Icon
            name="search"
            :size="16"
            class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute"
          />
          <input
            v-model="search"
            type="search"
            class="input pl-9 pr-9"
            :placeholder="t('accounts.searchPlaceholder')"
            :aria-label="t('accounts.searchPlaceholder')"
          />
          <button
            v-if="search"
            type="button"
            class="btn-icon absolute right-1 top-1/2 -translate-y-1/2"
            :title="t('common.reset')"
            :aria-label="t('common.reset')"
            @click="search = ''"
          >
            <Icon name="x" :size="14" />
          </button>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <select v-model="status" class="select" :aria-label="t('accounts.statusFilter')">
            <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
          <select v-model="sort" class="select" :aria-label="t('accounts.sort')">
            <option v-for="opt in sortOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
          <!-- 视图切换：记住用户选择（父级持久化到 localStorage） -->
          <div class="inline-flex items-center gap-0.5 rounded-control border border-line bg-canvas p-0.5">
            <button
              v-for="opt in viewOptions"
              :key="opt.value"
              type="button"
              class="h-8 rounded-[6px] px-2.5 text-xs font-medium transition-colors"
              :class="view === opt.value ? 'bg-surface text-ink shadow-card' : 'text-ink-mute hover:text-ink'"
              :title="opt.label"
              @click="view = opt.value"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <label class="inline-flex cursor-pointer items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            class="h-4 w-4 accent-brand-600"
            :checked="allSelected"
            :disabled="matching === 0"
            @change="$emit('select-all')"
          />
          {{ t('accounts.selectAll') }}
        </label>
        <span v-if="selectedCount" class="badge badge-brand">
          {{ t('accounts.selectedCount', { n: selectedCount }) }}
        </span>
        <button
          v-if="selectedCount && selectedCount < matching"
          type="button"
          class="btn-default btn-sm"
          @click="$emit('select-all')"
        >
          {{ t('accounts.selectAllMatching', { n: matching }) }}
        </button>
        <button
          v-if="selectedCount"
          type="button"
          class="btn-default btn-sm"
          @click="$emit('clear-selection')"
        >
          {{ t('accounts.clearSelection') }}
        </button>
        <div class="flex-1"></div>
        <button
          type="button"
          class="btn-default btn-sm"
          :disabled="!selectedCount"
          @click="$emit('delete-selected')"
        >
          <Icon name="trash" :size="14" />
          {{ t('accounts.deleteSelected') }}
        </button>
        <button type="button" class="btn-danger btn-sm" @click="$emit('delete-all')">
          <Icon name="trash" :size="14" />
          {{ t('accounts.deleteAll') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '../ui/Icon.vue'

// 四个筛选维度与父级双向绑定；搜索/筛选/排序变化时父级会把页码重置到第 1 页
const search = defineModel('search', { type: String, default: '' })
const status = defineModel('status', { type: String, default: 'all' })
const sort = defineModel('sort', { type: String, default: 'expiresAsc' })
const view = defineModel('view', { type: String, default: 'table' })

defineProps({
  // 当前筛选结果总数 / 已选数量：决定「全选筛选结果」与批量按钮的可用状态
  matching: { type: Number, default: 0 },
  selectedCount: { type: Number, default: 0 },
  allSelected: { type: Boolean, default: false }
})

defineEmits(['select-all', 'clear-selection', 'delete-selected', 'delete-all'])

const { t } = useI18n()

const statusOptions = computed(() => [
  { value: 'all', label: t('accounts.statusAll') },
  { value: 'active', label: t('accounts.statusActive') },
  { value: 'quota_exhausted', label: t('accounts.statusQuotaExhausted') },
  { value: 'cooldown', label: t('accounts.statusCooldown') },
  { value: 'warn', label: t('accounts.statusWarn') },
  { value: 'expiring', label: t('accounts.statusExpiring') },
  { value: 'disabled', label: t('accounts.statusDisabled') }
])

const sortOptions = computed(() => [
  { value: 'expiresAsc', label: t('accounts.sortExpiresAsc') },
  { value: 'expiresDesc', label: t('accounts.sortExpiresDesc') },
  { value: 'emailAsc', label: t('accounts.sortEmailAsc') },
  { value: 'emailDesc', label: t('accounts.sortEmailDesc') },
  { value: 'usageDesc', label: t('accounts.sortUsageDesc') },
  { value: 'usageAsc', label: t('accounts.sortUsageAsc') }
])

const viewOptions = computed(() => [
  { value: 'table', label: t('accounts.viewTable') },
  { value: 'cards', label: t('accounts.viewCards') }
])
</script>
