/** Save bytes or text as a file in the browser (no upload). */
export function downloadFile(name: string, data: Uint8Array | string, type: string): void {
  const blob = new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** File-system-safe version of a title. */
export function safeFileName(title: string): string {
  return (title.trim() || 'groovelab').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60)
}
