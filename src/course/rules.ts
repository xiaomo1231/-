import { moduleInfo } from '@/drills/types'
import type { Composition, ModuleProgress } from '@/entities/types'
import { LEVEL_UP_RATIO, LEVEL_WINDOW } from '@/services/masteryMath'
import type { CreationSpec, SongCheck, SongCreationSpec, StageRequirement } from './types'
import { SECTION_LABEL, emptyScore, type Score } from '@/music/score'
import { TRACK_LABEL, ensureTracks } from '@/music/arrangement'
import { analyzeArrangement } from '@/analysis/arrangementRules'
import type { ChordTypeId } from '@/music/chords'

const QUALITY_LABEL: Partial<Record<ChordTypeId, string>> = { maj7: '大七', dom7: '属七', min7: '小七', sus2: 'sus2', sus4: 'sus4', add9: 'add9', power: '强力和弦', m7b5: '半减七', dim7: '减七' }
import { romanLabel } from '@/music/keys'
import { NCT_LABEL, analyzeScore } from '@/analysis/ruleEngine'
import type { ScaleId } from '@/music/scales'

/** A level counts as passed once the next level is unlocked (or the top level is held at ≥85 %). */
export function requirementMet(req: StageRequirement, progress: ModuleProgress | undefined): boolean {
  if (!progress) return false
  if (progress.unlockedLevel > req.level) return true
  const max = moduleInfo(req.module).maxLevel
  if (req.level === max && progress.level === max) {
    const window = progress.recentAtLevel.slice(-LEVEL_WINDOW)
    if (window.length < LEVEL_WINDOW) return false
    return window.reduce((s, r) => s + r.credit, 0) / window.length >= LEVEL_UP_RATIO
  }
  return false
}

export interface CheckResult {
  ok: boolean
  /** One line per unmet requirement. */
  problems: string[]
}

const pc = (m: number) => ((m % 12) + 12) % 12

/** Validate a micro-creation against its lesson's requirements. */
export function checkCreation(spec: CreationSpec, cells: ReadonlyArray<number | null>): CheckResult {
  const c = spec.check
  const problems: string[] = []
  if (spec.kind === 'rhythm') {
    const hits = cells.map((x, i) => (x ? i : -1)).filter((i) => i >= 0)
    if (c.minNotes && hits.length < c.minNotes) problems.push(`至少需要 ${c.minNotes} 个音，现在有 ${hits.length} 个。`)
    if (c.maxNotes && hits.length > c.maxNotes) problems.push(`最多 ${c.maxNotes} 个音。`)
    if (c.needsOffbeat && !hits.some((i) => i % 2 === 1)) problems.push('需要至少一个落在反拍（“&”）上的音。')
    if (c.figure === 'rest') {
      // A whole beat of silence: both eighths of some beat empty.
      let hasRest = false
      for (let b = 0; b < cells.length; b += 2) if (!cells[b] && !cells[b + 1]) hasRest = true
      if (!hasRest) problems.push('需要留出至少一整拍的休止。')
    }
    if (c.figure === 'syncopation') {
      // An off-beat hit whose following on-beat is silent.
      const sync = hits.some((i) => i % 2 === 1 && !cells[i + 1])
      if (!sync) problems.push('需要一次切分：反拍上的音，后面紧接的拍点不发声。')
    }
    return { ok: problems.length === 0, problems }
  }

  const notes = cells.filter((x): x is number => typeof x === 'number' && x >= 0)
  const tonic = spec.tonic ?? 60
  if (c.minNotes && notes.length < c.minNotes) problems.push(`至少需要 ${c.minNotes} 个音，现在有 ${notes.length} 个。`)
  if (c.maxNotes && notes.length > c.maxNotes) problems.push(`最多 ${c.maxNotes} 个音。`)
  if (notes.length > 0) {
    if (c.startDegree !== undefined && pc(notes[0]! - tonic) !== c.startDegree) problems.push('第一个音不符合要求。')
    if (c.endDegree !== undefined && pc(notes[notes.length - 1]! - tonic) !== c.endDegree) problems.push('最后一个音要落在要求的音上（通常是主音）。')
    const leaps = notes.slice(1).map((n, i) => Math.abs(n - notes[i]!))
    if (c.maxLeap !== undefined && leaps.some((l) => l > c.maxLeap!)) problems.push(`有超过 ${c.maxLeap} 个半音的大跳，试着走得更平稳。`)
    if (c.needsLeap !== undefined && !leaps.some((l) => l >= c.needsLeap!)) problems.push(`需要至少一次 ${c.needsLeap} 个半音以上的跳进。`)
    if (c.maxDistinct !== undefined && new Set(notes).size > c.maxDistinct) problems.push(`最多只能用 ${c.maxDistinct} 个不同的音。`)
  }
  return { ok: problems.length === 0, problems }
}

