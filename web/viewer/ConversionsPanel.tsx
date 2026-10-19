import { useState } from 'react'
import type { ConversionRecord } from '@/songs/scoreServerTypes'
import { api, conversionFileUrl, errorText } from '../lib/api'
import { buttonClass, cx, PANEL } from '../lib/classes'
import { convertPdf, rate, remove, useConversions } from '../lib/conversions'
import { fileBaseName } from '../lib/format'
import { hrefViewer } from '../lib/route'
import { useMe } from '../lib/session'
import { useLoad } from '../lib/useLoad'
import { Notice } from '../components/ui'
import { Link } from '../components/Link'
import { StarRating } from '../components/StarRating'

const WARNINGS_FIRST = 3

/** The converter's warnings: collapsed by default, the first few shown, the rest on request. */
function Warnings({ items }: { items: string[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, WARNINGS_FIRST)
  return (
    <details className="text-sm">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-muted-foreground transition-colors hover:text-foreground">
        转换提示（{items.length} 条）
      </summary>
      <ul className="m-0 list-disc space-y-1 pl-5 text-muted-foreground">
        {shown.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
      {items.length > WARNINGS_FIRST && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="mt-1 inline-flex min-h-11 items-center text-primary"
        >
          {all ? '收起' : `还有 ${items.length - WARNINGS_FIRST} 条，显示全部`}
        </button>
      )}
    </details>
  )
}

function dateText(ms: number): string {
  return new Date(ms).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

/** One conversion of the song: its facts, rating, practice link, download and (creator/admin) delete. */
function ConversionItem({
  path,
  record: c,
  fresh,
  title,
  artist,
  canDelete,
  onError,
}: {
  path: string
  record: ConversionRecord
  fresh: boolean
  title: string
  artist: string
  canDelete: boolean
  onError: (message: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)

  const practice =
    hrefViewer({
      path: c.sourcePath,
      format: 'score',
      title: c.title || title,
      artist: c.artist || artist,
    }) + `&conv=${encodeURIComponent(c.id)}`

  const doRate = (stars: number) => {
    rate(path, c.id, stars).catch((e: unknown) => onError(errorText(e)))
  }

  const doRemove = () => {
    setRemoving(true)
    remove(path, c.id).catch((e: unknown) => {
      setRemoving(false)
      setConfirming(false)
      onError(errorText(e))
    })
  }

  return (
    <li
      className={cx(
        'space-y-3 rounded-lg border p-4',
        fresh ? 'border-primary bg-accent' : 'border-border',
      )}
    >
      <div className="space-y-1">
        <p className="m-0 break-all text-sm font-semibold">{fileBaseName(c.sourcePath)}</p>
        <p className="mono m-0 text-xs text-muted-foreground">
          {c.bars} 小节 · {dateText(c.createdAt)}
        </p>
        <p className="m-0 break-words text-sm">
          声部：{c.tracks.length > 0 ? c.tracks.join('、') : '未识别到声部'}
        </p>
      </div>

      {c.warnings.length > 0 && <Warnings items={c.warnings} />}

      <StarRating
        value={c.rating.average}
        count={c.rating.count}
        mine={c.myRating}
        onRate={doRate}
        size="sm"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Link href={practice} className={cx(buttonClass('primary'), 'w-full sm:w-auto')}>
          打开练习 →
        </Link>
        <a
          href={conversionFileUrl(c.id)}
          download={`${title}（PDF 转换）.gp5`}
          className={cx(buttonClass('outline'), 'w-full sm:w-auto')}
        >
          下载 GP5
        </a>
        {canDelete &&
          (confirming ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">删除这份转换版？</span>
              <button
                type="button"
                disabled={removing}
                onClick={doRemove}
                className={cx(buttonClass('outline'), 'border-destructive text-destructive')}
              >
                {removing ? '正在删除…' : '删除'}
              </button>
              <button
                type="button"
                disabled={removing}
                onClick={() => setConfirming(false)}
                className={buttonClass('ghost')}
              >
                取消
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className={buttonClass('ghost')}>
              删除
            </button>
          ))}
      </div>
    </li>
  )
}

/**
 * 「转换成可播放的谱（实验）」: converts only this PDF, on click, and lists the song's
 * conversions (newest first) with ratings, practice links and downloads.
 */
export function ConversionsPanel({
  path,
  title,
  artist,
}: {
  path: string
  title: string
  artist: string
}) {
  const me = useMe()
  const status = useLoad(() => api.conversionStatus(), 'conversion-status')
  const { items, loaded, error, converting } = useConversions(path)
  const [notice, setNotice] = useState<string | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)

  const mine = items.filter((c) => c.sourcePath === path)
  const available = status.status === 'ready' && status.data.available
  const unavailable =
    status.status === 'error'
      ? status.message
      : status.status === 'ready' && !status.data.available
        ? status.data.reason || '这台服务器暂时不能转换。'
        : null

  const onConvert = () => {
    setNotice(null)
    setFresh(null)
    convertPdf(path)
      .then((record) => setFresh(record.id))
      .catch((e: unknown) => setNotice(errorText(e)))
  }

  const canDelete = (c: ConversionRecord) =>
    me !== null && (me.role === 'admin' || c.createdBy === me.id)

  return (
    <section className={cx(PANEL, 'space-y-4 p-4')}>
      <div className="space-y-2">
        <h3 className="m-0 text-base font-semibold">转换成可播放的谱（实验）</h3>
        <p className="m-0 text-sm leading-relaxed text-muted-foreground">
          只适合用 Guitar Pro 等软件导出的文字六线谱 PDF；扫描图片做的 PDF 暂时认不出。转出来的谱请对照原谱检查，尤其是节奏。
        </p>
      </div>

      <div className="space-y-2">
        <button
          type="button"
          onClick={onConvert}
          disabled={converting || !available}
          aria-busy={converting}
          className={cx(
            buttonClass('primary'),
            'w-full whitespace-normal py-2 text-left sm:w-auto sm:text-center',
          )}
        >
          {converting ? (
            <>
              <span
                aria-hidden
                className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
              正在识别六线谱…（最长约 1 分钟）
            </>
          ) : mine.length > 0 ? (
            '再转换一次'
          ) : (
            '转换成可播放的谱（实验）'
          )}
        </button>
        {unavailable && (
          <p className="m-0 text-sm text-muted-foreground" role="status">
            {unavailable}
          </p>
        )}
        {!converting && mine.length > 0 && (
          <p className="m-0 text-sm text-muted-foreground">这份 PDF 之前转换过，下面有记录。</p>
        )}
      </div>

      {notice && <Notice tone="error">{notice}</Notice>}

      {fresh && (
        <div
          role="status"
          className="rounded-lg border border-primary bg-accent p-3 text-sm leading-relaxed"
        >
          转好了！打开练习后请给它打分，帮大家判断这份转换好不好用。
        </div>
      )}

      {error ? (
        <Notice tone="error">{error}</Notice>
      ) : !loaded ? (
        <p className="m-0 text-sm text-muted-foreground">正在读取转换记录…</p>
      ) : items.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">这首歌还没有转换版。</p>
      ) : (
        <ul className="m-0 list-none space-y-3 p-0">
          {items.map((c) => (
            <ConversionItem
              key={c.id}
              path={path}
              record={c}
              fresh={c.id === fresh}
              title={title}
              artist={artist}
              canDelete={canDelete(c)}
              onError={setNotice}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
