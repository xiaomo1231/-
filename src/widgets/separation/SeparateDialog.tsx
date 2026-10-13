import { useEffect, useRef, useState } from 'react'
import { Cpu, Loader2, Monitor, Scissors, Zap } from 'lucide-react'
import {
  BROWSER_MODEL_MB,
  browserModelCached,
  hasWebGpu,
  helperStatus,
  separateFile,
  type Engine,
  type HelperStatus,
  type SeparationMode,
  type SeparationProgress,
} from '@/audio/separation/separate'
import { Button } from '@/shared/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { cn } from '@/shared/lib/utils'

/**
 * 自动分轨: split one recording into stems with the local helper (fast, UVR
 * engine on the GPU) or in the browser (nothing to install). Hands back
 * named WAV files the stem detector understands.
 */
export function SeparateDialog({
  file,
  mode = 'stems',
  onClose,
  onDone,
}: {
  file: File | null
  /** 'vocals': only the voice and the rest (跟唱; fast, model shipped with the site). */
  mode?: SeparationMode
  onClose: () => void
  onDone: (files: File[], engine: Engine) => void
}) {
  const [helper, setHelper] = useState<HelperStatus | null | undefined>(undefined)
  const [cached, setCached] = useState(false)
  const [engine, setEngine] = useState<Engine>('browser')
  const [progress, setProgress] = useState<SeparationProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const running = progress !== null && error === null

  useEffect(() => {
    if (!file) return
    setProgress(null)
    setError(null)
    setHelper(undefined)
    void helperStatus().then((h) => {
      setHelper(h)
      setEngine(h ? 'local' : 'browser')
    })
    void browserModelCached().then(setCached)
  }, [file])

  const start = async () => {
    if (!file) return
    setError(null)
    abort.current = new AbortController()
    try {
      const r = await separateFile(file, {
        engine,
        mode,
        onProgress: setProgress,
        signal: abort.current.signal,
      })
      onDone(r.files, r.engine)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setProgress(null)
        return
      }
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const cancel = () => {
    abort.current?.abort()
    if (!running) onClose()
  }

  const gpuName = helper?.device.startsWith('cuda:') ? helper.device.slice(5) : null

  return (
    <Dialog open={file !== null} onOpenChange={(o) => !o && !running && onClose()}>
      <DialogContent className="overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="h-5 w-5 text-cyan" aria-hidden /> 自动分轨
          </DialogTitle>
          <DialogDescription className="break-words">
            把「
            <span className="font-medium text-foreground" title={file?.name}>
              {shortName(file?.name ?? '')}
            </span>
            」{mode === 'vocals' ? '分成人声和伴奏' : '分成人声、鼓、贝斯、吉他、钢琴、其它几轨'}。全部在这台电脑上完成，歌曲不会上传到网上。
          </DialogDescription>
        </DialogHeader>

        {!running && (
          <div className="space-y-2" role="radiogroup" aria-label="分轨方式">
            <EngineOption
              on={engine === 'local'}
              disabled={!helper}
              onPick={() => setEngine('local')}
              icon={<Zap className="h-4 w-4" />}
              title="本机加速（推荐）"
              text={
                helper === undefined
                  ? '正在检测本机分轨服务…'
                  : helper
                    ? `已连接${gpuName ? `：${gpuName}` : '（处理器计算）'}。用 UVR 的引擎和最好的人声模型，一首歌通常几十秒。`
                    : '没有检测到。运行一次 helper\\install.bat 安装后，用 Start.bat 启动网站时会自动开启。'
              }
            />
            <EngineOption
              on={engine === 'browser'}
              onPick={() => setEngine('browser')}
              icon={hasWebGpu() ? <Monitor className="h-4 w-4" /> : <Cpu className="h-4 w-4" />}
              title="在浏览器里分轨"
              text={
                mode === 'vocals'
                  ? `不用安装任何东西，人声模型随网站自带。${hasWebGpu() ? '有显卡加速，一首歌通常一分钟以内（看显卡）。' : crossOriginIsolated ? '没有显卡加速，用处理器多线程计算，会慢一些。' : '没有显卡加速，会比较慢。'}`
                  : `不用安装任何东西。${cached ? '模型已下载。' : `第一次要从 Hugging Face 下载约 ${BROWSER_MODEL_MB} MB 的模型（之后缓存）。`}${hasWebGpu() ? '有显卡加速，一首歌大约几分钟。' : '这个浏览器不支持显卡加速，会很慢。'}`
              }
            />
          </div>
        )}

        {progress && !error && (
          <div className="space-y-2" aria-live="polite">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-cyan" aria-hidden /> {progress.text}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-cyan transition-[width]"
                style={{ width: `${Math.round(progress.ratio * 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              分轨期间可以留在这个页面做别的，别关闭网页。
            </p>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            分轨没有完成：{error}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={cancel}>
            {running ? '取消分轨' : '关闭'}
          </Button>
          {!running && (
            <Button onClick={() => void start()} disabled={helper === undefined}>
              <Scissors /> {error ? '重试' : '开始分轨'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Long file names (e.g. download hashes) shortened in the middle so the dialog keeps its width. */
function shortName(name: string, max = 36): string {
  if (name.length <= max) return name
  const keep = Math.floor((max - 1) / 2)
  return `${name.slice(0, keep)}…${name.slice(-keep)}`
}

function EngineOption({
  on,
  disabled,
  onPick,
  icon,
  title,
  text,
}: {
  on: boolean
  disabled?: boolean
  onPick: () => void
  icon: React.ReactNode
  title: string
  text: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={onPick}
      className={cn(
        'focus-ring flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-60',
        on ? 'border-amber/70 bg-amber-soft/30' : 'border-border/80 hover:border-cyan/40',
      )}
    >
      <span className="mt-0.5 text-cyan">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block break-words text-xs text-muted-foreground">{text}</span>
      </span>
    </button>
  )
}
