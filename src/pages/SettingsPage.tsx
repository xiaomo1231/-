import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, Download, Guitar, KeyRound, Mic, Moon, Piano, RotateCcw, Sun, Trash2, CircleSlash } from 'lucide-react'
import { RangeCalibration } from '@/widgets/pitch/RangeCalibration'
import { BadgeService } from '@/services/badgeService'
import { midiToName } from '@/music/pitch'
import { INSTRUMENT_LABEL, type InstrumentId } from '@/entities/types'
import { ProfileService } from '@/services/profileService'
import { SettingsService } from '@/services/settingsService'
import { ImportError, exportAllData, importAllData, parseBackup, resetAllData } from '@/services/dataService'
import { useProfileStore } from '@/features/profile/profileStore'
import { toast } from '@/features/toast/toastStore'
import { PROVIDER_PRESETS, createProvider, getPreset, type AIProviderId } from '@/infrastructure/ai/presets'
import { LatencyCalibration } from '@/widgets/settings/LatencyCalibration'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/Dialog'
import { cn } from '@/shared/lib/utils'
import { TrainingTimbre } from '@/widgets/settings/TrainingTimbre'
import { GUITAR_TUNINGS, type GuitarTuningId } from '@/music/fretboard'

const INSTRUMENT_ICON: Record<InstrumentId, typeof Guitar> = { guitar: Guitar, bass: Guitar, piano: Piano, none: CircleSlash }

