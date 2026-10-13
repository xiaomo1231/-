import { Lock } from 'lucide-react'
import { MAJOR_BORROWED, MAJOR_DIATONIC, MAJOR_SECONDARY, MINOR_DIATONIC, romanLabel, type RomanChord, type RomanId } from '@/music/keys'
import { chordSymbolFor, type Score } from '@/music/score'
import { cn } from '@/shared/lib/utils'
import { COLOUR_LABEL, FUNC_BUTTON, type ChordColour } from './chordStyle'

export interface ChordPaletteProps {
  score: Score
  brush: RomanId | 'erase'
  brushBeats: 2 | 4
  advancedUnlocked: boolean
  colour: ChordColour
  bass: 0 | 1 | 2
  onColour: (c: ChordColour) => void
  onBass: (b: 0 | 1 | 2) => void
  onBrush: (b: RomanId | 'erase') => void
  onBrushBeats: (b: 2 | 4) => void
  onAudition: (roman: RomanId) => void
}

/** Pick a roman numeral (or the eraser) and a length; then click the chord lane in the piano roll. */
export function ChordPalette({ score, brush, brushBeats, advancedUnlocked, colour, bass, onColour, onBass, onBrush, onBrushBeats, onAudition }: ChordPaletteProps) {
  const diatonic = score.mode === 'major' ? MAJOR_DIATONIC : MINOR_DIATONIC
  const advanced = score.mode === 'major' ? [...MAJOR_BORROWED, ...MAJOR_SECONDARY] : []
  const pick = (r: RomanId) => {
    onBrush(r)
    onAudition(r)
  }
  return (
    <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-1.5">
      {diatonic.map((c) => (
        <PaletteButton key={c.roman} chord={c} score={score} active={brush === c.roman} onClick={() => pick(c.roman)} />
      ))}
      {advanced.length > 0 && <span className="mx-1 h-6 w-px bg-border" />}
      {advanced.map((c) =>
        advancedUnlocked ? (
          <PaletteButton key={c.roman} chord={c} score={score} active={brush === c.roman} onClick={() => pick(c.roman)} />
        ) : (
          <span key={c.roman} title="阶段 4「进阶和声」解锁" className="flex items-center gap-1 rounded-lg border border-dashed border-border px-2 py-1 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" /> {romanLabel(c.roman)}
          </span>
        ),
      )}
      <button
        type="button"
        onClick={() => onBrush('erase')}
        className={cn('focus-ring ml-2 rounded-lg border px-2.5 py-1 text-xs', brush === 'erase' ? 'border-destructive/60 bg-destructive/10' : 'border-border hover:border-cyan/40')}
      >
        橡皮
      </button>
      <div className="ml-auto flex overflow-hidden rounded-lg border border-border text-xs">
        {([2, 4] as const).map((b) => (
          <button key={b} type="button" onClick={() => onBrushBeats(b)} className={cn('px-2.5 py-1', brushBeats === b ? 'bg-accent text-foreground' : 'text-muted-foreground')}>
            {b === 2 ? '半小节' : '整小节'}
          </button>
        ))}
      </div>
    </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">色彩</span>
        {(Object.keys(COLOUR_LABEL) as ChordColour[]).map((c) => {
          const locked = !advancedUnlocked && c !== 'triad'
          return (
            <button
              key={c}
              type="button"
              disabled={locked}
              onClick={() => onColour(c)}
              title={locked ? '阶段 4「进阶和声」解锁' : undefined}
              className={cn('focus-ring flex items-center gap-1 rounded-lg border px-2 py-1', colour === c ? 'border-amber bg-amber/20' : 'border-border hover:border-cyan/40', locked && 'cursor-not-allowed opacity-45')}
            >
              {locked && <Lock className="h-3 w-3" />}
              {COLOUR_LABEL[c]}
            </button>
          )
        })}
        <span className="ml-3 text-muted-foreground">低音</span>
        {([0, 1, 2] as const).map((b) => {
          const locked = !advancedUnlocked && b !== 0
          return (
            <button
              key={b}
              type="button"
              disabled={locked}
              onClick={() => onBass(b)}
              className={cn('focus-ring rounded-lg border px-2 py-1', bass === b ? 'border-amber bg-amber/20' : 'border-border hover:border-cyan/40', locked && 'cursor-not-allowed opacity-45')}
            >
              {['根音', '三音（/3）', '五音（/5）'][b]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function PaletteButton({ chord, score, active, onClick }: { chord: RomanChord; score: Score; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${romanLabel(chord.roman)} ${chordSymbolFor(score, chord.roman)}，${chord.func}功能`}
      title={`${chord.func}功能`}
      className={cn('focus-ring flex flex-col items-start rounded-lg border px-2.5 py-1 text-left transition-colors', active ? 'border-amber bg-amber/20' : cn(FUNC_BUTTON[chord.func], 'hover:brightness-125'))}
    >
      <span className="font-mono text-xs font-semibold leading-none">{romanLabel(chord.roman)}</span>
      <span className="mt-0.5 text-[10px] leading-none text-muted-foreground">{chordSymbolFor(score, chord.roman)}</span>
    </button>
  )
}
