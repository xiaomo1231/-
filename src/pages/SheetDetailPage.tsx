import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil } from 'lucide-react'
import type { model } from '@coderline/alphatab'
import type { SongSheet } from '@/entities/types'
import { ALPHATAB_FORMATS, FORMAT_LABEL } from '@/import/gpImport'
import { SongService } from '@/services/songService'
import { groupSheets, sheetFormat, versionLabel } from '@/songs/sheetGroups'
import { useTimbreOverride } from '@/features/audio/useTimbreOverride'
import { useThemeStore } from '@/features/theme/themeStore'
import { AlphaTabView, type StaffMode } from '@/widgets/sheets/AlphaTabView'
import { GpPractice } from '@/widgets/sheets/GpPractice'
import { TransposeControl } from '@/widgets/sheets/TransposeControl'
import { ExportPdfButton } from '@/widgets/sheets/ExportPdfButton'
import { clampTranspose, defaultWay, transposedKey, type GuitarWay } from '@/songs/transpose'
import { BackingPanel } from '@/widgets/sheets/BackingPanel'
import type { AlphaTabApi } from '@coderline/alphatab'
import { SheetEditDialog } from '@/widgets/sheetList/SheetEditDialog'
import { SongPractice } from '@/widgets/songs/SongPractice'
import { Button } from '@/shared/ui/Button'

const INSTRUMENT_ZH = {
  guitar: '吉他',
  bass: '贝斯',
  drums: '鼓',
  keys: '键盘',
  voice: '人声',
  other: '其它',
} as const
const STAFF_LABEL: Record<StaffMode, string> = {
  ScoreTab: '五线谱 + 六线谱',
  Tab: '只看六线谱',
  Score: '只看五线谱',
}
const LENGTHS = [2, 4, 8, 16]

