import { useNavigate } from 'react-router-dom'
import { FolderOpen } from 'lucide-react'
import type { ScoreVersion } from '@/songs/scoreLibraryTypes'
import { ScoreLibrary } from '@/features/scores/scoreLibraryClient'
import { toast } from '@/features/toast/toastStore'
import { cn } from '@/shared/lib/utils'
import { FORMAT_BADGE, formatSize } from './formatBadge'
import { scoreViewUrl } from './scoreViewUrl'

interface Props {
  version: ScoreVersion
  /** Song title and artist name, passed to the viewer. */
  title: string
  artistName: string
}

/** One way to play a song: opens the viewer; the side button shows the file in Explorer. */
export function ScoreVersionRow({ version, title, artistName }: Props) {
  const navigate = useNavigate()
  const badge = FORMAT_BADGE[version.file.format]
  const reveal = () => {
    ScoreLibrary.reveal(version.file.path).catch((e: unknown) =>
      toast({
        title: '没能打开文件夹',
        description: e instanceof Error ? e.message : String(e),
        variant: 'error',
      }),
    )
  }
  return (
    <div className="flex items-center gap-1 rounded-xl hover:bg-muted/60">
      <button
        type="button"
        onClick={() => navigate(scoreViewUrl(version, title, artistName))}
        className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2.5 py-2 text-left"
      >
        <span
          className={cn(
            'shrink-0 rounded-md border px-1.5 py-px text-[11px] font-medium',
            badge.className,
          )}
        >
          {badge.label}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={version.label}>
          {version.label}
        </span>
        {version.tags.map((t) => (
          <span
            key={t}
            className="hidden shrink-0 rounded-md bg-muted px-1.5 py-px text-[11px] text-muted-foreground sm:inline"
          >
            {t}
          </span>
        ))}
        <span className="num w-16 shrink-0 text-right text-xs text-muted-foreground">
          {formatSize(version.size)}
        </span>
      </button>
      <button
        type="button"
        onClick={reveal}
        aria-label="在文件夹中显示"
        title="在文件夹中显示"
        className="focus-ring shrink-0 rounded-lg p-2 text-muted-foreground hover:text-foreground"
      >
        <FolderOpen className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}
