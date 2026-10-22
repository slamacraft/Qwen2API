<template>
  <!-- 分页条：每页条数 + 总数 + 上一页/下一页 -->
  <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
    <div class="flex items-center gap-2 text-sm text-ink-soft">
      <span>{{ t('accounts.perPage') }}</span>
      <select
        class="select h-8"
        :value="pageSize"
        :aria-label="t('accounts.perPage')"
        @change="$emit('update:page-size', Number($event.target.value))"
      >
        <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size }}</option>
      </select>
    </div>

    <div class="flex items-center gap-2 text-sm text-ink-soft">
      <span class="tabular-nums">{{ t('accounts.totalItems', { n: total }) }}</span>
      <button
        type="button"
        class="btn-default btn-sm"
        :disabled="page <= 1"
        :title="t('accounts.prevPage')"
        :aria-label="t('accounts.prevPage')"
        @click="$emit('update:page', page - 1)"
      >
        <Icon name="chevron-left" :size="14" />
      </button>
      <span class="tabular-nums">{{ page }} / {{ totalPages }}</span>
      <button
        type="button"
        class="btn-default btn-sm"
        :disabled="page >= totalPages"
        :title="t('accounts.nextPage')"
        :aria-label="t('accounts.nextPage')"
        @click="$emit('update:page', page + 1)"
      >
        <Icon name="chevron-right" :size="14" />
      </button>
    </div>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import Icon from '../ui/Icon.vue'

defineProps({
  page: { type: Number, default: 1 },
  pageSize: { type: Number, default: 10 },
  total: { type: Number, default: 0 },
  totalPages: { type: Number, default: 1 }
})

defineEmits(['update:page', 'update:page-size'])

const { t } = useI18n()

// 与旧页面保持同样的可选条数
const PAGE_SIZES = [10, 20, 50, 100, 200]
</script>
