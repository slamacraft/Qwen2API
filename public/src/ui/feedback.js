import { reactive } from 'vue'

// 轻量 toast + confirm：替代散落各处的 alert()/window.confirm()。
// 用法：toast.success('已保存') / await confirm({ title, message, danger: true })

const TOAST_TTL = 3200

export const toasts = reactive([])

let seq = 0

const push = (type, message, timeout = TOAST_TTL) => {
  const id = ++seq
  toasts.push({ id, type, message })
  if (timeout > 0) setTimeout(() => dismissToast(id), timeout)
  return id
}

export const dismissToast = (id) => {
  const index = toasts.findIndex(item => item.id === id)
  if (index >= 0) toasts.splice(index, 1)
}

export const toast = {
  success: (message) => push('success', message),
  error: (message) => push('error', message, 6000),
  warn: (message) => push('warn', message, 5000),
  info: (message) => push('info', message),
}

export const confirmState = reactive({
  open: false,
  title: '',
  message: '',
  confirmText: '',
  cancelText: '',
  danger: false,
  resolve: null,
})

/**
 * 打开确认弹窗，返回 Promise<boolean>。
 * @param {{title?: string, message?: string, confirmText?: string, cancelText?: string, danger?: boolean}} options
 */
export const confirm = (options = {}) => new Promise((resolve) => {
  Object.assign(confirmState, {
    open: true,
    title: options.title || '',
    message: options.message || '',
    confirmText: options.confirmText || '',
    cancelText: options.cancelText || '',
    danger: options.danger === true,
    resolve,
  })
})

export const resolveConfirm = (value) => {
  const resolve = confirmState.resolve
  confirmState.open = false
  confirmState.resolve = null
  if (resolve) resolve(value)
}

/** 复制到剪贴板，返回是否成功（http 环境下 navigator.clipboard 不可用）。 */
export const copyText = async (text) => {
  const value = String(text ?? '')
  if (!value) return false
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch (error) {
    /* 落到下面的兜底 */
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch (error) {
    return false
  }
}
