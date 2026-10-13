import type { GuitarExercise } from '@/guitar/units'
import { ChordCheck } from './ChordCheck'
import { ChangeDrill } from './ChangeDrill'
import { StrumPractice, type StrumTake } from './StrumPractice'
import { NoteFindQuiz, NoteNameQuiz } from './NoteQuiz'
import { LeadPlay } from './LeadPlay'
import { BendDrill, VibratoDrill } from './TechniqueDrill'
import { ImprovDrill, TargetDrill } from './LeadBacking'

function takeSummary(r: StrumTake): string {
  const parts = [`${r.bpm} BPM`, `准 ${r.perfect}`, `可 ${r.good}`, `漏 ${r.miss}`]
  if (r.offbeat) parts.push(`反拍 ${Math.round(r.offbeat.score * 100)}`)
  if (r.changes && r.changes.total > 1) parts.push(`换和弦 ${Math.round(r.changes.score * 100)}`)
  return parts.join(' · ')
}

/** Renders any workshop exercise and reports each attempt. */
export function ExerciseRunner({
  exercise: ex,
  onRecord,
}: {
  exercise: GuitarExercise
  onRecord: (score: number, passed: boolean, summary: string) => void
}) {
  return (
    <>
      {ex.kind === 'chord-check' && (
        <ChordCheck chords={ex.chords} onDone={(r) => onRecord(r.score, r.passed, r.summary)} />
      )}
      {ex.kind === 'change' && (
        <ChangeDrill
          chords={ex.chords}
          seconds={ex.seconds}
          target={ex.target}
          onDone={(r) => onRecord(r.score, r.passed, r.summary)}
        />
      )}
      {ex.kind === 'strum' && (
        <StrumPractice
          segments={[{ pattern: ex.pattern, romans: ex.romans, bars: ex.bars }]}
          tonic={ex.tonic}
          bpm={ex.bpm}
          pass={ex.pass}
          {...(ex.preset ? { preset: ex.preset } : {})}
          {...(ex.chordSuffix ? { chordSuffix: ex.chordSuffix } : {})}
          onTake={(r) =>
            onRecord(r.bpm >= ex.bpm ? r.score : r.score * 0.8, r.passed, takeSummary(r))
          }
        />
      )}
      {ex.kind === 'song' && (
        <StrumPractice
          segments={ex.segments}
          tonic={ex.tonic}
          bpm={ex.bpm}
          pass={ex.pass}
          {...(ex.preset ? { preset: ex.preset } : {})}
          onTake={(r) =>
            onRecord(r.bpm >= ex.bpm ? r.score : r.score * 0.8, r.passed, takeSummary(r))
          }
        />
      )}
      {ex.kind === 'note-name' && (
        <NoteNameQuiz
          count={ex.count}
          {...(ex.strings ? { strings: ex.strings } : {})}
          runId={`guitar:${ex.id}`}
          runTitle={`吉他工坊 · ${ex.title}`}
          onDone={(r) => onRecord(r.score, r.passed, r.summary)}
        />
      )}
      {ex.kind === 'note-find' && (
        <NoteFindQuiz
          count={ex.count}
          {...(ex.strings ? { strings: ex.strings } : {})}
          runId={`guitar:${ex.id}`}
          runTitle={`吉他工坊 · ${ex.title}`}
          onDone={(r) => onRecord(r.score, r.passed, r.summary)}
        />
      )}
      {ex.kind === 'play' && (
        <LeadPlay
          source={ex.source}
          bpm={ex.bpm}
          {...(ex.preset ? { preset: ex.preset } : {})}
          {...(ex.legato ? { legato: true } : {})}
          onDone={(r) => onRecord(r.score, r.passed, r.summary)}
        />
      )}
      {ex.kind === 'target' && (
        <TargetDrill
          spec={ex}
          pass={ex.pass}
          onDone={(r) => onRecord(r.score, r.passed, r.summary)}
        />
      )}
      {ex.kind === 'improv' && (
        <ImprovDrill
          spec={ex}
          title={ex.title}
          onDone={(r) => onRecord(r.score, r.passed, r.summary)}
        />
      )}
      {ex.kind === 'bend' && (
        <BendDrill
          string={ex.string}
          fret={ex.fret}
          semitones={ex.semitones}
          onDone={(r) => onRecord(r.score, r.passed, r.summary)}
        />
      )}
      {ex.kind === 'vibrato' && (
        <VibratoDrill
          string={ex.string}
          fret={ex.fret}
          onDone={(r) => onRecord(r.score, r.passed, r.summary)}
        />
      )}
    </>
  )
}
