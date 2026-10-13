import { useEffect, useMemo, useRef, useState } from 'react'
import { Lock, Play, Square } from 'lucide-react'
import * as engine from '@/audio/engine'
import { analysisMarks, analyzeScore } from '@/analysis/ruleEngine'
import { PATTERN_LABEL, PATTERNS_BY_KIND, TRACK_LABEL, ensureTracks } from '@/music/arrangement'
import { voiceRoman, type RomanId } from '@/music/keys'
import { pitchClass } from '@/music/pitch'
import {
  addNote,
  applyLyrics,
  noteAt,
  slotRomanLabel,
  slotSymbol,
  type ChordSlot,
  removeNoteAt,
  resizeScore,
  BAR_CHOICES,
  setChord,
  transposeScore,
  type Score,
  type TrackPattern,
} from '@/music/score'
import { spell, spelledName } from '@/music/spelling'
import { ScoreNotation } from '@/widgets/notation/ScoreNotation'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { cn } from '@/shared/lib/utils'
import { PianoRoll } from './PianoRoll'
import { ChordPalette } from './ChordTrack'
import { colourQuality, type ChordColour } from './chordStyle'
import { FUNC_BLOCK, chordFunc } from './chordStyle'
import { AnalysisPanel } from './AnalysisPanel'

export interface StudioFeatures {
  melody: boolean
  chords: boolean
  lyrics: boolean
  keyEditable: boolean
  barsEditable: boolean
  advancedChords: boolean
}

export interface StudioEditorProps {
  value: Score
  onChange: (s: Score) => void
  features: StudioFeatures
  /** Why a track is locked, shown in place of the control. */
  lockedHints?: Partial<Record<'chords' | 'lyrics', string>>
  compact?: boolean
}

const DURATIONS: Array<{ beats: number; label: string }> = [
  { beats: 0.5, label: '♪ 八分' },
  { beats: 1, label: '♩ 四分' },
  { beats: 1.5, label: '♩. 附点' },
  { beats: 2, label: '𝅗𝅥 二分' },
  { beats: 4, label: '𝅝 全' },
]


/** Tonic MIDI for a pitch class, kept in a comfortable melody register. */
const tonicFor = (pc: number) => 55 + ((pc - 7 + 12) % 12)

