import { useMemo, useState } from 'react'
import { Volume2 } from 'lucide-react'
import * as engine from '@/audio/engine'
import { nearestNote } from '@/audio/pitch/analysis'
import type { DetectorPreset } from '@/audio/pitch/detector'
import { usePitchDetector } from '@/features/audio/usePitchDetector'
import { useProfileStore } from '@/features/profile/profileStore'
import { ProfileService } from '@/services/profileService'
import { BadgeService } from '@/services/badgeService'
import { toast } from '@/features/toast/toastStore'
import { BASS_STANDARD, type Tuning } from '@/music/fretboard'
import { useGuitarSetup } from '@/features/instrument/useGuitarSetup'
import { midiToFrequency, midiToName } from '@/music/pitch'
import { TunerGauge } from '@/widgets/pitch/TunerGauge'
import { RangeCalibration } from '@/widgets/pitch/RangeCalibration'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/Tabs'
import { cn } from '@/shared/lib/utils'

type Mode = 'guitar' | 'bass' | 'chromatic'

export function TunerPage() {
  const profile = useProfileStore((s) => s.profile)!
  const setProfile = useProfileStore((s) => s.set)
  const initial: Mode = profile.instrument === 'bass' ? 'bass' : profile.instrument === 'guitar' ? 'guitar' : 'chromatic'
  const [tab, setTab] = useState<'tuner' | 'range'>('tuner')

  return (
    <div className="space-y-10">
      <header>
        <div className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">Tools</div>
        <h1 className="mt-2 text-4xl font-semibold">调音器与音域</h1>
        <p className="mt-3 text-muted-foreground">麦克风只在这台电脑上做音高分析，声音不会被录下或上传。</p>
      </header>
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'tuner' | 'range')}>
        <TabsList>
          <TabsTrigger value="tuner">调音器</TabsTrigger>
          <TabsTrigger value="range">音域标定</TabsTrigger>
        </TabsList>
        <TabsContent value="tuner" className="pt-6">
          {tab === 'tuner' && <Tuner initial={initial} />}
        </TabsContent>
        <TabsContent value="range" className="pt-6">
          {tab === 'range' && (
            <RangeCalibration
              {...(profile.vocalRange ? { initial: profile.vocalRange } : {})}
              onSave={async (range) => {
                const next = await ProfileService.update({ vocalRange: range })
                setProfile(next)
                const b = await BadgeService.award('range-set')
                if (b) toast({ title: `获得徽章「${b.name}」`, description: b.description, variant: 'success' })
                toast({ title: '音域已保存', description: `${midiToName(range.low, { octave: true })} – ${midiToName(range.high, { octave: true })}`, variant: 'success' })
              }}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Tuner({ initial }: { initial: Mode }) {
  const [mode, setMode] = useState<Mode>(initial)
  const preset: DetectorPreset = mode === 'bass' ? 'bass' : mode === 'guitar' ? 'guitar' : 'voice'
  const guitar = useGuitarSetup()
  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        {(['guitar', 'bass', 'chromatic'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn('focus-ring rounded-xl border px-4 py-2 text-sm transition-colors', mode === m ? 'border-amber/70 bg-amber-soft/40' : 'border-border/80 hover:border-cyan/40')}
          >
            {m === 'guitar' ? '吉他' : m === 'bass' ? '贝斯' : '半音阶（人声 / 键盘）'}
          </button>
        ))}
      </div>
      <TunerBody key={`${mode}-${guitar.open.id}`} preset={preset} tuning={mode === 'guitar' ? guitar.open : mode === 'bass' ? BASS_STANDARD : null} />
    </div>
  )
}

function TunerBody({ preset, tuning }: { preset: DetectorPreset; tuning: Tuning | null }) {
  const mic = usePitchDetector(preset, true)
  const hz = mic.frame?.hz ?? null

  // For instruments, compare with the nearest open string.
  const reading = useMemo(() => {
    if (!hz) return null
    if (!tuning) {
      const n = nearestNote(hz)
      return { label: midiToName(n.midi, { octave: true }), cents: n.cents, string: -1 }
    }
    let best = 0
    let bestCents = Infinity
    tuning.strings.forEach((m, i) => {
      const c = 1200 * Math.log2(hz / midiToFrequency(m))
      if (Math.abs(c) < Math.abs(bestCents)) {
        bestCents = c
        best = i
      }
    })
    // Far from every open string: show the chromatic reading instead.
    if (Math.abs(bestCents) > 250) {
      const n = nearestNote(hz)
      return { label: midiToName(n.midi, { octave: true }), cents: n.cents, string: -1 }
    }
    return { label: midiToName(tuning.strings[best]!, { octave: true }), cents: Math.round(bestCents), string: best }
  }, [hz, tuning])

  if (mic.state === 'error') {
    return <p className="rounded-2xl border border-destructive/40 bg-destructive/10 p-5 text-sm">{mic.error}</p>
  }

  return (
    <div className="grid grid-cols-5 gap-8">
      <TunerGauge
        className="col-span-3"
        cents={reading?.cents ?? null}
        tolerance={5}
        label={reading?.label}
        sublabel={mic.state === 'live' ? (reading && Math.abs(reading.cents) <= 5 ? '准了' : reading ? (reading.cents > 0 ? '偏高，放松一点' : '偏低，拧紧一点') : undefined) : '正在打开麦克风…'}
        level={mic.frame?.rms ?? 0}
      />
      <div className="col-span-2 space-y-3">
        {tuning ? (
          <>
            <div className="text-sm text-muted-foreground">{tuning.name}。点击弦名听参考音，弹一根空弦看指针。</div>
            {[...tuning.strings].reverse().map((m, ri) => {
              const i = tuning.strings.length - 1 - ri
              const active = reading?.string === i
              return (
                <button
                  key={i}
                  type="button"
                  onClick={async () => {
                    await engine.ensureAudio()
                    engine.playNote(m, 2)
                  }}
                  className={cn(
                    'focus-ring flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors',
                    active ? (Math.abs(reading!.cents) <= 5 ? 'border-success/60 bg-success/15' : 'border-amber/60 bg-amber-soft/40') : 'border-border/80 bg-card hover:border-cyan/40',
                  )}
                >
                  <span>
                    <span className="num mr-3 text-xs text-muted-foreground">{tuning.strings.length - i} 弦</span>
                    <span className="font-display text-lg font-semibold">{midiToName(m, { octave: true })}</span>
                  </span>
                  <Volume2 className="h-4 w-4 text-muted-foreground" />
                </button>
              )
            })}
          </>
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">唱一个音或弹一个键，指针显示离最近的音差多少音分。±5 音分以内是准的；唱歌练习里的容差从 ±50 开始逐级收紧。</p>
        )}
      </div>
    </div>
  )
}
