// CSV 生成与下载：导出原始整数，方便在表格软件里继续计算。

const BOM = '\uFEFF'

export function escapeCsvCell(value) {
  const text = value === null || value === undefined ? '' : String(value)
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function buildCsv(rows) {
  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')
}

export function downloadCsv(filename, csv) {
  const blob = new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// 账号邮箱可能带 @ 等字符，放进文件名前先做安全化处理。
export function sanitizeFilenamePart(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
}
