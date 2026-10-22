<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="path"
  ></svg>
</template>

<script setup>
import { computed } from 'vue'

// 统一图标集（线性、currentColor、24x24）。避免用 emoji 当图标：跨平台渲染不一致且不可着色。
const ICONS = {
  users:
    '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19v-1.2A3.8 3.8 0 0 1 7.3 14h3.4a3.8 3.8 0 0 1 3.8 3.8V19"/><path d="M16.5 5.4a3.2 3.2 0 0 1 0 5.2"/><path d="M17.6 14.3A3.8 3.8 0 0 1 20.5 18v1"/>',
  chart:
    '<path d="M4 20h16"/><rect x="6" y="10" width="3" height="7" rx="1"/><rect x="11" y="5.5" width="3" height="11.5" rx="1"/><rect x="16" y="13" width="3" height="4" rx="1"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M4.5 8.5 6 7l-1.2-1.2a1 1 0 0 1 0-1.4l1.2-1.2a1 1 0 0 1 1.4 0L8.5 4.5 10 3M4.5 15.5 6 17l-1.2 1.2a1 1 0 0 0 0 1.4l1.2 1.2a1 1 0 0 0 1.4 0L8.5 19.5 10 21M19.5 8.5 18 7l1.2-1.2a1 1 0 0 0 0-1.4l-1.2-1.2a1 1 0 0 0-1.4 0L15.5 4.5 14 3M19.5 15.5 18 17l1.2 1.2a1 1 0 0 1 0 1.4l-1.2 1.2a1 1 0 0 1-1.4 0L15.5 19.5 14 21"/>',
  message:
    '<path d="M20.5 11.5a7.5 7.5 0 0 1-7.5 7.5H8l-4 2.5V17a7.5 7.5 0 0 1 4.5-13.5h4.5a7.5 7.5 0 0 1 7.5 7.5z"/>',
  refresh:
    '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash:
    '<path d="M4 7h16"/><path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7"/><path d="M6.5 7l.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7"/><path d="M10.5 11v5M13.5 11v5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off':
    '<path d="M3 3l18 18"/><path d="M10.6 6.1A9.7 9.7 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3 3.6"/><path d="M6.2 6.2A17 17 0 0 0 2.5 12S6 18 12 18a9.6 9.6 0 0 0 4-.85"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  download: '<path d="M12 4v10"/><path d="M8 10.5 12 14.5l4-4"/><path d="M5 18.5h14"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>',
  shield: '<path d="M12 3.5 19 6v6c0 4.2-3 7.4-7 8.5-4-1.1-7-4.3-7-8.5V6z"/>',
  activity: '<path d="M3 12h3.5l2.5-7 4 14 2.5-7H21"/>',
  logout: '<path d="M15 5.5V4a1.5 1.5 0 0 0-1.5-1.5h-7A1.5 1.5 0 0 0 5 4v16a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 15 20v-1.5"/><path d="M10 12h10"/><path d="M17 9l3 3-3 3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  'chevron-down': '<path d="M6 9.5 12 15.5l6-6"/>',
  'chevron-left': '<path d="M14.5 6 8.5 12l6 6"/>',
  'chevron-right': '<path d="M9.5 6l6 6-6 6"/>',
  'arrow-up': '<path d="M12 19V5"/><path d="M6.5 10.5 12 5l5.5 5.5"/>',
  'arrow-down': '<path d="M12 5v14"/><path d="M6.5 13.5 12 19l5.5-5.5"/>',
  alert: '<path d="M12 4.5 21 19.5H3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 8h.01"/>',
  spinner: '<path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5" opacity="0.9"/>',
  send: '<path d="M4.5 12 20 4.5 14 20l-2.5-6z"/><path d="M11.5 14 20 4.5"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  key: '<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H21"/><path d="M17 12v3.5"/><path d="M20 12v2.5"/>',
  server: '<rect x="3.5" y="4.5" width="17" height="6" rx="2"/><rect x="3.5" y="13.5" width="17" height="6" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  filter: '<path d="M4 6h16"/><path d="M7 12h10"/><path d="M10 18h4"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-8.5 8.5"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  globe:
    '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.3 2.4 3.5 5.4 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.4-3.5-8.5S9.7 5.9 12 3.5z"/>',
}

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 16 },
  strokeWidth: { type: [Number, String], default: 1.8 },
})

const path = computed(() => ICONS[props.name] || '')
</script>
