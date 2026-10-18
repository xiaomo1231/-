/**
 * The floating remote over a score (desktop: a card bottom-right; phones: a sheet
 * along the bottom, collapsible to the play button), the small bar for the other
 * formats, and the star hook both share.
 */
import { useState } from 'react'
import { errorText, type FavoriteItem } from '../lib/api'
import { isFavorite, toggleFavorite, useFavorites } from '../lib/favorites'
import { cx } from '../lib/classes'
import {
  fmtClock,
  SHEET_OPTIONS,
  SPEED_MAX,
  SPEED_MIN,
  SPEED_PRESETS,
  STAFF_OPTIONS,
  ZOOM_OPTIONS,
  type SheetMode,
  type StaffMode,
} from './scorePrefs'

export type PopKind = 'speed' | 'tracks' | 'key' | 'view'

/** Star state and the toggle for one file; `note` is a short result line. */
export function useStar(item: Omit<FavoriteItem, 'addedAt'>) {
  const { items } = useFavorites()
  const starred = items.some((f) => f.path === item.path) || isFavorite(item.path)
  const [note, setNote] = useState('')
  const toggle = async () => {
    try {
      const now = await toggleFavorite(item)
      setNote(now ? '已收藏' : '已取消收藏')
    } catch (e) {
      setNote(errorText(e))
    }
    window.setTimeout(() => setNote(''), 2200)
  }
  return { starred, toggle, note }
}

