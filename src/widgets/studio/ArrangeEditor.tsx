import { useEffect, useMemo, useRef, useState } from 'react'
import { Drum, Guitar, Mic2, Piano, Play, Plus, Square, Trash2, Wand2, Waves } from 'lucide-react'
import * as engine from '@/audio/engine'
import { analyzeArrangement } from '@/analysis/arrangementRules'
import { analyzeScore } from '@/analysis/ruleEngine'
import {
  PATTERNS_BY_KIND,
  PATTERN_LABEL,
  STYLES,
  TIMBRES_BY_KIND,
  applyStyle,
  ensureTracks,
  materialize,
  removeSection,
  sectionDensity,
  setSection,
  toggleTrackNote,
  updateTrack,
  withTracks,
} from '@/music/arrangement'
import { SECTION_LABEL, type Score, type Section, type SectionLabel, type Track, type TrackKind, type TrackPattern } from '@/music/score'
import type { InstrumentId } from '@/entities/types'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'
import { AnalysisPanel } from './AnalysisPanel'
import { DrumGrid, TrackRoll } from './TrackRoll'

const KIND_ICON: Record<TrackKind, typeof Piano> = { keys: Piano, guitar: Guitar, bass: Waves, drums: Drum }
const ROLL_RANGE: Record<Exclude<TrackKind, 'drums'>, [number, number]> = { keys: [48, 79], guitar: [40, 72], bass: [28, 55] }
const SECTION_TONE: Record<SectionLabel, string> = {
  intro: 'bg-muted',
  verse: 'bg-cyan-soft',
  pre: 'bg-accent',
  chorus: 'bg-amber-soft',
  bridge: 'bg-secondary',
  outro: 'bg-muted',
}

/** The student's own instrument part is listed first (plan §5: the instrument decides the entry point). */
function orderTracks(tracks: Track[], instrument: InstrumentId): Track[] {
  const first: TrackKind | null = instrument === 'guitar' ? 'guitar' : instrument === 'bass' ? 'bass' : instrument === 'piano' ? 'keys' : null
  return first ? [...tracks.filter((t) => t.kind === first), ...tracks.filter((t) => t.kind !== first)] : tracks
}

export interface ArrangeEditorProps {
  value: Score
  onChange: (s: Score) => void
  instrument: InstrumentId
  compact?: boolean
}

