<template>
  <!-- Toast 堆栈：右下角，点击关闭 -->
  <div class="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end">
    <transition-group name="toast">
      <div
        v-for="item in toasts"
        :key="item.id"
        class="pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-card border bg-surface px-3.5 py-3 shadow-pop"
        :class="toneOf(item.type).border"
        role="status"
      >
        <Icon :name="toneOf(item.type).icon" :size="18" class="mt-0.5 shrink-0" :class="toneOf(item.type).text" />
        <p class="flex-1 text-sm leading-5 text-ink break-words">{{ item.message }}</p>
        <button class="btn-icon -mr-1 -mt-1 h-6 w-6" :aria-label="t('common.close')" @click="dismissToast(item.id)">
          <Icon name="x" :size="14" />
        </button>
      </div>
    </transition-group>
  </div>

  <!-- 确认弹窗 -->
  <Modal :open="confirmState.open" :title="confirmState.title" size="sm" @close="resolveConfirm(false)">
    <p class="text-sm leading-6 text-ink-soft whitespace-pre-line">{{ confirmState.message }}</p>
    <template #footer>
      <button class="btn-default" @click="resolveConfirm(false)">
        {{ confirmState.cancelText || t('common.cancel') }}
      </button>
      <button :class="confirmState.danger ? 'btn-danger' : 'btn-primary'" @click="resolveConfirm(true)">
        {{ confirmState.confirmText || t('common.confirm') }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import Icon from './Icon.vue'
import Modal from './Modal.vue'
import { toasts, dismissToast, confirmState, resolveConfirm } from '../../ui/feedback.js'

const { t } = useI18n()

const TONES = {
  success: { icon: 'check', border: 'border-ok-100', text: 'text-ok-600' },
  error: { icon: 'alert', border: 'border-danger-200', text: 'text-danger-600' },
  warn: { icon: 'alert', border: 'border-warn-100', text: 'text-warn-600' },
  info: { icon: 'info', border: 'border-brand-100', text: 'text-brand-600' },
}

const toneOf = (type) => TONES[type] || TONES.info
</script>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
