import type { MixCourseLesson } from '@/mixing/types'

type FigureId = NonNullable<MixCourseLesson['figure']>

const W = 520
const H = 170
const stroke = 'hsl(var(--cyan))'
const accent = 'hsl(var(--amber))'
const muted = 'hsl(var(--muted-foreground))'
const grid = 'hsl(var(--border))'

const logX = (f: number) => 30 + ((Math.log10(f) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20))) * (W - 50)

function Axis({ label }: { label?: string }) {
  return (
    <>
      <line x1={30} y1={H - 25} x2={W - 15} y2={H - 25} stroke={grid} />
      <line x1={30} y1={10} x2={30} y2={H - 25} stroke={grid} />
      {label && (
        <text x={W - 15} y={H - 8} textAnchor="end" fontSize={11} fill={muted}>
          {label}
        </text>
      )}
    </>
  )
}

function FreqTicks() {
  return (
    <>
      {[50, 100, 200, 500, 1000, 2000, 5000, 10000].map((f) => (
        <text key={f} x={logX(f)} y={H - 10} textAnchor="middle" fontSize={10} fill={muted}>
          {f >= 1000 ? `${f / 1000}k` : f}
        </text>
      ))}
    </>
  )
}

function path(points: Array<[number, number]>): string {
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
}

function FreqMap() {
  const zones: Array<[number, number, string]> = [
    [20, 80, '轰 / 嗡（低频）'],
    [80, 300, '厚 / 浑'],
    [300, 1000, '闷 / 箱子声'],
    [1000, 3000, '鼻音 / 清晰'],
    [3000, 6000, '临场 / 刺'],
    [6000, 20000, '齿音 / 空气感'],
  ]
  return (
    <>
      {zones.map(([a, b, t], i) => (
        <g key={t}>
          <rect x={logX(a)} y={20 + (i % 2) * 30} width={logX(b) - logX(a)} height={70} fill={i % 2 ? 'hsl(var(--cyan) / 0.12)' : 'hsl(var(--amber) / 0.12)'} />
          <text x={(logX(a) + logX(b)) / 2} y={60 + (i % 2) * 30} textAnchor="middle" fontSize={11} fill="currentColor">
            {t}
          </text>
        </g>
      ))}
      <Axis label="频率（Hz）" />
      <FreqTicks />
    </>
  )
}

function EqShapes() {
  const mid = 75
  const curve = (fn: (f: number) => number) => {
    const pts: Array<[number, number]> = []
    for (let i = 0; i <= 60; i++) {
      const f = 20 * Math.pow(1000, i / 60)
      pts.push([logX(f), mid - fn(f) * 4])
    }
    return path(pts)
  }
  const bell = (f: number) => 8 * Math.exp(-Math.pow(Math.log2(f / 1000) / 0.6, 2))
  const shelf = (f: number) => 7 / (1 + Math.pow(5000 / f, 2))
  const hp = (f: number) => -Math.max(0, 12 * Math.log2(100 / f))
  return (
    <>
      <line x1={30} y1={mid} x2={W - 15} y2={mid} stroke={grid} strokeDasharray="4 4" />
      <path d={curve(hp)} fill="none" stroke={muted} strokeWidth={2} />
      <path d={curve(bell)} fill="none" stroke={stroke} strokeWidth={2} />
      <path d={curve(shelf)} fill="none" stroke={accent} strokeWidth={2} />
      <text x={logX(40)} y={135} fontSize={11} fill={muted}>
        低切（高通）
      </text>
      <text x={logX(1000)} y={30} fontSize={11} fill={stroke} textAnchor="middle">
        峰值（钟形）
      </text>
      <text x={logX(9000)} y={38} fontSize={11} fill={accent} textAnchor="middle">
        高频搁架
      </text>
      <Axis label="频率" />
      <FreqTicks />
    </>
  )
}

function CompCurve() {
  const x0 = 40
  const y0 = H - 25
  const s = 2.2
  const thr = -24
  const ratio = 4
  const pts: Array<[number, number]> = []
  for (let inp = -60; inp <= 0; inp += 1) {
    const out = inp < thr ? inp : thr + (inp - thr) / ratio
    pts.push([x0 + (inp + 60) * s * 1.8, y0 - (out + 60) * s])
  }
  return (
    <>
      <path d={path([[x0, y0], [x0 + 60 * s * 1.8, y0 - 60 * s]])} stroke={grid} strokeDasharray="4 4" />
      <path d={path(pts)} fill="none" stroke={stroke} strokeWidth={2.5} />
      <circle cx={x0 + (thr + 60) * s * 1.8} cy={y0 - (thr + 60) * s} r={4} fill={accent} />
      <text x={x0 + (thr + 60) * s * 1.8 + 8} y={y0 - (thr + 60) * s + 16} fontSize={11} fill={accent}>
        阈值：超过之后，每进 4 dB 只出 1 dB（4:1）
      </text>
      <text x={x0} y={18} fontSize={11} fill={muted}>
        输出
      </text>
      <text x={W - 20} y={H - 8} fontSize={11} fill={muted} textAnchor="end">
        输入电平 →
      </text>
    </>
  )
}

