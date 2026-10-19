/**
 * 补位面板: which tracks and drums the 音箱 plays for members who are not in the room.
 * The table shows who plays each track now, the mode (自动 / 播放 / 不播) and its volume;
 * the result of 自动 is shown next to it. Narrow screens get stacked cards instead.
 */
import type { ReactNode } from 'react'
import type { DrumStyleInfo, FillConfig, FillDrumSource, FillMode } from '../lib/api'
import type { FillPlan, FillPlanTrack } from '@/songs/rehearsalFill'
import { cx, SELECT } from '../lib/classes'

const MODE_OPTIONS: ReadonlyArray<{ mode: FillMode; label: string }> = [
  { mode: 'auto', label: '自动' },
  { mode: 'on', label: '播放' },
  { mode: 'off', label: '不播' },
]

const SOURCE_LABEL: Record<FillDrumSource, string> = {
  auto: '自动（编辑过的鼓谱 > 谱里的鼓 > 自动生成）',
  file: '谱里的鼓',
  saved: '编辑过的鼓谱',
  generated: '自动生成',
  metronome: '只放节拍器',
}

const USED_LABEL: Record<FillPlan['drums']['source'], string> = {
  file: '谱里的鼓',
  saved: '编辑过的鼓谱',
  generated: '自动生成',
  metronome: '只放节拍器',
}

const DRUMS_KEY = 'drums'

