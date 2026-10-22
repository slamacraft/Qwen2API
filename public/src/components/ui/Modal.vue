<template>
  <teleport to="body">
    <transition name="modal">
      <div v-if="open" class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-6">
        <div class="fixed inset-0 bg-ink/40" @click="onBackdrop"></div>
        <div
          class="relative my-4 w-full rounded-card border border-line bg-surface shadow-pop"
          :class="sizeClass"
          role="dialog"
          aria-modal="true"
        >
          <div v-if="title || $slots.header" class="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <slot name="header">
              <h2 class="text-base font-semibold text-ink">{{ title }}</h2>
            </slot>
            <button class="btn-icon -mr-1.5" :aria-label="t('common.close')" @click="close">
              <Icon name="x" :size="16" />
            </button>
          </div>
          <div class="px-5 py-4" :class="bodyClass">
            <slot />
          </div>
          <div v-if="$slots.footer" class="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </transition>
  </teleport>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from './Icon.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  size: { type: String, default: 'md' }, // sm | md | lg | xl
  closeOnBackdrop: { type: Boolean, default: true },
  bodyClass: { type: String, default: '' },
})

const emit = defineEmits(['close'])
const { t } = useI18n()

const sizeClass = computed(() => ({
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}[props.size] || 'max-w-lg'))

const close = () => emit('close')

const onBackdrop = () => {
  if (props.closeOnBackdrop) close()
}

const onKeydown = (event) => {
  if (event.key === 'Escape' && props.open) close()
}

watch(() => props.open, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
})

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.16s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
