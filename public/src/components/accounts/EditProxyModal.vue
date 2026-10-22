<template>
  <!-- 修改单个账号的专属代理；留空 = 清除，回退到全局 PROXY_URL -->
  <Modal :open="open" :title="t('accounts.editProxyTitle')" size="sm" @close="requestClose">
    <div class="space-y-3">
      <p class="text-xs text-ink-mute">{{ t('accounts.editProxyHint') }}</p>
      <div>
        <label class="label">{{ t('accounts.emailLabel') }}</label>
        <div class="mono truncate rounded-control border border-line bg-canvas px-3 py-2 text-ink-soft" :title="email">
          {{ email || '—' }}
        </div>
      </div>
      <div>
        <label class="label" for="proxy-input">{{ t('accounts.proxyLabel') }}</label>
        <input
          id="proxy-input"
          v-model="proxyValue"
          type="text"
          class="input"
          :class="proxyValid ? '' : 'border-danger-200'"
          :disabled="saving"
          :placeholder="t('accounts.proxyPlaceholder')"
        />
        <p v-if="!proxyValid" class="mt-1 text-xs text-danger-600">{{ t('accounts.proxyInvalid') }}</p>
      </div>
    </div>

    <template #footer>
      <button type="button" class="btn-default" :disabled="saving" @click="clearProxy">
        {{ t('accounts.clearProxy') }}
      </button>
      <button type="button" class="btn-default" :disabled="saving" @click="requestClose">
        {{ t('common.cancel') }}
      </button>
      <button type="button" class="btn-primary" :disabled="saving || !proxyValid" @click="save">
        {{ saving ? t('accounts.saving') : t('common.save') }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Modal from '../ui/Modal.vue'
import { toast } from '../../ui/feedback.js'
import { getAuthHeaders, isValidProxy } from './shared.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  email: { type: String, default: '' },
  proxy: { type: String, default: '' }
})

const emit = defineEmits(['close', 'saved'])

const { t } = useI18n()

const proxyValue = ref('')
const saving = ref(false)

// 每次打开都以列表里的最新值为准，避免上一次编辑残留
watch(() => props.open, (open) => {
  if (open) proxyValue.value = props.proxy || ''
}, { immediate: true })

const proxyValid = computed(() => isValidProxy(proxyValue.value))

const errorText = (error) => error?.response?.data?.error || error?.message || ''

const requestClose = () => {
  if (saving.value) return
  emit('close')
}

const clearProxy = () => {
  proxyValue.value = ''
}

const save = async () => {
  if (saving.value || !proxyValid.value) return
  saving.value = true
  try {
    await axios.post('/api/updateAccountProxy', {
      email: props.email,
      proxy: proxyValue.value.trim() || null
    }, {
      headers: getAuthHeaders()
    })
    toast.success(t('accounts.toastProxySuccess'))
    emit('saved')
    emit('close')
  } catch (error) {
    toast.error(t('accounts.toastProxyFailed', { error: errorText(error) }))
  } finally {
    saving.value = false
  }
}
</script>