export function FillPanel({
  plan,
  fill,
  onChange,
  nameOf,
  hasFileDrums,
  hasSavedDrums,
  drumStyles,
  disabled = false,
  caption,
}: {
  plan: FillPlan
  fill: FillConfig
  onChange: (fill: FillConfig) => void
  /** Shown name of a user id. */
  nameOf: (userId: string) => string
  /** The file has its own drum track(s). */
  hasFileDrums: boolean
  /** A drum part was saved in the drum editor. */
  hasSavedDrums: boolean
  drumStyles: DrumStyleInfo[]
  /** Read-only (members who are not the conductor). */
  disabled?: boolean
  /** One line above the table, e.g. '按现在在场的人自动决定' or '假设全员到齐'. */
  caption?: string
}) {
  const trackMode = (index: number): FillMode => fill.tracks[String(index)] ?? 'auto'
  const volumeOf = (key: string): number => fill.volumes[key] ?? 100

  const setTrackMode = (index: number, mode: FillMode) => {
    const tracks = { ...fill.tracks }
    if (mode === 'auto') delete tracks[String(index)]
    else tracks[String(index)] = mode
    onChange({ ...fill, tracks })
  }

  const setVolume = (key: string, volume: number) => {
    onChange({ ...fill, volumes: { ...fill.volumes, [key]: volume } })
  }

  const setDrumsMode = (mode: FillMode) => onChange({ ...fill, drums: mode })

  const setDrumSource = (drumSource: FillDrumSource) => onChange({ ...fill, drumSource })

  const setDrumStyle = (value: string) => onChange({ ...fill, drumStyle: value === '' ? null : value })

  const setMetronome = (metronome: boolean) => onChange({ ...fill, metronome })

  const setCountIn = (countIn: boolean) => onChange({ ...fill, countIn })

  // Generated drums get a style choice: when chosen directly, or when 自动 resolves to them.
  const showStyle =
    fill.drumSource === 'generated' || (fill.drumSource === 'auto' && plan.drums.source === 'generated')

  const drummers = plan.drums.drummers.length > 0 ? plan.drums.drummers.map(nameOf).join('、') : null

  const trackRows = plan.tracks.map((t) => ({
    key: String(t.index),
    index: t.index,
    name: t.name,
    who: whoLine(t, nameOf),
    present: t.present,
    mode: trackMode(t.index),
    play: t.play,
    reason: t.reason,
    volumeKey: String(t.index),
    ariaName: t.name,
  }))

  return (
    <section className={cx('space-y-3', disabled && 'opacity-90')} aria-label="补位">
      {caption && <p className="m-0 text-sm text-muted-foreground">{caption}</p>}

      {/* Desktop: a table. */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-2 py-2 font-medium">轨道</th>
              <th className="px-2 py-2 font-medium">谁负责</th>
              <th className="px-2 py-2 font-medium">播放</th>
              <th className="px-2 py-2 font-medium">音量</th>
              <th className="px-2 py-2 font-medium">说明</th>
            </tr>
          </thead>
          <tbody>
            {trackRows.map((row) => (
              <tr key={row.key} className="border-b border-border/60 align-top">
                <td className="px-2 py-2">{row.name}</td>
                <td className="px-2 py-2">
                  <WhoLine who={row.who} present={row.present} />
                </td>
                <td className="px-2 py-2">
                  <ModeControl
                    name={row.ariaName}
                    mode={row.mode}
                    play={row.play}
                    disabled={disabled}
                    onChange={(m) => setTrackMode(row.index, m)}
                  />
                </td>
                <td className="px-2 py-2">
                  <VolumeControl
                    label={`${row.ariaName} 音量`}
                    value={volumeOf(row.volumeKey)}
                    disabled={disabled}
                    onChange={(v) => setVolume(row.volumeKey, v)}
                  />
                </td>
                <td className="px-2 py-2 text-xs text-muted-foreground">{row.reason}</td>
              </tr>
            ))}
            <DrumsTableRow
              plan={plan}
              fill={fill}
              disabled={disabled}
              hasFileDrums={hasFileDrums}
              hasSavedDrums={hasSavedDrums}
              drumStyles={drumStyles}
              showStyle={showStyle}
              drummers={drummers}
              volume={volumeOf(DRUMS_KEY)}
              onMode={setDrumsMode}
              onVolume={(v) => setVolume(DRUMS_KEY, v)}
              onSource={setDrumSource}
              onStyle={setDrumStyle}
            />
          </tbody>
        </table>
      </div>

      {/* Narrow screens: stacked cards. */}
      <div className="space-y-3 sm:hidden">
        {trackRows.map((row) => (
          <div key={row.key} className="space-y-2 rounded-xl border border-border bg-card p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{row.name}</span>
              <WhoLine who={row.who} present={row.present} />
            </div>
            <ModeControl
              name={row.ariaName}
              mode={row.mode}
              play={row.play}
              disabled={disabled}
              onChange={(m) => setTrackMode(row.index, m)}
            />
            <VolumeControl
              label={`${row.ariaName} 音量`}
              value={volumeOf(row.volumeKey)}
              disabled={disabled}
              onChange={(v) => setVolume(row.volumeKey, v)}
            />
            <p className="m-0 text-xs text-muted-foreground">{row.reason}</p>
          </div>
        ))}
        <DrumsCard
          plan={plan}
          fill={fill}
          disabled={disabled}
          hasFileDrums={hasFileDrums}
          hasSavedDrums={hasSavedDrums}
          drumStyles={drumStyles}
          showStyle={showStyle}
          drummers={drummers}
          volume={volumeOf(DRUMS_KEY)}
          onMode={setDrumsMode}
          onVolume={(v) => setVolume(DRUMS_KEY, v)}
          onSource={setDrumSource}
          onStyle={setDrumStyle}
        />
      </div>

      <div className="space-y-2 border-t border-border pt-3 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={fill.countIn}
            disabled={disabled}
            onChange={(e) => setCountIn(e.target.checked)}
            className="h-4 w-4"
          />
          预备拍
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={fill.metronome}
            disabled={disabled}
            onChange={(e) => setMetronome(e.target.checked)}
            className="h-4 w-4"
          />
          节拍器
        </label>
        <p className="m-0 text-xs text-muted-foreground">只放节拍器时节拍器会自动打开。</p>
      </div>
    </section>
  )
}

/** Who plays a track, for the table; the name is the shown name of the player. */
function whoLine(t: FillPlanTrack, nameOf: (id: string) => string): string | null {
  return t.player ? nameOf(t.player) : null
}

function WhoLine({ who, present }: { who: string | null; present: boolean }) {
  if (who === null) return <span className="text-muted-foreground">（没人负责）</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={cx(
          'inline-block h-2 w-2 shrink-0 rounded-full',
          present ? 'bg-primary' : 'border border-muted-foreground',
        )}
      />
      <span className="sr-only">{present ? '在场' : '不在场'}</span>
      {who}
    </span>
  )
}

