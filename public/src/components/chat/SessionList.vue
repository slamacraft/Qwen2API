<template>
  <!-- 会话列表：桌面端常驻左侧（贴在页面左缘、和对话区之间不留缝），窄屏放进抽屉。
       视觉参考 Qwen 官网：浅灰底 + 白色选中块，没有卡片边框。 -->
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="shrink-0 px-2 pt-3">
      <button
        type="button"
        class="flex h-9 w-full items-center gap-2 rounded-control border border-line bg-surface px-2.5 text-sm text-ink transition-colors hover:border-brand-200 hover:text-brand-700"
        @click="$emit('new')"
      >
        <Icon name="plus" :size="15" class="shrink-0 text-ink-mute" />
        <span class="truncate">{{ t("chatui.newChat") }}</span>
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
      <template v-for="group in groups" :key="group.key">
        <div
          v-if="group.sessions.length > 0"
          class="mb-0.5 mt-2 px-2 py-1 text-[11px] font-medium text-ink-mute first:mt-0"
        >
          {{ t(group.key) }}
        </div>
        <div
          v-for="session in group.sessions"
          :key="session.id"
          class="group mb-0.5 flex items-center rounded-control transition-colors"
          :class="session.id === activeId ? 'bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.06)]' : 'hover:bg-surface/70'"
        >
          <button
            type="button"
            class="min-w-0 flex-1 px-2.5 py-2 text-left"
            :title="session.title || t('chatui.untitled')"
            @click="$emit('select', session.id)"
          >
            <span
              class="block truncate text-[13px] leading-5"
              :class="session.id === activeId ? 'font-medium text-ink' : 'text-ink-soft'"
            >{{ session.title || t("chatui.untitled") }}</span>
            <span class="block truncate text-[10px] leading-4 text-ink-mute">
              {{ formatWhen(session.updatedAt) }}
              <span class="mx-0.5">·</span>
              {{ t("chatui.sessionMessages", { n: session.messages.length }) }}
            </span>
          </button>
          <button
            type="button"
            class="btn-icon mr-1 h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            :title="t('chatui.deleteSession')"
            :aria-label="t('chatui.deleteSession')"
            @click.stop="$emit('delete', session.id)"
          >
            <Icon name="trash" :size="12" />
          </button>
        </div>
      </template>

      <p v-if="total === 0" class="px-2 py-8 text-center text-xs text-ink-mute">{{ t("chatui.historyEmpty") }}</p>
    </div>

    <div class="shrink-0 px-3 py-2 text-[11px] text-ink-mute">
      {{ t("chatui.sessionsStoredLocally", { n: total }) }}
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '../ui/Icon.vue'

const props = defineProps({
  // [{ key: 'chatui.groupToday', sessions: [...] }, ...]
  groups: { type: Array, default: () => [] },
  activeId: { type: String, default: '' },
})

defineEmits(['new', 'select', 'delete'])

const { t } = useI18n()

const total = computed(() => props.groups.reduce((sum, group) => sum + group.sessions.length, 0))

// 今天只显示时分，其它显示月-日：列表要紧凑，别让时间占满一行
const formatWhen = (timestamp) => {
  const value = Number(timestamp) || 0
  if (!value) return ''
  const date = new Date(value)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  const pad = (n) => String(n).padStart(2, '0')
  return sameDay
    ? `${pad(date.getHours())}:${pad(date.getMinutes())}`
    : `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
</script>
