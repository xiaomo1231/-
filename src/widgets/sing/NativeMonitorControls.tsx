/**
 * 应用版 only (0.23.0): low-latency monitoring on / off and, when the sound
 * card has an ASIO driver, which way to use. Renders nothing in the browser.
 */
import { useEffect, useState } from 'react'
import { desktop } from '@/app/desktop'
import type { MonitorSettings } from '@/audio/sing/voiceMonitor'

export function NativeMonitorControls({
  monitor,
  setMonitor,
}: {
  monitor: MonitorSettings
  setMonitor: (p: Partial<MonitorSettings>) => void
}) {
  const app = desktop()
  const [asio, setAsio] = useState<string[]>([])
  useEffect(() => {
    if (!app || !monitor.native) return
    let dead = false
    app.monitor
      .devices()
      .then(
        (list) =>
          // Only drivers with inputs: ASIO records and plays through the same sound card.
          !dead &&
          setAsio([
            ...new Set(list.filter((d) => d.api === 'ASIO' && d.inputs > 0).map((d) => d.name)),
          ]),
      )
      .catch(() => undefined)
    return () => {
      dead = true
    }
  }, [app, monitor.native])
  if (!app) return null
  return (
    <>
      <label className="flex items-center gap-1 text-xs" title="通过声卡驱动直接监听，延迟更小">
        <input
          type="checkbox"
          checked={monitor.native}
          onChange={(e) => setMonitor({ native: e.target.checked })}
          className="accent-[hsl(var(--amber))]"
        />
        低延迟
      </label>
      {monitor.native && asio.length > 0 && (
        <select
          value={monitor.nativeApi}
          onChange={(e) => setMonitor({ nativeApi: e.target.value })}
          className="focus-ring h-7 rounded-lg border border-border bg-background px-1.5 text-xs"
          aria-label="低延迟监听方式"
        >
          <option value="wasapi">WASAPI（推荐）</option>
          {asio.map((n) => (
            <option key={n} value={`asio:${n}`}>
              ASIO：{n}（延迟最低；麦克风和耳机都要接在这块声卡上）
            </option>
          ))}
        </select>
      )}
    </>
  )
}
