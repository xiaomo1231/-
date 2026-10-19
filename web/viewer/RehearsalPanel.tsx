/**
 * The rehearsal control panel above the score during a band rehearsal: who conducts,
 * who plays the backing (音箱), this device's role and settings, the conductor's song /
 * section / loop controls, 从第 X 小节再来 requests and the devices' sync. Purely
 * presentational: every change goes out through `onCommand` or the callbacks.
 */
import { useState } from 'react'
import type { BandSong, Instrument, RehearsalCommand, RehearsalState, UserInfo } from '../lib/api'
import type { Section } from '@/songs/rehearsalSections'

const OPEN_KEY = 'gl-rehearsal-panel-open'

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0'
  } catch {
    return true
  }
}

function writeOpen(open: boolean) {
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0')
  } catch {
    // Storage unavailable (private mode): the choice simply is not remembered.
  }
}

const BTN =
  'rounded-md border border-[hsl(var(--border))] px-2.5 py-1 hover:border-[hsl(var(--primary))] disabled:cursor-not-allowed disabled:opacity-50'
const BTN_ON = 'border-[hsl(var(--primary))] text-[hsl(var(--primary))]'
const SELECT =
  'rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 disabled:opacity-50'
const NUM_INPUT =
  'w-16 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1'
const CHIP = 'rounded border border-[hsl(var(--border))] px-1 text-xs'
const CHIP_PRIMARY =
  'rounded border border-[hsl(var(--primary))] px-1 text-xs text-[hsl(var(--primary))]'
const MUTED = 'text-[hsl(var(--muted-foreground))]'
const MONO = { fontFamily: 'var(--font-mono)' } as const

const PASS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '2', label: '2 遍' },
  { value: '3', label: '3 遍' },
  { value: '4', label: '4 遍' },
  { value: '5', label: '5 遍' },
  { value: '8', label: '8 遍' },
  { value: 'inf', label: '一直循环' },
]

const RAMP_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: '不加速' },
  { value: 5, label: '每遍 +5%' },
  { value: 10, label: '每遍 +10%' },
]

const RAMP_MAX_OPTIONS = [80, 90, 100, 110, 120]

function clampBar(n: number, bars: number): number {
  return Math.min(Math.max(1, bars), Math.max(1, Math.round(n)))
}

/** Default loop range: the selection, else the current section, else a few bars from here. */
function defaultLoopRange(
  selection: [number, number] | null,
  sections: Section[],
  currentBar: number,
  bars: number,
): [number, number] {
  if (selection) return [clampBar(selection[0], bars), clampBar(selection[1], bars)]
  let cur = -1
  sections.forEach((s, i) => {
    if (s.startBar <= currentBar) cur = i
  })
  if (cur >= 0) {
    const next = sections[cur + 1]
    return [clampBar(sections[cur].startBar, bars), clampBar(next ? next.startBar - 1 : bars, bars)]
  }
  return [clampBar(currentBar, bars), clampBar(currentBar + 3, bars)]
}

export interface RehearsalPanelProps {
  state: RehearsalState
  me: UserInfo
  deviceId: string
  members: Array<{ id: string; displayName: string; instrument: Instrument | null }>
  /** All band songs (for names) and today's setlist (band song ids, in order). */
  songs: BandSong[]
  setlist: string[]
  connected: boolean
  error: string | null
  /** Sections of the current song (may be empty). */
  sections: Section[]
  /** Current 1-based bar, number of bars, and the bars selected on the sheet (1-based, inclusive) or null. */
  currentBar: number
  bars: number
  selection: [number, number] | null
  speedPct: number
  /** Count of 小节留言 of this song. */
  commentCount: number
  /** This device's calibrated latency in ms. */
  latencyMs: number
  /** Sends a rehearsal command (fire and forget; errors come back through `error`). */
  onCommand: (cmd: RehearsalCommand) => void
  /** 1-based bar → start tick, and exclusive end tick of a bar. */
  tickOfBar: (bar: number) => number
  endTickOfBar: (bar: number) => number
  /** Conductor: jump everyone to a bar (parent sends seek). */
  onSeekBar: (bar: number) => void
  /** Conductor: accept a request — jump to the bar and play. */
  onPlayFromBar: (bar: number) => void
  onOpenFill: () => void
  onOpenComments: () => void
  onCalibrate: () => void
}