function Envelope() {
  const pts: Array<[number, number]> = []
  for (let i = 0; i <= 200; i++) {
    const t = i / 200
    const env = t < 0.05 ? t / 0.05 : Math.exp(-(t - 0.05) * 4)
    pts.push([30 + t * (W - 50), 120 - env * 90 * Math.abs(Math.sin(i * 0.9))])
  }
  return (
    <>
      <path d={path(pts)} fill="none" stroke={stroke} strokeWidth={1.2} />
      <rect x={30} y={20} width={(W - 50) * 0.08} height={110} fill="hsl(var(--amber) / 0.15)" />
      <text x={34} y={16} fontSize={11} fill={accent}>
        启动：字头 / 鼓头
      </text>
      <rect x={30 + (W - 50) * 0.35} y={20} width={(W - 50) * 0.5} height={110} fill="hsl(var(--cyan) / 0.08)" />
      <text x={30 + (W - 50) * 0.36} y={16} fontSize={11} fill={stroke}>
        释放：压缩器多快"松手"
      </text>
      <Axis label="时间" />
    </>
  )
}

function ReverbTail() {
  const pts: Array<[number, number]> = []
  for (let i = 0; i <= 120; i++) pts.push([90 + i * 3.4, 130 - 90 * Math.exp(-i / 35) * (0.6 + 0.4 * Math.abs(Math.sin(i * 1.7)))])
  return (
    <>
      <rect x={34} y={30} width={14} height={100} fill={accent} />
      <text x={34} y={24} fontSize={11} fill={accent}>
        原声
      </text>
      <line x1={48} y1={130} x2={90} y2={130} stroke={muted} strokeDasharray="3 3" />
      <text x={50} y={148} fontSize={11} fill={muted}>
        预延迟
      </text>
      <path d={path(pts)} fill="none" stroke={stroke} strokeWidth={1.5} />
      <text x={260} y={60} fontSize={11} fill={stroke}>
        混响尾巴：衰减时间越长，空间越大
      </text>
      <Axis label="时间" />
    </>
  )
}

function PanField() {
  const items: Array<[number, string]> = [
    [-0.8, '吉他 1'],
    [-0.4, '和声'],
    [0, '主唱 · 底鼓 · 贝斯'],
    [0.45, '键盘'],
    [0.8, '吉他 2'],
  ]
  return (
    <>
      <line x1={40} y1={90} x2={W - 40} y2={90} stroke={grid} />
      <text x={40} y={115} fontSize={11} fill={muted}>
        左
      </text>
      <text x={W - 40} y={115} fontSize={11} fill={muted} textAnchor="end">
        右
      </text>
      {items.map(([p, t], i) => {
        const x = W / 2 + (p * (W - 80)) / 2
        return (
          <g key={t}>
            <circle cx={x} cy={90} r={p === 0 ? 9 : 6} fill={p === 0 ? accent : stroke} />
            <text x={x} y={i % 2 ? 66 : 60} fontSize={11} fill="currentColor" textAnchor="middle">
              {t}
            </text>
          </g>
        )
      })}
    </>
  )
}

function LoudnessMeter() {
  const bars: Array<[string, number, string]> = [
    ['峰值（Peak）', -1, accent],
    ['短时响度', -10, stroke],
    ['整体响度（LUFS）', -14, stroke],
  ]
  return (
    <>
      {bars.map(([t, v, c], i) => (
        <g key={t}>
          <text x={30} y={40 + i * 40} fontSize={11} fill="currentColor">
            {t}
          </text>
          <rect x={150} y={28 + i * 40} width={W - 180} height={14} fill="hsl(var(--muted) / 0.6)" />
          <rect x={150} y={28 + i * 40} width={((v + 30) / 30) * (W - 180)} height={14} fill={c} />
          <text x={150 + ((v + 30) / 30) * (W - 180) + 4} y={40 + i * 40} fontSize={11} fill={muted}>
            {v} dB
          </text>
        </g>
      ))}
      <text x={30} y={H - 10} fontSize={11} fill={muted}>
        峰值看会不会爆音；LUFS 看人耳觉得有多响（流媒体常见目标约 −14 LUFS）。
      </text>
    </>
  )
}

