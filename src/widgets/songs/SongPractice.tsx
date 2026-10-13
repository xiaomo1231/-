import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, PenLine, Play, Square } from 'lucide-react'
import * as engine from '@/audio/engine'
import { melodyTab, strumChart } from '@/songs/practice'
import { CompositionService } from '@/services/courseService'
import { STRUM_PATTERNS } from '@/guitar/strum'
import type { TabNote } from '@/guitar/scales'
import type { Score } from '@/music/score'
import { useProfileStore } from '@/features/profile/profileStore'
import { useGuitarSetup } from '@/features/instrument/useGuitarSetup'
import { toast } from '@/features/toast/toastStore'
import { ScoreNotation } from '@/widgets/notation/ScoreNotation'
import { StrumPractice } from '@/widgets/guitar/StrumPractice'
import { LeadPlay } from '@/widgets/guitar/LeadPlay'
import { LeadTab } from '@/widgets/guitar/LeadTab'
import { Button } from '@/shared/ui/Button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/Tabs'
import { TransposeControl } from '@/widgets/sheets/TransposeControl'
import { clampTranspose, transposeScore, transposeTab, transposedKey } from '@/songs/transpose'

export interface SongView {
  title: string
  subtitle: string
  note?: string
  score?: Score
  tab?: TabNote[]
  pattern: string
  bpm: number
}

const LENGTHS = [4, 8, 16]