const REMOTE_CSS = `
.gl-remote, .gl-filebar { position: fixed; z-index: 40; color: hsl(var(--foreground)); }
.gl-remote {
  right: max(16px, env(safe-area-inset-right, 0px));
  bottom: max(16px, env(safe-area-inset-bottom, 0px));
  width: 336px; padding: 12px;
  background: hsl(var(--background) / 0.94); backdrop-filter: blur(14px);
  border: 1px solid hsl(var(--border)); border-radius: 16px;
  box-shadow: 0 18px 50px -20px rgba(0, 0, 0, 0.55);
}
.gl-r-row { display: flex; align-items: center; gap: 8px; }
.gl-grid { margin-top: 10px; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
.gl-grid + .gl-grid { margin-top: 8px; }
.gl-key {
  min-height: 44px; min-width: 0; border: 1px solid hsl(var(--border)); border-radius: 10px;
  background: hsl(var(--background)); color: inherit; display: grid; place-items: center;
  font-size: 12px; line-height: 1.1; padding: 4px 2px; text-decoration: none;
  box-shadow: 0 2px 0 hsl(var(--border)); transition: transform 60ms, box-shadow 60ms;
}
.gl-key:active:not(:disabled) { transform: translateY(2px); box-shadow: none; }
.gl-key:disabled { opacity: 0.45; cursor: not-allowed; }
.gl-key[aria-pressed="true"] {
  background: hsl(var(--primary)); border-color: hsl(var(--primary)); color: hsl(var(--primary-foreground));
  box-shadow: 0 2px 0 hsl(var(--primary-strong));
}
.gl-key small { display: block; font-size: 10px; opacity: 0.72; }
.gl-play {
  width: 58px; height: 58px; border-radius: 50%; border: 0; flex: none;
  background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); display: grid; place-items: center;
  box-shadow: 0 4px 0 hsl(var(--primary-strong));
}
.gl-play:active:not(:disabled) { transform: translateY(3px); box-shadow: 0 1px 0 hsl(var(--primary-strong)); }
.gl-play:disabled { opacity: 0.5; cursor: not-allowed; }
.gl-tl { flex: 1; min-width: 0; }
.gl-tm { font-family: var(--font-mono); font-size: 12px; color: hsl(var(--muted-foreground)); display: flex; justify-content: space-between; gap: 6px; font-variant-numeric: tabular-nums; }
.gl-tm span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gl-prog { height: 4px; background: hsl(var(--border)); border-radius: 2px; margin-top: 6px; overflow: hidden; }
.gl-prog i { display: block; height: 100%; width: 0; background: hsl(var(--primary)); }
.gl-min {
  border: 0; background: none; color: hsl(var(--muted-foreground)); width: 44px; height: 44px;
  border-radius: 10px; flex: none; font-size: 18px; line-height: 1;
}
.gl-hint { font-size: 12px; color: hsl(var(--muted-foreground)); margin: 8px 2px 0; }
.gl-pop {
  position: absolute; right: 0; bottom: calc(100% + 10px); width: 100%; max-height: 62vh; overflow-y: auto;
  background: hsl(var(--background)); border: 1px solid hsl(var(--border)); border-radius: 14px;
  padding: 14px; box-shadow: 0 18px 40px -18px rgba(0, 0, 0, 0.5);
}
.gl-pop h4 { margin: 0 0 10px; font-size: 13px; letter-spacing: 0.12em; color: hsl(var(--muted-foreground)); font-weight: 600; }
.gl-pop h4:not(:first-child) { margin-top: 14px; }
.gl-pop .gl-hint { margin-top: 12px; }
.gl-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.gl-pill {
  min-height: 40px; min-width: 40px; border: 1px solid hsl(var(--border)); background: none; color: inherit;
  border-radius: 9px; padding: 6px 10px; font-size: 13px;
}
.gl-pill[aria-pressed="true"] { background: hsl(var(--primary)); border-color: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
.gl-pill:disabled { opacity: 0.45; }
.gl-pill.grow { flex: 1; text-align: left; }
.gl-dial { display: flex; align-items: center; gap: 10px; }
.gl-dial input[type="range"] { flex: 1; accent-color: hsl(var(--primary)); min-height: 40px; }
.gl-dial .gl-val { min-width: 84px; text-align: right; font-family: var(--font-mono); font-size: 13px; font-variant-numeric: tabular-nums; }
.gl-tracks { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.gl-tracks li { display: flex; gap: 6px; align-items: center; }
.gl-ms {
  min-width: 40px; min-height: 40px; border: 1px solid hsl(var(--border)); background: none; color: inherit;
  border-radius: 9px; font-family: var(--font-mono); font-size: 13px;
}
.gl-ms[aria-pressed="true"] { background: hsl(var(--primary)); border-color: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
.gl-filebar { right: max(16px, env(safe-area-inset-right, 0px)); bottom: max(16px, env(safe-area-inset-bottom, 0px)); display: flex; gap: 6px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.gl-filebar .gl-key { width: 76px; }
.gl-filebar .gl-note { font-size: 12px; background: hsl(var(--foreground)); color: hsl(var(--background)); padding: 4px 10px; border-radius: 8px; }
@media (max-width: 859px) {
  .gl-remote {
    left: 0; right: 0; bottom: 0; width: auto; border-radius: 18px 18px 0 0;
    padding: 12px max(16px, env(safe-area-inset-right, 0px)) max(14px, env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px));
  }
  .gl-pop { left: 0; right: 0; }
}
.gl-remote.is-min {
  left: auto; right: max(16px, env(safe-area-inset-right, 0px)); bottom: max(16px, env(safe-area-inset-bottom, 0px));
  width: auto; padding: 6px; border-radius: 999px; display: flex; align-items: center; gap: 4px;
}
.gl-remote.is-min .gl-play { width: 52px; height: 52px; }
`

const MS_LABEL = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0')

export interface RemoteProps {
  pop: PopKind | null
  onPop: (p: PopKind | null) => void
  collapsed: boolean
  onCollapsed: (c: boolean) => void
  /** 'loading' while the sound font loads, 'ready', or 'off' when it failed (no playback keys). */
  sound: 'loading' | 'ready' | 'off'
  soundPct: number
  playing: boolean
  onPlayPause: () => void
  onBackToStart: () => void
  now: number
  end: number
  bar: number
  bars: number
  speedPct: number
  onSpeedPct: (pct: number) => void
  tempo: number
  loop: boolean
  onLoop: () => void
  hasSelection: boolean
  countIn: boolean
  onCountIn: () => void
  metro: boolean
  onMetro: () => void
  tracks: string[]
  track: number
  onShowTrack: (i: number) => void
  solo: ReadonlySet<number>
  mute: ReadonlySet<number>
  onSolo: (i: number) => void
  onMute: (i: number) => void
  transpose: number
  onTranspose: (delta: number) => void
  staff: StaffMode
  onStaff: (s: StaffMode) => void
  scale: number
  onScale: (s: number) => void
  sheet: SheetMode
  onSheet: (s: SheetMode) => void
  starred: boolean
  onStar: () => void
  downloadHref: string
  note: string
}

