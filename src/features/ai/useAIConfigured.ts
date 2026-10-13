import { useEffect, useState } from 'react'
import { aiConfigured } from '@/services/ai/aiClient'

/** Whether the student has an AI key configured (null while loading). */
export function useAIConfigured(): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    void aiConfigured().then((v) => alive && setOk(v))
    return () => {
      alive = false
    }
  }, [])
  return ok
}
