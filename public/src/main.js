import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'
import router from './routes/index.js'
import App from './App.vue'
import zh from './locales/zh.json'
import en from './locales/en.json'
import ru from './locales/ru.json'
import shellZh from './locales/shell.zh.json'
import shellEn from './locales/shell.en.json'
import shellRu from './locales/shell.ru.json'
import accountsZh from './locales/accounts.zh.json'
import accountsEn from './locales/accounts.en.json'
import accountsRu from './locales/accounts.ru.json'
import usageZh from './locales/usage.zh.json'
import usageEn from './locales/usage.en.json'
import usageRu from './locales/usage.ru.json'
import chatuiZh from './locales/chatui.zh.json'
import chatuiEn from './locales/chatui.en.json'
import chatuiRu from './locales/chatui.ru.json'
import "./style.css"

// 每个功能域一份 locale 文件，互不冲突（zh.json 里的旧键保持原样，页面重写时逐步迁移）。
const deepMerge = (base, extra) => {
  const out = { ...base }
  for (const [key, value] of Object.entries(extra || {})) {
    out[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? deepMerge(out[key] || {}, value)
      : value
  }
  return out
}

const messages = {
  zh: deepMerge(deepMerge(deepMerge(deepMerge(zh, shellZh), accountsZh), usageZh), chatuiZh),
  en: deepMerge(deepMerge(deepMerge(deepMerge(en, shellEn), accountsEn), usageEn), chatuiEn),
  ru: deepMerge(deepMerge(deepMerge(deepMerge(ru, shellRu), accountsRu), usageRu), chatuiRu),
},
  fallbackLocale = 'zh'

const detectLocale = () => {
  const stored = localStorage.getItem('locale');

  if (stored in messages) {
    return stored;
  }

  const full = navigator.language;
  const code = full.split('-')[0];

  return code in messages ? code : fallbackLocale;
}

const i18n = createI18n({
  locale: detectLocale(),
  fallbackLocale,
  messages,
  globalInjection: true
})

createApp(App)
  .use(i18n)
  .use(router)
  .mount('#app')
