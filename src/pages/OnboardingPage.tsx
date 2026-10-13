import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, CircleSlash, Guitar, Lock, Piano, type LucideIcon } from 'lucide-react'
import { INSTRUMENT_LABEL, type InstrumentId, type NotationId } from '@/entities/types'
import { ProfileService } from '@/services/profileService'
import { useProfileStore } from '@/features/profile/profileStore'
import { ensureAudio, playChord, setTimbre, timbreForInstrument } from '@/audio/engine'
import { BrandMark } from '@/widgets/brand/BrandMark'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { cn } from '@/shared/lib/utils'

const BassIcon: LucideIcon = Guitar

const INSTRUMENTS: Array<{ id: InstrumentId; icon: LucideIcon; blurb: string }> = [
  { id: 'guitar', icon: Guitar, blurb: '指板图、和弦图、六线谱，先学节奏吉他与 riff。' },
  { id: 'bass', icon: BassIcon, blurb: '四弦指板、低音线，先学与底鼓锁定。' },
  { id: 'piano', icon: Piano, blurb: '键盘手型、转位与铺底，五线谱大谱表。' },
  { id: 'none', icon: CircleSlash, blurb: '只练耳朵与理论，作曲用内置工作台完成。' },
]

const NOTATIONS: Array<{ id: NotationId; title: string; body: string; available: boolean }> = [
  { id: 'staff', title: '五线谱', body: '必修。所有人都会学，考核题始终用它。', available: true },
  { id: 'jianpu', title: '简谱', body: '首调唱名记谱。从阶段 2 起作为默认显示，前两个阶段先学五线谱。', available: true },
  { id: 'tab', title: '吉他谱', body: '六线谱 / 四线谱 + 和弦图（主乐器是吉他或贝斯时可用），阶段 2 起作为默认显示。', available: true },
]

type Step = 0 | 1 | 2 | 3