/** Score, playback, strumming and melody practice for one song (library song or simple import). */
export function SongPractice({ view, header, transpose: initialTranspose = 0, onTranspose }: { view: SongView; header?: ReactNode; transpose?: number; onTranspose?: (n: number) => void }) {
  const navigate = useNavigate()
  const stage = useProfileStore((s) => s.profile?.unlockedStage ?? 0)
  const { played } = useGuitarSetup()
  const [playing, setPlaying] = useState(false)
  const [fromBar, setFromBar] = useState(0)
  const [length, setLength] = useState(8)
  const [pattern, setPattern] = useState(view.pattern)
  const [transpose, setTranspose] = useState(clampTranspose(initialTranspose))
  // 变调: the score moves to the new key; a written tab moves its frets.
  const score = useMemo(() => (view.score ? transposeScore(view.score, transpose) : undefined), [view.score, transpose])
  const tab = useMemo(() => (view.tab ? transposeTab(view.tab, transpose) : undefined), [view.tab, transpose])
  const bars = score?.bars ?? 0
  const changeTranspose = (n: number) => {
    const t = clampTranspose(n)
    setTranspose(t)
    onTranspose?.(t)
  }

  useEffect(() => () => engine.stopArrangement(), [])

  const chart = useMemo(
    () => (score ? strumChart(score, fromBar, Math.min(length, bars - fromBar)) : null),
    [score, fromBar, length, bars],
  )
  const lead = useMemo(
    () =>
      tab
        ? { notes: tab, shift: 0 }
        : score
          ? melodyTab(score, played, fromBar, Math.min(length, bars - fromBar))
          : { notes: [], shift: 0 },
    [tab, score, played, fromBar, length, bars],
  )

  const play = async () => {
    if (!score) return
    if (playing) {
      engine.stopArrangement()
      setPlaying(false)
      return
    }
    const { endAt } = await engine.playScore(score)
    setPlaying(true)
    engine.onAudioTime(endAt, () => setPlaying(false))
  }

  const openInStudio = async () => {
    if (!score) return
    const c = await CompositionService.save({
      title: view.title,
      kind: 'song',
      stage,
      bpm: score.bpm,
      steps: score.bars * 4,
      cells: [],
      score,
    })
    toast({
      title: '已复制到作品集',
      description: '在作曲台里改编不会影响曲库里的原谱。',
      variant: 'success',
    })
    navigate(`/studio?id=${c.id}`)
  }

  const sectionPicker = score && bars > 4 && (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-2">
        从第
        <select
          value={fromBar}
          onChange={(e) => setFromBar(Number(e.target.value))}
          className="focus-ring h-9 rounded-lg border border-border bg-background px-2"
          aria-label="起始小节"
        >
          {Array.from({ length: Math.max(1, bars - 1) }, (_, b) => (
            <option key={b} value={b}>
              {b + 1}
            </option>
          ))}
        </select>
        小节开始，练
        <select
          value={length}
          onChange={(e) => setLength(Number(e.target.value))}
          className="focus-ring h-9 rounded-lg border border-border bg-background px-2"
          aria-label="练习小节数"
        >
          {LENGTHS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        小节
      </label>
    </div>
  )

  const actions = (
    <div className="flex gap-2">
      {score && (
        <Button variant="outline" onClick={() => void play()}>
          {playing ? <Square /> : <Play />} {playing ? '停止' : '播放'}
        </Button>
      )}
      {score && (
        <Button variant="outline" onClick={() => void openInStudio()}>
          <PenLine /> 在作曲台打开
        </Button>
      )}
    </div>
  )

  return (
    <div className="space-y-6">
      {header ? (
        <>
          {header}
          {score && <div className="-mt-2">{actions}</div>}
        </>
      ) : (
        <>
          <Link
            to="/songs"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> 曲库
          </Link>
          <header className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-4xl font-semibold">{view.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{view.subtitle}</p>
              {view.note && <p className="mt-2 max-w-2xl text-muted-foreground">{view.note}</p>}
            </div>
            {actions}
          </header>
        </>
      )}
      <TransposeControl value={transpose} onChange={changeTranspose} {...(view.score ? { keyLabel: transpose ? `${transposedKey(view.score.keyTonic, view.score.mode, transpose)}（原调 ${transposedKey(view.score.keyTonic, view.score.mode, 0)}）` : `原调 ${transposedKey(view.score.keyTonic, view.score.mode, 0)}` } : {})} />
      <Tabs defaultValue={score ? 'score' : 'lead'}>
        <TabsList>
          {score && <TabsTrigger value="score">乐谱</TabsTrigger>}
          {chart && <TabsTrigger value="strum">练扫弦</TabsTrigger>}
          {lead.notes.length > 0 && <TabsTrigger value="lead">弹旋律</TabsTrigger>}
        </TabsList>
        {score && (
          <TabsContent value="score" className="pt-5">
            <ScoreNotation score={score} chordLabels="symbol" />
          </TabsContent>
        )}
        {chart && score && (
          <TabsContent value="strum" className="space-y-4 pt-5">
            <div className="flex flex-wrap items-center gap-4">
              {sectionPicker}
              <label className="flex items-center gap-2 text-sm">
                节奏型
                <select
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  className="focus-ring h-9 rounded-lg border border-border bg-background px-2"
                >
                  {STRUM_PATTERNS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {chart.filled > 0 && (
              <p className="text-xs text-muted-foreground">
                有 {chart.filled} 个小节没有和弦，沿用了前一个和弦。
              </p>
            )}
            <StrumPractice
              key={`${fromBar}-${length}-${pattern}-${transpose}`}
              segments={[{ pattern, romans: chart.romans, bars: chart.romans.length }]}
              tonic={chart.tonic}
              bpm={score.bpm}
              pass={0.75}
              onTake={() => undefined}
            />
          </TabsContent>
        )}
        {lead.notes.length > 0 && (
          <TabsContent value="lead" className="space-y-4 pt-5">
            {!tab && sectionPicker}
            {lead.shift !== 0 && (
              <p className="text-xs text-muted-foreground">
                为了适合吉他的音域，旋律整体{lead.shift > 0 ? '升高' : '降低'}了{' '}
                {Math.abs(lead.shift / 12)} 个八度。
              </p>
            )}
            {lead.notes.length > 48 ? (
              <>
                <p className="text-sm text-muted-foreground">
                  这一段有 {lead.notes.length} 个音，太长了。选短一点的段落再练。
                </p>
                <LeadTab notes={lead.notes} />
              </>
            ) : (
              <LeadPlay
                key={`${fromBar}-${length}-${transpose}`}
                source={{ type: 'notes', name: view.title, notes: lead.notes }}
                bpm={Math.min(view.bpm, 100)}
                onDone={() => undefined}
              />
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
