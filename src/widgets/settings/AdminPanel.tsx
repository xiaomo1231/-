import { useState } from 'react'
import { durationText, loadTimings } from '@/audio/separation/timings'
import { cpuWorkers, forceCpu } from '@/audio/separation/separate'

/**
 * 管理员模式 extras: this device's separation timings (to compare engines and
 * computers) and a switch that skips the GPU, to see how a computer without
 * WebGPU would do.
 */
export function AdminPanel() {
  const [cpu, setCpu] = useState(forceCpu)
  const timings = loadTimings()
  const toggle = () => {
    const next = !cpu
    try {
      if (next) localStorage.setItem('groovelab:separation-cpu', '1')
      else localStorage.removeItem('groovelab:separation-cpu')
    } catch {
      // storage blocked
    }
    setCpu(next)
  }
  return (
    <div className="space-y-3 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={cpu} onChange={toggle} className="accent-[hsl(var(--amber))]" />
        测试：浏览器分人声时不用显卡（只用处理器，{cpuWorkers()} 路并行）
      </label>
      {timings.length === 0 ? (
        <p className="text-muted-foreground">这台电脑还没有分轨记录。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-normal">时间</th>
                <th className="py-1 pr-3 font-normal">方式</th>
                <th className="py-1 pr-3 font-normal">计算</th>
                <th className="py-1 pr-3 font-normal">歌曲长度</th>
                <th className="py-1 pr-3 font-normal">耗时</th>
                <th className="py-1 font-normal">每分钟歌曲</th>
              </tr>
            </thead>
            <tbody className="num">
              {timings.map((t) => (
                <tr key={t.at} className="border-t border-border/60">
                  <td className="py-1 pr-3">{new Date(t.at).toLocaleString()}</td>
                  <td className="py-1 pr-3">{t.engine === 'local' ? '本机助手' : t.backend === 'native' ? '应用 · 人声' : t.mode === 'vocals' ? '浏览器 · 人声' : '浏览器 · 六轨'}</td>
                  <td className="py-1 pr-3">{t.engine === 'local' ? '—' : t.backend === 'webgpu' ? `显卡${t.precision ? ` ${t.precision}` : ''}` : `处理器${t.threads ? ` ×${t.threads}` : ''}`}</td>
                  <td className="py-1 pr-3">{t.audioSeconds ? durationText(t.audioSeconds) : '—'}</td>
                  <td className="py-1 pr-3">{durationText(t.seconds)}</td>
                  <td className="py-1">{t.audioSeconds ? durationText((t.seconds / t.audioSeconds) * 60) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
