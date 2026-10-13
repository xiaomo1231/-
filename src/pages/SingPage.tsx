import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import * as Tone from 'tone'
import { ArrowLeft, Loader2, Pencil } from 'lucide-react'
import type { SingSong } from '@/entities/types'
import { SingService, type SingSource } from '@/services/singService'
import { SingSessionContext, useSingSession } from '@/features/sing/useSingSession'
import { DEFAULT_MIX } from '@/songs/mixPresets'
import type { StemKind } from '@/songs/backingSync'
import { PracticeTab } from '@/widgets/sing/PracticeTab'
import { LyricsTab } from '@/widgets/sing/LyricsTab'
import { FullVersionTab } from '@/widgets/sing/FullVersionTab'
import { MixDesk } from '@/widgets/mix/MixDesk'
import { SingEditDialog } from '@/widgets/singList/SingEditDialog'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

type Tab = 'practice' | 'lyrics' | 'full' | 'mix'
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'practice', label: '跟唱' },
  { id: 'lyrics', label: '歌词' },
  { id: 'full', label: '完整版' },
  { id: 'mix', label: '后期' },
]

/** 跟唱 2.0: one song with four tabs — sing along, lyrics, full version, post-production. */
export function SingPage() {
  const { kind, id } = useParams()
  const [source, setSource] = useState<SingSource | null | 'missing'>(null)
  useEffect(() => {
    if ((kind !== 'song' && kind !== 'sheet') || !id) return setSource('missing')
    void SingService.source(kind, id).then((s) => setSource(s ?? 'missing'))
  }, [kind, id])
  if (source === 'missing') return <Navigate to="/sing" replace />
  if (!source) return <div className="py-20 text-center text-sm text-muted-foreground">正在载入…</div>
  return <SingWorkspace key={source.key} source={source} />
}

/** The stems to sing over in a cover: separated instruments, else the instrumental, else the full mix. */
function backingStems(kinds: StemKind[]): StemKind[] {
  const separated = kinds.filter((k) => !['mix', 'vocals', 'instrumental'].includes(k))
  if (separated.length) return separated
  if (kinds.includes('instrumental')) return ['instrumental']
  return kinds.includes('mix') ? ['mix'] : []
}

function SingWorkspace({ source }: { source: SingSource }) {
  const session = useSingSession(source)
  const [tab, setTab] = useState<Tab>('practice')
  const [title, setTitle] = useState(source.title)
  const [artist, setArtist] = useState(source.artist)
  const [editing, setEditing] = useState<SingSong | null>(null)
  const [voice, setVoice] = useState<{ buffer: AudioBuffer; label: string } | null>(null)
  const [backing, setBacking] = useState<AudioBuffer[] | null>(null)
  const [backingNames, setBackingNames] = useState<string[]>([])
  const kinds = source.stems.map((s) => s.stem)
  const usesMix = backingStems(kinds).includes('mix')

  // Decode the backing for the desk the first time it opens.
  useEffect(() => {
    if (tab !== 'mix' || backing || !session.ready) return
    void (async () => {
      const ctx = Tone.getContext().rawContext as AudioContext
      const want = backingStems(kinds)
      const stems = session.stems.current.filter((s) => want.includes(s.stem))
      const bufs = await Promise.all(stems.map(async (s) => ctx.decodeAudioData(await s.blob.arrayBuffer())))
      setBackingNames(stems.map((s) => s.stem))
      setBacking(bufs)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, session.ready])

  return (
    <SingSessionContext.Provider value={session}>
      <div className="space-y-6">
        <Link to="/sing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> 跟唱
        </Link>
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-4xl font-semibold">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {artist || '未填写演唱者'}
              {source.kind === 'sheet' ? ' · 来自我的谱子' : ''}
            </p>
          </div>
          {source.kind === 'song' && (
            <Button size="sm" variant="outline" onClick={() => void SingService.list().then((all) => setEditing(all.find((x) => x.id === source.id) ?? null))}>
              <Pencil /> 改名
            </Button>
          )}
        </header>
        <SingEditDialog
          song={editing}
          onClose={() => setEditing(null)}
          onSaved={(s) => {
            setTitle(s.title)
            setArtist(s.artist ?? '')
          }}
        />

        {session.error && (
          <p role="alert" className="rounded-2xl border border-destructive/40 p-4 text-sm text-destructive">
            {session.error}
          </p>
        )}
        {!session.curve && !session.error && (
          <div className="rounded-2xl border border-border/80 bg-card p-5 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> 正在分析原唱的音高（只在第一次需要）… {Math.round(session.progress * 100)}%
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-cyan transition-[width]" style={{ width: `${Math.round(session.progress * 100)}%` }} />
            </div>
          </div>
        )}

        {session.curve && (
          <>
            <nav className="flex gap-1 rounded-2xl border border-border/80 bg-card p-1" role="tablist" aria-label="跟唱页签">
              {TABS.map((t) => (
                <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn('focus-ring flex-1 rounded-xl px-3 py-2 text-sm transition-colors', tab === t.id ? 'bg-amber-soft/50 font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  {t.label}
                </button>
              ))}
            </nav>
            <div role="tabpanel">
              {/* The practice tab stays mounted so its clock keeps scoring while other tabs are open. */}
              <div className={tab === 'practice' ? '' : 'hidden'}>
                <PracticeTab />
              </div>
              {tab === 'lyrics' && <LyricsTab />}
              {tab === 'full' && (
                <FullVersionTab
                  onVoice={(buffer, label) => {
                    setVoice({ buffer, label })
                    setTab('mix')
                  }}
                />
              )}
              {tab === 'mix' && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {voice ? `人声：${voice.label}（${Math.round(voice.buffer.duration)} 秒）。` : '还没有合成人声：先到「完整版」里合成；现在可以先听伴奏、调伴奏。'}
                    {usesMix && ' 注意：这首歌只有完整原曲、没有伴奏轨，原唱会混在背景里；用「自动分轨」得到伴奏效果更好。'}
                  </p>
                  {backing ? (
                    <MixDesk
                      voice={voice?.buffer ?? null}
                      backing={backing}
                      backingNames={backingNames}
                      phrases={session.phrases.map((p) => ({ startMs: p.startMs, endMs: p.endMs, ...(p.lyric ? { lyric: p.lyric } : {}) }))}
                      mix={session.meta?.mix ?? DEFAULT_MIX}
                      onMix={(m) => void session.setMeta({ mix: m })}
                      snapshots={session.meta?.mixSnapshots ?? []}
                      refNotes={session.notes}
                      onSnapshots={(s) => void session.setMeta({ mixSnapshots: s })}
                      songKey={source.key}
                      title={title}
                      artist={artist}
                    />
                  ) : (
                    <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> 正在准备伴奏…
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </SingSessionContext.Provider>
  )
}
