import { ensureTracks, trackEvents } from '@/music/arrangement'
import { majorKeySignature } from '@/music/keys'
import { pitchClass } from '@/music/pitch'
import { scoreEvents, signatureTonicOf, slotBassInterval, slotQuality, slotRoot, spellChordRoot, type Event, type Score, type ScoreNote } from '@/music/score'
import { spell, type SpelledNote } from '@/music/spelling'
import type { ChordTypeId } from '@/music/chords'

/**
 * MusicXML 4.0 lead sheet: the melody with lyrics and chord symbols, plus
 * the bass line as a second part. Opens in MuseScore, Sibelius, Finale,
 * Dorico and GarageBand / Logic.
 */

const DIVISIONS = 4 // per quarter note

const TYPE: Record<string, [string, boolean]> = {
  '4': ['whole', false],
  '3': ['half', true],
  '2': ['half', false],
  '1.5': ['quarter', true],
  '1': ['quarter', false],
  '0.75': ['eighth', true],
  '0.5': ['eighth', false],
  '0.25': ['16th', false],
}

const KIND: Record<ChordTypeId, { kind: string; text: string; add9?: boolean }> = {
  maj: { kind: 'major', text: '' },
  min: { kind: 'minor', text: 'm' },
  dim: { kind: 'diminished', text: 'dim' },
  aug: { kind: 'augmented', text: 'aug' },
  power: { kind: 'power', text: '5' },
  sus2: { kind: 'suspended-second', text: 'sus2' },
  sus4: { kind: 'suspended-fourth', text: 'sus4' },
  maj7: { kind: 'major-seventh', text: 'maj7' },
  dom7: { kind: 'dominant', text: '7' },
  min7: { kind: 'minor-seventh', text: 'm7' },
  dim7: { kind: 'diminished-seventh', text: 'dim7' },
  add9: { kind: 'major', text: 'add9', add9: true },
  m7b5: { kind: 'half-diminished', text: 'm7b5' },
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function pitchXml(n: SpelledNote): string {
  const alter = n.accidental === '#' ? '<alter>1</alter>' : n.accidental === 'b' ? '<alter>-1</alter>' : ''
  return `<pitch><step>${n.letter}</step>${alter}<octave>${n.octave}</octave></pitch>`
}

function stepXml(tag: 'root' | 'bass', n: SpelledNote): string {
  const alter = n.accidental === '#' ? `<${tag}-alter>1</${tag}-alter>` : n.accidental === 'b' ? `<${tag}-alter>-1</${tag}-alter>` : ''
  return `<${tag}><${tag}-step>${n.letter}</${tag}-step>${alter}</${tag}>`
}

function noteXml(e: Event, keyTonic: number): string {
  const [type, dotted] = TYPE[String(e.beats)] ?? ['quarter', false]
  const dur = Math.round(e.beats * DIVISIONS)
  const dot = dotted ? '<dot/>' : ''
  if (e.midi === null) return `<note><rest/><duration>${dur}</duration><type>${type}</type>${dot}</note>`
  const lyric = e.lyric ? `<lyric number="1"><syllabic>single</syllabic><text>${esc(e.lyric)}</text></lyric>` : ''
  return `<note>${pitchXml(spell(e.midi, { keyTonic }))}<duration>${dur}</duration><type>${type}</type>${dot}${lyric}</note>`
}

function attributes(score: Score, clef: 'G' | 'F'): string {
  const fifths = majorKeySignature(pitchClass(signatureTonicOf(score)))
  return `<attributes><divisions>${DIVISIONS}</divisions><key><fifths>${fifths}</fifths><mode>${score.mode}</mode></key><time><beats>${score.beatsPerBar}</beats><beat-type>4</beat-type></time><clef><sign>${clef}</sign><line>${clef === 'G' ? 2 : 4}</line></clef></attributes>`
}

function harmonyXml(score: Score, slotIndex: number, offset: number): string {
  const slot = score.chords[slotIndex]!
  const sig = signatureTonicOf({ keyTonic: score.keyTonic, mode: score.mode })
  const root = slotRoot(score, slot)
  const q = slotQuality(score, slot)
  const k = KIND[q]
  const bassInt = slotBassInterval(score, slot)
  const bass = bassInt ? stepXml('bass', spell(root + bassInt, { keyTonic: sig })) : ''
  const degree = k.add9 ? '<degree><degree-value>9</degree-value><degree-alter>0</degree-alter><degree-type>add</degree-type></degree>' : ''
  const off = offset ? `<offset>${Math.round(offset * DIVISIONS)}</offset>` : ''
  return `<harmony>${stepXml('root', spellChordRoot(slot.roman, root, sig))}<kind text="${k.text}">${k.kind}</kind>${bass}${degree}${off}</harmony>`
}

function measures(score: Score, events: Event[], clef: 'G' | 'F', withHarmony: boolean): string {
  const keyTonic = signatureTonicOf(score)
  const out: string[] = []
  for (let bar = 0; bar < score.bars; bar++) {
    const from = bar * score.beatsPerBar
    const inBar = events.filter((e) => e.start >= from - 1e-6 && e.start < from + score.beatsPerBar - 1e-6)
    const parts: string[] = []
    if (bar === 0) parts.push(attributes(score, clef))
    const chordsHere = withHarmony ? score.chords.map((c, i) => ({ c, i })).filter(({ c }) => c.start >= from - 1e-6 && c.start < from + score.beatsPerBar - 1e-6) : []
    for (const e of inBar) {
      // Chord symbols starting during this note are attached before it, with an offset.
      for (const { c, i } of chordsHere) {
        if (c.start >= e.start - 1e-6 && c.start < e.start + e.beats - 1e-6) parts.push(harmonyXml(score, i, c.start - e.start))
      }
      parts.push(noteXml(e, keyTonic))
    }
    const barline = bar === score.bars - 1 ? '<barline location="right"><bar-style>light-heavy</bar-style></barline>' : ''
    out.push(`<measure number="${bar + 1}">${parts.join('')}${barline}</measure>`)
  }
  return out.join('\n')
}

/** Monophonic bass line from the bass track (lowest note at each onset, no overlaps). */
function bassLine(score: Score): ScoreNote[] {
  const bass = ensureTracks(score).find((t) => t.kind === 'bass' && !t.mute)
  if (!bass) return []
  const byStart = new Map<number, ScoreNote>()
  for (const e of trackEvents(score, bass)) {
    const start = Math.round(e.start * 4) / 4
    const prev = byStart.get(start)
    if (!prev || e.midi < prev.midi) byStart.set(start, { start, beats: Math.max(0.25, Math.round(e.beats * 4) / 4), midi: e.midi })
  }
  const notes = [...byStart.values()].sort((a, b) => a.start - b.start)
  // Trim overlaps and bar crossings.
  return notes.map((n, i) => {
    const next = notes[i + 1]
    const barEnd = (Math.floor(n.start / score.beatsPerBar + 1e-6) + 1) * score.beatsPerBar
    const end = Math.min(n.start + n.beats, next ? next.start : Infinity, barEnd)
    return { ...n, beats: Math.max(0.25, Math.floor((end - n.start) * 4) / 4) }
  })
}

export function writeMusicXml(score: Score, title = 'GrooveLab'): string {
  const leadEvents = scoreEvents(score)
  const bassNotes = bassLine(score)
  const parts = [
    { id: 'P1', name: '主旋律', body: measures(score, leadEvents, 'G', true) },
    ...(bassNotes.length ? [{ id: 'P2', name: '贝斯', body: measures(score, scoreEvents({ ...score, melody: bassNotes }), 'F', false) }] : []),
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
<work><work-title>${esc(title)}</work-title></work>
<identification><encoding><software>律动工坊 GrooveLab</software></encoding></identification>
<part-list>${parts.map((p) => `<score-part id="${p.id}"><part-name>${p.name}</part-name></score-part>`).join('')}</part-list>
${parts.map((p) => `<part id="${p.id}">\n${p.body}\n</part>`).join('\n')}
</score-partwise>
`
}
