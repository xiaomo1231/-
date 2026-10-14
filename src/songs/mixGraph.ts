/**
 * 模块化后期 (0.25.0), the data (pure): a graph of modules the student wires
 * up — sources (my voice, the backing), processors, an output — and the
 * cables between them. Each module's parameters are the matching part of a
 * MixSettings (so the desk's controls and teaching texts apply as they are).
 */
import type { MixSettings } from './singTypes'
import { cloneMix, clampMix, DEFAULT_MIX } from './mixPresets'

export type ModuleType =
  | 'voice'
  | 'backing'
  | 'gate'
  | 'lowCut'
  | 'eq'
  | 'dynEq'
  | 'comp'
  | 'parallel'
  | 'deEss'
  | 'saturation'
  | 'mod'
  | 'reverb'
  | 'delay'
  | 'backEq'
  | 'pocket'
  | 'duck'
  | 'gain'
  | 'pan'
  | 'mixer'
  | 'multiband'
  | 'width'
  | 'limiter'
  | 'output'

export interface ModNode {
  id: string
  type: ModuleType
  x: number
  y: number
  /** The module's part of a MixSettings (see MODULES[type].paths). */
  params: Record<string, unknown>
  /** Passes the signal through unchanged. */
  bypass?: boolean
  /** Reverb / delay: output only the effect (a send / return), not dry + effect. */
  send?: boolean
  label?: string
}

export interface ModEdge {
  id: string
  from: string
  to: string
  /** 0 = signal, 1 = sidechain (ducking: what makes it duck). */
  port: 0 | 1
}

export interface ModGraph {
  version: 1
  nodes: ModNode[]
  edges: ModEdge[]
}

export type ModuleCategory =
  'source' | 'clean' | 'dynamics' | 'color' | 'space' | 'backing' | 'utility' | 'master'

export interface ModuleInfo {
  label: string
  category: ModuleCategory
  /** One line: what it does. */
  blurb: string
  inputs: number
  /** Has an output (all but `output`). */
  output: boolean
  /** MixSettings paths whose values make up `params` (param key = last path segment). */
  paths: string[]
  /** Controls shown in the inspector (MixSettings paths, see mixing/controls). */
  controls: string[]
  /** Only one allowed. */
  single?: boolean
  /** Its controls change the desk's own settings (shared with the quick mode), not the module's params. */
  shared?: boolean
}

const C = (base: string, keys: string[]) => keys.map((k) => `${base}.${k}`)

