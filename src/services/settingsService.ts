import { getDb } from '@/infrastructure/db/database'
import { decryptString, encryptString, isEncryptedPayload } from '@/infrastructure/crypto/crypto'
import { getDeviceKey } from '@/infrastructure/crypto/deviceKey'
import { getPreset, type AIProviderId } from '@/infrastructure/ai/presets'
import type { ProviderConfig } from '@/infrastructure/ai/types'
import type { AISettingsRow } from '@/entities/types'

const ID = 'default' as const

export interface AISettingsInput {
  provider: AIProviderId
  baseURL: string
  apiKey: string
  model: string
  temperature?: number
  maxTokens?: number
}

/**
 * AI provider settings. The key is encrypted at rest with the device key and
 * only decrypted into memory when a request is about to be made.
 */
export const SettingsService = {
  async getRow(): Promise<AISettingsRow | undefined> {
    return getDb().aiSettings.get(ID)
  },

  /** Settings for display: the key is replaced by a masked marker. */
  async getMasked(): Promise<(Omit<AISettingsRow, 'apiKey'> & { hasKey: boolean }) | null> {
    const row = await this.getRow()
    if (!row) return null
    const { apiKey, ...rest } = row
    return { ...rest, hasKey: apiKey.length > 0 }
  },

  async save(input: AISettingsInput): Promise<void> {
    const key = await getDeviceKey()
    const existing = await this.getRow()
    // Empty key field keeps the stored key (so users can edit the model only).
    let stored = existing?.apiKey ?? ''
    if (input.apiKey.trim()) stored = await encryptString(key, input.apiKey.trim())
    const preset = getPreset(input.provider)
    const row: AISettingsRow = {
      id: ID,
      provider: input.provider,
      baseURL: input.baseURL.trim() || preset.baseURL,
      apiKey: stored,
      model: input.model.trim() || preset.defaultModel,
      temperature: input.temperature ?? existing?.temperature ?? 0.4,
      maxTokens: input.maxTokens ?? existing?.maxTokens ?? 2048,
      updatedAt: Date.now(),
    }
    await getDb().aiSettings.put(row)
  },

  async clearKey(): Promise<void> {
    const existing = await this.getRow()
    if (!existing) return
    await getDb().aiSettings.put({ ...existing, apiKey: '', updatedAt: Date.now() })
  },

  /** Decrypted provider config, or null when no key is configured. */
  async providerConfig(): Promise<ProviderConfig | null> {
    const row = await this.getRow()
    if (!row || !row.apiKey) return null
    let apiKey = row.apiKey
    if (isEncryptedPayload(apiKey)) {
      const key = await getDeviceKey()
      apiKey = await decryptString(key, apiKey)
    }
    return {
      provider: row.provider,
      baseURL: row.baseURL,
      apiKey,
      model: row.model,
      temperature: row.temperature,
      maxTokens: row.maxTokens,
    }
  },
}
