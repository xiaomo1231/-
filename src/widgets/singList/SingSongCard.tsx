import { Link } from 'react-router-dom'
import { Pencil, Trash2 } from 'lucide-react'
import type { SingSong } from '@/entities/types'
import { STEM_LABEL } from '@/songs/backingSync'
import { Button } from '@/shared/ui/Button'
import { formatDateShort } from '@/shared/lib/format'

interface SingSongCardProps {
  song: SingSong
  onDelete: (song: SingSong) => void
  onEdit: (song: SingSong) => void
  /** Phrases with a best score (跟唱 2.0 metadata). */
  scored?: number
}

/** One 跟唱 song: its stems, practice progress and the entry to start singing. */
export function SingSongCard({ song, onDelete, onEdit, scored = 0 }: SingSongCardProps) {
  const stems = song.stems.map((s) => STEM_LABEL[s.stem]).join(' · ')
  const when = song.lastPracticedAt ? `上次练习 ${formatDateShort(song.lastPracticedAt)}` : `添加于 ${formatDateShort(song.createdAt)}`

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-5 surface-gradient transition-all hover:-translate-y-0.5 hover:border-cyan/40 hover:shadow-lift">
      <div className="min-w-0">
        <h3 className="truncate font-display text-lg font-semibold">{song.title}</h3>
        <p className="truncate text-sm text-muted-foreground">{song.artist?.trim() || '未填演唱者'}</p>
      </div>

      <p className="text-xs text-muted-foreground">{stems}</p>

      <div className="flex flex-wrap gap-1.5 text-[11px]">
        <span className="text-muted-foreground">{when}</span>
        {scored > 0 && <span className="rounded-full bg-amber-soft/40 px-2 py-0.5 text-foreground">{`${scored} 句有最佳分数`}</span>}
      </div>

      <div className="mt-auto flex items-center gap-2 pt-1">
        <Button asChild size="sm">
          <Link to={`/sing/song/${song.id}`}>开始跟唱</Link>
        </Button>
        <Button variant="ghost" size="sm" className="ml-auto" aria-label={`编辑「${song.title}」`} onClick={() => onEdit(song)}>
          <Pencil />
          编辑
        </Button>
        <Button variant="ghost" size="sm" className="text-destructive" aria-label={`删除「${song.title}」`} onClick={() => onDelete(song)}>
          <Trash2 />
          删除
        </Button>
      </div>
    </article>
  )
}