export const MODULES: Record<ModuleType, ModuleInfo> = {
  voice: {
    label: '我的人声',
    category: 'source',
    blurb: '你的录音（逐句音量平衡、音高修正在这里，和快速模式共用）',
    inputs: 0,
    output: true,
    paths: [],
    controls: [
      'vocal.autoLevel.on',
      'vocal.autoLevel.strength',
      'vocal.tune.on',
      'vocal.tune.amount',
      'vocal.tune.speedMs',
    ],
    single: true,
    shared: true,
  },
  backing: {
    label: '伴奏',
    category: 'source',
    blurb: '分轨后的伴奏（各分轨音量在这里，和快速模式共用）',
    inputs: 0,
    output: true,
    paths: [],
    controls: [],
    single: true,
    shared: true,
  },
  gate: {
    label: '噪声门',
    category: 'clean',
    blurb: '不唱的时候把底噪压下去',
    inputs: 1,
    output: true,
    paths: ['vocal.gate'],
    controls: C('vocal.gate', ['on', 'thresholdDb', 'rangeDb', 'releaseMs']),
  },
  lowCut: {
    label: '低切',
    category: 'clean',
    blurb: '切掉喷麦、风声这些低频',
    inputs: 1,
    output: true,
    paths: ['vocal.lowCut'],
    controls: C('vocal.lowCut', ['on', 'freq']),
  },
  eq: {
    label: 'EQ',
    category: 'clean',
    blurb: '四段均衡：哪里闷了、刺了就调哪里',
    inputs: 1,
    output: true,
    paths: ['vocal.eq'],
    controls: [
      'vocal.eq.on',
      ...[0, 1, 2, 3].flatMap((i) => C(`vocal.eq.bands.${i}`, ['freq', 'gainDb', 'q'])),
    ],
  },
  dynEq: {
    label: '动态 EQ',
    category: 'clean',
    blurb: '某个频段变响时才压它（例如偶尔发闷的 250 Hz）',
    inputs: 1,
    output: true,
    paths: ['vocal.dynEq'],
    controls: C('vocal.dynEq', ['on', 'freq', 'q', 'thresholdDb', 'ratio', 'maxCutDb']),
  },
  comp: {
    label: '压缩',
    category: 'dynamics',
    blurb: '把忽大忽小的声音拉平',
    inputs: 1,
    output: true,
    paths: ['vocal.comp'],
    controls: C('vocal.comp', ['on', 'thresholdDb', 'ratio', 'attackMs', 'releaseMs', 'makeupDb']),
  },
  parallel: {
    label: '并行压缩',
    category: 'dynamics',
    blurb: '重压的一份混在原声下面：更结实、细节还在',
    inputs: 1,
    output: true,
    paths: ['vocal.parallel'],
    controls: C('vocal.parallel', ['on', 'thresholdDb', 'ratio', 'blend']),
  },
  deEss: {
    label: '去齿音',
    category: 'dynamics',
    blurb: '压住刺耳的"嘶""次"',
    inputs: 1,
    output: true,
    paths: ['vocal.deEss'],
    controls: C('vocal.deEss', ['on', 'freq', 'thresholdDb', 'amountDb']),
  },
  saturation: {
    label: '饱和',
    category: 'color',
    blurb: '加一点谐波，声音更暖、更靠前',
    inputs: 1,
    output: true,
    paths: ['vocal.saturation'],
    controls: C('vocal.saturation', ['on', 'type', 'drive', 'mix']),
  },
  mod: {
    label: '调制',
    category: 'color',
    blurb: '合唱 / 镶边 / 移相 / 加倍',
    inputs: 1,
    output: true,
    paths: ['vocal.mod'],
    controls: C('vocal.mod', ['on', 'type', 'rate', 'depth', 'mix']),
  },
  reverb: {
    label: '混响',
    category: 'space',
    blurb: '空间感；做成发送时只输出混响声',
    inputs: 1,
    output: true,
    paths: ['vocal.reverb'],
    controls: C('vocal.reverb', [
      'on',
      'type',
      'size',
      'decay',
      'preDelayMs',
      'mix',
      'lowCut',
      'highCut',
    ]),
  },
  delay: {
    label: '延迟',
    category: 'space',
    blurb: '回声；可以按歌曲速度同步',
    inputs: 1,
    output: true,
    paths: ['vocal.delay'],
    controls: C('vocal.delay', [
      'on',
      'sync',
      'division',
      'timeMs',
      'feedback',
      'mix',
      'pingPong',
      'highCut',
    ]),
  },
  backEq: {
    label: '伴奏 EQ',
    category: 'backing',
    blurb: '伴奏的低 / 中 / 高三段',
    inputs: 1,
    output: true,
    paths: ['backing.eq'],
    controls: C('backing.eq', ['on', 'lowDb', 'midDb', 'highDb']),
  },
  pocket: {
    label: '让出人声位置',
    category: 'backing',
    blurb: '在伴奏里挖一个人声最清楚的频段',
    inputs: 1,
    output: true,
    paths: ['backing.pocket'],
    controls: C('backing.pocket', ['on', 'freq', 'amountDb']),
  },
  duck: {
    label: '侧链让位',
    category: 'backing',
    blurb: '第二个输入有声音时（通常接人声），主输入自动变小',
    inputs: 2,
    output: true,
    paths: ['backing.duck'],
    controls: C('backing.duck', ['on', 'amountDb', 'releaseMs']),
  },
  gain: {
    label: '增益',
    category: 'utility',
    blurb: '调音量',
    inputs: 1,
    output: true,
    paths: ['vocal.gainDb'],
    controls: ['vocal.gainDb'],
  },
  pan: {
    label: '声像',
    category: 'utility',
    blurb: '放左一点或右一点',
    inputs: 1,
    output: true,
    paths: ['vocal.pan'],
    controls: ['vocal.pan'],
  },
  mixer: {
    label: '混合 / 总线',
    category: 'utility',
    blurb: '把接进来的几路加在一起',
    inputs: 1,
    output: true,
    paths: [],
    controls: [],
  },
  multiband: {
    label: '多段压缩',
    category: 'master',
    blurb: '低 / 中 / 高分开压',
    inputs: 1,
    output: true,
    paths: ['master.multiband'],
    controls: [
      'master.multiband.on',
      'master.multiband.lowHz',
      'master.multiband.highHz',
      ...[0, 1, 2].flatMap((i) => C(`master.multiband.bands.${i}`, ['thresholdDb', 'ratio'])),
    ],
  },
  width: {
    label: '立体声宽度',
    category: 'master',
    blurb: '让整体更宽或更窄',
    inputs: 1,
    output: true,
    paths: ['master.width'],
    controls: C('master.width', ['on', 'amount']),
  },
  limiter: {
    label: '限幅',
    category: 'master',
    blurb: '不让峰值超过上限',
    inputs: 1,
    output: true,
    paths: ['master.limiter', 'master.ceilingDb'],
    controls: ['master.limiter', 'master.ceilingDb'],
  },
  output: {
    label: '输出',
    category: 'master',
    blurb: '最终听到和导出的声音（导出时可以对齐目标响度）',
    inputs: 1,
    output: false,
    paths: ['master.targetLufs'],
    controls: [],
    single: true,
  },
}

