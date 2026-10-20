import { useState, type FormEvent } from 'react'
import { api, errorText } from '../lib/api'
import { buttonClass, cx } from '../lib/classes'
import { MINE_KIND_LABEL, mineRows, useMine, type MineKind, type MineRow } from '../lib/mine'
import { hrefUpload } from '../lib/route'
import { useRestoreScroll } from '../lib/scrollMemory'
import { Link } from '../components/Link'
import { MiddleText } from '../components/MiddleText'
import { Notice, PageBar } from '../components/ui'

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' })

const SECTIONS: ReadonlyArray<{ kind: MineKind; empty: string }> = [
  { kind: 'arrangement', empty: '在看谱页的「音轨」里换乐器、调音量，然后点「保存为改编谱」。' },
  { kind: 'upload', empty: '点上面的「上传谱子」，或在乐队页「新建歌曲」上传的谱会出现在这里。' },
  { kind: 'combo', empty: '在看谱页「组合乐队谱」里从不同版本挑声部，保存后会出现在这里。' },
]

/** 我的谱子: this account's 改编谱 (rename, delete), uploaded songs and 组合乐队谱. */
export function MinePage() {
  const { data, error, reload } = useMine()
  useRestoreScroll(data !== null)
  const rows = data ? mineRows(data) : []

  return (
    <>
      <PageBar
        title="我的谱子"
        back="← 目录"
        fallback="#/"
        subtitle={data ? `${rows.length} 个` : undefined}
      />
      <div className="max-w-[720px] space-y-10 pb-20 pt-6">
        {error && (
          <Notice tone="error">
            {error}
            <button
              type="button"
              onClick={reload}
              className="ml-3 underline underline-offset-4"
            >
              重试
            </button>
          </Notice>
        )}
        {!data && !error && <p className="text-sm text-muted-foreground">正在读取…</p>}
        {data && <UploadBox storage={data.storage} />}
        {data &&
          SECTIONS.map((s) => {
            const list = rows.filter((r) => r.kind === s.kind)
            return (
              <section key={s.kind} aria-label={MINE_KIND_LABEL[s.kind]}>
                <h2 className="label m-0">
                  {MINE_KIND_LABEL[s.kind]}
                  <span className="ml-2 normal-case tracking-normal text-muted-foreground">{list.length}</span>
                </h2>
                {list.length === 0 ? (
                  <p className="m-0 mt-2.5 text-sm text-muted-foreground">{s.empty}</p>
                ) : (
                  <ul className="m-0 mt-2.5 list-none p-0">
                    {list.map((r) => (
                      <MineItem key={r.key} row={r} onChanged={reload} />
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
      </div>
    </>
  )
}

const fmtMB = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`

/** 上传谱子: a song of 我的谱子 (only this account sees it), and how much space is left. */
function UploadBox({ storage }: { storage: { used: number; limit: number | null } }) {
  const full = storage.limit !== null && storage.used >= storage.limit
  const pct = storage.limit === null ? 0 : Math.min(100, Math.round((storage.used / storage.limit) * 100))
  return (
    <section aria-label="上传谱子" className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 font-bold">上传自己的谱子</p>
          <p className="m-0 mt-1 text-xs leading-relaxed text-muted-foreground">
            GP、MusicXML、PDF、图片都可以，只有你自己看得到；能播放的谱也能换乐器、存成改编谱。
          </p>
        </div>
        <Link
          href={hrefUpload({ personal: true })}
          aria-disabled={full}
          className={cx(buttonClass('primary'), 'shrink-0', full && 'pointer-events-none opacity-50')}
        >
          上传谱子
        </Link>
      </div>
      <div className="mt-3 space-y-1.5">
        <p className="m-0 text-xs text-muted-foreground">
          {storage.limit === null
            ? `已用 ${fmtMB(storage.used)}（管理员不限）`
            : `已用 ${fmtMB(storage.used)} / ${fmtMB(storage.limit)}${full ? '，空间用完了，先删掉一些再上传' : ''}`}
        </p>
        {storage.limit !== null && (
          <div className="h-1.5 w-full max-w-[320px] overflow-hidden rounded-full bg-border" aria-hidden>
            <div
              className={cx('h-full origin-left rounded-full', pct >= 90 ? 'bg-destructive' : 'bg-primary')}
              style={{ transform: `scaleX(${pct / 100})` }}
            />
          </div>
        )}
      </div>
    </section>
  )
}

/** One row; an 改编谱 can be renamed or deleted here. */
function MineItem({ row, onChanged }: { row: MineRow; onChanged: () => void }) {
  const [mode, setMode] = useState<'rename' | 'delete' | null>(null)
  const [name, setName] = useState(row.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editable = row.kind === 'arrangement'

  const run = async (job: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await job()
      setMode(null)
      onChanged()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const rename = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const n = name.trim()
    if (n) void run(() => api.renameArrangement(row.id, n))
  }

  return (
    <li className="border-t border-border py-3 last:border-b">
      <div className="flex items-start gap-3">
        <Link href={row.href} className="group min-w-0 flex-1">
          <MiddleText
            text={row.name}
            className="text-[15px] font-bold transition-colors group-hover:text-primary"
          />
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {row.line} · {fmtDate(row.updatedAt)}
          </span>
        </Link>
        {editable && mode === null && (
          <span className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => {
                setName(row.name)
                setMode('rename')
              }}
              className={cx(buttonClass('ghost'), 'min-h-11 px-2.5 text-sm')}
            >
              改名
            </button>
            <button
              type="button"
              onClick={() => setMode('delete')}
              className={cx(buttonClass('ghost'), 'min-h-11 px-2.5 text-sm hover:text-destructive')}
            >
              删除
            </button>
          </span>
        )}
      </div>
      {mode === 'rename' && (
        <form onSubmit={rename} className="mt-2 flex flex-wrap gap-2">
          <label className="sr-only" htmlFor={`name-${row.id}`}>
            改编谱名字
          </label>
          <input
            id={`name-${row.id}`}
            value={name}
            maxLength={60}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            className="h-11 min-w-0 flex-1 basis-56 rounded-lg border border-border bg-transparent px-3 text-base text-foreground focus:border-primary"
          />
          <button type="submit" disabled={busy || !name.trim()} className={buttonClass('primary')}>
            {busy ? '正在保存…' : '保存'}
          </button>
          <button type="button" onClick={() => setMode(null)} className={buttonClass('ghost')}>
            取消
          </button>
        </form>
      )}
      {mode === 'delete' && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-destructive p-3">
          <p className="m-0 flex-1 basis-56 text-sm">删除这个改编谱？原谱不受影响。</p>
          <button
            type="button"
            onClick={() => void run(() => api.removeArrangement(row.id))}
            disabled={busy}
            className={cx(buttonClass('outline'), 'border-destructive text-destructive')}
          >
            {busy ? '正在删除…' : '删除'}
          </button>
          <button type="button" onClick={() => setMode(null)} className={buttonClass('ghost')}>
            取消
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="m-0 mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </li>
  )
}
