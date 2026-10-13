import type { InstrumentId } from '@/entities/types'
import { analyzeArrangement } from '@/analysis/arrangementRules'
import { TRACK_LABEL, ensureTracks, withTracks } from '@/music/arrangement'
import { emptyScore, type Score, type Section, type TrackKind } from '@/music/score'

/**
 * Graduation project (plan §4): motif → harmony → structure → arrangement →
 * rule + AI review → revision → export. A 2–3 minute song with 4–6 voices,
 * at least one section contrast and one harmonic colour change, and a part
 * for an instrument the student does not play.
 */

export const GRAD_MIN_SECONDS = 120
export const GRAD_MAX_SECONDS = 180

export type GradStepId = 'motif' | 'harmony' | 'structure' | 'arrangement' | 'review' | 'revise' | 'export'

export interface GradCheck {
  id: string
  label: string
  ok: boolean
  detail?: string
}

export interface GradStep {
  id: GradStepId
  title: string
  hint: string
  checks: GradCheck[]
  done: boolean
}

export interface GradProgress {
  /** At least one critique stored for the project. */
  firstCritiqueAt?: number
  /** Newest saved version. */
  lastVersionAt?: number
  exportedAt?: number
}

const INSTRUMENT_KIND: Record<InstrumentId, TrackKind | null> = { guitar: 'guitar', bass: 'bass', piano: 'keys', none: null }
const BORROWED = new Set(['bVII', 'bVI', 'bIII', 'iv'])

const barRhythm = (s: Score, bar: number) =>
  s.melody
    .filter((n) => Math.floor(n.start / s.beatsPerBar + 1e-6) === bar)
    .map((n) => `${(n.start - bar * s.beatsPerBar).toFixed(2)}:${n.beats}`)
    .join(',')

export function seconds(s: Pick<Score, 'bars' | 'beatsPerBar' | 'bpm'>): number {
  return (s.bars * s.beatsPerBar * 60) / s.bpm
}