export const CATEGORY_LABEL: Record<ModuleCategory, string> = {
  source: '声音来源',
  clean: '清理',
  dynamics: '动态',
  color: '音色',
  space: '空间',
  backing: '伴奏',
  utility: '工具',
  master: '母带 / 输出',
}

const get = (o: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (a, k) => (a && typeof a === 'object' ? (a as Record<string, unknown>)[k] : undefined),
      o,
    )
const key = (path: string) => path.slice(path.lastIndexOf('.') + 1)

/** A module's params taken from a mix. */
export function paramsFrom(type: ModuleType, m: MixSettings): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const p of MODULES[type].paths) out[key(p)] = JSON.parse(JSON.stringify(get(m, p) ?? null))
  return out
}

/**
 * The MixSettings a module reads: `base` with the module's params put in
 * place (params that hold a whole object replace it; single values set the field).
 */
export function mixFor(base: MixSettings, node: Pick<ModNode, 'type' | 'params'>): MixSettings {
  const m = cloneMix(base)
  for (const p of MODULES[node.type].paths) {
    const value = node.params[key(p)]
    if (value === undefined || value === null) {
      if (p === 'master.targetLufs') (m.master as Record<string, unknown>).targetLufs = null
      continue
    }
    const parts = p.split('.')
    let cur = m as unknown as Record<string, unknown>
    for (const k of parts.slice(0, -1)) cur = cur[k] as Record<string, unknown>
    cur[parts[parts.length - 1]!] = JSON.parse(JSON.stringify(value))
  }
  return clampMix(m)
}

/** Params after changing one control (a MixSettings path) of a module. */
export function setControl(
  node: Pick<ModNode, 'type' | 'params'>,
  base: MixSettings,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const m = mixFor(base, node) as unknown as Record<string, unknown>
  const parts = path.split('.')
  let cur = m
  for (const k of parts.slice(0, -1)) cur = cur[k] as Record<string, unknown>
  cur[parts[parts.length - 1]!] = value
  return paramsFrom(node.type, m as unknown as MixSettings)
}

