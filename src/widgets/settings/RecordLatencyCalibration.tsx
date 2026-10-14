/**
 * 跟唱录音延迟 (0.24.1): measure how late recordings arrive (headphones,
 * sound card, microphone) and keep it, so takes line up with the song.
 */
import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { probeLatency, type ProbeMode, type ProbeResult } from '@/audio/latencyProbe'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

export function RecordLatencyCalibration({
  current,
  onSave,
}: {
  current: number
  onSave: (ms: number) => Promise<void>
}) {
  const [mode, setMode] = useState<ProbeMode>('loopback')
  const [running, setRunning] = useState(false)
  const [beat, setBeat] = useState<number | null>(null)
  const [result, setResult] = useState<ProbeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState(current)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => setManual(current), [current])
  useEffect(() => () => abort.current?.abort(), [])

  const start = async () => {
    setError(null)
    setResult(null)
    setRunning(true)
    abort.current = new AbortController()
    try {
      setResult(await probeLatency(mode, setBeat, abort.current.signal))
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError'))
        setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
      setBeat(null)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        跟唱时你听到的伴奏、录进来的声音都会晚一点（无线耳机通常 150–250 毫秒，有线耳机 0–40
        毫秒）。测出来以后，录音和评分会自动往前挪这么多，回放和伴奏就对齐了。换耳机或声卡后再测一次。
      </p>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="检测方式">
        {(
          [
            [
              'loopback',
              '耳机贴近麦克风（最准）',
              '把一只耳机（或耳机的出声口）贴在麦克风旁边，安静地等 10 声"嘀"放完。',
            ],
            [
              'sing',
              '跟着节拍唱"嗒"',
              '不用动耳机：4 拍预备后，跟着后面 10 下节拍各唱一声"嗒"，像平时跟着歌唱那样。',
            ],
          ] as const
        ).map(([m, title, text]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            disabled={running}
            onClick={() => setMode(m)}
            className={cn(
              'focus-ring rounded-xl border p-3 text-left',
              mode === m
                ? 'border-amber/60 bg-amber-soft/30'
                : 'border-border/80 hover:bg-muted/40',
            )}
          >
            <span className="block text-sm font-medium">{title}</span>
            <span className="mt-1 block text-xs text-muted-foreground">{text}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2" aria-hidden="true">
        {Array.from({ length: (mode === 'sing' ? 4 : 0) + 10 }, (_, k) => {
          const i = k - (mode === 'sing' ? 4 : 0)
          return (
            <span
              key={k}
              className={cn(
                'h-3 flex-1 rounded-full transition-colors duration-75',
                beat === i ? (i < 0 ? 'bg-cyan' : 'bg-amber') : i < 0 ? 'bg-muted/60' : 'bg-muted',
              )}
            />
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => void start()} disabled={running}>
          {running ? <Loader2 className="animate-spin" /> : null}{' '}
          {running
            ? mode === 'sing'
              ? '跟着节拍唱"嗒"…'
              : '正在检测，请保持安静…'
            : result
              ? '再测一次'
              : '开始检测'}
        </Button>
        {running && (
          <Button variant="ghost" onClick={() => abort.current?.abort()}>
            取消
          </Button>
        )}
        <span className="text-sm text-muted-foreground">
          当前 <b className="num text-foreground">{current} 毫秒</b>
        </span>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-background/60 px-4 py-3 text-sm">
          {result.ms === null ? (
            <span className="text-muted-foreground">
              只听到 {result.found} / {result.total} 声，没能测出来。
              {mode === 'loopback' ? '把耳机再贴近麦克风一点、音量调大一些，' : '每一拍都唱出声，'}
              再试一次。
            </span>
          ) : (
            <>
              <span>
                测得延迟 <b className="num">{result.ms} 毫秒</b>
                <span className="ml-2 text-muted-foreground">
                  （{result.found} / {result.total} 声，波动约 {result.spreadMs} 毫秒
                  {result.spreadMs > 40 ? '，有点大，可以再测一次' : ''}）
                </span>
              </span>
              <Button
                size="sm"
                onClick={() => void onSave(Math.max(0, Math.min(400, result.ms!)))}
                disabled={result.ms < 0 || result.ms > 400}
              >
                保存为跟唱录音延迟
              </Button>
            </>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">也可以直接填：</span>
        <input
          type="number"
          min={0}
          max={400}
          step={10}
          value={manual}
          onChange={(e) => setManual(Number(e.target.value))}
          className="focus-ring h-8 w-24 rounded-lg border border-border bg-background px-2"
          aria-label="跟唱录音延迟（毫秒）"
        />
        <span>毫秒</span>
        <Button
          size="sm"
          variant="outline"
          disabled={manual === current || !Number.isFinite(manual)}
          onClick={() => void onSave(Math.max(0, Math.min(400, Math.round(manual))))}
        >
          保存
        </Button>
      </div>
    </div>
  )
}
