/**
 * Lyric files from the student's lyrics folders (0.22.0): looks up the files
 * that could belong to a song by title and singer, and lets the student pick
 * one. Nothing is fetched from the internet.
 */
import { useState } from 'react'
import { FileText, Loader2, ShieldCheck } from 'lucide-react'
import type { LibraryFolder } from '@/entities/types'
import type { LyricsLookup } from '@/services/libraryService'
import type { LyricFileEntry } from '@/songs/lyricFiles'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

export interface LyricChoice {
  folderId: string
  entry: LyricFileEntry
}

const scoreLabel = (s: number) =>
  s >= 100 ? '歌名和演唱者都对得上' : s >= 70 ? '歌名对得上' : '歌名一样，演唱者不同'

/**
 * The matching files as a choice list. `value` null = don't use any.
 * `compact` hides the list behind "换一个" when the best match is certain.
 */
export function LyricFileList({
  lookup,
  locked,
  onAllow,
  value,
  onChange,
  busy = false,
  compact = false,
}: {
  lookup: LyricsLookup
  locked: LibraryFolder[]
  onAllow: () => void
  value: LyricChoice | null
  onChange: (c: LyricChoice | null) => void
  busy?: boolean
  compact?: boolean
}) {
  const [open, setOpen] = useState(!compact || !lookup.sure)
  const same = (c: LyricChoice | null, m: { folderId: string; entry: LyricFileEntry }) =>
    !!c && c.folderId === m.folderId && c.entry.path === m.entry.path
  return (
    <div className="space-y-2">
      {locked.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber/50 bg-amber-soft/20 px-2 py-1.5 text-xs">
          <span className="flex-1">
            需要点一下才能读取歌词文件夹（{locked.map((f) => f.name).join('、')}
            ）。
          </span>
          <Button size="sm" variant="outline" onClick={onAllow}>
            <ShieldCheck /> 允许读取歌词文件夹
          </Button>
        </div>
      )}
      {lookup.matches.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          歌词文件夹里没有找到这首歌的歌词（按歌名和演唱者找）。
        </p>
      ) : !open && value ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <FileText className="h-4 w-4 text-amber" aria-hidden />
          <span className="min-w-0 flex-1 truncate" title={value.entry.path}>
            {value.entry.fileName}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            换一个
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            不用
          </Button>
        </div>
      ) : (
        <ul className="space-y-1" aria-label="可能的歌词文件">
          {lookup.matches.map((m) => (
            <li key={`${m.folderId}/${m.entry.path}`}>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  onChange(same(value, m) ? null : { folderId: m.folderId, entry: m.entry })
                }
                aria-pressed={same(value, m)}
                className={cn(
                  'focus-ring flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-sm',
                  same(value, m)
                    ? 'border-amber bg-amber-soft/30'
                    : 'border-border/70 hover:bg-muted/40',
                )}
              >
                {busy && same(value, m) ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-amber" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate" title={m.entry.path}>
                  {m.entry.fileName}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {scoreLabel(m.score)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