let seq = 0
export const newId = (type: string) => `${type}-${Date.now().toString(36)}-${(seq++).toString(36)}`

export function makeNode(
  type: ModuleType,
  x: number,
  y: number,
  from: MixSettings = DEFAULT_MIX,
): ModNode {
  const params = paramsFrom(type, from)
  // A freshly added effect is on (otherwise dropping it in would change nothing).
  if (
    typeof params[key(MODULES[type].paths[0] ?? '')] === 'object' &&
    params[key(MODULES[type].paths[0] ?? '')] !== null
  ) {
    const p = params[key(MODULES[type].paths[0]!)] as Record<string, unknown>
    if ('on' in p) p.on = true
  }
  return { id: newId(type), type, x, y, params }
}

/**
 * The quick desk's chain as a graph (the starting point of the workspace):
 * voice → inserts in order → gain → pan → bus (+ reverb and delay sends);
 * backing → EQ → pocket → ducking (keyed by the voice) → gain → bus;
 * bus → master gain → multiband → width → limiter → output.
 */
export function graphFromMix(input: MixSettings): ModGraph {
  const m = clampMix(input)
  const nodes: ModNode[] = []
  const edges: ModEdge[] = []
  const add = (type: ModuleType, x: number, y: number, extra: Partial<ModNode> = {}): ModNode => {
    const n: ModNode = {
      id: `${type}-${nodes.length}`,
      type,
      x,
      y,
      params: paramsFrom(type, m),
      ...extra,
    }
    nodes.push(n)
    return n
  }
  const wire = (a: ModNode, b: ModNode, port: 0 | 1 = 0) =>
    edges.push({ id: `e${edges.length}`, from: a.id, to: b.id, port })
  // Layout: the voice chain in two rows of five, sends below it, the backing at the bottom,
  // the master chain as a column on the right.
  const X = 210
  const R = 130
  const voice = add('voice', 0, 0)
  let prev = voice
  m.vocal.order.forEach((id, i) => {
    const type: ModuleType = id === 'comp2' ? 'comp' : id
    const n = add(
      type,
      X * ((i % 5) + 1),
      R * Math.floor(i / 5),
      id === 'comp2'
        ? { params: { comp: JSON.parse(JSON.stringify(m.vocal.comp2)) }, label: '第二级压缩' }
        : {},
    )
    wire(prev, n)
    prev = n
  })
  const vGain = add('gain', X * 6, R, { label: '人声音量' })
  wire(prev, vGain)
  const pan = add('pan', X * 7, R)
  wire(vGain, pan)
  const rev = add('reverb', X * 7, R * 2.3, { send: true })
  wire(pan, rev)
  const del = add('delay', X * 7, R * 3.3, { send: true })
  wire(pan, del)
  const bus = add('mixer', X * 8.3, R * 2.6, { label: '总线' })
  wire(pan, bus)
  wire(rev, bus)
  wire(del, bus)
  const backing = add('backing', 0, R * 4.6)
  const bEq = add('backEq', X, R * 4.6)
  wire(backing, bEq)
  const pocket = add('pocket', X * 2, R * 4.6)
  wire(bEq, pocket)
  const duck = add('duck', X * 3, R * 4.6)
  wire(pocket, duck)
  wire(pan, duck, 1)
  const bGain = add('gain', X * 4, R * 4.6, {
    label: '伴奏音量',
    params: { gainDb: m.backing.gainDb },
  })
  wire(duck, bGain)
  wire(bGain, bus)
  const mGain = add('gain', X * 9.5, R * 2.6, {
    label: '总音量',
    params: { gainDb: m.master.gainDb },
  })
  wire(bus, mGain)
  const mb = add('multiband', X * 9.5, R * 3.6)
  wire(mGain, mb)
  const width = add('width', X * 9.5, R * 4.6)
  wire(mb, width)
  const lim = add('limiter', X * 9.5, R * 5.6)
  wire(width, lim)
  const out = add('output', X * 10.8, R * 5.6)
  wire(lim, out)
  return { version: 1, nodes, edges }
}