/** One imported sheet: the version picker, the sheet as written, and practice. */
export function SheetDetailPage() {
  useTimbreOverride('guitar')
  const { id } = useParams()
  const navigate = useNavigate()
  const [sheet, setSheet] = useState<SongSheet | null | 'missing'>(null)
  const [siblings, setSiblings] = useState<SongSheet[]>([])
  const [artists, setArtists] = useState<string[]>([])
  const [editing, setEditing] = useState<SongSheet | null>(null)

  const load = useCallback(async () => {
    if (!id) return setSheet('missing')
    const s = await SongService.get(id)
    if (!s) return setSheet('missing')
    setSheet(s)
    const all = await SongService.list()
    const group = groupSheets(all)
      .flatMap((a) => a.songs)
      .find((g) => g.versions.some((v) => v.id === s.id))
    setSiblings(group?.versions ?? [s])
    setArtists(await SongService.artists())
  }, [id])

  useEffect(() => {
    void load()
    if (id) void SongService.markOpened(id)
  }, [id, load])

  if (sheet === 'missing') return <Navigate to="/sheets" replace />
  if (!sheet)
    return <div className="py-20 text-center text-sm text-muted-foreground">正在载入…</div>

  const format = sheetFormat(sheet)
  const header = (
    <div className="space-y-4">
      <Link
        to="/sheets"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> 我的谱子
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-4xl font-semibold">{sheet.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {[
              sheet.artist || '未填写演唱者',
              FORMAT_LABEL[format],
              sheet.tabber ? `制谱 ${sheet.tabber}` : null,
              sheet.bars ? `${sheet.bars} 小节` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {sheet.tags?.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {sheet.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {siblings.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              版本
              <select
                value={sheet.id}
                onChange={(e) => navigate(`/sheets/${e.target.value}`)}
                className="focus-ring h-9 max-w-72 rounded-lg border border-border bg-background px-2"
                aria-label="选择版本"
              >
                {siblings.map((v) => (
                  <option key={v.id} value={v.id}>
                    {versionLabel(v)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button variant="outline" size="sm" onClick={() => setEditing(sheet)}>
            <Pencil /> 编辑信息
          </Button>
        </div>
      </header>
      <SheetEditDialog
        sheet={editing}
        artists={artists}
        onClose={() => setEditing(null)}
        onSaved={() => void load()}
      />
    </div>
  )

  if (sheet.fileId && ALPHATAB_FORMATS.includes(format))
    return <WrittenSheet key={sheet.id} sheet={sheet} header={header} />
  return (
    <SongPractice
      key={sheet.id}
      header={header}
      transpose={sheet.transpose ?? 0}
      onTranspose={(t) => void SongService.update(sheet.id, { transpose: t })}
      view={{
        title: sheet.title,
        subtitle: sheet.artist ?? '',
        ...(sheet.notes ? { note: sheet.notes } : {}),
        ...(sheet.score ? { score: sheet.score } : {}),
        ...(sheet.tab ? { tab: sheet.tab } : {}),
        pattern: sheet.pattern ?? 'pop',
        bpm: sheet.bpm,
      }}
    />
  )
}

/** The sheet with the panel's latest backing (removed when the last stem goes). */
function withBacking(sheet: SongSheet, backing: SongSheet['backing']): SongSheet {
  const { backing: _old, ...rest } = sheet
  return backing ? { ...rest, backing } : rest
}

/** Sheets with their original file: rendered by alphaTab, practised by section. */
function WrittenSheet({ sheet, header }: { sheet: SongSheet; header: React.ReactNode }) {
  const theme = useThemeStore((s) => s.mode)
  const [bytes, setBytes] = useState<Uint8Array | null | 'missing'>(null)
  const [score, setScore] = useState<model.Score | null>(null)
  const [repaired, setRepaired] = useState<SongSheet | null>(null)
  // Names stored by an older import may be garbled: fix them from the score as read now.
  useEffect(() => {
    if (!score) return
    void SongService.repairTexts(sheet.id, score).then((s) => s && setRepaired(s))
  }, [score, sheet.id])
  const [api, setApi] = useState<AlphaTabApi | null>(null)
  const [backing, setBacking] = useState(sheet.backing)
  const [track, setTrack] = useState(sheet.defaultTrack ?? 0)
  const [staff, setStaff] = useState<StaffMode>('ScoreTab')
  const [from, setFrom] = useState(0)
  const [length, setLength] = useState(4)
  const [transpose, setTranspose] = useState(clampTranspose(sheet.transpose ?? 0))
  const [way, setWay] = useState<GuitarWay>(sheet.transposeWay ?? defaultWay(sheet.transpose ?? 0))
  const changeTranspose = (n: number) => {
    const t = clampTranspose(n)
    // Going down there is no capo way; going up from the original key starts with the capo way.
    const w = t <= 0 ? 'frets' : transpose <= 0 ? defaultWay(t, trackCapo) : way
    setTranspose(t)
    setWay(w)
    void SongService.update(sheet.id, { transpose: t, transposeWay: w })
  }
  const changeWay = (w: GuitarWay) => {
    setWay(w)
    void SongService.update(sheet.id, { transposeWay: w })
  }

  useEffect(() => {
    void SongService.fileBytes(sheet.fileId!).then((b) => setBytes(b ?? 'missing'))
  }, [sheet.fileId])

  const bars = score?.masterBars.length ?? sheet.bars ?? 0
  const range = useMemo(
    () => ({ from, to: Math.min(bars || from + length, from + length) }),
    [from, length, bars],
  )
  const tracks =
    (repaired ?? sheet).tracks ??
    score?.tracks.map((t) => ({
      index: t.index,
      name: t.name,
      instrument: 'other' as const,
      tuning: [],
      capo: 0,
      notes: 0,
    })) ??
    []
  const sectionAt = (b: number) => sheet.sections?.find((s) => s.bar === b)?.name
  const trackCapo = tracks.find((t) => t.index === track)?.capo ?? 0
  const keyLabel = useMemo(() => {
    const mb = score?.masterBars[0]
    if (!mb) return undefined
    const minor = Number(mb.keySignatureType) === 1
    const major = (((Number(mb.keySignature) * 7) % 12) + 12) % 12
    const tonic = 60 + (minor ? (major + 9) % 12 : major)
    const mode = minor ? 'minor' : 'major'
    return transpose ? `${transposedKey(tonic, mode, transpose)}（原调 ${transposedKey(tonic, mode, 0)}）` : `原调 ${transposedKey(tonic, mode, 0)}`
  }, [score, transpose])

  if (bytes === 'missing')
    return (
      <>
        {header}
        <p className="mt-6 text-sm text-destructive">原文件不见了，请重新导入这份谱子。</p>
      </>
    )

  return (
    <div className="space-y-6">
      {header}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        {tracks.length > 1 && (
          <label className="flex items-center gap-2">
            音轨
            <select
              value={track}
              onChange={(e) => {
                const t = Number(e.target.value)
                setTrack(t)
                void SongService.update(sheet.id, { defaultTrack: t })
              }}
              className="focus-ring h-9 max-w-64 rounded-lg border border-border bg-background px-2"
            >
              {tracks.map((t) => (
                <option key={t.index} value={t.index}>
                  {t.name}（{INSTRUMENT_ZH[t.instrument]}）
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2">
          谱面
          <select
            value={staff}
            onChange={(e) => setStaff(e.target.value as StaffMode)}
            className="focus-ring h-9 rounded-lg border border-border bg-background px-2"
          >
            {(Object.keys(STAFF_LABEL) as StaffMode[]).map((m) => (
              <option key={m} value={m}>
                {STAFF_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        {bars > 1 && (
          <label className="flex items-center gap-2">
            练习段落：从第
            <select
              value={from}
              onChange={(e) => setFrom(Number(e.target.value))}
              className="focus-ring h-9 max-w-56 rounded-lg border border-border bg-background px-2"
              aria-label="起始小节"
            >
              {Array.from({ length: bars }, (_, b) => (
                <option key={b} value={b}>
                  {b + 1}
                  {sectionAt(b) ? ` · ${sectionAt(b)}` : ''}
                </option>
              ))}
            </select>
            小节起，共
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
        )}
        {score && (
          <ExportPdfButton
            source={{ kind: 'sheet', id: sheet.id }}
            track={track}
            trackCount={tracks.length}
            staff={staff}
            transpose={transpose}
            fileName={[sheet.title, sheet.artist].filter(Boolean).join(' - ')}
          />
        )}
      </div>

      <TransposeControl value={transpose} onChange={changeTranspose} {...(keyLabel ? { keyLabel } : {})} way={way} onWay={changeWay} capoNeeded={trackCapo + transpose} />

      {bytes ? (
        <AlphaTabView
          key={theme}
          bytes={bytes}
          track={track}
          staff={staff}
          range={range}
          onScore={setScore}
          onApi={setApi}
          externalMix={Boolean(backing?.stems.length)}
          transpose={transpose}
        />
      ) : (
        <div className="py-16 text-center text-sm text-muted-foreground">正在读取谱子…</div>
      )}

      {score && <BackingPanel sheet={withBacking(sheet, backing)} score={score} api={api} track={track} onChange={setBacking} transpose={transpose} />}

      {score && (
        <section
          className="surface-gradient rounded-3xl border border-border/80 bg-card p-6"
          aria-label="检测练习"
        >
          <h2 className="mb-1 text-lg font-semibold">练这一段</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            第 {range.from + 1}–{range.to} 小节 ·{' '}
            {tracks.find((t) => t.index === track)?.name ?? `音轨 ${track + 1}`}
            。按谱面原来的弦和品位弹，网站用吉他线或麦克风判定。
          </p>
          <GpPractice sheet={sheet} score={score} track={track} range={range} transpose={transpose} way={way} />
        </section>
      )}
    </div>
  )
}
