// 用量统计页共用的数字格式化：K/M 单位来自 usage.* 命名空间，随语言切换。
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatCompact } from '../../utils/format.js'

export function useUsageFormat() {
  const { t } = useI18n()
  const units = computed(() => ({
    unitK: t('usage.unit.k'),
    unitM: t('usage.unit.m')
  }))
  const fmt = (value) => formatCompact(value, units.value)
  return { t, units, fmt }
}
