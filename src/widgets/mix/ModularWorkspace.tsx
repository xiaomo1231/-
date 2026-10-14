/**
 * 模块模式 (0.25.0): the post-production as a patch — drag modules from the
 * library onto the workspace, wire outputs to inputs, click a module to set
 * it. Levels show on each module while playing; any module can be listened
 * to on its own ("试听这里").
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  Background,
  Controls as FlowControls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Headphones, LayoutTemplate, Power, Trash2 } from 'lucide-react'
import type { MixSettings } from '@/songs/singTypes'
import {
  CATEGORY_LABEL,
  MODULES,
  TEMPLATES,
  checkGraph,
  makeNode,
  mixFor,
  newId,
  paramsFrom,
  wouldCycle,
  type ModGraph,
  type ModNode,
  type ModuleCategory,
  type ModuleType,
} from '@/songs/mixGraph'
import { toast } from '@/features/toast/toastStore'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'
import { Controls, LoudnessTarget, StemLevels } from './DeskExtras'
import type { MixPlayer } from './mixPlayer'

const DRAG_TYPE = 'application/x-groovelab-module'

const CATEGORY_COLOR: Record<ModuleCategory, string> = {
  source: 'hsl(var(--cyan))',
  clean: 'hsl(var(--success))',
  dynamics: 'hsl(var(--amber))',
  color: 'hsl(330 70% 60%)',
  space: 'hsl(260 70% 68%)',
  backing: 'hsl(200 60% 55%)',
  utility: 'hsl(var(--muted-foreground))',
  master: 'hsl(var(--destructive))',
}

interface ModuleData extends Record<string, unknown> {
  node: ModNode
  level: number
  idle: boolean
  solo: boolean
  onBypass: (id: string) => void
}

const ModuleBox = memo(function ModuleBox({ data, selected }: NodeProps<Node<ModuleData>>) {
  const { node, level, idle, solo } = data
  const info = MODULES[node.type]
  const color = CATEGORY_COLOR[info.category]
  const db = level > 0 ? 20 * Math.log10(level) : -Infinity
  const pct = Math.max(0, Math.min(1, (db + 60) / 60))
  return (
    <div
      className={cn(
        'w-44 rounded-xl border bg-card text-xs shadow-sm transition-opacity',
        selected ? 'ring-2 ring-amber' : '',
        idle || node.bypass ? 'opacity-50' : '',
      )}
      style={{ borderColor: color }}
      title={info.blurb}
    >
      {info.inputs > 0 && (
        <Handle
          type="target"
          id="in"
          position={Position.Left}
          style={{ top: info.inputs > 1 ? '38%' : '50%', background: color, width: 10, height: 10 }}
        />
      )}
      {info.inputs > 1 && (
        <>
          <Handle
            type="target"
            id="sc"
            position={Position.Left}
            style={{ top: '78%', background: 'hsl(var(--amber))', width: 10, height: 10 }}
          />
          <span className="pointer-events-none absolute -left-9 top-[70%] text-[10px] text-amber">
            侧链
          </span>
        </>
      )}
      <div
        className="flex items-center gap-1 rounded-t-xl px-2 py-1"
        style={{ background: `color-mix(in srgb, ${color} 18%, transparent)` }}
      >
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {node.label ?? info.label}
        </span>
        {solo && <Headphones className="h-3 w-3 text-amber" aria-label="正在试听这里" />}
        {info.category !== 'source' && node.type !== 'output' && node.type !== 'mixer' && (
          <button
            type="button"
            className={cn(
              'nodrag rounded p-0.5',
              node.bypass ? 'text-muted-foreground' : 'text-success',
            )}
            onClick={(e) => {
              e.stopPropagation()
              data.onBypass(node.id)
            }}
            aria-label={node.bypass ? '打开这个模块' : '旁路这个模块'}
            title={node.bypass ? '已旁路（点一下打开）' : '点一下旁路（声音直接通过）'}
          >
            <Power className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="px-2 py-1.5">
        <div className="truncate text-[10px] text-muted-foreground">
          {node.send ? '发送：只输出效果声' : info.label}
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className="h-full rounded-full transition-[width] duration-100"
            style={{
              width: `${pct * 100}%`,
              background: db > -1 ? 'hsl(var(--destructive))' : color,
            }}
          />
        </div>
      </div>
      {info.output && (
        <Handle
          type="source"
          id="out"
          position={Position.Right}
          style={{ background: color, width: 10, height: 10 }}
        />
      )}
    </div>
  )
})

const nodeTypes = { module: ModuleBox }

export interface ModularWorkspaceProps {
  graph: ModGraph
  onGraph: (g: ModGraph) => void
  /** The desk's settings: base for every module, and what shared modules (voice, backing) edit. */
  mix: MixSettings
  onMix: (m: MixSettings) => void
  player: MixPlayer
  playing: boolean
  backingNames: string[]
}

