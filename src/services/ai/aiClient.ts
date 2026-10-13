import { AIService } from '@/services/aiService'
import { SettingsService } from '@/services/settingsService'
import { isAIError } from '@/infrastructure/ai/errors'

/**
 * The configured AI, or null when the student has not set one up. Everything
 * in the site works without it; AI features show what they would add and a
 * link to the settings page instead.
 */
export async function getAI(): Promise<AIService | null> {
  const config = await SettingsService.providerConfig()
  return config ? new AIService({ config }) : null
}

export async function aiConfigured(): Promise<boolean> {
  const row = await SettingsService.getRow()
  return Boolean(row?.apiKey)
}

/** A validated AI result failed local checks: nothing is stored. */
export class AIValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AIValidationError'
  }
}

/** An actionable message for any AI failure (never just "出错了"). */
export function aiErrorMessage(err: unknown): string {
  if (err instanceof AIValidationError) return err.message
  if (isAIError(err)) {
    switch (err.code) {
      case 'MISSING_API_KEY':
        return '还没有配置 AI。到“设置 → AI 导师”填入服务商和 API Key 后再试。'
      case 'MISSING_BASE_URL':
        return 'AI 设置缺少 API 地址。到“设置 → AI 导师”补上 Base URL。'
      case 'MISSING_MODEL':
        return 'AI 设置缺少模型名称。到“设置 → AI 导师”填写模型。'
      case 'AUTH_FAILED':
        return 'API Key 无效或没有权限。到“设置 → AI 导师”检查 Key 是否复制完整、是否属于所选服务商。'
      case 'RATE_LIMITED':
        return 'AI 服务商限流了，请等半分钟再试。'
      case 'QUOTA_EXCEEDED':
        return 'AI 服务商账户余额或额度不足。请到服务商的控制台充值或换一个 Key。'
      case 'CONTEXT_TOO_LONG':
        return '这次发送的内容太长了。作品太长时可以先只请 AI 点评一部分小节。'
      case 'OUTPUT_LIMIT':
      case 'OUTPUT_TRUNCATED':
        return 'AI 的回复被截断了。到“设置 → AI 导师”把“最大输出 Token”调大一些（例如 4096）再试。'
      case 'TIMEOUT':
        return 'AI 响应超时。检查网络后重试，或换一个更快的模型。'
      case 'PROVIDER_UNAVAILABLE':
        return 'AI 服务商暂时不可用，请稍后再试。'
      case 'INVALID_JSON':
      case 'INVALID_RESPONSE':
        return 'AI 返回的内容格式不对，没有保存。可以再试一次；如果总是这样，换一个更强的模型。'
      case 'ABORTED':
        return '已取消。'
      default:
        return `AI 请求失败：${err.message}`
    }
  }
  if (err instanceof TypeError && /fetch|network/i.test(err.message)) return '连不上 AI 服务商。检查网络，或确认 Base URL 是否正确。'
  return `AI 请求失败：${err instanceof Error ? err.message : String(err)}`
}
