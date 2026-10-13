import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, Trash2 } from 'lucide-react'
import type { SongSheet } from '@/entities/types'
import { FORMAT_LABEL } from '@/import/gpImport'
import { UNKNOWN_ARTIST, sheetFormat, versionLabel, type SongGroup } from '@/songs/sheetGroups'
import { Button } from '@/shared/ui/Button'
import { formatDateShort } from '@/shared/lib/format'

interface SongCardProps {
  group: SongGroup
  onEdit: (sheet: SongSheet) => void
  onDelete: (sheet: SongSheet) => void
}

/** One song (same title, same singer) with a version picker when it has several versions. */
export function SongCard({ group, onEdit, onDelete }: SongCardProps) {
  const [picked, setPicked] = useState<string | null>(null)
  const selected = group.versions.find((v) => v.id === picked) ?? group.versions[0]!
  const versions = group.versions.length
  const tracks = selected.tracks?.length ?? 0
  const bars = selected.bars ?? selected.score?.bars
  const when = selected.lastPracticedAt ? `上次练习 ${formatDateShort(selected.lastPracticedAt)}` : `导入于 ${formatDateShort(selected.createdAt)}`

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-5 surface-gradient transition-all hover:-translate-y-0.5 hover:border-cyan/40 hover:shadow-lift">
      <div className="min-w-0">
        <h3 className="truncate font-display text-lg font-semibold">{selected.title}</h3>
        <p className="truncate text-sm text-muted-foreground">{selected.artist?.trim() || UNKNOWN_ARTIST}</p>
      </div>

      <div className="flex flex-wrap gap-1.5 text-[11px]">
        <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{FORMAT_LABEL[sheetFormat(selected)]}</span>
        {tracks > 1 && <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{`${tracks} 条音轨`}</span>}
        {bars ? <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{`${bars} 小节`}</span> : null}
        {versions > 1 && <span className="rounded-full bg-amber-soft/40 px-2 py-0.5 text-foreground">{`${versions} 个版本`}</span>}
      </div>

      {versions > 1 && (
        <select
          aria-label="选择版本"
          value={selected.id}
          onChange={(e) => setPicked(e.target.value)}
          className="focus-ring h-9 w-full rounded-xl border border-border bg-background px-3 text-sm"
        >
          {group.versions.map((v) => (
            <option key={v.id} value={v.id}>
              {versionLabel(v)}
            </option>
          ))}
        </select>
      )}

      <p className="text-xs text-muted-foreground">{when}</p>

      <div className="mt-auto flex items-center gap-2 pt-1">
        <Button asChild size="sm">
          <Link to={`/sheets/${selected.id}`}>打开</Link>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onEdit(selected)}>
          <Pencil />
          编辑
        </Button>
        <Button variant="ghost" size="sm" className="ml-auto text-destructive" aria-label={`删除「${selected.title}」的这个版本`} onClick={() => onDelete(selected)}>
          <Trash2 />
          删除
        </Button>
      </div>
    </article>
  )
}
