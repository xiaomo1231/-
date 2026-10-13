/** Custom label per MIDI note (keyboard keys show these instead of plain names). */
export function markLabelMap(notes: readonly number[], labels?: readonly string[]): Record<number, string> {
  const out: Record<number, string> = {}
  if (!labels) return out
  notes.forEach((m, i) => {
    const text = labels[i]
    if (text) out[m] = text
  })
  return out
}
