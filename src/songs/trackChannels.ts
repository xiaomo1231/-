/**
 * Many scores exported from songsterr (GP5) put every track on one MIDI channel with
 * one instrument: the player then sounds them as one (solo and mute act on the
 * channel, so 独奏 does nothing and 静音 silences everything). When tracks share a
 * channel, each pitched track gets its own, and — since the shared instrument was
 * only the last track's — an instrument guessed from its name and tuning.
 * Well-formed files (every track on its own channel) are left as they are.
 */

/** The parts of an alphaTab track this needs (so it can be tested on plain objects). */
export interface ChannelTrack {
  name: string
  isPercussion: boolean
  playbackInfo: { primaryChannel: number; secondaryChannel: number; program: number }
  // (the importer gives tracks that share a channel one and the same playbackInfo object)
  staves: ReadonlyArray<{ tuning: ReadonlyArray<number> }>
}

const DRUM_CHANNEL = 9
const CHANNEL_COUNT = 16

/** General MIDI programs used for the guesses. */
export const GM = {
  piano: 0,
  electricPiano: 4,
  organ: 16,
  acousticGuitar: 25,
  cleanGuitar: 27,
  overdrivenGuitar: 29,
  distortionGuitar: 30,
  fingerBass: 33,
  strings: 48,
  voiceOohs: 53,
  trumpet: 56,
  sax: 65,
  flute: 73,
  synthLead: 81,
  synthPad: 89,
} as const

const isGuitarProgram = (p: number) => p >= 24 && p <= 31
const isBassProgram = (p: number) => p >= 32 && p <= 39

const NAME_RULES: ReadonlyArray<readonly [RegExp, number]> = [
  [/bass|贝斯|貝斯|ベース|低音/i, GM.fingerBass],
  [/vocal|voice|vox|sing|chorus|choir|人声|主唱|唱|和声|ボーカル|コーラス|歌/i, GM.voiceOohs],
  [/e(lectric)?[\s.-]*piano|epiano|rhodes|电钢|電鋼|エレピ/i, GM.electricPiano],
  [/piano|keyboard|keys?\b|钢琴|鋼琴|键盘|鍵盤|ピアノ|キーボード/i, GM.piano],
  [/organ|风琴|オルガン/i, GM.organ],
  [/synth|sequencer|合成器|シンセ/i, GM.synthLead],
  [/pad\b/i, GM.synthPad],
  [/string|violin|viola|cello|弦乐|小提琴|ストリングス/i, GM.strings],
  [/sax|萨克斯/i, GM.sax],
  [/trumpet|brass|horn|小号|铜管/i, GM.trumpet],
  [/flute|长笛|フルート/i, GM.flute],
  [/acoustic|木吉他|民谣|アコギ|アコースティック/i, GM.acousticGuitar],
  [/clean|干净/i, GM.cleanGuitar],
  [/guitar|gtr|lead|rhythm|solo|吉他|ギター/i, GM.overdrivenGuitar],
]

/** Bass by its strings: 4–5 strings, or a lowest string below the guitar's low E (MIDI 40). */
function looksLikeBass(t: ChannelTrack): boolean {
  const tuning = t.staves[0]?.tuning ?? []
  if (tuning.length === 0) return false
  const lowest = Math.min(...tuning)
  return tuning.length <= 5 || lowest < 36
}

/** The instrument a track most likely is, from its name, else its strings, else `fallback`. */
export function guessProgram(t: ChannelTrack, fallback: number): number {
  for (const [re, program] of NAME_RULES) {
    if (!re.test(t.name)) continue
    // A guitar name keeps the file's guitar sound (distortion, clean…), a bass its bass sound.
    if (program === GM.overdrivenGuitar && isGuitarProgram(fallback)) return fallback
    if (program === GM.fingerBass && isBassProgram(fallback)) return fallback
    return program
  }
  const tuning = t.staves[0]?.tuning ?? []
  if (tuning.length === 0) return fallback
  if (looksLikeBass(t)) return isBassProgram(fallback) ? fallback : GM.fingerBass
  return isGuitarProgram(fallback) ? fallback : GM.overdrivenGuitar
}

/** True when two pitched tracks play on the same MIDI channel. */
export function sharesChannels(tracks: readonly ChannelTrack[]): boolean {
  const seen = new Set<number>()
  for (const t of tracks) {
    if (t.isPercussion) continue
    const c = t.playbackInfo.primaryChannel
    if (seen.has(c)) return true
    seen.add(c)
  }
  return false
}

/**
 * Gives every pitched track its own channel (and its effect channel when enough are
 * free), and guesses the instrument of the tracks that shared one. Drums stay on
 * channel 9. Returns, for each track whose instrument was guessed, the program it had
 * (instrument changes written in the file with that program are the caller's to follow).
 */
export function separateChannels<T extends ChannelTrack>(tracks: readonly T[]): Map<T, number> {
  const before = new Map<T, number>()
  if (!sharesChannels(tracks)) return before
  const pitched = tracks.filter((t) => !t.isPercussion)
  // Tracks on one channel share one playbackInfo object: each gets its own copy first,
  // or changing one would change them all.
  const owners = new Set<object>()
  for (const t of pitched) {
    const info = t.playbackInfo
    if (owners.has(info))
      (t as { playbackInfo: ChannelTrack['playbackInfo'] }).playbackInfo = Object.assign(
        Object.create(Object.getPrototypeOf(info) as object) as ChannelTrack['playbackInfo'],
        info,
      )
    owners.add(t.playbackInfo)
  }
  // Which tracks shared a channel with another one (only those get a guessed instrument).
  const count = new Map<number, number>()
  for (const t of pitched) count.set(t.playbackInfo.primaryChannel, (count.get(t.playbackInfo.primaryChannel) ?? 0) + 1)
  const shared = new Set(pitched.filter((t) => (count.get(t.playbackInfo.primaryChannel) ?? 0) > 1))

  const free: number[] = []
  for (let c = 0; c < CHANNEL_COUNT; c++) if (c !== DRUM_CHANNEL) free.push(c)
  const primaries = pitched.map((_, i) => free[i % free.length]!)
  const spare = free.slice(pitched.length)
  pitched.forEach((t, i) => {
    const info = t.playbackInfo
    if (shared.has(t)) {
      before.set(t, info.program)
      info.program = guessProgram(t, info.program)
    }
    info.primaryChannel = primaries[i]!
    // Bends and slides use the effect channel; without a spare one it is the same channel.
    info.secondaryChannel = spare[i] ?? primaries[i]!
  })
  return before
}