/** Pure: every check of the graduation project. */
export function graduationSteps(s: Score, instrument: InstrumentId, progress: GradProgress): GradStep[] {
  const bpb = s.beatsPerBar
  const melodyBars = new Set(s.melody.map((n) => Math.floor(n.start / bpb + 1e-6)))
  // Motif: some bar's rhythm (with at least three notes) comes back later.
  let motifBar: number | null = null
  for (let b = 0; b < s.bars && motifBar === null; b++) {
    const r = barRhythm(s, b)
    if (r.split(',').length < 3) continue
    for (let c = b + 1; c < s.bars; c++) if (barRhythm(s, c) === r) motifBar = b
  }
  const emptyBars = Array.from({ length: s.bars }, (_, b) => b).filter((b) => !s.chords.some((c) => c.start < (b + 1) * bpb - 1e-6 && c.start + c.beats > b * bpb + 1e-6))
  const colour =
    s.chords.some((c) => (s.mode === 'major' && BORROWED.has(c.roman)) || c.roman === 'II' || c.roman === 'III' || c.quality || c.bass) || (s.sections ?? []).some((x) => x.transpose)
  const secs = s.sections ?? []
  const labels = new Set(secs.map((x) => x.label))
  const len = seconds(s)
  const tracks = ensureTracks(s)
  const audible = tracks.filter((t) => !t.mute)
  const voices = audible.length + (s.melody.length && !s.lead?.mute ? 1 : 0)
  const findings = analyzeArrangement(s)
  const contrast = findings.find((f) => f.id === 'contrast')?.severity === 'good'
  const ranges = !findings.some((f) => f.id.startsWith('range-'))
  const own = INSTRUMENT_KIND[instrument]
  const otherManual = audible.some((t) => t.source === 'manual' && t.notes.length > 0 && t.kind !== own)
  const minutes = (x: number) => `${Math.floor(x / 60)} 分 ${Math.round(x % 60)} 秒`

  const steps: Array<Omit<GradStep, 'done'>> = [
    {
      id: 'motif',
      title: '动机',
      hint: '先写一个一小节的动机（至少 3 个音），让它的节奏在后面再出现。',
      checks: [
        { id: 'melody', label: '旋律覆盖至少一半的小节', ok: melodyBars.size >= Math.ceil(s.bars / 2), detail: `现在 ${melodyBars.size}/${s.bars} 小节有旋律` },
        { id: 'motif', label: '有一个动机的节奏在后面重复出现', ok: motifBar !== null, ...(motifBar !== null ? { detail: `第 ${motifBar + 1} 小节的节奏又出现了` } : {}) },
      ],
    },
    {
      id: 'harmony',
      title: '和声',
      hint: '每小节都配上和弦，并至少用一次和声色彩：借用和弦、副属和弦、七和弦 / 挂留 / 加九、斜线和弦或转调。',
      checks: [
        { id: 'every-bar', label: '每小节都有和弦', ok: emptyBars.length === 0, ...(emptyBars.length ? { detail: `还有 ${emptyBars.length} 个小节没有和弦` } : {}) },
        { id: 'colour', label: '至少一次和声色彩变化', ok: colour },
      ],
    },
    {
      id: 'structure',
      title: '结构',
      hint: `用段落标出主歌和副歌，整首长度在 ${GRAD_MIN_SECONDS / 60}–${GRAD_MAX_SECONDS / 60} 分钟（改速度或小节数）。`,
      checks: [
        { id: 'sections', label: '有主歌和副歌段落', ok: labels.has('verse') && labels.has('chorus') },
        { id: 'length', label: '长度 2–3 分钟', ok: len >= GRAD_MIN_SECONDS && len <= GRAD_MAX_SECONDS, detail: `现在约 ${minutes(len)}` },
      ],
    },
    {
      id: 'arrangement',
      title: '编曲',
      hint: own ? `4–6 个声部，副歌比主歌饱满，并且亲手写一轨你不弹的乐器（不是${TRACK_LABEL[own]}）。` : '4–6 个声部，副歌比主歌饱满，并且至少亲手写一轨。',
      checks: [
        { id: 'voices', label: '4–6 个声部在演奏（含主旋律）', ok: voices >= 4 && voices <= 6, detail: `现在 ${voices} 个` },
        { id: 'contrast', label: '副歌比主歌饱满', ok: contrast },
        { id: 'other-part', label: own ? `手写了一轨你不弹的乐器` : '手写了至少一轨', ok: otherManual },
        { id: 'ranges', label: '所有声部都在常用音域里', ok: ranges },
      ],
    },
    {
      id: 'review',
      title: '点评',
      hint: '在“点评”页记录一次点评：规则检查一定有，配置了 AI 还可以请 AI 点评。',
      checks: [{ id: 'critique', label: '至少记录了一次点评', ok: Boolean(progress.firstCritiqueAt) }],
    },
    {
      id: 'revise',
      title: '修改',
      hint: '根据点评改一处或几处，然后保存。',
      checks: [{ id: 'revised', label: '点评之后保存过修改', ok: Boolean(progress.firstCritiqueAt && progress.lastVersionAt && progress.lastVersionAt > progress.firstCritiqueAt) }],
    },
    {
      id: 'export',
      title: '导出',
      hint: '在“导出”页导出 MIDI、MusicXML 或 WAV 中的任意一种。',
      checks: [{ id: 'exported', label: '导出过作品', ok: Boolean(progress.exportedAt) }],
    },
  ]
  return steps.map((st) => ({ ...st, done: st.checks.every((c) => c.ok) }))
}

export function graduationComplete(steps: GradStep[]): boolean {
  return steps.every((s) => s.done)
}

/** Suggested skeleton: 56 bars at 100 BPM ≈ 2 min 14 s. Sections only, no notes. */
export const GRAD_SKELETON: Section[] = [
  { start: 0, bars: 4, label: 'intro', energy: 1 },
  { start: 4, bars: 8, label: 'verse', energy: 1 },
  { start: 12, bars: 4, label: 'pre', energy: 2 },
  { start: 16, bars: 8, label: 'chorus', energy: 3 },
  { start: 24, bars: 8, label: 'verse', energy: 2 },
  { start: 32, bars: 8, label: 'chorus', energy: 3 },
  { start: 40, bars: 8, label: 'bridge', energy: 2 },
  { start: 48, bars: 8, label: 'chorus', energy: 3 },
]

export function graduationStarter(): Score {
  return withTracks(emptyScore({ bars: 56, bpm: 100, sections: GRAD_SKELETON.map((x) => ({ ...x })), accompaniment: { comp: 'block', bass: 'roots', drums: 'pop' } }))
}