/** Would a cable from → to close a loop? */
export function wouldCycle(g: ModGraph, from: string, to: string): boolean {
  if (from === to) return true
  const next = new Map<string, string[]>()
  for (const e of g.edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to])
  const seen = new Set<string>()
  const stack = [to]
  while (stack.length) {
    const n = stack.pop()!
    if (n === from) return true
    if (seen.has(n)) continue
    seen.add(n)
    stack.push(...(next.get(n) ?? []))
  }
  return false
}

export interface GraphCheck {
  ok: boolean
  /** Problems that stop it from working (no output, nothing reaches it). */
  errors: string[]
  /** Modules that do nothing because they are not connected through to the output. */
  idle: string[]
}

export function checkGraph(g: ModGraph): GraphCheck {
  const errors: string[] = []
  const outputs = g.nodes.filter((n) => n.type === 'output')
  if (outputs.length !== 1)
    errors.push(
      outputs.length
        ? '只能有一个「输出」模块。'
        : '还没有「输出」模块：从模块库拖一个进来，把声音接到它。',
    )
  // Reaches the output, walking cables backwards.
  const prev = new Map<string, string[]>()
  for (const e of g.edges) prev.set(e.to, [...(prev.get(e.to) ?? []), e.from])
  const live = new Set<string>()
  const stack = outputs.map((o) => o.id)
  while (stack.length) {
    const n = stack.pop()!
    if (live.has(n)) continue
    live.add(n)
    stack.push(...(prev.get(n) ?? []))
  }
  const voice = g.nodes.find((n) => n.type === 'voice')
  if (outputs.length === 1 && voice && !live.has(voice.id))
    errors.push('你的人声没有接到「输出」，导出会没有人声。')
  const idle = g.nodes.filter((n) => !live.has(n.id)).map((n) => n.id)
  return { ok: errors.length === 0, errors, idle }
}

/** What needs a new audio graph (rather than a parameter update). */
export function topologyKey(g: ModGraph): string {
  return JSON.stringify([
    g.nodes.map((n) => [n.id, n.type, !!n.bypass, !!n.send]),
    g.edges.map((e) => [e.from, e.to, e.port]),
  ])
}

/** The voice preparation (level riding, pitch correction) of a graph, as a mix. */
export function voicePrepMix(g: ModGraph, base: MixSettings): MixSettings {
  const v = g.nodes.find((n) => n.type === 'voice')
  return v ? mixFor(base, v) : base
}

/** Loudness target, ceiling and safety limiting for export, from the output (and limiter) modules. */
export function exportSettings(
  g: ModGraph,
  base: MixSettings,
): Pick<MixSettings['master'], 'targetLufs' | 'ceilingDb' | 'limiter'> {
  const out = g.nodes.find((n) => n.type === 'output')
  const lim = g.nodes.find((n) => n.type === 'limiter' && !n.bypass)
  const o = out ? mixFor(base, out).master : base.master
  const l = lim ? mixFor(base, lim).master : null
  return { targetLufs: o.targetLufs, ceilingDb: l?.ceilingDb ?? -1, limiter: l ? l.limiter : false }
}

