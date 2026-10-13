import { uuid } from '@/infrastructure/crypto/crypto'
import { getDb } from '@/infrastructure/db/database'
import type { CritiqueRecord } from '@/entities/types'
import { analyzeScore } from '@/analysis/ruleEngine'
import { analyzeArrangement } from '@/analysis/arrangementRules'
import { PATTERN_LABEL, TIMBRES_BY_KIND, TRACK_LABEL, ensureTracks } from '@/music/arrangement'
import { SECTION_LABEL, slotRomanLabel, slotSymbol, type Score } from '@/music/score'
import { spell, spelledName } from '@/music/spelling'
import { compositionReviewer } from '@/infrastructure/ai/prompts'
import { AIValidationError, getAI } from './ai/aiClient'
import { validateReview } from './ai/validate'
import { CompositionService } from './courseService'

/** Seconds of music in a score. */
export function scoreSeconds(s: Pick<Score, 'bars' | 'beatsPerBar' | 'bpm'>): number {
  return Math.round((s.bars * s.beatsPerBar * 60) / s.bpm)
}

/** Rule-engine and arrangement findings, merged (warnings first). */
export function ruleFindings(score: Score): CritiqueRecord['rules'] {
  const melody = analyzeScore(score).findings
  const arrangement = score.tracks || score.sections?.length ? analyzeArrangement(score) : []
  const order = { warn: 0, info: 1, good: 2 }
  return [...melody, ...arrangement]
    .map((f) => ({ severity: f.severity, message: f.message, ...(f.bar !== undefined ? { bar: f.bar + 1 } : {}) }))
    .sort((a, b) => order[a.severity] - order[b.severity])
}

const DUR: Record<string, string> = { '4': '全', '3': '附点二分', '2': '二分', '1.5': '附点四分', '1': '四分', '0.75': '附点八分', '0.5': '八分', '0.25': '十六分' }

/**
 * Pure: a compact symbolic description of a work for the reviewer. Only
 * symbols leave the browser: notes, chords, sections, track settings.
 * Title and lyrics are sent separately as untrusted text.
 */
export function summarizeScore(s: Score): string {
  const lines: string[] = []
  const keyName = spelledName(spell(s.keyTonic, { keyTonic: s.mode === 'minor' ? s.keyTonic + 3 : s.keyTonic }))
  lines.push(`调：${keyName} ${s.mode === 'major' ? '大调' : '小调'}；速度 ${s.bpm} BPM；${s.beatsPerBar}/4 拍；${s.bars} 小节（约 ${scoreSeconds(s)} 秒）`)
  const secs = [...(s.sections ?? [])].sort((a, b) => a.start - b.start)
  lines.push(
    secs.length
      ? `段落：${secs
          .map((x) => `${x.start + 1}–${x.start + x.bars} 小节 ${SECTION_LABEL[x.label]}（能量 ${x.energy}${x.transpose ? `，移调 ${x.transpose > 0 ? '+' : ''}${x.transpose}` : ''}${x.off?.length ? `，${x.off.map((k) => TRACK_LABEL[k]).join('、')}休息` : ''}）`)
          .join('；')}`
      : '段落：未标记',
  )
  lines.push('每小节和弦与旋律（旋律写作 音名八度·时值）：')
  for (let b = 0; b < s.bars; b++) {
    const from = b * s.beatsPerBar
    const to = from + s.beatsPerBar
    const chords = s.chords
      .filter((c) => c.start < to - 1e-6 && c.start >= from - 1e-6)
      .map((c) => `${slotRomanLabel(s, c)}(${slotSymbol(s, c)})`)
      .join(' ')
    const notes = s.melody
      .filter((n) => n.start >= from - 1e-6 && n.start < to - 1e-6)
      .sort((x, y) => x.start - y.start)
      .map((n) => `${spelledName(spell(n.midi, { keyTonic: s.keyTonic }))}${Math.floor(n.midi / 12) - 1}·${DUR[String(n.beats)] ?? `${n.beats}拍`}`)
      .join(' ')
    lines.push(`${b + 1}｜和弦 ${chords || '—'}｜旋律 ${notes || '休止'}`)
  }
  const tracks = ensureTracks(s)
  lines.push(
    `轨道：主旋律${s.lead?.mute ? '（静音）' : ''}；${tracks
      .map((t) => {
        if (t.mute) return `${t.name}（静音）`
        const timbre = TIMBRES_BY_KIND[t.kind].find((x) => x.id === t.timbre)?.label ?? t.timbre
        const how = t.source === 'manual' ? `手写 ${t.notes.length} 个音` : `自动·${PATTERN_LABEL[t.pattern]}`
        return `${t.name}（${how}，${timbre}，音量 ${Math.round(t.volume * 100)}%，声像 ${t.pan === 0 ? '中' : t.pan < 0 ? `左 ${Math.round(-t.pan * 100)}` : `右 ${Math.round(t.pan * 100)}`}）`
      })
      .join('；')}`,
  )
  return lines.join('\n')
}

export const CritiqueService = {
  async list(compositionId: string): Promise<CritiqueRecord[]> {
    const rows = await getDb().critiques.where('compositionId').equals(compositionId).toArray()
    return rows.sort((a, b) => b.createdAt - a.createdAt)
  },

  /**
   * Record a critique of the saved work. Rule-engine results are always
   * included; with `ai`, the AI review is added after local validation.
   * Nothing is stored if the AI part fails.
   */
  async record(compositionId: string, opts: { ai: boolean }): Promise<CritiqueRecord & { dropped?: number }> {
    const comp = await CompositionService.get(compositionId)
    if (!comp?.score) throw new AIValidationError('先保存作品，再请求点评。')
    const score = comp.score
    const rules = ruleFindings(score)
    const record: CritiqueRecord = { id: uuid(), compositionId, createdAt: Date.now(), bars: score.bars, rules }
    let dropped = 0
    if (opts.ai) {
      const ai = await getAI()
      if (!ai) throw new AIValidationError('还没有配置 AI。到“设置 → AI 导师”填入服务商和 API Key 后再试。')
      const input: compositionReviewer.CompositionReviewerInput = {
        summary: summarizeScore(score),
        rules: rules.filter((r) => r.severity !== 'good').map((r) => `${r.bar ? `第 ${r.bar} 小节：` : ''}${r.message}`),
        title: comp.title,
        lyrics: score.melody.map((n) => n.lyric ?? '').join('').trim(),
        bars: score.bars,
        stage: comp.stage,
      }
      const { data, raw } = await ai.chatJSON<unknown>([
        { role: 'system', content: compositionReviewer.buildSystemPrompt() },
        { role: 'user', content: compositionReviewer.buildUserPrompt(input) },
      ])
      const v = validateReview(data, score.bars)
      record.ai = v.review
      record.promptVersion = compositionReviewer.VERSION
      record.model = raw.model
      dropped = v.dropped
    }
    await getDb().critiques.put(record)
    return { ...record, dropped }
  },
}
