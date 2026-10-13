/** `10月7日` style date for compact labels. */
export function formatDateShort(ms: number): string {
  const d = new Date(ms)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** e.g. 10/8 21:30 */
export function formatDateTime(ms: number): string {
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
