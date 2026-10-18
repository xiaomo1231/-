/**
 * 音色: the sound fonts the score player can use. The basic one ships with alphaTab;
 * the two larger ones are optional files the server may have (server-assets/soundfonts,
 * copied to /alphatab/soundfont/ by the web build). The choice is kept on this device.
 */
export type SoundFontId = 'basic' | 'musescore' | 'fluid'

export interface SoundFontOption {
  id: SoundFontId
  label: string
  file: string
  sizeLabel: string
  note: string
}

export const SOUND_FONTS: ReadonlyArray<SoundFontOption> = [
  { id: 'basic', label: '标准', file: 'sonivox.sf2', sizeLabel: '1.3 MB', note: '加载快，适合手机流量。' },
  {
    id: 'musescore',
    label: '高品质',
    file: 'MuseScore_General.sf3',
    sizeLabel: '38 MB',
    note: '吉他、贝斯、鼓更自然。第一次加载要等一会儿，之后浏览器会缓存。',
  },
  {
    id: 'fluid',
    label: '最高品质',
    file: 'FluidR3_GM.sf2',
    sizeLabel: '142 MB',
    note: '最细腻也最大；手机上可能加载很慢或内存不够，建议在电脑或 Wi-Fi 下用。',
  },
]

export function soundFontUrl(id: SoundFontId): string {
  const f = SOUND_FONTS.find((o) => o.id === id) ?? SOUND_FONTS[0]!
  return new URL(`/alphatab/soundfont/${f.file}`, window.location.href).href
}

let available: Promise<Set<SoundFontId>> | null = null

/** Which sound fonts this server has (asked once per visit with HEAD requests). */
export function availableSoundFonts(): Promise<Set<SoundFontId>> {
  if (!available)
    available = Promise.all(
      SOUND_FONTS.map(async (o) => {
        if (o.id === 'basic') return o.id
        try {
          const res = await fetch(soundFontUrl(o.id), { method: 'HEAD', credentials: 'same-origin' })
          return res.ok ? o.id : null
        } catch {
          return null
        }
      }),
    ).then((ids) => new Set(ids.filter((x): x is SoundFontId => x !== null)))
  return available
}