export function ArrangeEditor({ value, onChange, instrument, compact }: ArrangeEditorProps) {
  const score = useMemo(() => withTracks(value), [value])
  const tracks = useMemo(() => orderTracks(ensureTracks(score), instrument), [score, instrument])
  const [selected, setSelected] = useState<string>(tracks[0]?.id ?? 'lead')
  const [noteBeats, setNoteBeats] = useState(1)
  const [cursor, setCursor] = useState<number | null>(null)
  const playing = useRef<{ startAt: number; beatSeconds: number } | null>(null)
  const raf = useRef(0)
  const [draft, setDraft] = useState<Section>({ start: 0, bars: Math.min(4, score.bars), label: 'verse', energy: 2 })

  useEffect(() => () => {
    cancelAnimationFrame(raf.current)
    engine.stopArrangement()
  }, [])

  const findings = useMemo(() => {
    const melody = analyzeScore(score).findings.filter((f) => f.severity !== 'good' || f.id === 'cadence')
    return [...analyzeArrangement(score), ...melody.filter((f) => f.severity === 'warn')]
  }, [score])
  const density = useMemo(() => sectionDensity(score), [score])

  const set = (s: Score) => {
    if (playing.current) stop()
    onChange(s)
  }
  const stop = () => {
    cancelAnimationFrame(raf.current)
    engine.stopArrangement()
    playing.current = null
    setCursor(null)
  }
  const play = async () => {
    if (playing.current) return stop()
    playing.current = await engine.playScore(score)
    const total = score.bars * score.beatsPerBar
    const tick = () => {
      const p = playing.current
      if (!p) return
      const beat = (engine.now() - p.startAt) / p.beatSeconds
      if (beat >= total) return stop()
      setCursor(Math.max(0, beat))
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }

  const track = tracks.find((t) => t.id === selected)
  const lead = score.lead ?? { volume: 0.9, pan: 0, mute: false, solo: false, timbre: 'lead' }

  return (
    <div className="space-y-6">
      {/* Transport + styles */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/80 bg-card px-4 py-3">
        <Button size="sm" onClick={() => void play()}>
          {playing.current ? <Square /> : <Play />} {playing.current ? '停止' : '播放全曲'}
        </Button>
        <span className="text-xs text-muted-foreground">风格模板</span>
        {STYLES.map((st) => (
          <button
            key={st.id}
            type="button"
            onClick={() => set(applyStyle(score, st))}
            title={st.description}
            aria-label={`套用${st.name}风格：${st.description}`}
            className="focus-ring rounded-lg border border-border px-2.5 py-1 text-xs hover:border-amber/60"
          >
            {st.name}
          </button>
        ))}
        <span className="num ml-auto text-xs text-muted-foreground">{score.bpm} BPM · {score.bars} 小节</span>
      </div>

      {/* Sections */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">段落</h3>
        <div className="relative h-10 overflow-hidden rounded-xl border border-border/70 bg-background/50">
          {Array.from({ length: score.bars }, (_, b) => (
            <span key={b} className="absolute top-0 h-full border-l border-border/60 pl-1 font-mono text-[9px] text-muted-foreground" style={{ left: `${(b / score.bars) * 100}%` }}>
              {b + 1}
            </span>
          ))}
          {(score.sections ?? []).map((sec) => (
            <button
              key={sec.start}
              type="button"
              onClick={() => setDraft(sec)}
              className={cn('absolute top-1 flex h-8 items-center justify-between rounded-lg border border-border/80 px-2 text-xs', SECTION_TONE[sec.label])}
              style={{ left: `calc(${(sec.start / score.bars) * 100}% + 2px)`, width: `calc(${(sec.bars / score.bars) * 100}% - 4px)` }}
            >
              <span className="font-medium">{SECTION_LABEL[sec.label]}</span>
              <span className="num text-[10px] text-muted-foreground">
                {'▮'.repeat(sec.energy)}
                {sec.transpose ? ` ${sec.transpose > 0 ? '+' : ''}${sec.transpose}` : ''}
              </span>
            </button>
          ))}
          {cursor !== null && <div className="pointer-events-none absolute top-0 h-full w-0.5 bg-cyan" style={{ left: `${(cursor / (score.bars * score.beatsPerBar)) * 100}%` }} />}
        </div>
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/70 bg-card px-3 py-2 text-xs">
          <Labeled label="类型">
            <select value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value as SectionLabel })} className="rounded-lg border border-input bg-background px-2 py-1">
              {(Object.keys(SECTION_LABEL) as SectionLabel[]).map((l) => (
                <option key={l} value={l}>
                  {SECTION_LABEL[l]}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled label="起始小节">
            <input type="number" min={1} max={score.bars} value={draft.start + 1} onChange={(e) => setDraft({ ...draft, start: Math.max(0, Math.min(score.bars - 1, Number(e.target.value) - 1)) })} className="w-16 rounded-lg border border-input bg-background px-2 py-1" />
          </Labeled>
          <Labeled label="小节数">
            <input type="number" min={1} max={score.bars} value={draft.bars} onChange={(e) => setDraft({ ...draft, bars: Math.max(1, Number(e.target.value)) })} className="w-16 rounded-lg border border-input bg-background px-2 py-1" />
          </Labeled>
          <Labeled label="能量">
            <div className="flex overflow-hidden rounded-lg border border-border">
              {([1, 2, 3] as const).map((e) => (
                <button key={e} type="button" onClick={() => setDraft({ ...draft, energy: e })} className={cn('px-2.5 py-1', draft.energy === e ? 'bg-amber/25' : 'text-muted-foreground')}>
                  {['稀疏', '正常', '饱满'][e - 1]}
                </button>
              ))}
            </div>
          </Labeled>
          <Labeled label="转调">
            <select value={draft.transpose ?? 0} onChange={(e) => setDraft({ ...draft, transpose: Number(e.target.value) || undefined } as Section)} className="rounded-lg border border-input bg-background px-2 py-1">
              {[-2, -1, 0, 1, 2, 3].map((t) => (
                <option key={t} value={t}>
                  {t === 0 ? '不转' : `${t > 0 ? '升' : '降'} ${Math.abs(t)} 个半音`}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled label="这一段不演奏">
            <div className="flex gap-1">
              {(['keys', 'guitar', 'bass', 'drums'] as TrackKind[]).map((k) => {
                const off = draft.off?.includes(k)
                return (
                  <button key={k} type="button" onClick={() => setDraft({ ...draft, off: off ? draft.off!.filter((x) => x !== k) : [...(draft.off ?? []), k] })} className={cn('rounded-lg border px-2 py-1', off ? 'border-destructive/50 bg-destructive/10' : 'border-border')}>
                    {({ keys: '键盘', guitar: '吉他', bass: '贝斯', drums: '鼓' } as const)[k]}
                  </button>
                )
              })}
            </div>
          </Labeled>
          <Button size="sm" variant="outline" onClick={() => set(setSection(score, { ...draft, bars: Math.min(draft.bars, score.bars - draft.start) }))}>
            <Plus /> 设置段落
          </Button>
          {(score.sections ?? []).some((x) => x.start === draft.start) && (
            <Button size="sm" variant="ghost" onClick={() => set(removeSection(score, draft.start))}>
              <Trash2 /> 删除
            </Button>
          )}
        </div>
        {density.length > 1 && <EnergyCurve points={density.map((d) => ({ label: SECTION_LABEL[d.section.label], start: d.section.start, bars: d.section.bars, value: d.density }))} bars={score.bars} />}
      </section>

      {/* Mixer */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">轨道</h3>
        <div className="overflow-hidden rounded-2xl border border-border/80">
          <MixerRow
            icon={Mic2}
            name="主旋律"
            selected={selected === 'lead'}
            onSelect={() => setSelected('lead')}
            mix={lead}
            onMix={(patch) => set({ ...score, lead: { ...lead, ...patch } })}
            timbres={[
              { id: 'lead', label: '合成主音' },
              { id: 'piano', label: '钢琴' },
            ]}
          >
            <span className="text-xs text-muted-foreground">{score.melody.length} 个音 · 在「作曲」里编辑</span>
          </MixerRow>
          {tracks.map((t) => (
            <MixerRow
              key={t.id}
              icon={KIND_ICON[t.kind]}
              name={t.name}
              selected={selected === t.id}
              onSelect={() => setSelected(t.id)}
              mix={t}
              onMix={(patch) => set(updateTrack(score, t.id, patch))}
              timbres={TIMBRES_BY_KIND[t.kind]}
            >
              {t.source === 'auto' ? (
                <div className="flex items-center gap-2">
                  <select value={t.pattern} onChange={(e) => set(updateTrack(score, t.id, { pattern: e.target.value as TrackPattern }))} className="rounded-lg border border-input bg-background px-2 py-1 text-xs">
                    {PATTERNS_BY_KIND[t.kind].map((p) => (
                      <option key={p} value={p}>
                        {PATTERN_LABEL[p]}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={() => { set(updateTrack(score, t.id, materialize(score, t))); setSelected(t.id) }} className="focus-ring flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:border-cyan/40" title="把自动生成的音符变成可以编辑的音符">
                    <Wand2 className="h-3 w-3" /> 转为手动
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-amber">手动 · {t.notes.length} 个音</span>
                  <button type="button" onClick={() => set(updateTrack(score, t.id, { source: 'auto', notes: [] }))} className="focus-ring rounded-lg border border-border px-2 py-1 hover:border-cyan/40">
                    恢复自动
                  </button>
                </div>
              )}
            </MixerRow>
          ))}
        </div>
      </section>

      {/* Track editor */}
      {track && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground">
              编辑：{track.name}
              {track.source === 'auto' ? '（自动生成中，点格子会转为手动）' : ''}
            </h3>
            {track.kind !== 'drums' && (
              <div className="flex overflow-hidden rounded-lg border border-border text-xs">
                {[0.5, 1, 2, 4].map((b) => (
                  <button key={b} type="button" onClick={() => setNoteBeats(b)} className={cn('px-2.5 py-1', noteBeats === b ? 'bg-amber/25' : 'text-muted-foreground')}>
                    {({ 0.5: '八分', 1: '四分', 2: '二分', 4: '全' } as Record<number, string>)[b]}
                  </button>
                ))}
              </div>
            )}
          </div>
          {track.kind === 'drums' ? (
            <DrumGrid
              score={score}
              notes={(track.source === 'auto' ? materialize(score, track) : track).notes}
              cursorBeat={cursor}
              onToggle={(start, midi) => {
                const base = track.source === 'auto' ? updateTrack(score, track.id, materialize(score, track)) : score
                set(toggleTrackNote(base, track.id, { start, beats: 0.25, midi }))
              }}
            />
          ) : (
            <TrackRoll
              score={score}
              notes={(track.source === 'auto' ? materialize(score, track) : track).notes}
              low={ROLL_RANGE[track.kind][0]}
              high={ROLL_RANGE[track.kind][1]}
              cursorBeat={cursor}
              onAudition={async (m) => {
                await engine.ensureAudio()
                engine.playNote(m, 0.4)
              }}
              onToggle={(start, midi) => {
                const base = track.source === 'auto' ? updateTrack(score, track.id, materialize(score, track)) : score
                set(toggleTrackNote(base, track.id, { start, beats: noteBeats, midi }))
              }}
            />
          )}
        </section>
      )}

      <section className={cn(!compact && 'max-w-3xl')}>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">编曲检查</h3>
        <AnalysisPanel analysis={{ findings, notes: [], key: null, cadence: null }} />
      </section>
    </div>
  )
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

interface Mix {
  volume: number
  pan: number
  mute: boolean
  solo: boolean
  timbre: string
}

function MixerRow({
  icon: Icon,
  name,
  selected,
  onSelect,
  mix,
  onMix,
  timbres,
  children,
}: {
  icon: typeof Piano
  name: string
  selected: boolean
  onSelect: () => void
  mix: Mix
  onMix: (patch: Partial<Mix>) => void
  timbres: Array<{ id: string; label: string }>
  children: React.ReactNode
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0', selected ? 'bg-accent/60' : 'bg-card')}>
      <button type="button" onClick={onSelect} className="focus-ring flex w-28 items-center gap-2 rounded-lg text-left text-sm font-medium">
        <Icon className={cn('h-4 w-4', selected ? 'text-amber' : 'text-muted-foreground')} /> {name}
      </button>
      <button type="button" onClick={() => onMix({ mute: !mix.mute })} className={cn('h-7 w-7 rounded-md border text-xs font-semibold', mix.mute ? 'border-destructive/60 bg-destructive/20 text-destructive' : 'border-border text-muted-foreground')} aria-pressed={mix.mute} title="静音">
        M
      </button>
      <button type="button" onClick={() => onMix({ solo: !mix.solo })} className={cn('h-7 w-7 rounded-md border text-xs font-semibold', mix.solo ? 'border-amber bg-amber/25 text-amber' : 'border-border text-muted-foreground')} aria-pressed={mix.solo} title="独奏">
        S
      </button>
      <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
        音量
        <input type="range" min={0} max={1} step={0.05} value={mix.volume} onChange={(e) => onMix({ volume: Number(e.target.value) })} className="w-20 accent-[hsl(var(--amber))]" />
      </label>
      <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
        声像
        <input type="range" min={-1} max={1} step={0.1} value={mix.pan} onChange={(e) => onMix({ pan: Number(e.target.value) })} className="w-16 accent-[hsl(var(--cyan))]" />
      </label>
      {timbres.length > 1 && (
        <select value={mix.timbre} onChange={(e) => onMix({ timbre: e.target.value })} className="rounded-lg border border-input bg-background px-2 py-1 text-xs">
          {timbres.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      )}
      <div className="ml-auto">{children}</div>
    </div>
  )
}

function EnergyCurve({ points, bars }: { points: Array<{ label: string; start: number; bars: number; value: number }>; bars: number }) {
  const max = Math.max(...points.map((p) => p.value), 1)
  const W = 600
  const H = 70
  const xy = points.map((p) => [((p.start + p.bars / 2) / bars) * W, H - 10 - (p.value / max) * (H - 24)] as const)
  return (
    <div className="rounded-xl border border-border/70 bg-background/50 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">能量曲线（每拍音符数）</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-full" role="img" aria-label="能量曲线">
        <polyline points={xy.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" className="stroke-[hsl(var(--amber))]" strokeWidth={2.5} />
        {xy.map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r={4} className="fill-[hsl(var(--amber))]" />
            <text x={x} y={H - 1} textAnchor="middle" className="fill-[hsl(var(--muted-foreground))] text-[10px]">
              {points[i]!.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}
