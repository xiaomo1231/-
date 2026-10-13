import { useMemo, useState } from 'react'
import { Play, Square } from 'lucide-react'
import * as engine from '@/audio/engine'
import { chordNotes, chordTypeById, type ChordTypeId } from '@/music/chords'
import { romanChord, romanLabel, type Mode, type RomanId } from '@/music/keys'
import { pitchClass } from '@/music/pitch'
import { chordSymbolFor, emptyScore, type Score } from '@/music/score'
import { spell, spelledName } from '@/music/spelling'
import { useProfileStore } from '@/features/profile/profileStore'
import { useChordShapes } from '@/features/instrument/useGuitarSetup'
import { ChordDiagram } from '@/widgets/instrument/ChordDiagram'
import { InstrumentView } from '@/widgets/instrument/InstrumentView'
import { MelodyStaff } from '@/widgets/notation/MelodyStaff'
import { ScoreNotation } from '@/widgets/notation/ScoreNotation'
import { Button } from '@/shared/ui/Button'

/** Guitar shape suffix for a chord quality, or null when no movable shape exists. */
function shapeSuffix(type: ChordTypeId): string | null {
  const map: Partial<Record<ChordTypeId, string>> = { maj: '', min: 'm', dom7: '7', min7: 'm7', maj7: 'maj7', power: '5' }
  return map[type] ?? null
}

const CHORD_TONE_LABELS = ['根', '三', '五', '七']

function useArrangementPlayer() {
  const [playing, setPlaying] = useState(false)
  const play = async (score: Score, withMelody = true) => {
    if (playing) {
      engine.stopArrangement()
      setPlaying(false)
      return
    }
    await engine.ensureAudio()
    setPlaying(true)
    const { endAt } = await engine.playScore(withMelody ? score : { ...score, melody: [] })
    engine.onAudioTime(endAt, () => setPlaying(false))
  }
  return { playing, play }
}

function Frame({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <figure className="rounded-2xl border border-border/80 bg-card p-5 surface-gradient">
      <figcaption className="mb-3 flex items-center justify-between gap-4">
        <span className="font-medium">{title}</span>
        {action}
      </figcaption>
      {children}
    </figure>
  )
}

export function ChordBlock({ title, root, quality, inversion = 0, caption }: { title: string; root: number; quality: ChordTypeId; inversion?: number; caption?: string }) {
  const instrument = useProfileStore((s) => s.profile?.instrument ?? 'none')
  const notes = chordNotes(root, quality, inversion)
  const rootName = spelledName(spell(root, { preferFlats: [1, 3, 8, 10].includes(pitchClass(root)) }))
  const suffix = shapeSuffix(quality)
  const shapeFor = useChordShapes()
  const found = instrument === 'guitar' && suffix !== null && inversion === 0 ? shapeFor(pitchClass(root), suffix, rootName) : null
  const shape = found?.shape ?? null
  const play = async () => {
    await engine.ensureAudio()
    engine.playSequence([...notes.map((m) => ({ midi: m, duration: 1.2, at: 0 })), ...notes.map((m, i) => ({ midi: m, duration: 0.5, at: 1.4 + i * 0.35 }))])
  }
  return (
    <Frame
      title={title}
      action={
        <Button variant="outline" size="sm" onClick={() => void play()}>
          <Play /> 播放
        </Button>
      }
    >
      <div className="grid grid-cols-5 items-center gap-4">
        <div className="col-span-2">
          <MelodyStaff notes={notes.map((m) => ({ midi: m, beats: 1 }))} showKeySignature={false} timeSignature={null} />
          <div className="text-center font-display text-lg font-semibold">
            {rootName}
            {chordTypeById(quality).symbol}
          </div>
        </div>
        <div className="col-span-3">
          {shape ? (
            <div className="flex flex-col items-center">
              <ChordDiagram shape={shape} />
              {found?.playedAs && <span className="text-[11px] text-muted-foreground">{found.playedAs}</span>}
            </div>
          ) : (
            <InstrumentView instrument={instrument} notes={notes} rootPc={pitchClass(root)} labels={notes.map((m) => CHORD_TONE_LABELS[chordTypeById(quality).intervals.indexOf(((m - root) % 12 + 12) % 12)] ?? '')} />
          )}
        </div>
      </div>
      {caption && <p className="mt-2 text-sm text-muted-foreground">{caption}</p>}
    </Frame>
  )
}

export function ProgressionBlock({ title, tonic, mode, romans, beatsEach = 4, caption }: { title: string; tonic: number; mode: Mode; romans: RomanId[]; beatsEach?: number; caption?: string }) {
  const instrument = useProfileStore((s) => s.profile?.instrument ?? 'none')
  const { playing, play } = useArrangementPlayer()
  const shapeFor = useChordShapes()
  const score = useMemo(() => {
    const total = romans.length * beatsEach
    return emptyScore({
      keyTonic: tonic,
      mode,
      bpm: 96,
      bars: Math.ceil(total / 4),
      chords: romans.map((r, i) => ({ start: i * beatsEach, beats: beatsEach, roman: r })),
      accompaniment: { comp: 'block', bass: 'roots', drums: 'pop' },
    })
  }, [tonic, mode, romans, beatsEach])
  return (
    <Frame
      title={title}
      action={
        <Button variant="outline" size="sm" onClick={() => void play(score, false)}>
          {playing ? <Square /> : <Play />} {playing ? '停止' : '播放'}
        </Button>
      }
    >
      <div className="flex flex-wrap gap-2">
        {romans.map((r, i) => {
          const c = romanChord(r, mode)
          const rootPc = pitchClass(tonic + c.offset)
          const symbol = chordSymbolFor(score, r)
          const suffix = shapeSuffix(c.type)
          const found = instrument === 'guitar' && suffix !== null ? shapeFor(rootPc, suffix, symbol.replace(/(m|dim|aug)$/, '')) : null
          const shape = found?.shape ?? null
          return (
            <div key={i} className="flex flex-col items-center rounded-xl border border-border/70 bg-background/50 px-3 py-2">
              <span className="font-display text-lg font-semibold">{symbol}</span>
              <span className="font-mono text-xs text-muted-foreground">{romanLabel(r)}</span>
              {shape && <ChordDiagram shape={shape} className="mt-1" />}
              {found?.playedAs && <span className="text-[10px] text-muted-foreground">{found.playedAs}</span>}
            </div>
          )
        })}
      </div>
      {caption && <p className="mt-3 text-sm text-muted-foreground">{caption}</p>}
    </Frame>
  )
}

export function SongBlock({ title, score, caption }: { title: string; score: Score; caption?: string }) {
  const { playing, play } = useArrangementPlayer()
  return (
    <Frame
      title={title}
      action={
        <Button variant="outline" size="sm" onClick={() => void play(score)}>
          {playing ? <Square /> : <Play />} {playing ? '停止' : '播放'}
        </Button>
      }
    >
      <ScoreNotation score={score} chordLabels="both" />
      {caption && <p className="mt-2 text-sm text-muted-foreground">{caption}</p>}
    </Frame>
  )
}
