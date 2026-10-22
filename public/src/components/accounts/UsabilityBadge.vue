<template>
  <!-- 可用性徽章：回答「现在能不能真的发请求」；缺浏览器会话时就地给「生成」按钮 -->
  <div class="flex flex-wrap items-center gap-1.5">
    <span class="badge" :class="meta.badge" :title="tooltip">
      <Icon :name="meta.icon" :size="12" class="shrink-0" />
      <span class="truncate">{{ t(meta.label) }}</span>
    </span>
    <button
      v-if="canProvision"
      type="button"
      class="btn-default btn-sm h-6 px-1.5 text-[11px]"
      :disabled="busy"
      :title="t('accounts.provisionTooltip')"
      :aria-label="t('accounts.provisionTooltip')"
      @click="$emit('provision')"
    >
      <Icon name="refresh" :size="11" :class="busy ? 'animate-spin' : ''" />
      {{ busy ? t('accounts.provisioning') : t('accounts.provision') }}
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '../ui/Icon.vue'
import { USABILITY_META, buildUsabilityTooltip, usabilityKind } from './shared.js'

const props = defineProps({
  row: { type: Object, required: true },
  // 该账号的指纹生成请求进行中：按钮进入 spin + 「生成中…」
  busy: { type: Boolean, default: false }
})

defineEmits(['provision'])

const { t } = useI18n()

const kind = computed(() => usabilityKind(props.row))
const meta = computed(() => USABILITY_META[kind.value] || USABILITY_META.usable)
const tooltip = computed(() => buildUsabilityTooltip(kind.value, props.row, t))
// 只有缺会话才给生成入口：可用账号无需生成，禁用账号要先启用
const canProvision = computed(() => kind.value === 'no_fingerprint')
</script>
