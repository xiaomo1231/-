import { Loader2, RotateCcw } from 'lucide-react'
import { ensureAudio, playChord } from '@/audio/engine'
import { PIANO_CREDIT, loadPianoBank, type PianoStatus } from '@/audio/piano'
import { usePianoStatus } from '@/features/audio/usePianoStatus'
import { INSTRUMENT_LABEL, type StudentProfile } from '@/entities/types'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

const STATUS_TEXT: Record<PianoStatus, string> = {
  idle: '第一次播放时加载',
  loading: '正在加载钢琴采样…',
  ready: '钢琴采样已就绪（离线可用）',
  failed: '钢琴采样没加载成功，暂时用合成钢琴',
}

/** Settings block: which timbre drills use, and the bundled piano's state. */
export function TrainingTimbre({ profile, onChange }: { profile: StudentProfile; onChange: (v: 'piano' | 'instrument') => void }) {
  const status = usePianoStatus()
  const value = profile.trainingTimbre ?? 'piano'
  const follows = profile.instrument === 'guitar' || profile.instrument === 'bass'
  const options = [
    { id: 'piano' as const, title: '钢琴', hint: '真实三角钢琴录音，默认' },
    { id: 'instrument' as const, title: '跟随主乐器', hint: follows ? `用${INSTRUMENT_LABEL[profile.instrument]}的音色` : '你的主乐器没有单独音色，仍是钢琴' },
  ]
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">训练音色</div>
      <p className="text-xs text-muted-foreground">用于基础训练营、入门测试和课程里的试听。吉他工坊和谱子播放始终用吉他音色。</p>
      <div className="flex gap-3" role="radiogroup" aria-label="训练音色">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            onClick={async () => {
              onChange(o.id)
              if (o.id === 'piano') {
                await ensureAudio()
                await loadPianoBank()
                playChord([60, 64, 67], 1.2)
              }
            }}
            className={cn('focus-ring flex-1 rounded-2xl border p-4 text-left transition-colors', value === o.id ? 'border-amber/70 bg-amber-soft/40' : 'border-border/80 bg-card hover:border-cyan/40')}
          >
            <div className="font-medium">{o.title}</div>
            <div className="text-xs text-muted-foreground">{o.hint}</div>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {status === 'loading' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
        <span role="status">{STATUS_TEXT[status]}</span>
        {status === 'failed' && (
          <Button size="sm" variant="outline" onClick={() => void loadPianoBank()}>
            <RotateCcw /> 重新加载
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground/80">{PIANO_CREDIT}</p>
    </div>
  )
}