export function RehearsalPanel(props: RehearsalPanelProps) {
  const {
    state,
    me,
    deviceId,
    members,
    songs,
    setlist,
    connected,
    error,
    sections,
    currentBar,
    bars,
    selection,
    commentCount,
    latencyMs,
    onCommand,
    tickOfBar,
    endTickOfBar,
    onSeekBar,
    onPlayFromBar,
    onOpenFill,
    onOpenComments,
    onCalibrate,
  } = props

  const [open, setOpen] = useState(readOpen)
  const toggleOpen = () => {
    const next = !open
    setOpen(next)
    writeOpen(next)
  }

  // Loop editor: the user's own edit wins; otherwise it follows the sheet's selection.
  const [loopEdit, setLoopEdit] = useState<[number, number] | null>(null)
  const [passes, setPasses] = useState('4')
  const [rampPct, setRampPct] = useState(0)
  const [rampMaxPct, setRampMaxPct] = useState(100)

  const nameOf = (id: string): string => {
    if (id === me.id) return me.displayName
    return members.find((m) => m.id === id)?.displayName ?? '成员'
  }

  const isLeader = state.leaderId === me.id
  const isSpeaker = state.speakerDevice === deviceId
  const myDevice = state.devices.find((d) => d.deviceId === deviceId)
  const leaderPresent =
    state.leaderId !== null && state.devices.some((d) => d.userId === state.leaderId)
  const speakerDevice = state.speakerDevice
    ? state.devices.find((d) => d.deviceId === state.speakerDevice)
    : undefined
  const leaderName = state.leaderId ? nameOf(state.leaderId) : null

  const songIndex = state.songId ? setlist.indexOf(state.songId) : -1
  const userIds = new Set(state.devices.map((d) => d.userId))
  const readyIds = new Set(state.devices.filter((d) => d.ready).map((d) => d.userId))

  const role = isSpeaker ? '你是音箱' : myDevice?.audible ? '耳机出声' : '静音看谱'

  const range: [number, number] =
    loopEdit ?? defaultLoopRange(selection, sections, currentBar, bars)

  let curSection = -1
  sections.forEach((s, i) => {
    if (s.startBar <= currentBar) curSection = i
  })

  const loop = state.loop
  const passText = loop
    ? loop.passes === null
      ? `第 ${state.pass} 遍（一直循环）`
      : `第 ${state.pass}/${loop.passes} 遍`
    : ''
  const rampText = loop
    ? loop.rampPct > 0
      ? `每遍 +${loop.rampPct}% 到 ${loop.rampMaxPct}%`
      : '不加速'
    : ''

  const requestBar = selection?.[0] ?? currentBar

  return (
    <section
      aria-label="排练控制"
      className="mb-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-sm"
    >
      {/* header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-medium">排练中</span>
        <span className={`inline-flex items-center gap-1.5 ${MUTED}`}>
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-full"
            style={{
              background: connected ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
            }}
          />
          {connected ? '已连接' : '未连接'}
        </span>
        {songIndex >= 0 && (
          <span className={MUTED} style={MONO}>
            第 {songIndex + 1}/{setlist.length} 首
          </span>
        )}
        <span>
          {leaderName ? (
            <>指挥：{leaderName}</>
          ) : (
            <span className="text-amber-600 dark:text-amber-400">没有指挥</span>
          )}
        </span>
        <span>
          {speakerDevice ? (
            <>
              音箱：{nameOf(speakerDevice.userId)} 的 {speakerDevice.label}
            </>
          ) : (
            <span className="text-amber-600 dark:text-amber-400">还没有音箱</span>
          )}
        </span>
        <span className={MUTED} style={MONO}>
          已就位 {readyIds.size}/{userIds.size}
        </span>
        <button
          type="button"
          className={`${BTN} ml-auto`}
          aria-expanded={open}
          onClick={toggleOpen}
        >
          {open ? '收起' : '展开'}
        </button>
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-3">
          {/* this device */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={CHIP_PRIMARY}>{role}</span>
            <button
              type="button"
              className={BTN}
              title="音箱这台设备负责出声，接排练室的音箱。"
              onClick={() => onCommand({ type: 'speaker', take: !isSpeaker })}
            >
              {isSpeaker ? '不当音箱' : '设为音箱'}
            </button>
            {!isSpeaker && (
              <button
                type="button"
                className={`${BTN} ${myDevice?.audible ? BTN_ON : ''}`}
                aria-pressed={myDevice?.audible ?? false}
                disabled={!myDevice}
                onClick={() => onCommand({ type: 'device', audible: !myDevice?.audible })}
              >
                这台也出声（戴耳机）
              </button>
            )}
            <button type="button" className={BTN} onClick={onCalibrate}>
              校准延迟（{latencyMs} 毫秒）
            </button>
            <button
              type="button"
              className={`${BTN} ${myDevice?.ready ? BTN_ON : ''}`}
              aria-pressed={myDevice?.ready ?? false}
              disabled={!myDevice}
              onClick={() => onCommand({ type: 'device', ready: !myDevice?.ready })}
            >
              我准备好了
            </button>
            <button type="button" className={BTN} onClick={onOpenFill}>
              补位
            </button>
            <button type="button" className={BTN} onClick={onOpenComments}>
              留言 ({commentCount})
            </button>
          </div>

          {/* conductor controls */}
          {isLeader && (
            <div className="flex flex-col gap-3 rounded-md border border-[hsl(var(--border))] p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={BTN}
                  disabled={songIndex <= 0}
                  onClick={() => {
                    const id = setlist[songIndex - 1]
                    if (id) onCommand({ type: 'song', songId: id })
                  }}
                >
                  ◀ 上一首
                </button>
                <button
                  type="button"
                  className={BTN}
                  disabled={songIndex < 0 || songIndex >= setlist.length - 1}
                  onClick={() => {
                    const id = setlist[songIndex + 1]
                    if (id) onCommand({ type: 'song', songId: id })
                  }}
                >
                  下一首 ▶
                </button>
                <label className="flex items-center gap-1.5">
                  <span className="sr-only">选择曲目</span>
                  <select
                    className={SELECT}
                    value={state.songId ?? ''}
                    disabled={setlist.length === 0}
                    onChange={(e) => {
                      if (e.target.value) onCommand({ type: 'song', songId: e.target.value })
                    }}
                  >
                    {state.songId === null && <option value="">选择曲目</option>}
                    {setlist.map((id) => {
                      const song = songs.find((s) => s.id === id)
                      const label = song ? `${song.title} — ${song.artist}` : id
                      return (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      )
                    })}
                  </select>
                </label>
                <button
                  type="button"
                  className={`${BTN} ${state.countIn ? BTN_ON : ''}`}
                  aria-pressed={state.countIn}
                  onClick={() => onCommand({ type: 'countIn', on: !state.countIn })}
                >
                  预备拍
                </button>
              </div>

              {sections.length > 0 && (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="段落">
                  {sections.map((s, i) => (
                    <button
                      key={`${s.startBar}-${i}`}
                      type="button"
                      className={`${BTN} px-2 py-0.5 text-xs ${i === curSection ? BTN_ON : ''}`}
                      aria-current={i === curSection ? 'true' : undefined}
                      onClick={() => onSeekBar(s.startBar)}
                    >
                      {s.name} {s.startBar}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5">
                    <span>从</span>
                    <input
                      type="number"
                      className={NUM_INPUT}
                      min={1}
                      max={bars}
                      value={range[0]}
                      aria-label="循环起始小节"
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        if (e.target.value !== '' && Number.isFinite(n)) setLoopEdit([n, range[1]])
                      }}
                    />
                    <span>小节到</span>
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="number"
                      className={NUM_INPUT}
                      min={1}
                      max={bars}
                      value={range[1]}
                      aria-label="循环结束小节"
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        if (e.target.value !== '' && Number.isFinite(n)) setLoopEdit([range[0], n])
                      }}
                    />
                    <span>小节</span>
                  </label>
                  <label className="flex items-center gap-1.5">
                    <span className="sr-only">遍数</span>
                    <select
                      className={SELECT}
                      value={passes}
                      onChange={(e) => setPasses(e.target.value)}
                    >
                      {PASS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5">
                    <span className="sr-only">爬速度</span>
                    <select
                      className={SELECT}
                      value={rampPct}
                      onChange={(e) => setRampPct(Number(e.target.value))}
                    >
                      {RAMP_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5">
                    <span>加到</span>
                    <select
                      className={SELECT}
                      value={rampMaxPct}
                      onChange={(e) => setRampMaxPct(Number(e.target.value))}
                    >
                      {RAMP_MAX_OPTIONS.map((p) => (
                        <option key={p} value={p}>
                          {p} %
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className={BTN}
                    onClick={() => {
                      const a = clampBar(Math.min(range[0], range[1]), bars)
                      const b = clampBar(Math.max(range[0], range[1]), bars)
                      onCommand({
                        type: 'loop',
                        loop: {
                          startTick: tickOfBar(a),
                          endTick: endTickOfBar(b),
                          startBar: a,
                          endBar: b,
                          passes: passes === 'inf' ? null : Number(passes),
                          rampPct,
                          rampMaxPct,
                        },
                      })
                    }}
                  >
                    开始循环
                  </button>
                  {state.loop && (
                    <button
                      type="button"
                      className={BTN}
                      onClick={() => onCommand({ type: 'loop', loop: null })}
                    >
                      取消循环
                    </button>
                  )}
                </div>
                {loop && (
                  <p style={MONO} className="text-xs">
                    正在循环 {loop.startBar}–{loop.endBar} 小节 · {passText} · {rampText}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={BTN}
                  onClick={() => onCommand({ type: 'lead', take: false })}
                >
                  交出指挥
                </button>
                <button
                  type="button"
                  className={`${BTN} text-destructive`}
                  onClick={() => {
                    if (window.confirm('结束这次排练？所有人的排练都会结束。')) {
                      onCommand({ type: 'end' })
                    }
                  }}
                >
                  结束排练
                </button>
              </div>
            </div>
          )}

          {/* not the conductor */}
          {!isLeader && (
            <div className="flex flex-wrap items-center gap-2">
              {leaderPresent ? (
                <span className={MUTED}>由 {leaderName} 指挥</span>
              ) : (
                <button
                  type="button"
                  className={BTN}
                  onClick={() => onCommand({ type: 'lead', take: true })}
                >
                  我来当指挥
                </button>
              )}
            </div>
          )}

          {/* requests: 从第 X 小节再来 */}
          {state.requests.length > 0 && (
            <ul className="flex flex-col gap-1.5" aria-label="从第几小节再来的提议">
              {state.requests.map((r) => {
                const mine = r.userId === me.id
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                    <span>
                      {nameOf(r.userId)} 提议从第 {r.bar} 小节来
                    </span>
                    {isLeader && (
                      <>
                        <button
                          type="button"
                          className={BTN}
                          onClick={() => {
                            onPlayFromBar(r.bar)
                            onCommand({ type: 'dismiss', requestId: r.id })
                          }}
                        >
                          同意
                        </button>
                        <button
                          type="button"
                          className={BTN}
                          onClick={() => onCommand({ type: 'dismiss', requestId: r.id })}
                        >
                          忽略
                        </button>
                      </>
                    )}
                    {!isLeader && mine && (
                      <>
                        <span className={MUTED}>等指挥同意</span>
                        <button
                          type="button"
                          className={BTN}
                          onClick={() => onCommand({ type: 'dismiss', requestId: r.id })}
                        >
                          撤回
                        </button>
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {!isLeader && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={BTN}
                onClick={() =>
                  onCommand({ type: 'request', bar: requestBar, tick: tickOfBar(requestBar) })
                }
              >
                提议从第 {requestBar} 小节来
              </button>
              <span className={`${MUTED} text-xs`}>在谱上点一个小节可以选别的位置</span>
            </div>
          )}

          {/* devices */}
          {state.devices.length > 0 && (
            <ul className="flex flex-col gap-1" aria-label="设备">
              {state.devices.map((d) => {
                const isThisLeader = d.userId === state.leaderId
                const isThisSpeaker = d.deviceId === state.speakerDevice
                const drift = d.driftMs === null ? null : Math.round(Math.abs(d.driftMs))
                let driftNode = null
                if (d.driftMs !== null && drift !== null) {
                  if (Math.abs(d.driftMs) < 50) {
                    driftNode = (
                      <span className="text-[hsl(var(--primary))]" style={MONO}>
                        同步
                      </span>
                    )
                  } else if (Math.abs(d.driftMs) < 120) {
                    driftNode = (
                      <span className="text-amber-600 dark:text-amber-400" style={MONO}>
                        差 {drift} ms
                      </span>
                    )
                  } else {
                    driftNode = (
                      <span className="text-destructive" style={MONO}>
                        差 {drift} ms
                      </span>
                    )
                  }
                }
                return (
                  <li key={d.deviceId} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span>
                      {nameOf(d.userId)} · {d.label}
                    </span>
                    {isThisLeader && <span className={CHIP_PRIMARY}>指挥</span>}
                    {isThisSpeaker && <span className={CHIP_PRIMARY}>音箱</span>}
                    {!isThisSpeaker && d.audible && <span className={CHIP}>耳机</span>}
                    {d.ready && (
                      <span className="text-[hsl(var(--primary))]" aria-label="已准备好">
                        ✓
                      </span>
                    )}
                    {d.latencyMs > 0 && (
                      <span className={MUTED} style={MONO}>
                        延迟 {d.latencyMs} ms
                      </span>
                    )}
                    {driftNode}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