/** The score remote: playback keys (when the sound is there), view keys, and the popovers above it. */
export function Remote(p: RemoteProps) {
  const min = p.collapsed
  const keysOn = p.sound !== 'off'
  const playable = p.sound === 'ready'
  const progress = p.end > 0 ? Math.min(1, p.now / p.end) : 0
  const togglePop = (k: PopKind) => p.onPop(p.pop === k ? null : k)

  return (
    <section className={cx('gl-remote', min && 'is-min')} role="region" aria-label="播放控制">
      <style>{REMOTE_CSS}</style>
      {!min && p.pop && <Popover kind={p.pop} p={p} />}
      <div className="gl-r-row">
        {keysOn && (
          <button
            type="button"
            className="gl-play"
            onClick={p.onPlayPause}
            disabled={!playable}
            aria-label={p.playing ? '暂停（空格）' : '播放（空格）'}
          >
            {p.playing ? (
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
                <rect x="4" y="3" width="4" height="14" rx="1" fill="currentColor" />
                <rect x="12" y="3" width="4" height="14" rx="1" fill="currentColor" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 20 20" aria-hidden>
                <path d="M6 3.5v13l11-6.5z" fill="currentColor" />
              </svg>
            )}
          </button>
        )}
        {!min && (
          <div className="gl-tl">
            <div className="gl-tm">
              {playable ? (
                <>
                  <span>{fmtClock(p.now)}</span>
                  <span>
                    第 {p.bar} / {p.bars} 小节
                  </span>
                  <span>{fmtClock(p.end)}</span>
                </>
              ) : (
                <span role="status">
                  {p.sound === 'off'
                    ? '音色没能加载，只能看谱'
                    : `正在加载音色… ${p.soundPct > 0 ? `${p.soundPct}%` : ''}`}
                </span>
              )}
            </div>
            <div className="gl-prog" aria-hidden>
              <i style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
        )}
        <button
          type="button"
          className="gl-min"
          onClick={() => p.onCollapsed(!min)}
          aria-label={min ? '展开控制面板' : '收起控制面板'}
          aria-expanded={!min}
        >
          <span aria-hidden>{min ? '⌃' : '⌄'}</span>
        </button>
      </div>

      {!min && keysOn && (
        <div className="gl-grid">
          <button
            type="button"
            className="gl-key"
            onClick={p.onBackToStart}
            disabled={!playable}
            aria-label="回到开头（退格）"
          >
            <span aria-hidden>⏮</span>
            <small>回开头</small>
          </button>
          <button
            type="button"
            className="gl-key"
            onClick={() => togglePop('speed')}
            aria-pressed={p.pop === 'speed'}
            aria-label={`速度 ${p.speedPct}%（S）`}
            disabled={!playable}
          >
            <span className="num">{p.speedPct}%</span>
            <small>速度</small>
          </button>
          <button
            type="button"
            className="gl-key"
            onClick={p.onLoop}
            aria-pressed={p.loop}
            aria-label="循环（L）"
            title="在谱面上拖动选出要循环的小节；没有选择时循环整首"
            disabled={!playable}
          >
            <span aria-hidden>⟲</span>
            <small>循环</small>
          </button>
          <button
            type="button"
            className="gl-key"
            onClick={p.onCountIn}
            aria-pressed={p.countIn}
            aria-label="预备拍（C）"
            disabled={!playable}
          >
            <span aria-hidden>1-2-3</span>
            <small>预备拍</small>
          </button>
          <button
            type="button"
            className="gl-key"
            onClick={p.onMetro}
            aria-pressed={p.metro}
            aria-label="节拍器"
            disabled={!playable}
          >
            <span aria-hidden>♩</span>
            <small>节拍器</small>
          </button>
        </div>
      )}
      {!min && keysOn && p.loop && !p.hasSelection && (
        <p className="gl-hint">在谱面上拖动选出要循环的小节；没有选择时循环整首。</p>
      )}

      {!min && (
        <div className="gl-grid">
          <button
            type="button"
            className="gl-key"
            onClick={() => togglePop('tracks')}
            aria-pressed={p.pop === 'tracks'}
            aria-label="音轨（T）"
          >
            <span aria-hidden>≡</span>
            <small>音轨</small>
          </button>
          <button
            type="button"
            className="gl-key"
            onClick={() => togglePop('key')}
            aria-pressed={p.pop === 'key'}
            aria-label={`移调 ${MS_LABEL(p.transpose)}（K）`}
          >
            <span className="num">{MS_LABEL(p.transpose)}</span>
            <small>移调</small>
          </button>
          <button
            type="button"
            className="gl-key"
            onClick={() => togglePop('view')}
            aria-pressed={p.pop === 'view'}
            aria-label="谱面、缩放、配色"
          >
            <span aria-hidden>Aa</span>
            <small>谱面</small>
          </button>
          <button
            type="button"
            className="gl-key"
            onClick={p.onStar}
            aria-pressed={p.starred}
            aria-label={p.starred ? '取消收藏（F）' : '收藏（F）'}
          >
            <span aria-hidden>{p.starred ? '★' : '☆'}</span>
            <small>收藏</small>
          </button>
          <a className="gl-key" href={p.downloadHref} download aria-label="下载原文件">
            <span aria-hidden>↓</span>
            <small>下载</small>
          </a>
        </div>
      )}
      {p.note && (
        <p className="gl-hint" role="status">
          {p.note}
        </p>
      )}
    </section>
  )
}

