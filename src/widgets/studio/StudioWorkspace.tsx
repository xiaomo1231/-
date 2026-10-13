import { useState } from 'react'
import { Lock } from 'lucide-react'
import type { CritiqueRecord, InstrumentId } from '@/entities/types'
import type { Score } from '@/music/score'
import { StudioEditor, type StudioFeatures } from './StudioEditor'
import { ArrangeEditor } from './ArrangeEditor'
import { ExportPanel } from './ExportPanel'
import { CritiquePanel } from './CritiquePanel'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/Tabs'

export type WorkspaceTab = 'compose' | 'arrange' | 'review' | 'export'

export interface StudioWorkspaceProps {
  score: Score
  onChange: (s: Score) => void
  compositionId: string | null
  title: string
  dirty: boolean
  /** Save and return the composition id (null when saving was not possible). */
  onSave: () => Promise<string | null>
  features: StudioFeatures
  arrangeUnlocked: boolean
  instrument: InstrumentId
  /** Remount key for the editors (e.g. after loading another work). */
  editorKey: string
  tab?: WorkspaceTab
  onTabChange?: (t: WorkspaceTab) => void
  onExported?: () => void
  onCritique?: (r: CritiqueRecord) => void
}

/** Compose / arrange / critique / export, shared by the studio and the graduation project. */
export function StudioWorkspace(p: StudioWorkspaceProps) {
  const [ownTab, setOwnTab] = useState<WorkspaceTab>('compose')
  const tab = p.tab ?? ownTab
  const setTab = p.onTabChange ?? setOwnTab
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as WorkspaceTab)}>
      <TabsList>
        <TabsTrigger value="compose">作曲</TabsTrigger>
        <TabsTrigger value="arrange">
          {!p.arrangeUnlocked && <Lock className="mr-1 h-3 w-3" aria-label="未解锁" />}编曲
        </TabsTrigger>
        <TabsTrigger value="review">点评</TabsTrigger>
        <TabsTrigger value="export">导出</TabsTrigger>
      </TabsList>
      <TabsContent value="compose" className="pt-5">
        {tab === 'compose' && (
          <StudioEditor
            key={p.editorKey}
            value={p.score}
            onChange={p.onChange}
            features={p.features}
            lockedHints={{ chords: '进入阶段 2「和声基础」后解锁和声轨与自动伴奏。', lyrics: '进入阶段 3「旋律与歌曲结构」后解锁歌词。' }}
          />
        )}
      </TabsContent>
      <TabsContent value="arrange" className="pt-5">
        {tab === 'arrange' &&
          (p.arrangeUnlocked ? (
            <ArrangeEditor value={p.score} instrument={p.instrument} onChange={p.onChange} />
          ) : (
            <div className="rounded-3xl border border-dashed border-border p-10 text-center text-muted-foreground">
              <Lock className="mx-auto h-8 w-8" aria-hidden />
              <p className="mt-3">多轨编曲在阶段 5「编曲」解锁。现在可以在「作曲」里用自动伴奏，也可以导出 MIDI 到其他软件。</p>
            </div>
          ))}
      </TabsContent>
      <TabsContent value="review" className="pt-5">
        {tab === 'review' && <CritiquePanel compositionId={p.compositionId} score={p.score} dirty={p.dirty} onSave={p.onSave} {...(p.onCritique ? { onRecorded: p.onCritique } : {})} />}
      </TabsContent>
      <TabsContent value="export" className="pt-5">
        {tab === 'export' && <ExportPanel score={p.score} title={p.title} {...(p.onExported ? { onExported: p.onExported } : {})} />}
      </TabsContent>
    </Tabs>
  )
}
