import { useCallback, useEffect, useState } from 'react'
import type { MixCourseVoice } from '@/entities/types'
import { MixCourseService } from '@/services/mixCourseService'
import { setLessonVoice } from '@/mixing/material'

let loaded: Promise<MixCourseVoice | undefined> | null = null

async function decode(row: MixCourseVoice): Promise<{ samples: Float32Array; rate: number }> {
  const ctx = new OfflineAudioContext(1, 1, row.sampleRate)
  const buf = await ctx.decodeAudioData(await row.blob.arrayBuffer())
  return { samples: new Float32Array(buf.getChannelData(0)), rate: buf.sampleRate }
}

/** Load the student's lesson voice once and hand it to the material generator. */
export function ensureLessonVoice(): Promise<MixCourseVoice | undefined> {
  if (!loaded) {
    loaded = MixCourseService.voice().then(async (row) => {
      if (row) setLessonVoice(await decode(row).catch(() => null))
      return row
    })
  }
  return loaded
}

/** The lesson voice (row) with save / remove that keep the material in step. */
export function useLessonVoice() {
  const [voice, setVoice] = useState<MixCourseVoice | undefined | null>(null)
  useEffect(() => {
    void ensureLessonVoice().then((v) => setVoice(v))
  }, [])
  const save = useCallback(async (samples: Float32Array, rate: number, source: MixCourseVoice['source']) => {
    const row = await MixCourseService.saveVoice(samples, rate, source)
    setLessonVoice({ samples, rate })
    loaded = Promise.resolve(row)
    setVoice(row)
  }, [])
  const remove = useCallback(async () => {
    await MixCourseService.removeVoice()
    setLessonVoice(null)
    loaded = Promise.resolve(undefined)
    setVoice(undefined)
  }, [])
  return { voice, save, remove, loading: voice === null }
}
