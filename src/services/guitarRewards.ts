import { BadgeService } from './badgeService'
import { DailyPlanService } from './dailyPlanService'
import { GuitarService } from './guitarService'
import type { BadgeInfo } from './progressRules'

/**
 * After any guitar-workshop attempt: award guitar badges (and tick a guitar
 * item left over in a plan made before guitar left the daily plan). Returns what the UI should announce.
 */
export async function afterGuitarAttempt(firstPass: boolean): Promise<{ badges: BadgeInfo[]; planCompleted: boolean; bonusXp: number }> {
  const badges: BadgeInfo[] = []
  let planCompleted = false
  let bonusXp = 0
  const plan = await DailyPlanService.today()
  const item = plan.items.find((i) => i.link?.startsWith('/guitar') && !i.completed)
  if (item) {
    const r = await DailyPlanService.completeItem(item.id)
    planCompleted = r.planCompleted
    bonusXp = r.bonusXp
  }
  if (firstPass) {
    const first = await BadgeService.award('guitar-first')
    if (first) badges.push(first)
    const status = await GuitarService.unitStatus()
    for (const [line, id] of [
      ['rhythm', 'guitar-rhythm'],
      ['lead', 'guitar-lead'],
    ] as const) {
      const units = status.filter((s) => s.unit.line === line)
      if (units.length && units.every((s) => s.complete)) {
        const b = await BadgeService.award(id)
        if (b) badges.push(b)
      }
    }
  }
  return { badges, planCompleted, bonusXp }
}
