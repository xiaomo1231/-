import { useMemo, useState } from 'react'
import { Check, Lightbulb, Save, X } from 'lucide-react'
import type { SongCreationSpec } from '@/course/types'
import { checkSong, scoreFromSpec } from '@/course/rules'
import type { Score } from '@/music/score'
import { STYLES, applyStyle } from '@/music/arrangement'
import { useProfileStore } from '@/features/profile/profileStore'
import { StudioEditor } from '@/widgets/studio/StudioEditor'
import { ArrangeEditor } from '@/widgets/studio/ArrangeEditor'
import { Button } from '@/shared/ui/Button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/Tabs'

export interface SongCreationProps {
  spec: SongCreationSpec
  initial?: Score
  saved: boolean
  onSave: (score: Score) => Promise<void> | void
}

/**
 * A lesson's composer task: harmonise a given melody ('chords'), write a
 * melody with chords ('song') or arrange a song ('arrange'). The same rule
 * engines as the studio drive both the live hints and the pass check.
 */
export function SongCreation({ spec, initial, saved, onSave }: SongCreationProps) {
  const [score, setScore] = useState<Score>(() => initial ?? scoreFromSpec(spec))
  const [saving, setSaving] = useState(false)
  const instrument = useProfileStore((s) => s.profile?.instrument ?? 'none')
  const result = useMemo(() => checkSong(spec, score), [spec, score])
  const withArranger = spec.kind === 'arrange' || Boolean(spec.arranger)
  const [tab, setTab] = useState<'compose' | 'arrange'>(spec.kind === 'arrange' ? 'arrange' : 'compose')

  const save = async () => {
    setSaving(true)
    try {
      await onSave(score)
    } finally {
      setSaving(false)
    }
  }

  const showExample = () => {
    const style = STYLES.find((st) => st.id === spec.exampleStyle)
    const base = style ? { ...applyStyle(score, style), bpm: score.bpm } : score
    setScore({
      ...base,
      ...(spec.exampleChords ? { chords: [...spec.exampleChords] } : {}),
      ...(spec.exampleSections ? { sections: spec.exampleSections.map((x) => ({ ...x })) } : {}),
    })
  }

  const composer = (
    <StudioEditor
      value={score}
      onChange={setScore}
      compact
      features={{
        melody: spec.kind === 'song' || (spec.kind === 'arrange' && !spec.givenMelody),
        chords: true,
        lyrics: Boolean(spec.lyrics),
        keyEditable: false,
        barsEditable: false,
        advancedChords: Boolean(spec.advancedChords),
      }}
      lockedHints={{ lyrics: '这一课不需要歌词。' }}
    />
  )

  return (
    <div className="space-y-5">
      {withArranger ? (
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="compose">作曲</TabsTrigger>
            <TabsTrigger value="arrange">编曲</TabsTrigger>
          </TabsList>
          <TabsContent value="compose" className="pt-4">
            {composer}
          </TabsContent>
          <TabsContent value="arrange" className="pt-4">
            <ArrangeEditor value={score} onChange={setScore} instrument={instrument} compact />
          </TabsContent>
        </Tabs>
      ) : (
        composer
      )}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-border/80 bg-card p-4">
        <ul className="space-y-1 text-sm">
          {result.problems.length === 0 ? (
            <li className="flex items-center gap-2 text-success">
              <Check className="h-4 w-4" /> 符合这一课的所有要求，可以保存了。
            </li>
          ) : (
            result.problems.map((p) => (
              <li key={p} className="flex items-start gap-2 text-muted-foreground">
                <X className="mt-0.5 h-4 w-4 shrink-0 text-amber" /> {p}
              </li>
            ))
          )}
        </ul>
        <div className="flex gap-2">
          {(spec.exampleChords || spec.exampleSections || spec.exampleStyle) && (
            <Button variant="ghost" onClick={showExample} title="用一种可行的做法替换当前和弦或段落，听听看，再改成你自己的">
              <Lightbulb /> 看一种做法
            </Button>
          )}
          <Button onClick={() => void save()} disabled={!result.ok || saving}>
            {saved ? <Check /> : <Save />} {saved ? '更新作品' : '保存到作品集'}
          </Button>
        </div>
      </div>
    </div>
  )
}
