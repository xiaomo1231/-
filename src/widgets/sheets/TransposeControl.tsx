import { Minus, Plus, RotateCcw } from 'lucide-react'
import { TRANSPOSE_MAX, TRANSPOSE_MIN, transposeLabel, type GuitarWay } from '@/songs/transpose'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

/**
 * 变调 control: semitones up / down, the key it lands in, and — for guitar
 * sheets — whether to keep the shapes with a capo or move the frets.
 */
export function TransposeControl({
  value,
  onChange,
  keyLabel,
  way,
  onWay,
  capoNeeded,
}: {
  value: number
  onChange: (n: number) => void
  /** e.g. "D 大调（原调 C 大调）". */
  keyLabel?: string
  way?: GuitarWay
  onWay?: (w: GuitarWay) => void
  /** Capo fret the capo way needs (sheet capo + value). */
  capoNeeded?: number
}) {
  return (
    <div className="space-y-2 rounded-2xl border border-border/80 bg-card p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">变调</span>
        <Button size="sm" variant="outline" onClick={() => onChange(value - 1)} disabled={value <= TRANSPOSE_MIN} aria-label="降半音">
          <Minus />
        </Button>
        <span className={cn('num w-28 text-center', value !== 0 && 'text-amber')}>{transposeLabel(value)}</span>
        <Button size="sm" variant="outline" onClick={() => onChange(value + 1)} disabled={value >= TRANSPOSE_MAX} aria-label="升半音">
          <Plus />
        </Button>
        {value !== 0 && (
          <Button size="sm" variant="ghost" onClick={() => onChange(0)}>
            <RotateCcw /> 回到原调
          </Button>
        )}
        {keyLabel && <span className="text-xs text-muted-foreground">{keyLabel}</span>}
      </div>
      {value !== 0 && onWay && way && (
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="吉他怎么弹">
          <span className="text-xs text-muted-foreground">吉他怎么弹：</span>
          {value > 0 && (
            <button type="button" role="radio" aria-checked={way === 'capo'} onClick={() => onWay('capo')} disabled={(capoNeeded ?? 0) > 9} className={cn('focus-ring rounded-full border px-3 py-1 text-xs disabled:opacity-50', way === 'capo' ? 'border-amber/70 bg-amber-soft/40' : 'border-border/80 text-muted-foreground hover:text-foreground')}>
              按原指法，夹变调夹 {capoNeeded} 品
            </button>
          )}
          <button type="button" role="radio" aria-checked={way === 'frets'} onClick={() => onWay('frets')} className={cn('focus-ring rounded-full border px-3 py-1 text-xs', way === 'frets' ? 'border-amber/70 bg-amber-soft/40' : 'border-border/80 text-muted-foreground hover:text-foreground')}>
            不夹变调夹，品位整体{value > 0 ? '上移' : '下移'} {Math.abs(value)} 品
          </button>
          <span className="w-full text-xs text-muted-foreground">
            谱面上的六线谱仍按原来的品位显示；五线谱和播放已经变到新调。{way === 'capo' ? '夹上变调夹后照着原来的品位弹即可。' : '练习区里的旋律已经按移动后的品位给出（落到 0 品以下的音会移高一个八度）。'}
          </span>
        </div>
      )}
    </div>
  )
}
