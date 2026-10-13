import { useMemo, useState } from 'react'
import type { model } from '@coderline/alphatab'
import type { SongSheet } from '@/entities/types'
import { trackChordChart, trackToTab } from '@/import/gpImport'
import { transposeLabel, transposeScore, transposeTab, type GuitarWay } from '@/songs/transpose'
import { chordChartToScore } from '@/import/chordChart'
import { strumChart } from '@/songs/practice'
import { STRUM_PATTERNS } from '@/guitar/strum'
import { GUITAR_TUNINGS } from '@/music/fretboard'
import { matchTuning } from '@/songs/tuningMatch'
import { midiToName } from '@/music/pitch'
import { useGuitarSetup } from '@/features/instrument/useGuitarSetup'
import { useProfileStore } from '@/features/profile/profileStore'
import { ProfileService } from '@/services/profileService'
import { SongService } from '@/services/songService'
import { toast } from '@/features/toast/toastStore'
import { LeadPlay } from '@/widgets/guitar/LeadPlay'
import { LeadTab } from '@/widgets/guitar/LeadTab'
import { StrumPractice } from '@/widgets/guitar/StrumPractice'
import { Button } from '@/shared/ui/Button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/Tabs'
import type { BarRange } from './AlphaTabView'

const MAX_NOTES = 48

const sameStrings = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * Practising a part of a Guitar Pro sheet with the site's detection: the
 * chosen track and bars as a melody (LeadPlay), or the written chord names as
 * a strumming chart. Best scores are kept per track and bar range.
 */
export function GpPractice({ sheet, score, track, range, transpose = 0, way = 'capo' }: { sheet: SongSheet; score: model.Score; track: number; range: BarRange; transpose?: number; way?: GuitarWay }) {
  const { open, played, capo } = useGuitarSetup()
  const setProfile = useProfileStore((s) => s.set)
  const [pattern, setPattern] = useState(sheet.pattern ?? 'pop')
  const info = sheet.tracks?.find((t) => t.index === track)
  const tab = useMemo(() => trackToTab(score, track, range.from, range.to), [score, track, range.from, range.to])
  // 变调: move the frets, or keep them and put a capo on (see songs/transpose.ts).
  const moved = transpose !== 0 && way === 'frets'
  const notes = useMemo(() => (moved ? transposeTab(tab.notes, transpose) : tab.notes), [tab.notes, moved, transpose])
  const capoNeeded = tab.capo + (transpose !== 0 && way === 'capo' ? transpose : 0)
  const chart = useMemo(() => {
    const text = trackChordChart(score, track)
    if (!text) return null
    const r = chordChartToScore(text, { bpm: Math.round(score.tempo), maxBars: score.masterBars.length })
    return strumChart(transposeScore(r.score, transpose), range.from, range.to - range.from)
  }, [score, track, range.from, range.to, transpose])
  const key = `${track}:${range.from}-${range.to}`
  const best = sheet.sectionBests?.[key]
  const bpm = Math.round(score.tempo) || 90

  const isGuitar = info ? info.instrument === 'guitar' && info.tuning.length === 6 : tab.tuning.length === 6
  const sheetPlayed = tab.tuning.map((s) => s + capoNeeded)
  const tuningOk = sameStrings(sheetPlayed, played.strings)
  const match = matchTuning(tab.tuning, capoNeeded)

  const switchTuning = async () => {
    if (!match) return
    const next = await ProfileService.update({ guitarTuning: match.id, capo: match.capo })
    setProfile(next)
    toast({ title: `已切换到「${GUITAR_TUNINGS[match.id].name}」${match.capo ? ` · 变调夹 ${match.capo} 品` : ''}`, description: '吉他设置里随时可以改回来。', variant: 'success' })
  }

  const record = (score: number) => void SongService.recordPractice(sheet.id, key, score)

  if (!isGuitar) {
    return <p className="rounded-2xl border border-border/80 p-5 text-sm text-muted-foreground">检测练习目前只支持六弦吉他音轨。这条音轨可以看谱、播放，或者静音它跟着伴奏弹。</p>
  }

  return (
    <div className="space-y-4">
      {!tuningOk && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber/50 bg-amber-soft/20 p-4 text-sm">
          <p>
            这条音轨用的调弦是 <b>{tab.tuning.map((m) => midiToName(m)).join(' ')}</b>
            {capoNeeded ? `，变调夹 ${capoNeeded} 品` : ''}
            {transpose !== 0 && way === 'capo' ? `（${transposeLabel(transpose)}，按原指法夹变调夹）` : ''}，和你吉他设置里的（{open.name}
            {capo ? ` · 变调夹 ${capo} 品` : ''}）不一样，检测会按你现在的调弦判音。
          </p>
          {match ? (
            <Button size="sm" variant="outline" onClick={() => void switchTuning()}>
              切换到「{GUITAR_TUNINGS[match.id].name}」{match.capo ? ` + 变调夹 ${match.capo} 品` : ''}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">网站还不支持这种调弦的检测，可以先看谱、跟伴奏弹。</span>
          )}
        </div>
      )}
      {best !== undefined && <p className="text-xs text-muted-foreground">这一段的最好成绩：{Math.round(best * 100)}%</p>}
      <Tabs defaultValue={notes.length ? 'lead' : 'strum'}>
        <TabsList>
          <TabsTrigger value="lead" disabled={!notes.length}>
            弹旋律
          </TabsTrigger>
          <TabsTrigger value="strum" disabled={!chart}>
            练扫弦
          </TabsTrigger>
        </TabsList>
        <TabsContent value="lead" className="space-y-3 pt-4">
          {tab.warnings.map((w) => (
            <p key={w} className="text-xs text-muted-foreground">
              {w}
            </p>
          ))}
          {notes.length > MAX_NOTES ? (
            <>
              <p className="text-sm text-muted-foreground">
                这一段有 {notes.length} 个音，太长了。把练习段落缩短到 {MAX_NOTES} 个音以内再练（一般 2–4 小节）。
              </p>
              <LeadTab notes={notes.slice(0, 64)} />
            </>
          ) : (
            <LeadPlay
              key={`${key}-${played.id}-${transpose}-${way}`}
              source={{ type: 'notes', name: sheet.title, notes: notes }}
              bpm={Math.min(bpm, 120)}
              onDone={(r) => {
                record(r.score)
                toast({ title: r.passed ? '这一段过关了' : `得分 ${Math.round(r.score * 100)}%`, description: r.summary, variant: r.passed ? 'success' : 'info' })
              }}
            />
          )}
        </TabsContent>
        <TabsContent value="strum" className="space-y-3 pt-4">
          {chart ? (
            <>
              <label className="flex items-center gap-2 text-sm">
                节奏型
                <select
                  value={pattern}
                  onChange={(e) => {
                    setPattern(e.target.value)
                    void SongService.update(sheet.id, { pattern: e.target.value })
                  }}
                  className="focus-ring h-9 rounded-lg border border-border bg-background px-2"
                >
                  {STRUM_PATTERNS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {chart.filled > 0 && <p className="text-xs text-muted-foreground">有 {chart.filled} 个小节没有写和弦，沿用了前一个和弦。</p>}
              <StrumPractice key={`${key}-${pattern}-${transpose}`} segments={[{ pattern, romans: chart.romans, bars: chart.romans.length }]} tonic={chart.tonic} bpm={bpm} pass={0.75} onTake={(t) => record(t.score)} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">这条音轨没有写和弦名，不能生成扫弦练习。</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
