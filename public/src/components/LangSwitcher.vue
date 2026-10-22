<template>
  <div ref="rootRef" class="relative shrink-0" @focusout="onFocusOut">
    <button
      ref="triggerRef"
      type="button"
      class="flex h-9 items-center gap-1.5 rounded-control border border-line bg-surface px-2.5 text-xs font-medium text-ink-soft transition-colors hover:bg-canvas hover:text-ink"
      :title="t('shell.language')"
      :aria-label="t('shell.language')"
      aria-haspopup="menu"
      :aria-controls="open ? 'lang-switcher-menu' : null"
      :aria-expanded="open ? 'true' : 'false'"
      @click="toggle"
      @keydown.down.prevent="openMenu('first')"
      @keydown.up.prevent="openMenu('last')"
    >
      <Icon name="globe" :size="16" class="shrink-0" />
      <span class="whitespace-nowrap">{{ currentLabel }}</span>
      <Icon
        name="chevron-down"
        :size="14"
        class="shrink-0 text-ink-mute transition-transform duration-150"
        :class="open ? 'rotate-180' : ''"
      />
    </button>

    <div
      v-if="open"
      id="lang-switcher-menu"
      ref="menuRef"
      class="absolute right-0 top-full z-50 mt-1.5 min-w-[160px] rounded-card border border-line bg-surface p-1 shadow-pop"
      role="menu"
      :aria-label="t('shell.language')"
      @keydown="onMenuKeydown"
    >
      <button
        v-for="lang in LANGS"
        :key="lang.code"
        type="button"
        role="menuitemradio"
        :aria-checked="locale === lang.code ? 'true' : 'false'"
        class="flex w-full items-center gap-2 rounded-control px-2.5 py-1.5 text-left text-sm transition-colors"
        :class="locale === lang.code
          ? 'bg-brand-50 font-medium text-brand-700'
          : 'text-ink-soft hover:bg-canvas hover:text-ink'"
        @click="select(lang.code)"
      >
        <span class="flex-1 truncate">{{ lang.label }}</span>
        <Icon v-if="locale === lang.code" name="check" :size="14" class="shrink-0" />
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from './ui/Icon.vue'

// 语言名固定用母语写法：不跟随当前界面语言变化，否则用户可能认不出自己的语言。
const LANGS = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Русский' },
]

const { locale, t } = useI18n()

const rootRef = ref(null)
const triggerRef = ref(null)
const menuRef = ref(null)
const open = ref(false)

const currentLabel = computed(
  () => LANGS.find((lang) => lang.code === locale.value)?.label || LANGS[0].label
)

const menuItems = () => Array.from(menuRef.value?.querySelectorAll('[role="menuitemradio"]') || [])

const focusItem = (index) => {
  const items = menuItems()
  if (!items.length) return
  items[((index % items.length) + items.length) % items.length].focus()
}

// 打开后把焦点放到当前语言项；从按钮用 ↑/↓ 打开时分别落到首项/末项。
const openMenu = async (target = 'current') => {
  if (open.value) return
  open.value = true
  await nextTick()
  const items = menuItems()
  if (!items.length) return
  if (target === 'first') {
    focusItem(0)
  } else if (target === 'last') {
    focusItem(items.length - 1)
  } else {
    const index = items.findIndex((item) => item.getAttribute('aria-checked') === 'true')
    focusItem(index >= 0 ? index : 0)
  }
}

const closeMenu = (restoreFocus = false) => {
  if (!open.value) return
  open.value = false
  if (restoreFocus) triggerRef.value?.focus()
}

const toggle = () => (open.value ? closeMenu() : openMenu())

// 沿用原有持久化逻辑：localStorage 的 locale 由 main.js detectLocale 读取。
const select = (code) => {
  locale.value = code
  localStorage.setItem('locale', code)
  closeMenu(true)
}

const onMenuKeydown = (event) => {
  const items = menuItems()
  if (!items.length) return
  const index = items.indexOf(document.activeElement)
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    focusItem(index + 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    focusItem(index - 1)
  } else if (event.key === 'Home') {
    event.preventDefault()
    focusItem(0)
  } else if (event.key === 'End') {
    event.preventDefault()
    focusItem(items.length - 1)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    closeMenu(true)
  }
}

// 焦点离开组件（如 Tab 出去）时收起，避免菜单挂在页面上。
const onFocusOut = (event) => {
  if (!open.value) return
  const next = event.relatedTarget
  if (next && rootRef.value?.contains(next)) return
  closeMenu()
}

const onDocPointerDown = (event) => {
  if (!open.value) return
  if (!rootRef.value?.contains(event.target)) closeMenu()
}

const onDocKeydown = (event) => {
  if (open.value && event.key === 'Escape') {
    event.preventDefault()
    closeMenu(true)
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown)
  document.addEventListener('keydown', onDocKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown)
  document.removeEventListener('keydown', onDocKeydown)
})
</script>