/** Onsets (beats) of a rhythm composition, for notation and playback. */
export function rhythmOnsets(comp: Pick<Composition, 'cells'>): number[] {
  return comp.cells.map((x, i) => (x ? i * 0.5 : -1)).filter((t) => t >= 0)
}

/** Melody composition → staff notes (quarter cells; empty cells are rests). */
export function melodyNotes(comp: Pick<Composition, 'cells'>): Array<{ midi: number | null; beats: number }> {
  return comp.cells.map((x) => ({ midi: typeof x === 'number' && x >= 0 ? x : null, beats: 1 }))
}

const MINOR_LIKE: ScaleId[] = ['natural_minor', 'harmonic_minor', 'melodic_minor', 'pentatonic_minor', 'blues', 'dorian', 'phrygian']

/** Major-key tonic whose signature fits the scale (relative major for minor-type scales). */
export function signatureTonic(tonic: number, scale: ScaleId | undefined): number {
  if (!scale) return tonic
  if (MINOR_LIKE.includes(scale)) return tonic + 3
  if (scale === 'mixolydian') return tonic + 5
  return tonic
}

// ---------------------------------------------------------------------------
// Composer-based creations
// ---------------------------------------------------------------------------

/** The score a lesson's composer starts from. */
export function scoreFromSpec(spec: SongCreationSpec): Score {
  const s = emptyScore({
    keyTonic: spec.tonic,
    mode: spec.mode,
    bpm: spec.bpm,
    bars: spec.bars,
    melody: spec.givenMelody ? [...spec.givenMelody] : [],
    chords: spec.givenChords ? [...spec.givenChords] : [],
    accompaniment: spec.accompaniment ?? { comp: 'block', bass: 'roots', drums: 'pop' },
    ...(spec.givenSections ? { sections: spec.givenSections.map((x) => ({ ...x })) } : {}),
  })
  const patch = spec.trackPatch
  if (!patch) return s
  return { ...s, tracks: ensureTracks(s).map((t) => ({ ...t, ...patch[t.kind] })) }
}

const BORROWED: ReadonlySet<string> = new Set(['bVII', 'bVI', 'bIII', 'iv'])

