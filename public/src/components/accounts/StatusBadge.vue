<template>
  <!-- 账号健康徽章：冷却中额外显示 mm:ss 倒计时，悬停给出完整原因 -->
  <span class="badge" :class="meta.badge" :title="tooltip">
    <Icon :name="meta.icon" :size="12" class="shrink-0" />
    <span class="truncate">{{ t(meta.label) }}</span>
    <span v-if="countdown" class="mono tabular-nums">{{ countdown }}</span>
  </span>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '../ui/Icon.vue'
import { STATUS_META } from './shared.js'

const props = defineProps({
  kind: { type: String, default: 'active' },
  countdown: { type: String, default: '' },
  tooltip: { type: String, default: '' }
})

const { t } = useI18n()

const meta = computed(() => STATUS_META[props.kind] || STATUS_META.active)
</script>