export function sanitizeGraph(input: unknown): ModGraph | null {
  const g = input as Partial<ModGraph> | null
  if (!g || g.version !== 1 || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) return null
  const nodes = g.nodes.filter(
    (n): n is ModNode =>
      !!n &&
      typeof n.id === 'string' &&
      n.type in MODULES &&
      typeof n.params === 'object' &&
      n.params !== null,
  )
  const ids = new Set(nodes.map((n) => n.id))
  const edges = g.edges.filter(
    (e): e is ModEdge => !!e && ids.has(e.from) && ids.has(e.to) && (e.port === 0 || e.port === 1),
  )
  return {
    version: 1,
    nodes: nodes.map((n) => ({ ...n, x: Number(n.x) || 0, y: Number(n.y) || 0 })),
    edges,
  }
}

/** Starting points offered in the workspace. */
export const TEMPLATES: Array<{
  id: string
  label: string
  blurb: string
  make: (m: MixSettings) => ModGraph
}> = [
  {
    id: 'quick',
    label: '和快速模式一样',
    blurb: '把快速模式现在的整条链路摊开',
    make: graphFromMix,
  },
  {
    id: 'simple',
    label: '极简链路',
    blurb: '人声：低切 → EQ → 压缩 → 去齿音 → 混响；伴奏直接混进来',
    make: (m) => chain(m, [['lowCut'], ['eq'], ['comp'], ['deEss'], ['reverb']]),
  },
  {
    id: 'parallel',
    label: '并联压缩示范',
    blurb: '人声分两路：一路重压、一路原声，在「混合」里合起来——更结实，细节还在',
    make: (m) => {
      const g = chain(m, [['lowCut'], ['eq']])
      const eq = g.nodes.find((n) => n.type === 'eq')!
      const bus = g.nodes.find((n) => n.label === '人声混合')!
      // eq → bus already (dry); add the squashed path
      const crush: ModNode = {
        id: 'comp-crush',
        type: 'comp',
        x: eq.x + 230,
        y: eq.y + 140,
        label: '重压',
        params: {
          comp: { on: true, thresholdDb: -35, ratio: 10, attackMs: 1, releaseMs: 80, makeupDb: 10 },
        },
      }
      const level: ModNode = {
        id: 'gain-crush',
        type: 'gain',
        x: eq.x + 460,
        y: eq.y + 140,
        label: '重压的量',
        params: { gainDb: -8 },
      }
      g.nodes.push(crush, level)
      g.edges.push(
        { id: 'e-crush-1', from: eq.id, to: crush.id, port: 0 },
        { id: 'e-crush-2', from: crush.id, to: level.id, port: 0 },
        { id: 'e-crush-3', from: level.id, to: bus.id, port: 0 },
      )
      return g
    },
  },
]

/** voice → the given modules → 人声混合 → 总线 ← backing; 总线 → limiter → output. */
function chain(input: MixSettings, steps: Array<[ModuleType]>): ModGraph {
  const m = clampMix(input)
  const nodes: ModNode[] = []
  const edges: ModEdge[] = []
  const X = 230
  const add = (type: ModuleType, x: number, y: number, extra: Partial<ModNode> = {}) => {
    const n: ModNode = { ...makeNode(type, x, y, m), id: `${type}-${nodes.length}`, ...extra }
    nodes.push(n)
    return n
  }
  const wire = (a: ModNode, b: ModNode) =>
    edges.push({ id: `e${edges.length}`, from: a.id, to: b.id, port: 0 })
  let prev = add('voice', 0, 0)
  steps.forEach(([type], i) => {
    const n = add(type, X * (i + 1), 0)
    wire(prev, n)
    prev = n
  })
  const vBus = add('mixer', X * (steps.length + 1) + 230, 0, { label: '人声混合' })
  wire(prev, vBus)
  const backing = add('backing', 0, 320)
  const bus = add('mixer', X * (steps.length + 2) + 230, 160, { label: '总线' })
  wire(vBus, bus)
  wire(backing, bus)
  const lim = add('limiter', X * (steps.length + 3) + 230, 160)
  wire(bus, lim)
  const out = add('output', X * (steps.length + 4) + 230, 160)
  wire(lim, out)
  return { version: 1, nodes, edges }
}