export function ModularWorkspace(props: ModularWorkspaceProps) {
  return (
    <ReactFlowProvider>
      <Workspace {...props} />
    </ReactFlowProvider>
  )
}

function Workspace({
  graph: outer,
  onGraph,
  mix,
  onMix,
  player,
  playing,
  backingNames,
}: ModularWorkspaceProps) {
  // A working copy: dragging moves it every frame, the song is saved when the drag ends.
  const [graph, setGraph] = useState(outer)
  const dragging = useRef(false)
  useEffect(() => {
    if (!dragging.current) setGraph(outer)
  }, [outer])
  const commit = useCallback(
    (g: ModGraph) => {
      setGraph(g)
      onGraph(g)
    },
    [onGraph],
  )
  const [selected, setSelected] = useState<string | null>(null)
  const [soloId, setSoloId] = useState<string | null>(null)
  const [levels, setLevels] = useState<Record<string, number>>({})
  const flow = useReactFlow()
  // Sizes React Flow measured (it needs them back on the nodes).
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({})

  useEffect(() => {
    if (!playing) {
      setLevels({})
      return
    }
    const t = window.setInterval(() => setLevels(player.levels()), 100)
    return () => window.clearInterval(t)
  }, [playing, player])
  // Listening at a module survives a rebuild of the audio graph.
  useEffect(() => {
    player.solo(soloId)
  }, [player, soloId, graph])
  useEffect(() => () => player.solo(null), [player])

  // Fit everything into view once React Flow has measured the modules (templates fit again themselves).
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current || !graph.nodes.length || !graph.nodes.every((n) => sizes[n.id])) return
    fitted.current = true
    requestAnimationFrame(() => void flow.fitView({ padding: 0.12 }))
  }, [graph.nodes, sizes, flow])

  const check = useMemo(() => checkGraph(graph), [graph])
  const idle = useMemo(() => new Set(check.idle), [check])

  const toggleBypass = useCallback(
    (id: string) =>
      commit({
        ...graph,
        nodes: graph.nodes.map((n) => (n.id === id ? { ...n, bypass: !n.bypass } : n)),
      }),
    [graph, commit],
  )

  const nodes: Array<Node<ModuleData>> = useMemo(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: 'module',
        position: { x: n.x, y: n.y },
        selected: n.id === selected,
        deletable: !MODULES[n.type].single,
        ...(sizes[n.id] ? { measured: sizes[n.id] } : {}),
        data: {
          node: n,
          level: levels[n.id] ?? 0,
          idle: idle.has(n.id),
          solo: soloId === n.id,
          onBypass: toggleBypass,
        },
      })),
    [graph, selected, levels, idle, soloId, toggleBypass, sizes],
  )
  const edges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => {
        const lv = levels[e.from] ?? 0
        return {
          id: e.id,
          source: e.from,
          target: e.to,
          sourceHandle: 'out',
          targetHandle: e.port === 1 ? 'sc' : 'in',
          animated: playing && lv > 0.003,
          style: {
            strokeWidth: 1.5 + Math.min(3, lv * 6),
            stroke: e.port === 1 ? 'hsl(var(--amber))' : undefined,
            strokeDasharray: e.port === 1 ? '5 4' : undefined,
          },
        }
      }),
    [graph, levels, playing],
  )

  const onNodesChange = (changes: NodeChange<Node<ModuleData>>[]) => {
    let g = graph
    let changed = false
    const measured: Record<string, { width: number; height: number }> = {}
    for (const c of changes) {
      if (c.type === 'dimensions' && c.dimensions) measured[c.id] = c.dimensions
      else if (c.type === 'select') {
        if (c.selected) setSelected(c.id)
        else if (selected === c.id) setSelected(null)
      } else if (c.type === 'position' && c.position) {
        dragging.current = !!c.dragging
        g = {
          ...g,
          nodes: g.nodes.map((n) =>
            n.id === c.id
              ? { ...n, x: Math.round(c.position!.x), y: Math.round(c.position!.y) }
              : n,
          ),
        }
        if (!c.dragging) changed = true
      } else if (c.type === 'remove') {
        g = {
          ...g,
          nodes: g.nodes.filter((n) => n.id !== c.id),
          edges: g.edges.filter((e) => e.from !== c.id && e.to !== c.id),
        }
        if (selected === c.id) setSelected(null)
        if (soloId === c.id) setSoloId(null)
        changed = true
      }
    }
    if (Object.keys(measured).length) setSizes((s) => ({ ...s, ...measured }))
    if (changed) commit(g)
    else setGraph(g)
  }
  const onEdgesChange = (changes: EdgeChange[]) => {
    const gone = new Set(changes.filter((c) => c.type === 'remove').map((c) => c.id))
    if (gone.size) commit({ ...graph, edges: graph.edges.filter((e) => !gone.has(e.id)) })
  }
  const onConnect = (c: Connection) => {
    if (!c.source || !c.target) return
    const port = c.targetHandle === 'sc' ? 1 : 0
    if (graph.edges.some((e) => e.from === c.source && e.to === c.target && e.port === port)) return
    if (wouldCycle(graph, c.source, c.target)) {
      toast({
        title: '不能这样连',
        description: '这样会让声音绕回自己（形成回路）。延迟、混响自带的回授在模块里面调。',
        variant: 'error',
      })
      return
    }
    commit({
      ...graph,
      edges: [...graph.edges, { id: newId('e'), from: c.source, to: c.target, port }],
    })
  }

  const addModule = (type: ModuleType, x?: number, y?: number) => {
    if (MODULES[type].single && graph.nodes.some((n) => n.type === type)) {
      toast({ title: `「${MODULES[type].label}」只能有一个`, variant: 'info' })
      return
    }
    let px = x
    let py = y
    if (px === undefined || py === undefined) {
      const center = flow.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      })
      px = center.x
      py = center.y
    }
    const node = makeNode(type, px - 88, py - 30, mix)
    commit({ ...graph, nodes: [...graph.nodes, node] })
    setSelected(node.id)
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    const type = e.dataTransfer.getData(DRAG_TYPE) as ModuleType
    if (!type || !(type in MODULES)) return
    const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    addModule(type, p.x, p.y)
  }

  const sel = graph.nodes.find((n) => n.id === selected) ?? null
  const updateNode = (id: string, patch: Partial<ModNode>) =>
    commit({ ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) })

  const byCategory = useMemo(() => {
    const out = new Map<ModuleCategory, ModuleType[]>()
    for (const [t, info] of Object.entries(MODULES) as Array<
      [ModuleType, (typeof MODULES)[ModuleType]]
    >)
      out.set(info.category, [...(out.get(info.category) ?? []), t])
    return [...out.entries()]
  }, [])

  const dark =
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

  return (
    <section
      className="space-y-3 rounded-3xl border border-border/80 bg-card p-4"
      aria-label="模块化后期工作区"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">模块工作区</h3>
        <span className="text-xs text-muted-foreground">
          从左边把模块拖进来（或点一下），从模块右边的圆点拖线到另一个模块左边的圆点；选中线或模块按
          Delete 删除。
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-1">
          <LayoutTemplate className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          {TEMPLATES.map((t) => (
            <Button
              key={t.id}
              size="sm"
              variant="ghost"
              title={t.blurb}
              onClick={() => {
                if (
                  !window.confirm(`换成「${t.label}」？现在工作区里的连线会被替换。\n\n${t.blurb}`)
                )
                  return
                setSelected(null)
                setSoloId(null)
                commit(t.make(mix))
                requestAnimationFrame(() => flow.fitView({ padding: 0.15 }))
              }}
            >
              {t.label}
            </Button>
          ))}
        </span>
      </div>

      {check.errors.length > 0 && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {check.errors.join(' ')}
        </p>
      )}
      {check.idle.length > 0 && check.errors.length === 0 && (
        <p className="text-xs text-muted-foreground">变淡的模块没有接到输出，现在不起作用。</p>
      )}

      <div className="grid gap-3 lg:grid-cols-[10rem_1fr]">
        <nav className="space-y-3 lg:max-h-[640px] lg:overflow-auto" aria-label="模块库">
          {byCategory.map(([cat, types]) => (
            <div key={cat}>
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                {CATEGORY_LABEL[cat]}
              </p>
              <div className="flex flex-wrap gap-1 lg:flex-col">
                {types.map((t) => (
                  <button
                    key={t}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_TYPE, t)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onClick={() => addModule(t)}
                    title={MODULES[t].blurb}
                    className="focus-ring flex cursor-grab items-center gap-1.5 rounded-lg border border-border/70 px-2 py-1 text-left text-xs hover:bg-muted/50 active:cursor-grabbing"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: CATEGORY_COLOR[cat] }}
                      aria-hidden
                    />
                    {MODULES[t].label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div
          className="relative h-[640px] overflow-hidden rounded-2xl border border-border/80"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onPaneClick={() => setSelected(null)}
            colorMode={dark ? 'dark' : 'light'}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.2}
            deleteKeyCode={['Delete', 'Backspace']}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} />
            <FlowControls showInteractive={false} position="top-left" />
            <MiniMap
              pannable
              zoomable
              className="!bg-card"
              style={{ width: 140, height: 90 }}
              position="bottom-left"
            />
          </ReactFlow>
          {sel && (
            <aside
              className="absolute right-2 top-2 z-10 max-h-[620px] w-72 space-y-3 overflow-auto rounded-2xl border border-border/80 bg-card/95 p-3 shadow-soft backdrop-blur"
              aria-label="模块设置"
            >
              <Inspector
                node={sel}
                mix={mix}
                onMix={onMix}
                backingNames={backingNames}
                solo={soloId === sel.id}
                onSolo={() => setSoloId(soloId === sel.id ? null : sel.id)}
                onChange={(patch) => updateNode(sel.id, patch)}
                onRemove={
                  MODULES[sel.type].single
                    ? null
                    : () => {
                        commit({
                          ...graph,
                          nodes: graph.nodes.filter((n) => n.id !== sel.id),
                          edges: graph.edges.filter((e) => e.from !== sel.id && e.to !== sel.id),
                        })
                        setSelected(null)
                        if (soloId === sel.id) setSoloId(null)
                      }
                }
              />
            </aside>
          )}
        </div>
      </div>
    </section>
  )
}

