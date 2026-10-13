import { useEffect, useState } from 'react'
import { Headphones, Loader2, Volume2, VolumeX } from 'lucide-react'
import { useGuitarAudio } from '@/features/guitar/guitarAudioStore'
import { MONITOR_WARN_MS } from '@/audio/latency'
import { Button } from '@/shared/ui/Button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/Dialog'
import { cn } from '@/shared/lib/utils'

/**
 * Monitor on/off with the safety rule: with a microphone input, monitoring
 * through speakers would howl, so the student must confirm headphones.
 */
export function MonitorToggle({ compact, className }: { compact?: boolean; className?: string }) {
  const { monitorOn, startMonitor, stopMonitor, estimateMs, rig, setRig, hydrate, error } = useGuitarAudio()
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => hydrate(), [hydrate])

  const toggle = async () => {
    if (monitorOn) {
      stopMonitor()
      return
    }
    setBusy(true)
    const r = await startMonitor()
    setBusy(false)
    if (r === 'needs-confirm') setConfirm(true)
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      <Button variant={monitorOn ? 'default' : 'outline'} size={compact ? 'sm' : 'default'} onClick={() => void toggle()} disabled={busy} aria-pressed={monitorOn}>
        {busy ? <Loader2 className="animate-spin" /> : monitorOn ? <Volume2 /> : <VolumeX />} {monitorOn ? '监听开' : '监听关'}
      </Button>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        音量
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={rig.volume}
          onChange={(e) => setRig({ ...rig, volume: Number(e.target.value) })}
          className="w-24 accent-[hsl(var(--amber))]"
          aria-label="监听音量"
        />
      </label>
      {monitorOn && (
        <span className={cn('num text-xs', estimateMs > MONITOR_WARN_MS ? 'text-amber' : 'text-muted-foreground')}>监听延迟约 {estimateMs} ms</span>
      )}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>你在用麦克风收音</DialogTitle>
            <DialogDescription>
              现在的输入不是吉他线。如果用音箱外放监听，麦克风会收到音箱的声音，形成刺耳的啸叫。请先戴上耳机再打开监听；用木吉他或不插电练习时，一般不需要监听。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              不开了
            </Button>
            <Button
              onClick={async () => {
                setConfirm(false)
                setBusy(true)
                await startMonitor(true)
                setBusy(false)
              }}
            >
              <Headphones /> 我戴着耳机，打开
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
