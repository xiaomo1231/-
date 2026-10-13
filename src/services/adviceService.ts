import { getDb } from '@/infrastructure/db/database'
import type { AdviceRecord, ModuleProgress, StudentProfile } from '@/entities/types'
import { MODULES, moduleInfo, type ModuleId } from '@/drills/types'
import { confusionLabel } from '@/drills/confusionLabel'
import type { StageInfo } from '@/course/types'
import { planAdvisor } from '@/infrastructure/ai/prompts'
import { localDateKey } from './progressRules'
import { MasteryService } from './masteryService'
import { ModuleProgressService } from './moduleProgressService'
import { ProfileService } from './profileService'
import { CourseService, computeStageStatus } from './courseService'
import { DrillService } from './drillService'
import { ReviewService } from './reviewService'
import { AIValidationError, getAI } from './ai/aiClient'
import { validateAdvice } from './ai/validate'

export const DAILY_MINUTES = 25
const WEEK_MS = 7 * 24 * 3600 * 1000

/** Monday of the week containing `d`, as YYYY-MM-DD. */
export function weekKey(d = new Date()): string {
  const day = (d.getDay() + 6) % 7
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day)
  return localDateKey(monday)
}

export interface ModuleStat {
  id: ModuleId
  name: string
  level: number
  maxLevel: number
  mastery: number
  attempts7d: number
  due: number
  /** Required by the next stage and not met yet. */
  gate: boolean
}

export type Focus = AdviceRecord['focus']

const visible = (id: ModuleId, p: Pick<StudentProfile, 'instrument' | 'secondInstrument'>) =>
  id === 'I1' ? p.instrument !== 'none' : id === 'I2' ? Boolean(p.secondInstrument) : true

/**
 * Pure: the built-in weekly plan. Next-stage gates first, then the weakest
 * modules, and singing / rhythm are never left out for long.
 */
export function localAdvice(stats: ModuleStat[], minutes = DAILY_MINUTES): Focus {
  const out: Focus = []
  const add = (s: ModuleStat, reason: string) => {
    if (out.length < 4 && !out.some((f) => f.module === s.id)) out.push({ module: s.id, minutes: 0, reason })
  }
  for (const s of stats.filter((x) => x.gate).sort((a, b) => a.mastery - b.mastery)) add(s, `进入下一阶段需要${s.name}达标`)
  const practised = stats.filter((s) => s.attempts7d > 0 || s.mastery > 0)
  for (const s of [...practised].sort((a, b) => a.mastery - b.mastery).slice(0, 2)) add(s, `估计掌握度 ${Math.round(s.mastery * 100)}%，是目前最需要加强的部分之一`)
  for (const s of [...stats].sort((a, b) => b.due - a.due)) if (s.due >= 5) add(s, `有 ${s.due} 项到期复习`)
  const sing = stats.find((s) => s.id === 'S1')
  const rhythm = stats.find((s) => s.id === 'R1')
  if (sing && sing.attempts7d === 0) add(sing, '最近 7 天没有练音准，基本功需要持续练')
  if (rhythm && rhythm.attempts7d === 0) add(rhythm, '最近 7 天没有练节奏，基本功需要持续练')
  if (out.length === 0) {
    for (const s of stats.filter((x) => x.id === 'E2' || x.id === 'S1' || x.id === 'R2')) add(s, '基础三件套：听、唱、打')
  }
  const each = Math.max(3, Math.round(minutes / Math.max(1, out.length)))
  return out.map((f) => ({ ...f, minutes: each }))
}

async function moduleStats(profile: StudentProfile): Promise<{ stats: ModuleStat[]; progress: ModuleProgress[]; next: StageInfo | undefined; gates: Array<{ module: string; label: string; met: boolean }> }> {
  const db = getDb()
  const since = Date.now() - WEEK_MS
  const [progress, lessons, due] = await Promise.all([ModuleProgressService.all(), CourseService.progressAll(), ReviewService.due(Date.now(), 1000)])
  const statuses = computeStageStatus(profile, lessons, progress)
  const nextStatus = statuses.find((s) => s.info.stage === profile.unlockedStage + 1)
  const gates = nextStatus?.requirements ?? []
  const mods = MODULES.filter((m) => visible(m.id, profile))
  const stats = await Promise.all(
    mods.map(async (m) => {
      const [avg, attempts] = await Promise.all([
        MasteryService.moduleAverage(m.id),
        db.drillAttempts.where('[module+createdAt]').between([m.id, since], [m.id, Infinity]).count(),
      ])
      const p = progress.find((x) => x.moduleId === m.id)
      return {
        id: m.id,
        name: m.name,
        level: p?.level ?? 1,
        maxLevel: m.maxLevel,
        mastery: avg.mastery,
        attempts7d: attempts,
        due: due.filter((d) => d.module === m.id).length,
        gate: gates.some((g) => g.module === m.id && !g.met),
      }
    }),
  )
  return { stats, progress, next: nextStatus?.info, gates }
}

export const AdviceService = {
  async local(): Promise<{ focus: Focus; stats: ModuleStat[] }> {
    const profile = await ProfileService.ensure()
    const { stats } = await moduleStats(profile)
    return { focus: localAdvice(stats), stats }
  },

  async current(): Promise<AdviceRecord | undefined> {
    return getDb().advice.get(weekKey())
  },

  async generate(): Promise<AdviceRecord> {
    const ai = await getAI()
    if (!ai) throw new AIValidationError('还没有配置 AI。到“设置 → AI 导师”填入服务商和 API Key 后再试。')
    const profile = await ProfileService.ensure()
    const { stats, next, gates } = await moduleStats(profile)
    const confusions = await DrillService.confusions(null, 5)
    const input: planAdvisor.PlanAdvisorInput = {
      stage: profile.unlockedStage,
      nextStage: next ? { title: next.title, requirements: gates.map((g) => ({ module: g.module, label: g.label, met: g.met })) } : null,
      modules: stats.map((s) => ({ id: s.id, name: s.name, level: s.level, maxLevel: s.maxLevel, mastery: s.mastery, attempts7d: s.attempts7d, due: s.due })),
      confusions: confusions.map((c) => ({ module: moduleInfo(c.module).name, expected: confusionLabel(c.module, c.expected), given: confusionLabel(c.module, c.given), count: c.count })),
      minutesPerDay: DAILY_MINUTES,
    }
    const { data, raw } = await ai.chatJSON<unknown>([
      { role: 'system', content: planAdvisor.buildSystemPrompt() },
      { role: 'user', content: planAdvisor.buildUserPrompt(input) },
    ])
    const { focus, tip } = validateAdvice(data, new Set(stats.map((s) => s.id)))
    const record: AdviceRecord = { week: weekKey(), createdAt: Date.now(), focus, tip, promptVersion: planAdvisor.VERSION, model: raw.model }
    await getDb().advice.put(record)
    return record
  },
}
