<template>
  <!-- 启用/禁用开关：禁用后账号移出轮换队列（账号、令牌、统计都保留） -->
  <button
    type="button"
    role="switch"
    :aria-checked="!disabled"
    :disabled="busy"
    class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors"
    :class="[
      disabled ? 'border-line bg-canvas' : 'border-brand-600 bg-brand-600',
      busy ? 'cursor-wait opacity-70' : 'cursor-pointer'
    ]"
    :title="disabled ? t('accounts.enableAccount') : t('accounts.disableAccount')"
    :aria-label="disabled ? t('accounts.enableAccount') : t('accounts.disableAccount')"
    @click.stop="$emit('toggle')"
  >
    <span
      class="inline-block h-4 w-4 rounded-full bg-surface shadow transition-transform"
      :class="disabled ? 'translate-x-0.5' : 'translate-x-[18px]'"
    ></span>
  </button>
</template>

<script setup>
import { useI18n } from 'vue-i18n'

defineProps({
  disabled: { type: Boolean, default: false },
  // 请求进行中：禁用开关避免连点造成状态错乱
  busy: { type: Boolean, default: false }
})

defineEmits(['toggle'])

const { t } = useI18n()
</script>
