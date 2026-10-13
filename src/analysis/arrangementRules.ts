import { DRUM, TRACK_LABEL, ensureTracks, sectionDensity, trackEvents } from '@/music/arrangement'
import { midiToName } from '@/music/pitch'
import { SECTION_LABEL, type Score, type TrackKind } from '@/music/score'
import type { Finding } from './ruleEngine'

/** Comfortable written ranges per track kind (MIDI). */
export const TRACK_RANGE: Record<Exclude<TrackKind, 'drums'>, { low: number; high: number }> = {
  bass: { low: 28, high: 60 },
  guitar: { low: 40, high: 88 },
  keys: { low: 36, high: 96 },
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)

/**
 * Arrangement checks (P4). Like the melody rules, these are measurable
 * observations phrased as suggestions.
 */
export function analyzeArrangement(s: Score): Finding[] {
  const findings: Finding[] = []
  const tracks = ensureTracks(s)
  const audible = tracks.filter((t) => !t.mute)
  const anySolo = tracks.some((t) => t.solo) || s.lead?.solo
  if (anySolo) findings.push({ id: 'solo', severity: 'info', message: '有轨道处于独奏状态，检查和播放只听得到独奏的轨道。' })

  // Track count.
  const voices = audible.length + (s.melody.length && !s.lead?.mute ? 1 : 0)
  if (voices >= 4) findings.push({ id: 'tracks', severity: 'good', message: `一共 ${voices} 个声部在演奏。` })
  else findings.push({ id: 'tracks', severity: 'info', message: `现在只有 ${voices} 个声部。流行摇滚的基本编制是鼓、贝斯、和声乐器（键盘或吉他）加主旋律。` })

  // Bass ↔ kick lock-in.
  const drums = audible.find((t) => t.kind === 'drums')
  const bass = audible.find((t) => t.kind === 'bass')
  if (drums && bass && s.chords.length) {
    const kicks = trackEvents(s, drums).filter((e) => e.midi === DRUM.kick).map((e) => e.start)
    const bassOn = new Set(trackEvents(s, bass).map((e) => Math.round(e.start * 4)))
    if (kicks.length) {
      const together = kicks.filter((k) => bassOn.has(Math.round(k * 4))).length / kicks.length
      if (together >= 0.6) findings.push({ id: 'lock', severity: 'good', message: `贝斯和底鼓在 ${Math.round(together * 100)}% 的底鼓上同时落下，节奏很稳。` })
      else if (together < 0.35)
        findings.push({ id: 'lock', severity: 'warn', message: `底鼓响的时候，贝斯只在 ${Math.round(together * 100)}% 的位置同时出现。让贝斯跟着底鼓走（至少每小节第一拍一起落），低频会更结实。` })
      else findings.push({ id: 'lock', severity: 'info', message: `贝斯和底鼓有 ${Math.round(together * 100)}% 的时候一起落下，可以再对齐一些。` })
    }
  }

  // Ranges and low-end mud.
  for (const t of audible) {
    if (t.kind === 'drums') continue
    const events = trackEvents(s, t)
    if (!events.length) continue
    const r = TRACK_RANGE[t.kind]
    const out = events.filter((e) => e.midi < r.low || e.midi > r.high)
    if (out.length) {
      findings.push({ id: `range-${t.id}`, severity: 'warn', message: `${t.name}有 ${out.length} 个音超出常用音域（${midiToName(r.low, { octave: true })}–${midiToName(r.high, { octave: true })}），真实乐器可能弹不到或很难听清。` })
    }
    if ((t.kind === 'keys' || t.kind === 'guitar') && events.filter((e) => e.midi < 48).length > events.length * 0.25) {
      findings.push({ id: `mud-${t.id}`, severity: 'info', message: `${t.name}的和弦有不少音低于 C3，会和贝斯抢低频，听起来发闷。把和弦往上移一个八度试试。` })
    }
  }

  // Melody vs accompaniment register.
  if (s.melody.length) {
    const melodyAvg = avg(s.melody.map((n) => n.midi))
    const comp = audible.filter((t) => t.kind === 'keys' || t.kind === 'guitar').flatMap((t) => trackEvents(s, t).map((e) => e.midi))
    if (comp.length && Math.abs(avg(comp) - melodyAvg) < 3) {
      findings.push({ id: 'register', severity: 'info', message: '主旋律和和声伴奏挤在同一个音区，旋律容易被盖住。可以把伴奏移低一点，或换成更稀疏的织体。' })
    }
  }

  // Section contrast.
  const dens = sectionDensity(s)
  const verse = dens.filter((d) => d.section.label === 'verse')
  const chorus = dens.filter((d) => d.section.label === 'chorus')
  if (verse.length && chorus.length) {
    const v = avg(verse.map((d) => d.density))
    const c = avg(chorus.map((d) => d.density))
    if (c > v * 1.15) findings.push({ id: 'contrast', severity: 'good', message: `副歌的音符密度是主歌的 ${(c / Math.max(v, 0.01)).toFixed(1)} 倍，段落对比清楚。` })
    else findings.push({ id: 'contrast', severity: 'warn', message: '副歌没有比主歌更饱满。提高副歌的能量、让更多乐器进来，或让主歌更稀疏。' })
    const melIn = (label: string) =>
      avg(s.melody.filter((n) => (s.sections ?? []).some((x) => x.label === label && n.start >= x.start * s.beatsPerBar && n.start < (x.start + x.bars) * s.beatsPerBar)).map((n) => n.midi))
    const mv = melIn('verse')
    const mc = melIn('chorus')
    if (mv && mc && mc <= mv) findings.push({ id: 'contrast-pitch', severity: 'info', message: '副歌旋律的平均音高没有比主歌高，副歌可能不够“抬起来”。' })
  }

  // Silent sections.
  for (const d of dens) {
    if (d.density === 0) findings.push({ id: `silent-${d.section.start}`, severity: 'info', bar: d.section.start, message: `${SECTION_LABEL[d.section.label]}（第 ${d.section.start + 1} 小节起）没有任何声音。` })
  }

  // Everything automatic.
  if (audible.length && audible.every((t) => t.source === 'auto')) {
    findings.push({ id: 'manual', severity: 'info', message: `所有伴奏都是自动生成的。试着把一轨（比如${TRACK_LABEL[audible[0]!.kind]}）转为手动，写一段属于你的 riff 或过门。` })
  }

  const order = { warn: 0, info: 1, good: 2 }
  return findings.sort((a, b) => order[a.severity] - order[b.severity])
}