export function SettingsPage() {
  const navigate = useNavigate()
  const profile = useProfileStore((s) => s.profile)!
  const setProfile = useProfileStore((s) => s.set)
  const [name, setName] = useState(profile.displayName)
  const [confirmReset, setConfirmReset] = useState(false)
  const [calibrating, setCalibrating] = useState(false)
  const [pendingImport, setPendingImport] = useState<{ text: string; name: string; works: number; attempts: number } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // Links like /settings#ai jump to that section.
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' })
  }, [])
  const playsGuitar = profile.instrument === 'guitar' || profile.secondInstrument === 'guitar'

  const save = async (patch: Parameters<typeof ProfileService.update>[0], message?: string) => {
    const next = await ProfileService.update(patch)
    setProfile(next)
    if (message) toast({ title: message, variant: 'success' })
  }

  return (
    <div className="max-w-3xl space-y-10">
      <header>
        <div className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">Settings</div>
        <h1 className="mt-2 text-4xl font-semibold">设置</h1>
      </header>

      <Section title="个人与乐器">
        <div className="space-y-6">
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="name">昵称</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value.slice(0, 24))} />
            </div>
            <Button variant="outline" onClick={() => void save({ displayName: name.trim() }, '已保存')} disabled={name.trim() === profile.displayName}>
              保存
            </Button>
          </div>
          <InstrumentPicker
            label="主乐器"
            value={profile.instrument}
            onChange={(v) =>
              void save({ instrument: v, ...(profile.secondInstrument === v ? { secondInstrument: undefined } : {}) }, `主乐器：${INSTRUMENT_LABEL[v]}`)
            }
          />
          <InstrumentPicker
            label="第二乐器"
            value={profile.secondInstrument ?? 'none'}
            exclude={profile.instrument}
            onChange={(v) => void save({ secondInstrument: v === 'none' ? undefined : v }, `第二乐器：${v === 'none' ? '无' : INSTRUMENT_LABEL[v]}`)}
          />
          <p className="text-xs text-muted-foreground">听辨题的默认音色跟随主乐器；训练营里会出现对应的乐器任务。五线谱始终必修。</p>
          {playsGuitar && (
            <div className="grid grid-cols-2 gap-4 rounded-2xl border border-border/70 bg-background/40 p-4">
              <div className="space-y-2">
                <Label htmlFor="tuning">吉他调弦</Label>
                <select
                  id="tuning"
                  className="focus-ring h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
                  value={profile.guitarTuning ?? 'standard'}
                  onChange={(e) => void save({ guitarTuning: e.target.value as GuitarTuningId }, '调弦已更新')}
                >
                  {(Object.keys(GUITAR_TUNINGS) as GuitarTuningId[]).map((id) => (
                    <option key={id} value={id}>
                      {GUITAR_TUNINGS[id].name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="capo">变调夹</Label>
                <select
                  id="capo"
                  className="focus-ring h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
                  value={profile.capo ?? 0}
                  onChange={(e) => void save({ capo: Number(e.target.value) }, '变调夹已更新')}
                >
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? '不用' : `第 ${n} 品`}
                    </option>
                  ))}
                </select>
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">指板、六线谱和和弦图会按你的调弦和变调夹显示。用了变调夹时，和弦图给出实际要按的指型，比如变调夹 2 品弹 A 和弦要按 G 型。调音器按空弦音调。</p>
            </div>
          )}
        </div>
      </Section>

      <Section title="记谱方式">
        <div className="grid grid-cols-3 gap-3">
          {([
            ['staff', '五线谱', '必修，考核题始终用它'],
            ['jianpu', '简谱', '首调唱名，1 = 主音'],
            ['tab', profile.instrument === 'bass' ? '四线谱' : '六线谱', '吉他 / 贝斯的指法谱'],
          ] as const).map(([id, title, body]) => {
            const disabled = id === 'tab' && profile.instrument !== 'guitar' && profile.instrument !== 'bass'
            return (
              <button
                key={id}
                type="button"
                disabled={disabled}
                onClick={() => void save({ notation: id }, `默认记谱：${title}`)}
                className={cn(
                  'focus-ring rounded-2xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  profile.notation === id ? 'border-amber/70 bg-amber-soft/40' : 'border-border/80 bg-card hover:border-cyan/40',
                )}
              >
                <div className="font-medium">{title}</div>
                <div className="text-xs text-muted-foreground">{body}</div>
              </button>
            )
          })}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {profile.unlockedStage >= 2 ? '每个谱面上方都可以临时切换。' : '阶段 0–1 先用五线谱打基础；进入阶段 2 后会按这里的选择默认显示。'}
        </p>
      </Section>

      <Section title="外观">
        <div className="flex gap-3">
          {(['dark', 'light'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => void save({ theme: m })}
              className={cn(
                'focus-ring flex flex-1 items-center gap-3 rounded-2xl border p-4 text-left transition-colors',
                profile.theme === m ? 'border-amber/70 bg-amber-soft/40' : 'border-border/80 bg-card hover:border-cyan/40',
              )}
            >
              {m === 'dark' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
              <div>
                <div className="font-medium">{m === 'dark' ? '夜间录音室' : '日间排练房'}</div>
                <div className="text-xs text-muted-foreground">{m === 'dark' ? '深色，默认' : '浅色'}</div>
              </div>
            </button>
          ))}
        </div>
        <div className="mt-6">
          <TrainingTimbre profile={profile} onChange={(v) => void save({ trainingTimbre: v })} />
        </div>
      </Section>

      <Section title="音域与音准">
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {profile.vocalRange
                ? `当前舒适音域：${midiToName(profile.vocalRange.low, { octave: true })} – ${midiToName(profile.vocalRange.high, { octave: true })}`
                : '还没有标定音域。第一次做唱歌练习时会提示你标定。'}
            </p>
            <Button variant="outline" onClick={() => setCalibrating((c) => !c)}>
              <Mic /> {calibrating ? '收起' : profile.vocalRange ? '重新标定' : '现在标定'}
            </Button>
          </div>
          {calibrating && (
            <RangeCalibration
              {...(profile.vocalRange ? { initial: profile.vocalRange } : {})}
              onSave={async (range) => {
                await save({ vocalRange: range }, '音域已保存')
                await BadgeService.award('range-set')
                setCalibrating(false)
              }}
            />
          )}
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border/80 p-4">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-[hsl(var(--amber))]"
              checked={profile.octaveEquivalence}
              onChange={(e) => void save({ octaveEquivalence: e.target.checked })}
            />
            <span>
              <span className="font-medium">八度等价</span>
              <span className="block text-sm text-muted-foreground">
                单音模仿、音程和级数演唱时，唱在高或低八度也算对（男声跟着钢琴参考音唱很常见）。音阶、视唱和模唱始终按准确音高评分。
              </span>
            </span>
          </label>
        </div>
      </Section>

      <Section title="节奏延迟标定">
        <LatencyCalibration current={profile.deviceLatencyMs} onSave={(ms) => save({ deviceLatencyMs: ms }, `已保存补偿值 ${ms}ms`)} />
      </Section>

      <Section title="入门测试">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {profile.placementDone ? '重新测一次会按新结果调整各模块的起始级别（不会降低已解锁的级别）。' : '还没有做入门测试。'}
          </p>
          <Button variant="outline" onClick={() => navigate('/placement')}>
            <RotateCcw /> {profile.placementDone ? '重新测试' : '开始测试'}
          </Button>
        </div>
      </Section>

      <Section title="AI 导师（可选）" id="ai">
        <AISettingsForm />
      </Section>

      <Section title="数据">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            onClick={async () => {
              const json = await exportAllData()
              const blob = new Blob([json], { type: 'application/json' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `groovelab-${new Date().toISOString().slice(0, 10)}.json`
              a.click()
              URL.revokeObjectURL(url)
            }}
          >
            <Download /> 导出练习数据
          </Button>
          <Button variant="outline" onClick={() => fileInput.current?.click()}>
            <Upload /> 从备份恢复
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label="选择备份文件"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              const text = await file.text()
              try {
                const { counts } = parseBackup(text)
                setPendingImport({ text, name: file.name, works: counts.compositions ?? 0, attempts: counts.drillAttempts ?? 0 })
              } catch (err) {
                toast({ title: '不能导入这个文件', description: err instanceof ImportError ? err.message : String(err), variant: 'error' })
              }
            }}
          />
          <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmReset(true)}>
            <Trash2 /> 清空全部数据
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">所有数据只存在这台电脑的浏览器里。换浏览器或清除站点数据前，请先导出备份。导出文件包含练习记录、课程进度、作品和版本历史，不包含 API 密钥。</p>
      </Section>

      <Dialog open={pendingImport !== null} onOpenChange={(o) => !o && setPendingImport(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>用备份替换现在的数据？</DialogTitle>
            <DialogDescription>
              「{pendingImport?.name}」包含 {pendingImport?.works ?? 0} 首作品、{pendingImport?.attempts ?? 0} 条练习记录。导入会替换这台电脑上现有的练习数据和作品（AI 设置保留），无法撤销。建议先导出一份当前数据。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingImport(null)}>
              取消
            </Button>
            <Button
              onClick={async () => {
                if (!pendingImport) return
                try {
                  await importAllData(pendingImport.text)
                  window.location.assign('/camp')
                } catch (err) {
                  setPendingImport(null)
                  toast({ title: '导入失败，数据没有改变', description: err instanceof ImportError ? err.message : String(err), variant: 'error' })
                }
              }}
            >
              确认导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>清空全部数据？</DialogTitle>
            <DialogDescription>练习记录、掌握度、段位、徽章、入门测试结果和 AI 设置都会被删除，无法恢复。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                await resetAllData()
                window.location.assign('/')
              }}
            >
              确认清空
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-6 rounded-3xl border border-border/80 bg-card p-7 surface-gradient">
      <h2 className="mb-5 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function InstrumentPicker({
  label,
  value,
  onChange,
  exclude,
}: {
  label: string
  value: InstrumentId
  onChange: (v: InstrumentId) => void
  exclude?: InstrumentId
}) {
  const ids = (Object.keys(INSTRUMENT_LABEL) as InstrumentId[]).filter((i) => i !== exclude || i === 'none')
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="grid grid-cols-4 gap-2">
        {ids.map((id) => {
          const Icon = INSTRUMENT_ICON[id]
          return (
            <button
              key={id}
              type="button"
              onClick={() => id !== value && onChange(id)}
              className={cn(
                'focus-ring flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition-colors',
                value === id ? 'border-amber/70 bg-amber-soft/40' : 'border-border/80 hover:border-cyan/40',
              )}
            >
              <Icon className={cn('h-4 w-4', id === 'bass' && 'rotate-12', value === id ? 'text-amber' : 'text-muted-foreground')} />
              {id === 'none' && label === '第二乐器' ? '无' : INSTRUMENT_LABEL[id]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function AISettingsForm() {
  const [provider, setProvider] = useState<AIProviderId>('deepseek')
  const [baseURL, setBaseURL] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void SettingsService.getMasked().then((s) => {
      if (!s) return
      setProvider(s.provider)
      setBaseURL(s.baseURL)
      setModel(s.model)
      setHasKey(s.hasKey)
    })
  }, [])

  const preset = getPreset(provider)

  const saveSettings = async () => {
    setBusy(true)
    try {
      await SettingsService.save({ provider, baseURL, model, apiKey })
      setApiKey('')
      setHasKey(true)
      toast({ title: 'AI 设置已保存', description: '密钥已加密保存在本机。', variant: 'success' })
    } catch (e) {
      toast({ title: '保存失败', description: e instanceof Error ? e.message : String(e), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setBusy(true)
    try {
      const cfg = await SettingsService.providerConfig()
      if (!cfg) {
        toast({ title: '还没有保存密钥', description: '先填写 API 密钥并保存，再测试连接。', variant: 'warning' })
        return
      }
      const r = await createProvider(cfg).testConnection()
      toast(
        r.ok
          ? { title: `连接成功 · ${r.model}`, description: `延迟 ${r.latencyMs}ms`, variant: 'success' }
          : { title: '连接失败', description: r.error ?? '请检查 Base URL、模型名和密钥。', variant: 'error' },
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        接入后可以使用：AI 专项练习、混淆解释、本周训练建议、作品点评、课内问答。没有 AI 时，所有训练、课程和作曲功能照常可用。
      </p>
      <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        <li>只会发给你配置的 AI 服务商，而且只发当前任务需要的符号化数据：掌握度摘要、混淆记录、作品的音符 / 和弦 / 段落、课文和你的问题。</li>
        <li>录音和麦克风信号永远不会上传。</li>
        <li>AI 不会替你写旋律或和弦；它出的题都要先通过本地检查，判分也在本地完成。</li>
        <li>API 密钥加密保存在本机，不会出现在导出文件里。</li>
      </ul>
      <div className="grid grid-cols-3 gap-2">
        {PROVIDER_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setProvider(p.id)
              setBaseURL('')
              setModel('')
            }}
            className={cn(
              'focus-ring rounded-xl border px-3 py-2 text-left text-sm transition-colors',
              provider === p.id ? 'border-amber/70 bg-amber-soft/40' : 'border-border/80 hover:border-cyan/40',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="baseurl">Base URL</Label>
          <Input id="baseurl" value={baseURL} placeholder={preset.baseURL || 'https://…/v1'} onChange={(e) => setBaseURL(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="model">模型</Label>
          <Input id="model" value={model} placeholder={preset.defaultModel || '模型名称'} onChange={(e) => setModel(e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="apikey" className="flex items-center gap-2">
          <KeyRound className="h-3.5 w-3.5" /> API 密钥
        </Label>
        <Input
          id="apikey"
          type="password"
          autoComplete="off"
          value={apiKey}
          placeholder={hasKey ? '已保存（留空则保持不变）' : 'sk-…'}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={() => void saveSettings()} disabled={busy || (!apiKey && !hasKey)}>
          保存
        </Button>
        <Button variant="outline" onClick={() => void test()} disabled={busy || !hasKey}>
          测试连接
        </Button>
        {hasKey && (
          <Button
            variant="ghost"
            onClick={async () => {
              await SettingsService.clearKey()
              setHasKey(false)
              toast({ title: '已删除密钥' })
            }}
          >
            删除密钥
          </Button>
        )}
      </div>
    </div>
  )
}
