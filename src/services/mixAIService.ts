/**
 * Optional AI review of a 跟唱 mix (0.21.0): local measurements and the
 * current settings go to the student's own AI provider; the answer is
 * validated before it is shown. It only gives advice — it never changes the mix.
 */
import { mixReviewer } from '@/infrastructure/ai/prompts'
import { AIValidationError, getAI } from './ai/aiClient'
import { cleanText } from './ai/validate'
import type { MixSettings } from '@/songs/singTypes'
import type { VoiceMetrics } from '@/audio/fx/mixAdvisor'

export interface MixReview {
  summary: string
  strengths: string[]
  suggestions: Array<{ module: string; text: string }>
  nextStep: string
}

const r1 = (x: number) => Math.round(x * 10) / 10

/** One line per active module, for the prompt. */
export function describeMix(m: MixSettings): string[] {
  const v = m.vocal
  const out: string[] = [`人声音量 ${r1(v.gainDb)} dB，声像 ${Math.round(v.pan * 100)}%；伴奏音量 ${r1(m.backing.gainDb)} dB`]
  out.push(`效果顺序：${v.order.join(' → ')}`)
  if (v.gate.on) out.push(`噪声门：阈值 ${v.gate.thresholdDb} dB，压低 ${v.gate.rangeDb} dB`)
  if (v.lowCut.on) out.push(`低切：${Math.round(v.lowCut.freq)} Hz`)
  if (v.eq.on) out.push(`EQ：${v.eq.bands.map((b) => `${b.type} ${Math.round(b.freq)} Hz ${r1(b.gainDb)} dB Q${r1(b.q)}`).join('；')}`)
  if (v.dynEq.on) out.push(`动态 EQ：${Math.round(v.dynEq.freq)} Hz，阈值 ${v.dynEq.thresholdDb} dB，最多 −${v.dynEq.maxCutDb} dB`)
  if (v.comp.on) out.push(`压缩：阈值 ${v.comp.thresholdDb} dB，${v.comp.ratio}:1，启动 ${v.comp.attackMs} ms，释放 ${v.comp.releaseMs} ms，补偿 ${v.comp.makeupDb} dB`)
  if (v.comp2.on) out.push(`第二级压缩：阈值 ${v.comp2.thresholdDb} dB，${v.comp2.ratio}:1`)
  if (v.parallel.on) out.push(`并行压缩：比例 ${Math.round(v.parallel.blend * 100)}%`)
  if (v.deEss.on) out.push(`去齿音：${Math.round(v.deEss.freq)} Hz，阈值 ${v.deEss.thresholdDb} dB，最多 −${v.deEss.amountDb} dB`)
  if (v.saturation.on) out.push(`饱和：${v.saturation.type}，驱动 ${Math.round(v.saturation.drive * 100)}%，干湿 ${Math.round(v.saturation.mix * 100)}%`)
  if (v.mod.on) out.push(`调制：${v.mod.type}，干湿 ${Math.round(v.mod.mix * 100)}%`)
  if (v.reverb.on) out.push(`混响：${v.reverb.type}，${v.reverb.decay} s，预延迟 ${v.reverb.preDelayMs} ms，比例 ${Math.round(v.reverb.mix * 100)}%`)
  if (v.delay.on) out.push(`延迟：${v.delay.sync ? v.delay.division : `${v.delay.timeMs} ms`}，回授 ${Math.round(v.delay.feedback * 100)}%，比例 ${Math.round(v.delay.mix * 100)}%${v.delay.pingPong ? '，乒乓' : ''}`)
  if (v.autoLevel.on) out.push(`逐句音量平衡：力度 ${Math.round(v.autoLevel.strength * 100)}%`)
  if (v.tune.on) out.push(`音高修正：力度 ${Math.round(v.tune.amount * 100)}%，速度 ${v.tune.speedMs} ms`)
  if (m.backing.duck.on) out.push(`伴奏让位：${m.backing.duck.amountDb} dB`)
  if (m.backing.pocket.on) out.push(`伴奏中频凹陷：${Math.round(m.backing.pocket.freq)} Hz −${m.backing.pocket.amountDb} dB`)
  out.push(`母线：${m.master.limiter ? `限幅器开（上限 ${m.master.ceilingDb} dB）` : '限幅器关'}，总音量 ${r1(m.master.gainDb)} dB${m.master.targetLufs !== null ? `，目标响度 ${m.master.targetLufs} LUFS` : ''}${m.master.multiband.on ? '，多段压缩开' : ''}${m.master.width.on ? `，宽度 ${m.master.width.amount}` : ''}`)
  return out
}

export function validateMixReview(raw: unknown): MixReview {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  const summary = cleanText(o?.summary, 220)
  const nextStep = cleanText(o?.nextStep, 160)
  if (!summary || !nextStep) throw new AIValidationError('AI 的点评格式不完整，没有显示。可以再试一次。')
  const modules = new Set<string>(mixReviewer.MIX_MODULES)
  const strengths = (Array.isArray(o?.strengths) ? o.strengths : []).map((x) => cleanText(x, 120)).filter((x): x is string => !!x).slice(0, 3)
  const suggestions = (Array.isArray(o?.suggestions) ? o.suggestions : [])
    .map((x) => {
      const s = x && typeof x === 'object' ? (x as Record<string, unknown>) : {}
      const text = cleanText(s.text, 200)
      const module = typeof s.module === 'string' && modules.has(s.module) ? s.module : 'master'
      return text ? { module, text } : null
    })
    .filter((x): x is { module: string; text: string } => !!x)
    .slice(0, 4)
  return { summary, strengths, suggestions, nextStep }
}

export const MixAIService = {
  async review(metrics: VoiceMetrics, mix: MixSettings, shown: string[]): Promise<{ review: MixReview; model: string }> {
    const ai = await getAI()
    if (!ai) throw new AIValidationError('还没有配置 AI。到“设置 → AI 导师”填入服务商和 API Key 后再试。')
    const input = {
      metrics: {
        voiceDb: metrics.voiceDb,
        backingDb: metrics.backingDb,
        bandShares: { '120Hz以下': metrics.bands.sub, '120–500Hz': metrics.bands.lowMid, '500–2k': metrics.bands.mid, '2–5k': metrics.bands.presence, '5–10k': metrics.bands.sibilance, '10k以上': metrics.bands.air },
        dynamicRangeDb: metrics.dynamicRangeDb,
        noiseFloorDb: metrics.noiseFloorDb,
        clipped: metrics.clipped,
        masking: metrics.masking,
      },
      settings: describeMix(mix),
      shownSuggestions: shown,
    }
    const { data, raw } = await ai.chatJSON<unknown>([
      { role: 'system', content: mixReviewer.buildSystemPrompt() },
      { role: 'user', content: mixReviewer.buildUserPrompt(input) },
    ])
    return { review: validateMixReview(data), model: raw.model }
  },
}
