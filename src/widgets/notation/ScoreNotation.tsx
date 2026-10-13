import { useMemo, useState } from 'react'
import { Lock } from 'lucide-react'
import type { NotationId } from '@/entities/types'
import { useNotationViews } from '@/features/notation/useNotationViews'
import { useGuitarSetup } from '@/features/instrument/useGuitarSetup'
import { scoreEvents, signatureTonicOf, slotRomanLabel, slotSymbol, type Score } from '@/music/score'
import { cn } from '@/shared/lib/utils'
import { MelodyStaff } from './MelodyStaff'
import { JianpuView } from './JianpuView'
import { TabView } from './TabView'

export interface ScoreNotationProps {
  score: Score
  /** Highlight this melody note (index into score.melody). */
  activeNote?: number | null
  /** Per melody-note marks (index into score.melody). */
  marks?: Record<number, 'ok' | 'bad' | 'warn'>
  /** Chord label style. */
  chordLabels?: 'symbol' | 'roman' | 'both' | 'none'
  showSwitcher?: boolean
  /** Force a view (e.g. assessments stay on staff). */
  forceView?: NotationId
  className?: string
}

const VIEW_LABEL: Record<NotationId, string> = { staff: '五线谱', jianpu: '简谱', tab: '六线谱' }

/**
 * One score, three notations. All views read the same events, so switching
 * never loses anything (acceptance criterion for P3).
 */
export function ScoreNotation({ score, activeNote = null, marks, chordLabels = 'symbol', showSwitcher = true, forceView, className }: ScoreNotationProps) {
  const views = useNotationViews()
  const guitar = useGuitarSetup()
  const [view, setView] = useState<NotationId>(forceView ?? views.defaultView)
  const current = forceView ?? (views.allowed[view] ? view : 'staff')

  const events = useMemo(() => scoreEvents(score), [score])
  const sigTonic = signatureTonicOf(score)
  const chords = useMemo(
    () =>
      chordLabels === 'none'
        ? []
        : score.chords.map((c) => ({
            start: c.start,
            text:
              chordLabels === 'roman'
                ? slotRomanLabel(score, c)
                : chordLabels === 'both'
                  ? `${slotSymbol(score, c)} ${slotRomanLabel(score, c)}`
                  : slotSymbol(score, c),
          })),
    [score, chordLabels],
  )
  // Map melody-note indices to event indices.
  const activeEvent = activeNote === null ? null : events.findIndex((e) => e.source === activeNote)
  const eventMarks = useMemo(() => {
    if (!marks) return undefined
    const out: Record<number, 'ok' | 'bad' | 'warn'> = {}
    events.forEach((e, i) => {
      if (e.source >= 0 && marks[e.source]) out[i] = marks[e.source]!
    })
    return out
  }, [marks, events])

  return (
    <div className={cn('space-y-2', className)}>
      {showSwitcher && !forceView && (
        <div className="flex items-center gap-1" role="tablist" aria-label="记谱方式">
          {(['staff', 'jianpu', 'tab'] as NotationId[]).map((v) => {
            const ok = views.allowed[v]
            return (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={current === v}
                disabled={!ok}
                onClick={() => setView(v)}
                title={ok ? undefined : v === 'tab' && views.allowed.jianpu ? '主乐器是吉他或贝斯时可用' : '阶段 2 解锁（阶段 0–1 先把五线谱学扎实）'}
                className={cn(
                  'focus-ring flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs transition-colors',
                  current === v ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
                  !ok && 'cursor-not-allowed opacity-50 hover:text-muted-foreground',
                )}
              >
                {!ok && <Lock className="h-3 w-3" />}
                {v === 'tab' ? views.tabLabel : VIEW_LABEL[v]}
              </button>
            )
          })}
        </div>
      )}
      {current === 'staff' && (
        <MelodyStaff
          notes={events.map((e) => ({ midi: e.midi, beats: e.beats, ...(e.lyric ? { lyric: e.lyric } : {}) }))}
          keyTonic={sigTonic}
          activeIndex={activeEvent}
          marks={eventMarks ? events.map((_, i) => (eventMarks[i] === 'warn' ? 'muted' : eventMarks[i])) : undefined}
          chords={chords}
        />
      )}
      {current === 'jianpu' && <JianpuView events={events} bars={score.bars} signatureTonic={sigTonic} chords={chords} activeEvent={activeEvent} {...(eventMarks ? { marks: eventMarks } : {})} />}
      {current === 'tab' && <TabView events={events} instrument={views.instrument} chords={chords} activeEvent={activeEvent} tuning={guitar.played} capo={guitar.capo} />}
    </div>
  )
}