function Popover({ kind, p }: { kind: PopKind; p: RemoteProps }) {
  if (kind === 'speed') return <SpeedPop p={p} />
  if (kind === 'tracks') return <TracksPop p={p} />
  if (kind === 'key') return <KeyPop p={p} />
  return <ViewPop p={p} />
}

function SpeedPop({ p }: { p: RemoteProps }) {
  const bpm = p.tempo > 0 ? `${Math.round((p.tempo * p.speedPct) / 100)} bpm` : '— bpm'
  return (
    <div className="gl-pop" role="dialog" aria-label="速度">
      <h4>速 度</h4>
      <div className="gl-dial">
        <button
          type="button"
          className="gl-pill"
          aria-label="慢 1%"
          onClick={() => p.onSpeedPct(p.speedPct - 1)}
          disabled={p.speedPct <= SPEED_MIN}
        >
          −1
        </button>
        <input
          type="range"
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={5}
          value={p.speedPct}
          aria-label="速度百分比"
          aria-valuetext={`${p.speedPct}%`}
          onChange={(e) => p.onSpeedPct(Number(e.target.value))}
        />
        <button
          type="button"
          className="gl-pill"
          aria-label="快 1%"
          onClick={() => p.onSpeedPct(p.speedPct + 1)}
          disabled={p.speedPct >= SPEED_MAX}
        >
          +1
        </button>
      </div>
      <p className="gl-val num" style={{ margin: '8px 0 0', fontSize: 13 }}>
        {p.speedPct}% · {bpm}
      </p>
      <div className="gl-chips" style={{ marginTop: 10 }}>
        {SPEED_PRESETS.map((v) => (
          <button
            key={v}
            type="button"
            className="gl-pill"
            aria-pressed={p.speedPct === v}
            onClick={() => p.onSpeedPct(v)}
          >
            {v}%
          </button>
        ))}
      </div>
      <p className="gl-hint">15%–175%，播放中可以直接调整。</p>
    </div>
  )
}