/** 自动 / 播放 / 不播 segmented control, with the result of 自动 next to it. */
function ModeControl({
  name,
  mode,
  play,
  disabled,
  onChange,
}: {
  name: string
  mode: FillMode
  play: boolean
  disabled: boolean
  onChange: (mode: FillMode) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label={`${name} 播放方式`} className="inline-flex overflow-hidden rounded-lg border border-border">
        {MODE_OPTIONS.map((o) => {
          const pressed = mode === o.mode
          return (
            <button
              key={o.mode}
              type="button"
              aria-pressed={pressed}
              disabled={disabled}
              onClick={() => onChange(o.mode)}
              className={cx(
                'min-h-9 px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                pressed ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {o.label}
            </button>
          )
        })}
      </div>
      {mode === 'auto' && (
        <span className="text-xs text-muted-foreground">→ {play ? '播放' : '不播'}</span>
      )}
    </div>
  )
}

function VolumeControl({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: number
  disabled: boolean
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={0}
        max={150}
        step={5}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-[hsl(var(--primary))]"
      />
      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{value}%</span>
    </div>
  )
}

interface DrumsRowProps {
  plan: FillPlan
  fill: FillConfig
  disabled: boolean
  hasFileDrums: boolean
  hasSavedDrums: boolean
  drumStyles: DrumStyleInfo[]
  showStyle: boolean
  drummers: string | null
  volume: number
  onMode: (mode: FillMode) => void
  onVolume: (v: number) => void
  onSource: (source: FillDrumSource) => void
  onStyle: (value: string) => void
}

/** The drum controls, shared by the table row and the narrow card. */
function DrumControls(p: DrumsRowProps) {
  const { plan, fill, disabled } = p
  const unavailable = (ok: boolean) => (ok ? '' : '（没有，会自动改用其它）')
  return (
    <div className="space-y-2">
      <ModeControl
        name="鼓"
        mode={fill.drums}
        play={plan.drums.play}
        disabled={disabled}
        onChange={p.onMode}
      />
      <div className="space-y-1.5">
        <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">鼓的来源</span>
          <select
            value={fill.drumSource}
            disabled={disabled}
            onChange={(e) => p.onSource(e.target.value as FillDrumSource)}
            className={cx(SELECT, 'min-w-0 flex-1 text-foreground')}
          >
            <option value="auto">{SOURCE_LABEL.auto}</option>
            <option value="file">{`${SOURCE_LABEL.file}${unavailable(p.hasFileDrums)}`}</option>
            <option value="saved">{`${SOURCE_LABEL.saved}${unavailable(p.hasSavedDrums)}`}</option>
            <option value="generated">{SOURCE_LABEL.generated}</option>
            <option value="metronome">{SOURCE_LABEL.metronome}</option>
          </select>
        </label>
        {p.showStyle && (
          <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="shrink-0">风格</span>
            <select
              value={fill.drumStyle ?? ''}
              disabled={disabled}
              onChange={(e) => p.onStyle(e.target.value)}
              className={cx(SELECT, 'min-w-0 flex-1 text-foreground')}
            >
              <option value="">自动</option>
              {p.drumStyles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.zh}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="m-0 text-xs text-muted-foreground">
          现在用：{USED_LABEL[plan.drums.source]}
        </p>
        {plan.drums.sourceNote && (
          <p className="m-0 text-xs text-amber-600 dark:text-amber-400">{plan.drums.sourceNote}</p>
        )}
      </div>
    </div>
  )
}

function drumsName(hasFileDrums: boolean): ReactNode {
  return (
    <>
      鼓
      {!hasFileDrums && <span className="block text-xs text-muted-foreground">（谱里没有鼓轨）</span>}
    </>
  )
}

function DrumsTableRow(p: DrumsRowProps) {
  return (
    <tr className="border-b border-border/60 align-top">
      <td className="px-2 py-2">{drumsName(p.hasFileDrums)}</td>
      <td className="px-2 py-2">
        {p.drummers ?? <span className="text-muted-foreground">（没人负责）</span>}
      </td>
      <td className="px-2 py-2">
        <DrumControls {...p} />
      </td>
      <td className="px-2 py-2">
        <VolumeControl label="鼓 音量" value={p.volume} disabled={p.disabled} onChange={p.onVolume} />
      </td>
      <td className="px-2 py-2 text-xs text-muted-foreground">{p.plan.drums.reason}</td>
    </tr>
  )
}

function DrumsCard(p: DrumsRowProps) {
  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{drumsName(p.hasFileDrums)}</span>
        <span className="text-sm text-muted-foreground">{p.drummers ?? '（没人负责）'}</span>
      </div>
      <DrumControls {...p} />
      <VolumeControl label="鼓 音量" value={p.volume} disabled={p.disabled} onChange={p.onVolume} />
      <p className="m-0 text-xs text-muted-foreground">{p.plan.drums.reason}</p>
    </div>
  )
}