/** Advanced-harmony and arrangement checks (stages 4–5). */
function checkAdvanced(c: SongCheck, s: Score, problems: string[]) {
  if (c.needsBorrowed) {
    const n = s.mode === 'major' ? s.chords.filter((ch) => BORROWED.has(ch.roman)).length : 0
    if (n < c.needsBorrowed) problems.push(`需要至少 ${c.needsBorrowed} 个借用和弦（♭VII、♭VI、♭III 或 iv），现在有 ${n} 个。`)
  }
  if (c.needsSecondary) {
    const ok = s.chords.some((ch) => ch.roman === 'II' || ch.roman === 'III' || (ch.quality === 'dom7' && !['V', 'v'].includes(ch.roman) && ch.roman !== 'bVII'))
    if (!ok) problems.push('需要一个副属和弦：比如 II（V 的属和弦）、III（vi 的属和弦），或把某个和弦改成属七。')
  }
  if (c.needsQuality) {
    const used = new Set(s.chords.map((ch) => ch.quality).filter(Boolean))
    const miss = c.needsQuality.filter((q) => !used.has(q))
    if (miss.length) problems.push(`需要用到这些和弦色彩：${miss.map((q) => QUALITY_LABEL[q] ?? q).join('、')}。在和弦面板的“色彩”里选。`)
  }
  if (c.needsSlash && !s.chords.some((ch) => ch.bass)) problems.push('需要至少一个斜线和弦（低音在三音或五音上），在和弦面板的“低音”里选。')
  if (c.needsTranspose && !(s.sections ?? []).some((x) => x.transpose)) problems.push('需要一个转调的段落：在“编曲”页给某个段落设置移调。')

  const needsArrange =
    c.minVoices !== undefined || c.needsTracks || c.changedFrom || c.needsWidePan || c.needsSections || c.chorusFuller || c.bassKickLock || c.noRangeWarnings || c.needsManual || c.needsDropout || c.energyRises || c.maxArrangeWarnings !== undefined
  if (!needsArrange) return
  const findings = analyzeArrangement(s)
  const tracks = ensureTracks(s)
  const audible = tracks.filter((t) => !t.mute)
  if (c.minVoices !== undefined) {
    const voices = audible.length + (s.melody.length && !s.lead?.mute ? 1 : 0)
    if (voices < c.minVoices) problems.push(`至少要有 ${c.minVoices} 个声部在演奏（含主旋律），现在是 ${voices} 个。打开被静音的轨道。`)
  }
  if (c.needsTracks) {
    const miss = c.needsTracks.filter((k) => !audible.some((t) => t.kind === k))
    if (miss.length) problems.push(`需要这些乐器在演奏：${miss.map((k) => TRACK_LABEL[k]).join('、')}。取消它们的静音。`)
  }
  if (c.changedFrom) {
    const { kind, pattern, timbre } = c.changedFrom
    const t = audible.find((x) => x.kind === kind)
    if (!t || (t.source === 'auto' && t.pattern === pattern && t.timbre === timbre)) problems.push(`换一种${TRACK_LABEL[kind]}的织体或音色（或转为手动），不要停在默认的弹法上。`)
  }
  if (c.needsWidePan) {
    const pitched = audible.filter((t) => t.kind !== 'drums')
    if (!(pitched.some((t) => t.pan <= -0.4) && pitched.some((t) => t.pan >= 0.4))) problems.push('把两件和声或旋律乐器分别往左、往右摆开（声像至少 40%），给中间的人声和贝斯留出位置。')
  }
  if (c.needsSections) {
    const have = new Set((s.sections ?? []).map((x) => x.label))
    const miss = c.needsSections.filter((l) => !have.has(l))
    if (miss.length) problems.push(`需要这些段落：${miss.map((l) => SECTION_LABEL[l]).join('、')}。在“编曲”页的段落栏里添加。`)
  }
  if (c.chorusFuller && findings.find((f) => f.id === 'contrast')?.severity !== 'good') problems.push('副歌要比主歌更饱满：提高副歌能量，或让主歌更稀疏。')
  if (c.bassKickLock && findings.find((f) => f.id === 'lock')?.severity !== 'good') problems.push('贝斯和底鼓要锁在一起：至少六成的底鼓上同时有贝斯音。')
  if (c.noRangeWarnings && findings.some((f) => f.id.startsWith('range-'))) problems.push('有轨道超出了乐器的常用音域，看看右侧的提示。')
  if (c.needsManual) {
    const ok = tracks.some((t) => t.source === 'manual' && t.notes.length > 0 && !t.mute && (c.needsManual === true || t.kind === c.needsManual))
    if (!ok) problems.push(c.needsManual === true ? '需要至少一轨手写的声部：把一轨转为手动，再改成你自己的。' : `需要把${TRACK_LABEL[c.needsManual]}轨转为手动，写出你自己的声部。`)
  }
  if (c.needsDropout && !(s.sections ?? []).some((x) => x.off && x.off.length)) problems.push('需要至少一个段落让某件乐器休息（段落里的“休息的乐器”），制造进出的层次。')
  if (c.energyRises) {
    const secs = [...(s.sections ?? [])].sort((a, b) => a.start - b.start)
    if (secs.length < 2 || secs[secs.length - 1]!.energy <= secs[0]!.energy) problems.push('能量要从第一段到最后一段逐渐升高。')
  }
  if (c.maxArrangeWarnings !== undefined) {
    const n = findings.filter((f) => f.severity === 'warn').length
    if (n > c.maxArrangeWarnings) problems.push(`编曲检查有 ${n} 条“需要注意”，最多允许 ${c.maxArrangeWarnings} 条。`)
  }
}

const barRhythm = (s: Score, bar: number) =>
  s.melody
    .filter((n) => Math.floor(n.start / s.beatsPerBar + 1e-6) === bar)
    .map((n) => `${(n.start - bar * s.beatsPerBar).toFixed(2)}:${n.beats}`)
    .join(',')

const barNotes = (s: Score, bar: number) =>
  s.melody
    .filter((n) => Math.floor(n.start / s.beatsPerBar + 1e-6) === bar)
    .map((n) => `${(n.start - bar * s.beatsPerBar).toFixed(2)}:${n.beats}:${n.midi}`)
    .join(',')