function Inspector({
  node,
  mix,
  onMix,
  backingNames,
  solo,
  onSolo,
  onChange,
  onRemove,
}: {
  node: ModNode
  mix: MixSettings
  onMix: (m: MixSettings) => void
  backingNames: string[]
  solo: boolean
  onSolo: () => void
  onChange: (patch: Partial<ModNode>) => void
  onRemove: (() => void) | null
}) {
  const info = MODULES[node.type]
  // Module params seen as a MixSettings, so the desk's controls work as they are.
  const view = info.shared ? mix : mixFor(mix, node)
  const setView = (m: MixSettings) =>
    info.shared ? onMix(m) : onChange({ params: paramsFrom(node.type, m) })
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          value={node.label ?? info.label}
          onChange={(e) => onChange({ label: e.target.value.slice(0, 20) || undefined })}
          className="focus-ring h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-sm font-medium"
          aria-label="模块名称"
        />
        {onRemove && (
          <Button size="sm" variant="ghost" onClick={onRemove} aria-label="删除这个模块">
            <Trash2 />
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{info.blurb}</p>
      <div className="flex flex-wrap gap-2">
        {node.type !== 'output' && (
          <Button
            size="sm"
            variant={solo ? 'default' : 'outline'}
            onClick={onSolo}
            title="只听这个模块输出的声音（再点一下回到正常）"
          >
            <Headphones /> {solo ? '正在试听这里' : '试听这里'}
          </Button>
        )}
        {info.category !== 'source' && node.type !== 'output' && node.type !== 'mixer' && (
          <Button size="sm" variant="outline" onClick={() => onChange({ bypass: !node.bypass })}>
            <Power /> {node.bypass ? '打开' : '旁路'}
          </Button>
        )}
      </div>
      {(node.type === 'reverb' || node.type === 'delay') && (
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={!!node.send}
            onChange={(e) => onChange({ send: e.target.checked })}
            className="mt-0.5 accent-[hsl(var(--amber))]"
          />
          <span>
            做成发送（只输出{node.type === 'reverb' ? '混响' : '回声'}，原声从另一条线走）
            <span className="block text-muted-foreground">不勾：输出原声 + 效果（插入式）。</span>
          </span>
        </label>
      )}
      {info.controls.length > 0 && (
        <Controls paths={info.controls} mix={view} onMix={setView} cols={1} />
      )}
      {node.type === 'backing' && <StemLevels names={backingNames} mix={mix} onMix={onMix} />}
      {node.type === 'output' && <LoudnessTarget mix={view} onMix={setView} />}
      {node.type === 'mixer' && (
        <p className="text-xs text-muted-foreground">
          接进来的几路声音会加在一起。想调某一路的大小，在它前面加一个「增益」。
        </p>
      )}
      {node.type === 'duck' && (
        <p className="text-xs text-muted-foreground">
          主输入（上面的圆点）接伴奏，侧链（下面黄色的圆点）接人声：人声出现时伴奏自动让位。
        </p>
      )}
    </div>
  )
}
