/**
 * 我的谱子: this account's 改编谱, uploaded songs and 组合乐队谱, as rows the home
 * page and the 我的谱子 page show. Read from /api/mine each time a page opens.
 */
import { useCallback, useEffect, useState } from 'react'
import { describeConfig } from '@/songs/arrangement'
import { api, errorText, type MyScores } from './api'
import { hrefUpload, hrefViewer } from './route'

export type MineKind = 'arrangement' | 'upload' | 'combo'

export const MINE_KIND_LABEL: Record<MineKind, string> = {
  arrangement: '改编谱',
  upload: '上传的谱',
  combo: '组合乐队谱',
}

export interface MineRow {
  key: string
  kind: MineKind
  id: string
  name: string
  /** Song and what it is, e.g. "夜曲 · 周杰伦 · 2 条轨换了乐器". */
  line: string
  href: string
  updatedAt: number
}

/** Every item as a row, newest change first. */
export function mineRows(m: MyScores): MineRow[] {
  const song = (title: string, artist: string) => [title, artist].filter(Boolean).join(' · ')
  const rows: MineRow[] = [
    ...m.arrangements.map((a) => ({
      key: `a:${a.id}`,
      kind: 'arrangement' as const,
      id: a.id,
      name: a.name,
      line: [song(a.title, a.artist), describeConfig(a)].filter(Boolean).join(' · '),
      href: hrefViewer({ path: a.path, format: 'score', title: a.title, artist: a.artist, arr: a.id }),
      updatedAt: a.updatedAt,
    })),
    ...m.uploads.map((u) => ({
      key: `u:${u.id}`,
      kind: 'upload' as const,
      id: u.id,
      name: u.title,
      line: [u.artist, `${u.files.length} 个文件`].filter(Boolean).join(' · '),
      href: hrefUpload({ id: u.id }),
      updatedAt: u.updatedAt,
    })),
    ...m.combos.map((c) => ({
      key: `c:${c.id}`,
      kind: 'combo' as const,
      id: c.id,
      name: c.title || '组合乐队谱',
      line: [c.artist, `${c.parts.length} 个声部`].filter(Boolean).join(' · '),
      href: hrefViewer({ path: c.base, format: 'score', title: c.title, artist: c.artist, combo: c.id }),
      updatedAt: c.updatedAt,
    })),
  ]
  return rows.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 我的谱子, read when the page opens; `reload` reads it again. */
export function useMine(): { data: MyScores | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<MyScores | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const ac = new AbortController()
    api.mine(ac.signal).then(
      (m) => {
        setData(m)
        setError(null)
      },
      (e: unknown) => {
        if (!ac.signal.aborted) setError(errorText(e))
      },
    )
    return () => ac.abort()
  }, [version])
  const reload = useCallback(() => setVersion((v) => v + 1), [])
  return { data, error, reload }
}