function TracksPop({ p }: { p: RemoteProps }) {
  return (
    <div className="gl-pop" role="dialog" aria-label="音轨">
      <h4>音 轨</h4>
      <ul className="gl-tracks">
        {p.tracks.map((name, i) => (
          <li key={i}>
            <button
              type="button"
              className="gl-pill grow"
              aria-pressed={p.track === i}
              onClick={() => p.onShowTrack(i)}
            >
              {name}
            </button>
            <button
              type="button"
              className="gl-ms"
              aria-pressed={p.solo.has(i)}
              aria-label={`独奏 ${name}`}
              title="独奏"
              onClick={() => p.onSolo(i)}
            >
              S
            </button>
            <button
              type="button"
              className="gl-ms"
              aria-pressed={p.mute.has(i)}
              aria-label={`静音 ${name}`}
              title="静音"
              onClick={() => p.onMute(i)}
            >
              M
            </button>
          </li>
        ))}
      </ul>
      <p className="gl-hint">点音轨名显示这一轨；S 独奏，M 静音（M 键静音当前音轨）。</p>
    </div>
  )
}

function KeyPop({ p }: { p: RemoteProps }) {
  const t = p.transpose
  const hint =
    t > 0
      ? `也可以夹变调夹在第 ${t} 品，按原指法弹。`
      : t < 0
        ? '往下移调：没有变调夹的弹法，品位整体下移。'
        : '原调。'
  return (
    <div className="gl-pop" role="dialog" aria-label="移调">
      <h4>移 调</h4>
      <div className="gl-dial">
        <button
          type="button"
          className="gl-pill"
          aria-label="降半音"
          onClick={() => p.onTranspose(-1)}
          disabled={t <= -6}
        >
          −
        </button>
        <span className="num" style={{ flex: 1, textAlign: 'center', fontSize: 20 }}>
          {t > 0 ? `+${t}` : t}
          <span style={{ fontSize: 13 }}> 半音</span>
        </span>
        <button
          type="button"
          className="gl-pill"
          aria-label="升半音"
          onClick={() => p.onTranspose(1)}
          disabled={t >= 6}
        >
          +
        </button>
      </div>
      <p className="gl-hint">{hint} 只在这里生效，不改动原文件。</p>
    </div>
  )
}

function ViewPop({ p }: { p: RemoteProps }) {
  return (
    <div className="gl-pop" role="dialog" aria-label="谱面">
      <h4>谱 面</h4>
      <div className="gl-chips">
        {STAFF_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            className="gl-pill"
            aria-pressed={p.staff === o.value}
            onClick={() => p.onStaff(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <h4>缩 放</h4>
      <div className="gl-chips">
        {ZOOM_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            className="gl-pill"
            aria-pressed={p.scale === o.value}
            onClick={() => p.onScale(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <h4>配 色</h4>
      <div className="gl-chips">
        {SHEET_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            className="gl-pill"
            aria-pressed={p.sheet === o.value}
            onClick={() => p.onSheet(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="gl-hint">设置保存在这台设备上。</p>
    </div>
  )
}

/** Non-score files: a small bar with the star and the download only. */
export function FileBar({
  item,
  downloadHref,
}: {
  item: Omit<FavoriteItem, 'addedAt'>
  downloadHref: string
}) {
  const star = useStar(item)
  return (
    <div className="gl-filebar" role="region" aria-label="文件操作">
      <style>{REMOTE_CSS}</style>
      {star.note && (
        <span className="gl-note" role="status">
          {star.note}
        </span>
      )}
      <button
        type="button"
        className="gl-key"
        onClick={() => void star.toggle()}
        aria-pressed={star.starred}
        aria-label={star.starred ? '取消收藏' : '收藏'}
      >
        <span aria-hidden>{star.starred ? '★' : '☆'}</span>
        <small>收藏</small>
      </button>
      <a className="gl-key" href={downloadHref} download aria-label="下载原文件">
        <span aria-hidden>↓</span>
        <small>下载</small>
      </a>
    </div>
  )
}
