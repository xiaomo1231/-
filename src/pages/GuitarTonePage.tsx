import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { AmpRack } from '@/widgets/guitar/AmpRack'
import { MonitorToggle } from '@/widgets/guitar/MonitorToggle'
import { useTimbreOverride } from '@/features/audio/useTimbreOverride'

/** Tone: monitor, presets, pedals and amp. */
export function GuitarTonePage() {
  useTimbreOverride('guitar')
  return (
    <div className="space-y-8">
      <Link to="/guitar" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> 吉他工坊
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">Tone</div>
          <h1 className="mt-2 text-4xl font-semibold">音色</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            噪声门、压缩、过载、失真、音箱、箱体、合唱、延迟、混响，按这个顺序串在一起。打开监听后，改动立刻就能听到，并自动保存。这些效果只影响你听到的声音，不影响任何判定。
          </p>
        </div>
        <MonitorToggle />
      </header>
      <AmpRack />
    </div>
  )
}
