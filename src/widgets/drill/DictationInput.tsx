import { useEffect, useState } from 'react'
import { Delete, Send } from 'lucide-react'
import * as engine from '@/audio/engine'
import type { DictationQuestion, DrillResponse } from '@/drills/types'
import type { InstrumentId } from '@/entities/types'
import { MelodyStaff } from '@/widgets/notation/MelodyStaff'
import { VirtualKeyboard } from '@/widgets/keyboard/VirtualKeyboard'
import { InstrumentView } from '@/widgets/instrument/InstrumentView'
import { Button } from '@/shared/ui/Button'

export interface DictationInputProps {
  question: DictationQuestion
  instrument: InstrumentId
  disabled?: boolean
  graded?: boolean
  submitted?: number[] | null
  onSubmit: (r: DrillResponse) => void
}

/**
 * Melodic dictation: the given notes are pre-filled; each click on the
 * keyboard appends a note and plays it. Backspace removes; Enter submits
 * once every note is written.
 */
export function DictationInput({ question: q, instrument, disabled, graded, submitted, onSubmit }: DictationInputProps) {
  const given = q.melody.slice(0, q.given).map((n) => n.midi)
  const [entered, setEntered] = useState<number[]>([])
  const total = q.melody.length
  const remaining = total - q.given - entered.length

  useEffect(() => setEntered([]), [q.id])

  const add = async (midi: number) => {
    if (disabled || graded || remaining <= 0) return
    await engine.ensureAudio()
    engine.playNote(midi, 0.5)
    setEntered((e) => [...e, midi])
  }
  const submit = () => {
    if (remaining > 0 || disabled || graded) return
    onSubmit({ kind: 'notes', midis: [...given, ...entered] })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (graded) return
      if (e.key === 'Backspace') {
        e.preventDefault()
        setEntered((x) => x.slice(0, -1))
      } else if (e.key === 'Enter' && remaining === 0) {
        e.preventDefault()
        submit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const shown = graded && submitted ? submitted : [...given, ...entered]
  const marks = graded && submitted
    ? submitted.map((m, i) => (i < q.given ? 'muted' : (m % 12) === (q.melody[i]!.midi % 12) ? 'ok' : 'bad')) as Array<'ok' | 'bad' | 'muted'>
    : shown.map((_, i) => (i < q.given ? 'muted' : undefined))
  // Unwritten notes show as quarter rests so the bar length stays visible.
  const staffNotes = [
    ...shown.map((m) => ({ midi: m, beats: 1 })),
    ...Array.from({ length: Math.max(0, total - shown.length) }, () => ({ midi: null, beats: 1 })),
  ]
  const low = q.tonic - 7
  const high = q.tonic + 19

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border/70 bg-background/50 px-4 py-2">
        <MelodyStaff notes={staffNotes} keyTonic={q.tonic} marks={marks} />
      </div>
      {graded && (
        <div className="rounded-2xl border border-success/30 bg-success/5 px-4 py-2">
          <div className="pt-2 text-xs text-muted-foreground">正确旋律</div>
          <MelodyStaff notes={q.melody.map((n) => ({ midi: n.midi, beats: 1 }))} keyTonic={q.tonic} />
        </div>
      )}
      {!graded && (
        <>
          {instrument === 'guitar' || instrument === 'bass' ? (
            <InstrumentView instrument={instrument} notes={[]} onNote={(m) => void add(m)} />
          ) : null}
          <VirtualKeyboard low={low - (((low % 12) + 12) % 12)} high={high + ((12 - (high % 12)) % 12)} highlighted={entered.slice(-1)} onNote={(m) => void add(m)} labelAll className="max-h-32" disabled={disabled} />
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {remaining > 0 ? `还要写 ${remaining} 个音 · 退格键删除` : '写完了，按 Enter 提交'}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEntered((x) => x.slice(0, -1))} disabled={entered.length === 0}>
                <Delete /> 退格
              </Button>
              <Button size="sm" onClick={submit} disabled={remaining > 0 || disabled}>
                <Send /> 提交
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
