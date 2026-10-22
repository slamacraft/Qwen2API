<template>
  <div class="relative flex min-h-full items-center justify-center bg-canvas px-4 py-10">
    <!-- 登录页不在后台外壳内，语言切换单独放在右上角 -->
    <div class="absolute right-4 top-4 z-10">
      <LangSwitcher />
    </div>

    <div class="w-full max-w-sm">
      <div class="card p-6 sm:p-7">
        <!-- 品牌标识 -->
        <div class="flex flex-col items-center text-center">
          <div class="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white">
            Q
          </div>
          <h1 class="mt-4 text-lg font-semibold text-ink">{{ t('authui.title') }}</h1>
          <p class="mt-1 text-sm text-ink-mute">{{ t('authui.subtitle') }}</p>
        </div>

        <form class="mt-6 space-y-4" @submit.prevent="handleLogin">
          <div>
            <label class="label" for="auth-api-key">{{ t('authui.label') }}</label>
            <div class="relative">
              <input
                id="auth-api-key"
                v-model="apiKey"
                :type="showKey ? 'text' : 'password'"
                class="input pr-10"
                :placeholder="t('authui.placeholder')"
                autocomplete="current-password"
                @keyup.enter="handleLogin"
              />
              <button
                type="button"
                class="btn-icon absolute right-0.5 top-1/2 h-8 w-8 -translate-y-1/2"
                :aria-label="showKey ? t('authui.hideKey') : t('authui.showKey')"
                :title="showKey ? t('authui.hideKey') : t('authui.showKey')"
                @click="showKey = !showKey"
              >
                <Icon :name="showKey ? 'eye-off' : 'eye'" :size="16" />
              </button>
            </div>
          </div>

          <button type="submit" class="btn-primary h-10 w-full" :disabled="loading">
            <Icon v-if="loading" name="spinner" :size="15" class="animate-spin" />
            {{ loading ? t('authui.loggingIn') : t('authui.login') }}
          </button>
        </form>

        <p class="mt-4 text-center text-xs text-ink-mute">{{ t('authui.hint') }}</p>
      </div>

      <p class="mt-4 text-center text-xs text-ink-mute">{{ t('authui.footer') }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { useRouter } from 'vue-router'
import Icon from '../components/ui/Icon.vue'
import LangSwitcher from '../components/LangSwitcher.vue'
import { toast } from '../ui/feedback.js'

const { t } = useI18n()
const router = useRouter()
const apiKey = ref('')
const loading = ref(false)
const showKey = ref(false)

// 保留原有 /verify 登录逻辑：成功后写 localStorage 并进入后台
const handleLogin = async () => {
  if (loading.value) return
  const key = apiKey.value.trim()
  if (!key) {
    toast.warn(t('authui.empty'))
    return
  }

  loading.value = true
  try {
    const res = await axios.post('/verify', {
      apiKey: key
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    })
    if (res.data?.status == 200) {
      localStorage.setItem('apiKey', key)
      router.push({ path: '/', replace: true })
    } else {
      toast.error(t('authui.failed'))
    }
  } catch (err) {
    toast.error(t('authui.failed'))
  } finally {
    loading.value = false
  }
}
</script>
