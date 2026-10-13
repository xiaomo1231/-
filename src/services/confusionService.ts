import type { ConfusionPair } from '@/entities/types'
import { moduleInfo } from '@/drills/types'
import { confusionLabel } from '@/drills/confusionLabel'
import { INSTRUMENT_LABEL } from '@/entities/types'
import { confusionExplainer } from '@/infrastructure/ai/prompts'
import { ModuleProgressService } from './moduleProgressService'
import { ProfileService } from './profileService'
import { AIValidationError, getAI } from './ai/aiClient'
import { validateConfusion, type ConfusionExplanation } from './ai/validate'

/** Explanations are cheap to keep for the session; a new count does not need a new one. */
const cache = new Map<string, ConfusionExplanation>()

export const ConfusionService = {
  cached(pair: Pick<ConfusionPair, 'id'>): ConfusionExplanation | undefined {
    return cache.get(pair.id)
  },

  async explain(pair: ConfusionPair): Promise<ConfusionExplanation> {
    const hit = cache.get(pair.id)
    if (hit) return hit
    const ai = await getAI()
    if (!ai) throw new AIValidationError('还没有配置 AI。到“设置 → AI 导师”填入服务商和 API Key 后再试。')
    const [progress, profile] = await Promise.all([ModuleProgressService.ensure(pair.module), ProfileService.ensure()])
    const input: confusionExplainer.ConfusionExplainerInput = {
      moduleName: moduleInfo(pair.module).name,
      expected: confusionLabel(pair.module, pair.expected),
      given: confusionLabel(pair.module, pair.given),
      count: pair.count,
      level: progress.level,
      instrument: INSTRUMENT_LABEL[profile.instrument],
    }
    const { data } = await ai.chatJSON<unknown>([
      { role: 'system', content: confusionExplainer.buildSystemPrompt() },
      { role: 'user', content: confusionExplainer.buildUserPrompt(input) },
    ])
    const result = validateConfusion(data)
    cache.set(pair.id, result)
    return result
  },
}