export function StudioEditor({ value: score, onChange, features, lockedHints, compact }: StudioEditorProps) {
  const [noteBeats, setNoteBeats] = useState(1)
  const [brush, setBrush] = useState<RomanId | 'erase'>(score.mode === 'major' ? 'I' : 'i')
  const [brushBeats, setBrushBeats] = useState<2 | 4>(4)
  const [colour, setColour] = useState<ChordColour>('triad')
  const [bassNote, setBassNote] = useState<0 | 1 | 2>(0)
  const [cursor, setCursor] = useState<number | null>(null)
  const [lyricText, setLyricText] = useState(() => score.melody.map((n) => n.lyric ?? '').join(''))
  const playing = useRef<{ startAt: number; beatSeconds: number; endAt: number } | null>(null)
  const raf = useRef(0)

  const analysis = useMemo(() => analyzeScore(score), [score])
  const warn = useMemo(() => new Set(Object.keys(analysisMarks(analysis)).map(Number)), [analysis])

  useEffect(() => () => {
    cancelAnimationFrame(raf.current)
    engine.stopArrangement()
  }, [])

  const stop = () => {
    cancelAnimationFrame(raf.current)
    engine.stopArrangement()
    playing.current = null
    setCursor(null)
  }

  const play = async () => {
    if (playing.current) {
      stop()
      return
    }
    await engine.ensureAudio()
    // Without the harmony track unlocked only the melody plays.
    const toPlay = features.chords ? score : { ...score, tracks: ensureTracks(score).map((t) => ({ ...t, mute: true, solo: false })) }
    playing.current = await engine.playScore(toPlay)
    const total = score.bars * score.beatsPerBar
    const tick = () => {
      const p = playing.current
      if (!p) return
      const beat = (engine.now() - p.startAt) / p.beatSeconds
      if (beat >= total) {
        stop()
        return
      }
      setCursor(Math.max(0, beat))
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }

  const audition = async (midi: number) => {
    await engine.ensureAudio()
    engine.playNote(midi, 0.4)
  }
  const auditionChord = async (roman: RomanId) => {
    await engine.ensureAudio()
    engine.playChord(voiceRoman(score.keyTonic, roman, score.mode), 0.9)
  }

  const paintSlot = (start: number, beats: number, roman: RomanId): ChordSlot => {
    const quality = colourQuality(colour, roman, score.mode)
    return { start, beats, roman, ...(quality ? { quality } : {}), ...(bassNote ? { bass: bassNote } : {}) }
  }

  const set = (s: Score) => {
    if (playing.current) stop()
    onChange(s)
  }

  const activeNote = cursor === null ? null : score.melody.indexOf(noteAt(score, cursor) as never)
  const low = score.keyTonic - 7
  const high = score.keyTonic + 17

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/80 bg-card px-4 py-3">
        <Button onClick={() => void play()} size="sm">
          {playing.current ? <Square /> : <Play />} {playing.current ? '停止' : '播放'}
        </Button>
        <Field label="调">
          <select
            disabled={!features.keyEditable}
            value={pitchClass(score.keyTonic)}
            onChange={(e) => set(transposeScore(score, tonicFor(Number(e.target.value))))}
            className="rounded-lg border border-input bg-background px-2 py-1 text-sm disabled:opacity-60"
          >
            {Array.from({ length: 12 }, (_, pc) => (
              <option key={pc} value={pc}>
                {spelledName(spell(60 + pc, { preferFlats: [1, 3, 5, 8, 10].includes(pc) }))}
              </option>
            ))}
          </select>
          <select
            disabled={!features.keyEditable}
            value={score.mode}
            onChange={(e) => {
              const mode = e.target.value as Score['mode']
              setBrush(mode === 'major' ? 'I' : 'i')
              // Roman numerals mean different chords in the other mode; start the chord track over.
              set({ ...score, mode, chords: [] })
            }}
            className="rounded-lg border border-input bg-background px-2 py-1 text-sm disabled:opacity-60"
          >
            <option value="major">大调</option>
            <option value="minor">小调</option>
          </select>
        </Field>
        <Field label="速度">
          <input type="range" min={60} max={160} step={2} value={score.bpm} onChange={(e) => set({ ...score, bpm: Number(e.target.value) })} className="w-24 accent-[hsl(var(--amber))]" />
          <span className="num w-14 text-xs">{score.bpm} BPM</span>
        </Field>
        <Field label="小节">
          <select disabled={!features.barsEditable} value={score.bars} onChange={(e) => set(resizeScore(score, Number(e.target.value)))} className="rounded-lg border border-input bg-background px-2 py-1 text-sm disabled:opacity-60">
            {Array.from(new Set([...BAR_CHOICES, score.bars])).sort((a, b) => a - b).map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </Field>
        {features.chords && (
          <>
            {(['keys', 'guitar', 'bass', 'drums'] as const).map((kind) => {
              const tracks = ensureTracks(score)
              const t = tracks.find((x) => x.kind === kind)
              if (!t) return null
              const labels = Object.fromEntries([...PATTERNS_BY_KIND[kind].map((p) => [p, PATTERN_LABEL[p]]), ['off', '关']]) as Record<string, string>
              return (
                <Field key={kind} label={TRACK_LABEL[kind]}>
                  <MiniSelect
                    value={t.mute ? 'off' : t.source === 'manual' ? 'manual' : t.pattern}
                    labels={t.source === 'manual' ? { ...labels, manual: '手动' } : labels}
                    onChange={(v) =>
                      set({
                        ...score,
                        tracks: tracks.map((x) => (x.id === t.id ? (v === 'off' ? { ...x, mute: true } : v === 'manual' ? { ...x, mute: false } : { ...x, mute: false, source: 'auto', pattern: v as TrackPattern }) : x)),
                      })
                    }
                  />
                </Field>
              )
            })}
          </>
        )}
      </div>

      {/* Chord track */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">和声轨</h3>
        {features.chords ? (
          <>
            <ChordPalette
              score={score}
              brush={brush}
              brushBeats={brushBeats}
              advancedUnlocked={features.advancedChords}
              colour={colour}
              bass={bassNote}
              onColour={setColour}
              onBass={setBassNote}
              onBrush={setBrush}
              onBrushBeats={setBrushBeats}
              onAudition={(r) => void auditionChord(r)}
            />
            <p className="text-xs text-muted-foreground">选一个和弦，再点下面卷帘顶部的“和弦”行放进小节里。</p>
          </>
        ) : (
          <Locked text={lockedHints?.chords ?? '学完阶段 1 后解锁和声轨。'} />
        )}
      </section>

      {/* Melody */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">旋律轨{features.melody ? ' · 点空格加音，点音符删除' : ' · 已给定'}</h3>
          {features.melody && (
            <div className="flex overflow-hidden rounded-lg border border-border text-xs">
              {DURATIONS.map((d) => (
                <button key={d.beats} type="button" onClick={() => setNoteBeats(d.beats)} className={cn('px-2.5 py-1', noteBeats === d.beats ? 'bg-amber/25 text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  {d.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <PianoRoll
          score={score}
          low={low}
          high={high}
          cursorBeat={cursor}
          warnNotes={warn}
          editable={features.melody}
          onAdd={(start, midi) => {
            void audition(midi)
            set(applyLyrics(addNote(score, { start, beats: noteBeats, midi }), lyricText))
          }}
          onRemove={(start) => set(applyLyrics(removeNoteAt(score, start), lyricText))}
          onAudition={(m) => void audition(m)}
          {...(features.chords
            ? {
                chordLane: {
                  editable: true,
                  brushBeats,
                  onPaint: (start: number, beats: number) => set(setChord(score, brush === 'erase' ? { start, beats, roman: null } : paintSlot(start, beats, brush))),
                  describe: (slot: ChordSlot) => ({ symbol: slotSymbol(score, slot), roman: slotRomanLabel(score, slot), tone: FUNC_BLOCK[chordFunc(score.mode, slot.roman)] }),
                },
              }
            : {})}
        />
      </section>

      {/* Lyrics */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">歌词 · 一个字对应一个音</h3>
        {features.lyrics ? (
          <div className="flex items-center gap-3">
            <Input
              value={lyricText}
              onChange={(e) => {
                setLyricText(e.target.value)
                set(applyLyrics(score, e.target.value))
              }}
              placeholder="输入歌词，按音符顺序逐字分配"
            />
            <span className="num shrink-0 text-xs text-muted-foreground">
              {Array.from(lyricText.replace(/\s+/g, '')).length}/{score.melody.length}
            </span>
          </div>
        ) : (
          <Locked text={lockedHints?.lyrics ?? '阶段 3「歌词与旋律」解锁。'} />
        )}
      </section>

      <div className={cn('grid gap-5', compact ? 'grid-cols-1' : 'grid-cols-5')}>
        <section className={cn('rounded-2xl border border-border/70 bg-background/50 p-4', !compact && 'col-span-3')}>
          <ScoreNotation score={score} activeNote={activeNote !== null && activeNote >= 0 ? activeNote : null} marks={analysisMarks(analysis)} chordLabels={features.chords ? 'symbol' : 'none'} />
        </section>
        <section className={cn(!compact && 'col-span-2')}>
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">规则检查</h3>
          <AnalysisPanel analysis={analysis} />
        </section>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  )
}

function MiniSelect<T extends string>({ value, labels, onChange }: { value: T; labels: Record<T, string>; onChange: (v: T) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} className="rounded-lg border border-input bg-background px-2 py-1 text-sm">
      {(Object.keys(labels) as T[]).map((k) => (
        <option key={k} value={k}>
          {labels[k]}
        </option>
      ))}
    </select>
  )
}

function Locked({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
      <Lock className="h-4 w-4" /> {text}
    </div>
  )
}
