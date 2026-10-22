<template>
  <div class="flex h-full overflow-hidden bg-canvas">
    <!-- 移动端遮罩 -->
    <div
      v-if="mobileOpen"
      class="fixed inset-0 z-30 bg-ink/40 lg:hidden"
      @click="mobileOpen = false"
    ></div>

    <!-- 侧边栏 -->
    <aside
      class="fixed inset-y-0 left-0 z-40 flex shrink-0 flex-col border-r border-line bg-surface transition-[width,transform] duration-200 lg:static lg:translate-x-0"
      :class="[
        collapsed ? 'w-[68px]' : 'w-60',
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      ]"
    >
      <div class="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-4">
        <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
          Q
        </div>
        <div v-if="!collapsed" class="min-w-0 leading-tight">
          <div class="truncate text-sm font-semibold text-ink">{{ t('shell.brand') }}</div>
          <div class="truncate text-[11px] text-ink-mute">{{ t('shell.subtitle') }}</div>
        </div>
      </div>

      <nav class="flex-1 space-y-0.5 overflow-y-auto p-2">
        <router-link
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="group flex h-9 items-center gap-2.5 rounded-control px-2.5 text-sm transition-colors"
          :class="isActive(item.to)
            ? 'bg-brand-50 font-medium text-brand-700'
            : 'text-ink-soft hover:bg-canvas hover:text-ink'"
          :title="collapsed ? t(item.key) : ''"
          @click="mobileOpen = false"
        >
          <Icon :name="item.icon" :size="18" class="shrink-0" />
          <span v-if="!collapsed" class="truncate">{{ t(item.key) }}</span>
        </router-link>
      </nav>

      <div class="space-y-1 border-t border-line p-2">
        <button
          class="flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-sm text-ink-mute transition-colors hover:bg-canvas hover:text-ink"
          :title="collapsed ? t('shell.expand') : t('shell.collapse')"
          @click="toggleCollapse"
        >
          <Icon :name="collapsed ? 'chevron-right' : 'chevron-left'" :size="18" class="shrink-0" />
          <span v-if="!collapsed" class="truncate">{{ t('shell.collapse') }}</span>
        </button>
        <button
          class="flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-sm text-ink-mute transition-colors hover:bg-canvas hover:text-ink"
          :title="t('shell.logout')"
          :aria-label="t('shell.logout')"
          @click="logout"
        >
          <Icon name="logout" :size="18" class="shrink-0" />
          <span v-if="!collapsed" class="truncate">{{ t('shell.logout') }}</span>
        </button>
      </div>
    </aside>

    <!-- 主区域 -->
    <div class="flex min-w-0 flex-1 flex-col">
      <header class="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
        <button class="btn-icon lg:hidden" :aria-label="t('shell.menu')" @click="mobileOpen = true">
          <Icon name="menu" :size="18" />
        </button>
        <h1 class="truncate text-sm font-semibold text-ink">{{ pageTitle }}</h1>
        <div class="flex-1"></div>
        <LangSwitcher />
        <a
          class="hidden items-center gap-1.5 text-xs text-ink-mute transition-colors hover:text-ink sm:flex"
          href="https://github.com/Rfym21/Qwen2API"
          target="_blank"
          rel="noreferrer noopener"
        >
          <Icon name="external" :size="14" />
          GitHub
        </a>
      </header>

      <main class="flex-1 overflow-y-auto">
        <router-view />
      </main>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Icon from '../components/ui/Icon.vue'
import LangSwitcher from '../components/LangSwitcher.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const COLLAPSE_KEY = 'shell.collapsed'

const collapsed = ref(localStorage.getItem(COLLAPSE_KEY) === 'true')
const mobileOpen = ref(false)

const navItems = [
  { to: '/accounts', key: 'shell.nav.accounts', icon: 'users' },
  { to: '/usage', key: 'shell.nav.usage', icon: 'chart' },
  { to: '/settings', key: 'shell.nav.settings', icon: 'settings' },
  { to: '/chat', key: 'shell.nav.chat', icon: 'message' },
]

const isActive = (to) => route.path === to || route.path.startsWith(`${to}/`)

const pageTitle = computed(() => (route.meta.titleKey ? t(route.meta.titleKey) : t('shell.brand')))

const toggleCollapse = () => {
  collapsed.value = !collapsed.value
  localStorage.setItem(COLLAPSE_KEY, String(collapsed.value))
}

const logout = () => {
  localStorage.removeItem('apiKey')
  localStorage.removeItem('isAdmin')
  router.push({ path: '/auth', replace: true })
}
</script>
