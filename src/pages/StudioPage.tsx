import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FilePlus2, FileUp, Save } from 'lucide-react'
import { useRef } from 'react'
import { SongService, ImportError } from '@/services/songService'
import { emptyScore, type Score } from '@/music/score'
import type { Composition } from '@/entities/types'
import { CompositionService } from '@/services/courseService'
import { BadgeService } from '@/services/badgeService'
import { useProfileStore } from '@/features/profile/profileStore'
import { toast } from '@/features/toast/toastStore'
import { StudioWorkspace } from '@/widgets/studio/StudioWorkspace'
import { VersionHistoryButton } from '@/widgets/studio/VersionHistory'
import { ensureTracks } from '@/music/arrangement'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'

function starterScore(chordsUnlocked: boolean): Score {
  return emptyScore({
    bars: 8,
    accompaniment: chordsUnlocked ? { comp: 'block', bass: 'roots', drums: 'pop' } : { comp: 'off', bass: 'off', drums: 'off' },
  })
}

export function StudioPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const profile = useProfileStore((s) => s.profile)!
  const stage = profile.unlockedStage
  const features = { melody: true, chords: stage >= 2, lyrics: stage >= 3, keyEditable: true, barsEditable: true, advancedChords: stage >= 4 }
  const [score, setScore] = useState<Score>(() => starterScore(features.chords))
  const [title, setTitle] = useState('未命名')
  const [comp, setComp] = useState<Composition | null>(null)
  const [dirty, setDirty] = useState(false)
  const [loadKey, setLoadKey] = useState(0)
  const openId = params.get('id')
  const id = comp?.id ?? null
  const importInput = useRef<HTMLInputElement>(null)

  const importFile = async (file: File) => {
    try {
      const p = await SongService.importFile(file)
      if (!p.score) {
        toast({ title: '这个文件是六线谱', description: '六线谱请到“曲库”里导入，在那里可以按谱练习。', variant: 'info' })
        return
      }
      setScore(p.score)
      setTitle(p.title)
      setComp(null)
      setDirty(true)
      setLoadKey((k) => k + 1)
      navigate('/studio', { replace: true })
      toast({ title: `已导入「${p.title}」`, description: p.warnings.length ? p.warnings.join(' ') : '记得保存。', variant: p.warnings.length ? 'info' : 'success' })
    } catch (e) {
      toast({ title: '导入失败', description: e instanceof ImportError ? e.message : String(e), variant: 'error' })
    }
  }

  const load = (c: Composition) => {
    if (!c.score) return
    setScore(c.score)
    setTitle(c.title)
    setComp(c)
    setDirty(false)
    setLoadKey((k) => k + 1)
  }

  useEffect(() => {
    if (!openId) return
    void CompositionService.get(openId).then((c) => {
      if (c?.project === 'graduation') navigate('/graduation', { replace: true })
      else if (c) load(c)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId])

  const save = async (): Promise<string | null> => {
    const saved = await CompositionService.save({
      ...(id ? { id } : {}),
      title: title.trim() || '未命名',
      kind: 'song',
      stage,
      bpm: score.bpm,
      steps: score.bars * score.beatsPerBar,
      cells: [],
      score,
    })
    setComp(saved)
    setDirty(false)
    if (!openId) navigate(`/studio?id=${saved.id}`, { replace: true })
    toast({ title: '已保存到作品集', variant: 'success' })
    const fullHarmony = score.bars >= 8 && Array.from({ length: score.bars }, (_, b) => score.chords.some((c) => c.start < (b + 1) * 4 && c.start + c.beats > b * 4)).every(Boolean)
    if (fullHarmony && score.melody.length >= 16) {
      const b = await BadgeService.award('first-song')
      if (b) toast({ title: `获得徽章「${b.name}」`, description: b.description, variant: 'success' })
    }
    const audibleTracks = ensureTracks(score).filter((t) => !t.mute).length + (score.melody.length ? 1 : 0)
    if (fullHarmony && audibleTracks >= 4 && (score.sections?.length ?? 0) >= 2) {
      const b = await BadgeService.award('first-arrangement')
      if (b) toast({ title: `获得徽章「${b.name}」`, description: b.description, variant: 'success' })
    }
    return saved.id
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">Studio</div>
          <h1 className="mt-2 text-4xl font-semibold">作曲工作台</h1>
          <p className="mt-2 text-muted-foreground">写旋律、配和弦、加歌词，再编成多轨作品，请规则引擎和 AI 点评，最后导出。</p>
        </div>
        <div className="flex items-center gap-2">
          <Input value={title} onChange={(e) => { setTitle(e.target.value.slice(0, 40)); setDirty(true) }} className="w-48" aria-label="作品名" />
          {comp && <VersionHistoryButton composition={comp} onRestored={load} />}
          <Button variant="outline" onClick={() => importInput.current?.click()} title="导入 MIDI 或 MusicXML">
            <FileUp /> 导入
          </Button>
          <input
            ref={importInput}
            type="file"
            accept=".mid,.midi,.musicxml,.xml,.mxl,.txt"
            className="hidden"
            aria-label="导入乐谱文件"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void importFile(f)
            }}
          />
          <Button variant="outline" onClick={() => { setScore(starterScore(features.chords)); setTitle('未命名'); setComp(null); setDirty(false); setLoadKey((k) => k + 1); navigate('/studio') }}>
            <FilePlus2 /> 新建
          </Button>
          <Button onClick={() => void save()}>
            <Save /> {id ? (dirty ? '保存修改' : '已保存') : '保存'}
          </Button>
        </div>
      </header>
      <StudioWorkspace
        score={score}
        onChange={(s) => {
          setScore(s)
          setDirty(true)
        }}
        compositionId={id}
        title={title}
        dirty={dirty}
        onSave={save}
        features={features}
        arrangeUnlocked={stage >= 5}
        instrument={profile.instrument}
        editorKey={`${id ?? 'new'}-${loadKey}`}
        onExported={() => id && void CompositionService.markExported(id)}
      />
    </div>
  )
}