/** Validate a composer creation. Rule-engine warnings are counted, not just shown. */
export function checkSong(spec: SongCreationSpec, s: Score): CheckResult {
  const c = spec.check
  const problems: string[] = []
  const melody = [...s.melody].sort((a, b) => a.start - b.start)
  const analysis = analyzeScore(s)
  const tonicPc = ((s.keyTonic % 12) + 12) % 12

  if (c.minNotes && melody.length < c.minNotes) problems.push(`旋律至少需要 ${c.minNotes} 个音，现在有 ${melody.length} 个。`)
  if (c.everyBarChord) {
    const missing = Array.from({ length: s.bars }, (_, b) => b).filter((b) => !s.chords.some((ch) => ch.start < (b + 1) * s.beatsPerBar - 1e-6 && ch.start + ch.beats > b * s.beatsPerBar + 1e-6))
    if (missing.length) problems.push(`第 ${missing.map((b) => b + 1).join('、')} 小节还没有和弦。`)
  }
  const chords = [...s.chords].sort((a, b) => a.start - b.start)
  const last = chords[chords.length - 1]
  const prev = chords[chords.length - 2]
  const tonicRoman = s.mode === 'major' ? 'I' : 'i'
  if (c.endsOnTonicChord && last?.roman !== tonicRoman) problems.push(`最后一个和弦要回到主和弦 ${tonicRoman}。`)
  if (c.cadence === 'authentic' && !(last?.roman === tonicRoman && prev && ['V', 'v', 'vii°'].includes(prev.roman))) problems.push('结尾需要正格终止：属和弦 V 进行到主和弦 I。')
  if (c.cadence === 'plagal' && !(last?.roman === tonicRoman && prev && ['IV', 'iv'].includes(prev.roman))) problems.push('结尾需要变格终止：IV 进行到 I。')
  if (c.cadence === 'half' && !(last && ['V', 'v'].includes(last.roman))) problems.push('结尾需要半终止：停在 V 上。')
  if (c.requireRomans) {
    const used = new Set(s.chords.map((ch) => ch.roman))
    const miss = c.requireRomans.filter((r) => !used.has(r))
    if (miss.length) problems.push(`需要用到这些和弦：${miss.map(romanLabel).join('、')}。`)
  }
  const warnings = analysis.findings.filter((f) => f.severity === 'warn').length
  if (c.maxWarnings !== undefined && warnings > c.maxWarnings) problems.push(`规则检查有 ${warnings} 条“需要注意”，最多允许 ${c.maxWarnings} 条。看看右侧的提示。`)
  if (melody.length) {
    const lastNote = melody[melody.length - 1]!
    if (c.endDegree !== undefined && (((lastNote.midi - s.keyTonic) % 12) + 12) % 12 !== c.endDegree) problems.push('旋律最后一个音要落在要求的音上（通常是主音）。')
    if (c.lastNoteBeats && lastNote.beats < c.lastNoteBeats - 1e-6) problems.push(`最后一个音至少要持续 ${c.lastNoteBeats} 拍，让乐句有落脚的地方。`)
    if (c.climaxOnce) {
      const hi = Math.max(...melody.map((n) => n.midi))
      if (melody.filter((n) => n.midi === hi).length !== 1) problems.push('最高音要只出现一次，作为整段的高点。')
    }
    if (c.secondHalfHigher !== undefined) {
      const half = (s.bars * s.beatsPerBar) / 2
      const avg = (ns: typeof melody) => (ns.length ? ns.reduce((t, n) => t + n.midi, 0) / ns.length : 0)
      const a = melody.filter((n) => n.start < half)
      const b = melody.filter((n) => n.start >= half)
      if (!a.length || !b.length || avg(b) - avg(a) < c.secondHalfHigher) problems.push(`后半段（副歌）的平均音高要比前半段高至少 ${c.secondHalfHigher} 个半音。`)
    }
    if (c.needsNct) {
      for (const kind of c.needsNct) {
        if (!analysis.notes.some((n) => n.nct === kind)) problems.push(`需要至少一个${NCT_LABEL[kind]}。`)
      }
    }
    if (c.questionAnswer) {
      const end = (c.questionAnswer.bar + 1) * s.beatsPerBar
      const before = melody.filter((n) => n.start < end).pop()
      if (!before || ((before.midi % 12) + 12) % 12 === tonicPc) problems.push(`第 ${c.questionAnswer.bar + 1} 小节结尾不要落在主音上，让第一句像“问句”。`)
      if (((lastNote.midi % 12) + 12) % 12 !== tonicPc) problems.push('最后一句要回到主音，像“答句”。')
    }
    if (c.needsRest) {
      let gap = false
      for (let i = 1; i < melody.length; i++) if (melody[i]!.start - (melody[i - 1]!.start + melody[i - 1]!.beats) >= 1 - 1e-6) gap = true
      if (!gap) problems.push('旋律中间要留一个至少一拍的休止，给歌手换气。')
    }
    if (c.needsLyrics && melody.some((n) => !n.lyric)) problems.push('每个音都要有一个字的歌词。')
  }
  if (c.motifRepeat) {
    const motif = barRhythm(s, 0)
    if (!motif || !Array.from({ length: s.bars - 1 }, (_, i) => i + 1).some((b) => barRhythm(s, b) === motif)) problems.push('第 1 小节的节奏型要在后面的某一小节再出现一次（动机重复）。')
  }
  if (c.repeatBars) {
    const [x, y] = c.repeatBars
    if (!barNotes(s, x) || barNotes(s, x) !== barNotes(s, y)) problems.push(`第 ${x + 1} 小节和第 ${y + 1} 小节要完全一样（这就是 hook 的重复）。`)
  }
  checkAdvanced(c, s, problems)
  return { ok: problems.length === 0, problems }
}