export function OnboardingPage() {
  const navigate = useNavigate()
  const profile = useProfileStore((s) => s.profile)!
  const setProfile = useProfileStore((s) => s.set)
  const [step, setStep] = useState<Step>(0)
  const [name, setName] = useState(profile.displayName)
  const [instrument, setInstrument] = useState<InstrumentId>(profile.setupDone ? profile.instrument : 'guitar')
  const [second, setSecond] = useState<InstrumentId>(profile.secondInstrument ?? 'none')
  const [notation, setNotation] = useState<NotationId>('staff')
  const [saving, setSaving] = useState(false)

  const preview = async (id: InstrumentId) => {
    await ensureAudio()
    setTimbre(timbreForInstrument(id))
    const root = id === 'bass' ? 40 : 52
    playChord(id === 'bass' ? [root, root + 7] : [root, root + 7, root + 12, root + 16], 1.2)
  }

  const finish = async () => {
    setSaving(true)
    try {
      const next = await ProfileService.setup({ displayName: name, instrument, secondInstrument: second, notation })
      setProfile(next)
      navigate(next.placementDone ? '/camp' : '/placement')
    } finally {
      setSaving(false)
    }
  }

  const steps = ['怎么称呼你', '主乐器', '第二乐器', '记谱方式']

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col px-8 py-12">
      <div className="mb-12 flex items-center gap-3">
        <BrandMark className="h-8 w-8" />
        <span className="font-display font-semibold">律动工坊</span>
        <div className="ml-auto flex items-center gap-2">
          {steps.map((s, i) => (
            <span
              key={s}
              className={cn('h-1.5 w-10 rounded-full transition-colors', i <= step ? 'bg-amber' : 'bg-muted')}
              aria-label={`${s}${i < step ? '（已完成）' : ''}`}
            />
          ))}
        </div>
      </div>

      <div key={step} className="flex-1 animate-rise">
        <div className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">Step {step + 1} / 4</div>
        <h1 className="mt-3 text-4xl font-semibold">{steps[step]}</h1>

        {step === 0 && (
          <div className="mt-10 max-w-md space-y-3">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 24))}
              placeholder="昵称（可以留空）"
              className="h-12 text-base"
              onKeyDown={(e) => e.key === 'Enter' && setStep(1)}
            />
            <p className="text-sm text-muted-foreground">只保存在这台电脑上。</p>
          </div>
        )}

        {step === 1 && (
          <>
            <p className="mt-3 text-muted-foreground">它决定课程的示例、可视化和每天的动手任务。乐理内容对所有人都一样，随时可以改。</p>
            <div className="mt-8 grid grid-cols-2 gap-4">
              {INSTRUMENTS.map(({ id, icon: Icon, blurb }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setInstrument(id)
                    if (id !== 'none') void preview(id)
                    if (second === id) setSecond('none')
                  }}
                  className={cn(
                    'focus-ring group relative rounded-2xl border p-6 text-left transition-all duration-200 hover:-translate-y-0.5',
                    instrument === id ? 'border-amber/70 bg-amber-soft/40 shadow-soft' : 'border-border/80 bg-card hover:border-cyan/40',
                  )}
                >
                  <Icon className={cn('h-7 w-7', instrument === id ? 'text-amber' : 'text-muted-foreground', id === 'bass' && 'rotate-12')} />
                  <div className="mt-5 font-display text-xl font-semibold">{INSTRUMENT_LABEL[id]}</div>
                  <p className="mt-1.5 text-sm text-muted-foreground">{blurb}</p>
                  {instrument === id && <Check className="absolute right-5 top-5 h-5 w-5 text-amber" />}
                </button>
              ))}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <p className="mt-3 text-muted-foreground">手边还有别的乐器吗？训练营里会多出它的乐器任务，想练的时候自己选。</p>
            <div className="mt-8 grid grid-cols-2 gap-4">
              {INSTRUMENTS.filter((i) => i.id !== instrument).map(({ id, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSecond(id)}
                  className={cn(
                    'focus-ring flex items-center gap-4 rounded-2xl border p-5 text-left transition-colors',
                    second === id ? 'border-amber/70 bg-amber-soft/40' : 'border-border/80 bg-card hover:border-cyan/40',
                  )}
                >
                  <Icon className={cn('h-6 w-6', second === id ? 'text-amber' : 'text-muted-foreground')} />
                  <span className="font-medium">{id === 'none' ? '没有第二乐器' : INSTRUMENT_LABEL[id]}</span>
                  {second === id && <Check className="ml-auto h-5 w-5 text-amber" />}
                </button>
              ))}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <p className="mt-3 text-muted-foreground">同一份音乐可以用三种谱来看，随时切换。五线谱是必修：阶段 0–1 只用五线谱，从阶段 2 开始按你选的方式默认显示。</p>
            <div className="mt-8 space-y-3">
              {NOTATIONS.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  disabled={!n.available || (n.id === 'tab' && instrument !== 'guitar' && instrument !== 'bass')}
                  onClick={() => setNotation(n.id)}
                  className={cn(
                    'focus-ring flex w-full items-center gap-4 rounded-2xl border p-5 text-left transition-colors disabled:cursor-not-allowed',
                    notation === n.id ? 'border-amber/70 bg-amber-soft/40' : 'border-border/80 bg-card',
                    (!n.available || (n.id === 'tab' && instrument !== 'guitar' && instrument !== 'bass')) && 'opacity-55',
                  )}
                >
                  <div className="flex-1">
                    <div className="font-display text-lg font-semibold">{n.title}</div>
                    <div className="text-sm text-muted-foreground">{n.body}</div>
                  </div>
                  {n.available ? notation === n.id && <Check className="h-5 w-5 text-amber" /> : <Lock className="h-4 w-4 text-muted-foreground" />}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="mt-12 flex items-center justify-between">
        <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1) as Step)} disabled={step === 0}>
          <ArrowLeft /> 上一步
        </Button>
        {step < 3 ? (
          <Button size="lg" onClick={() => setStep((s) => (s + 1) as Step)}>
            下一步 <ArrowRight />
          </Button>
        ) : (
          <Button size="lg" onClick={() => void finish()} disabled={saving}>
            {profile.placementDone ? '保存' : '开始入门测试'} <ArrowRight />
          </Button>
        )}
      </div>
    </div>
  )
}