function SignalChain() {
  const steps = ['噪声门', '低切', 'EQ', '压缩', '去齿音', '饱和', '混响 / 延迟', '母线 · 限幅']
  const w = (W - 40) / steps.length
  return (
    <>
      {steps.map((s, i) => (
        <g key={s}>
          <rect x={20 + i * w + 2} y={60} width={w - 10} height={44} rx={8} fill="hsl(var(--cyan) / 0.12)" stroke={stroke} />
          <text x={20 + i * w + w / 2 - 3} y={86} fontSize={11} textAnchor="middle" fill="currentColor">
            {s}
          </text>
          {i < steps.length - 1 && <text x={20 + (i + 1) * w - 5} y={86} fontSize={12} fill={muted} textAnchor="middle">›</text>}
        </g>
      ))}
      <text x={20} y={40} fontSize={11} fill={muted}>
        常见的人声顺序：先清理（门、低切、减法 EQ），再控制动态，最后加空间与染色。
      </text>
    </>
  )
}

function SaturationCurve() {
  const pts = (k: number) => {
    const p: Array<[number, number]> = []
    for (let i = 0; i <= 80; i++) {
      const x = (i / 80) * 2 - 1
      p.push([W / 2 + x * 180, 85 - (Math.tanh(k * x) / Math.tanh(k)) * 60])
    }
    return path(p)
  }
  return (
    <>
      <line x1={W / 2 - 190} y1={85} x2={W / 2 + 190} y2={85} stroke={grid} />
      <line x1={W / 2} y1={15} x2={W / 2} y2={155} stroke={grid} />
      <path d={path([[W / 2 - 180, 145], [W / 2 + 180, 25]])} stroke={muted} strokeDasharray="4 4" fill="none" />
      <path d={pts(2)} fill="none" stroke={stroke} strokeWidth={2} />
      <path d={pts(6)} fill="none" stroke={accent} strokeWidth={2} />
      <text x={W / 2 + 120} y={20} fontSize={11} fill={accent}>
        驱动越大，越"圆"
      </text>
      <text x={20} y={H - 10} fontSize={11} fill={muted}>
        曲线把波形的尖头压圆，产生新的谐波：轻则温暖，重则失真。
      </text>
    </>
  )
}

function MsMatrix() {
  return (
    <>
      <text x={30} y={40} fontSize={12} fill="currentColor">
        中间（M）= (左 + 右) / 2 → 主唱、底鼓、贝斯
      </text>
      <text x={30} y={70} fontSize={12} fill="currentColor">
        两侧（S）= (左 − 右) / 2 → 左右不同的部分（双吉他、混响）
      </text>
      <text x={30} y={105} fontSize={12} fill={stroke}>
        宽度 = 把 S 放大或缩小：S 为 0 就是单声道
      </text>
      <text x={30} y={135} fontSize={11} fill={muted}>
        加宽过头：手机外放或单声道播放时，两侧的东西会变弱甚至消失。
      </text>
    </>
  )
}

const FIGURES: Record<FigureId, { title: string; render: () => JSX.Element }> = {
  freqMap: { title: '频段与听感', render: FreqMap },
  eqShapes: { title: 'EQ 的几种形状', render: EqShapes },
  compCurve: { title: '压缩曲线', render: CompCurve },
  envelope: { title: '启动与释放', render: Envelope },
  reverbTail: { title: '混响的结构', render: ReverbTail },
  panField: { title: '声像摆位', render: PanField },
  loudnessMeter: { title: '峰值与响度', render: LoudnessMeter },
  signalChain: { title: '信号链', render: SignalChain },
  saturationCurve: { title: '饱和曲线', render: SaturationCurve },
  msMatrix: { title: '中间与两侧（M/S）', render: MsMatrix },
}

export function LessonFigure({ id }: { id: FigureId }) {
  const f = FIGURES[id]
  return (
    <figure className="rounded-2xl border border-border/80 bg-muted/20 p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full text-foreground" role="img" aria-label={f.title}>
        {f.render()}
      </svg>
      <figcaption className="mt-1 text-center text-xs text-muted-foreground">{f.title}</figcaption>
    </figure>
  )
}
