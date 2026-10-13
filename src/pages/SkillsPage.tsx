import { Link } from 'react-router-dom'
import { Award, Lock } from 'lucide-react'
import { MODULES, type ModuleId } from '@/drills/types'
import { CHORD_LEVELS, DEGREE_LEVELS, INTERVAL_LEVELS, PITCH_COMPARE_LEVELS, RHYTHM_TAP_LEVELS, SCALE_LEVELS } from '@/drills/levels'
import {
  bassSkill,
  chordSkill,
  degreeSkill,
  intervalSkill,
  inversionSkill,
  melodySkill,
  pitchSkill,
  readAccSkill,
  readSkill,
  rhythmFigureSkill,
  rhythmReadSkill,
  rhythmTempoSkill,
  romanSkill,
  scaleSkill,
  singSkill,
  skillLabel,
  theorySkill,
} from '@/drills/skills'
import { SIGHT_LEVELS, SING_DEGREE_LEVELS, SING_INTERVAL_LEVELS, SING_NOTE_LEVELS, SING_SCALE_LEVELS, SING_SUSTAIN_LEVELS } from '@/drills/levelsP2'
import { PROGRESSIONS } from '@/music/keys'
import { LETTERS } from '@/music/pitch'
import type { DegreeId } from '@/music/scales'
import type { RhythmFigure } from '@/music/rhythm'
import { MasteryService } from '@/services/masteryService'
import { GuitarService } from '@/services/guitarService'
import { BadgeService } from '@/services/badgeService'
import { BADGES, RANKS, rankFor } from '@/services/progressRules'
import { BAND_LABEL, masteryBand } from '@/services/masteryMath'
import { useProfileStore } from '@/features/profile/profileStore'
import { useAsync } from '@/shared/lib/useAsync'
import { MODULE_ICON } from '@/widgets/drill/moduleIcons'
import { cn } from '@/shared/lib/utils'

/** Every skill each module can produce, in teaching order. */
function skillUniverse(module: ModuleId): string[] {
  const uniq = (xs: string[]) => Array.from(new Set(xs))
  switch (module) {
    case 'E1':
      return PITCH_COMPARE_LEVELS.map((l) => pitchSkill(l.cents))
    case 'E2':
      return uniq(INTERVAL_LEVELS.flatMap((l) => l.pool.map(intervalSkill)))
    case 'E3':
      return uniq(DEGREE_LEVELS.flatMap((l) => l.pool.map(degreeSkill)))
    case 'E4':
      return uniq(SCALE_LEVELS.flatMap((l) => l.pool.map(scaleSkill)))
    case 'E5':
      return uniq([...CHORD_LEVELS.filter((l) => !l.inversions).flatMap((l) => l.pool.map(chordSkill)), ...[0, 1, 2].map(inversionSkill)])
    case 'R1':
      return RHYTHM_TAP_LEVELS.map((l) => rhythmTempoSkill(l.bpm))
    case 'R2':
    case 'R3':
      return FIGURES.map(rhythmFigureSkill)
    case 'E6':
      return uniq(PROGRESSIONS.flatMap((p) => p.romans.slice(1).map((r) => romanSkill(p.mode, r))))
    case 'E7':
      return (['4', '5', '6', '2', '3'] as DegreeId[]).map(bassSkill)
    case 'E8':
      return [melodySkill('step'), melodySkill('leap'), melodySkill('chromatic')]
    case 'E9':
      return FIGURES.map(rhythmReadSkill)
    case 'S1':
      return SING_NOTE_LEVELS.map((l) => singSkill('pitch', String(l.tolerance)))
    case 'S2':
      return SING_SUSTAIN_LEVELS.map((l) => singSkill('sustain', String(l.seconds)))
    case 'S3':
      return uniq(SING_INTERVAL_LEVELS.flatMap((l) => l.pool.map((i) => singSkill('interval', i))))
    case 'S4':
      return uniq(SING_SCALE_LEVELS.flatMap((l) => l.pool.map((sc) => singSkill('scale', sc))))
    case 'S5':
      return uniq(SING_DEGREE_LEVELS.flatMap((l) => l.pool.map((d) => singSkill('degree', d))))
    case 'S6':
      return SIGHT_LEVELS.map((l) => singSkill('sight', String(l.level)))
    case 'S7':
      return SIGHT_LEVELS.map((l) => singSkill('echo', String(l.level)))
    case 'N1':
      return [...LETTERS.map((l) => readSkill('treble', l)), ...LETTERS.map((l) => readSkill('bass', l)), readAccSkill()]
    case 'T1':
      return ['rhythm', 'pitch', 'major', 'interval', 'minor'].map(theorySkill)
    case 'I1':
    case 'I2':
      return []
  }
}

const FIGURES: RhythmFigure[] = ['quarter', 'eighth', 'dotted', 'syncopation', 'sixteenth', 'triplet', 'rest']

export function SkillsPage() {
  const profile = useProfileStore((s) => s.profile)!
  const { data } = useAsync(async () => {
    const [mastery, badges, guitar] = await Promise.all([MasteryService.all(), BadgeService.all(), GuitarService.unitStatus()])
    return { mastery: new Map(mastery.map((m) => [m.skillId, m])), badges: new Map(badges.map((b) => [b.id, b])), guitar }
  }, [])
  const rank = rankFor(profile.xp)
  // R2 and R3 share rhythm-figure skills; show them once.
  const modules = MODULES.filter((m) => m.id !== 'R3' && !m.id.startsWith('I'))

  return (
    <div className="space-y-12">
      <header>
        <div className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">Skill Map</div>
        <h1 className="mt-2 text-4xl font-semibold">音乐人技能地图</h1>
        <p className="mt-3 text-muted-foreground">每一格是一项具体能力。练得越多、越准，格子越亮。</p>
      </header>

      <section className="space-y-6">
        {modules.map((m) => {
          const Icon = MODULE_ICON[m.id]
          const skills = skillUniverse(m.id)
          return (
            <div key={m.id} className="grid grid-cols-12 items-start gap-6">
              <Link to={`/camp/${m.id}`} className="focus-ring col-span-2 flex items-center gap-2 rounded-lg pt-3 text-sm hover:text-amber">
                <Icon className="h-4 w-4 text-amber" />
                {m.id === 'R2' ? '节奏型' : m.name}
              </Link>
              <div className="col-span-10 flex flex-wrap gap-2">
                {skills.map((id) => {
                  const row = data?.mastery.get(id)
                  const band = masteryBand(row?.mastery ?? 0, row?.attempts ?? 0)
                  const v = row?.mastery ?? 0
                  return (
                    <div
                      key={id}
                      title={`${skillLabel(id)} · ${BAND_LABEL[band]}${row ? ` · ${Math.round(v * 100)}% · ${row.attempts} 次` : ''}`}
                      className={cn(
                        'relative min-w-[92px] overflow-hidden rounded-xl border px-3 py-2.5 text-xs transition-colors',
                        band === 'new' && 'border-dashed border-border/80 text-muted-foreground',
                        band === 'learning' && 'border-amber/30 bg-amber-soft/20',
                        band === 'solid' && 'border-amber/60 bg-amber-soft/50',
                        band === 'mastered' && 'border-amber bg-amber/25 shadow-[0_0_18px_-6px_hsl(var(--amber))]',
                      )}
                    >
                      <div className="font-medium">{skillLabel(id)}</div>
                      <div className="num mt-0.5 text-[10px] text-muted-foreground">{row ? `${Math.round(v * 100)}%` : '—'}</div>
                      {row && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-amber" style={{ width: `${v * 100}%` }} />}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        <div className="flex items-center gap-5 pl-[16.66%] text-xs text-muted-foreground">
          {(['new', 'learning', 'solid', 'mastered'] as const).map((b) => (
            <span key={b} className="flex items-center gap-1.5">
              <span
                className={cn(
                  'h-3 w-3 rounded border',
                  b === 'new' && 'border-dashed border-border',
                  b === 'learning' && 'border-amber/30 bg-amber-soft/20',
                  b === 'solid' && 'border-amber/60 bg-amber-soft/50',
                  b === 'mastered' && 'border-amber bg-amber/25',
                )}
              />
              {BAND_LABEL[b]}
            </span>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-5 text-2xl font-semibold">段位</h2>
        <ol className="grid grid-cols-6 gap-3">
          {RANKS.map((r) => {
            const reached = profile.xp >= r.minXp
            const current = r.index === rank.index
            return (
              <li
                key={r.index}
                className={cn(
                  'rounded-2xl border p-4',
                  current ? 'border-amber/70 bg-amber-soft/40' : reached ? 'border-border/80 bg-card' : 'border-dashed border-border/70 opacity-60',
                )}
              >
                <div className="num text-xs text-muted-foreground">{r.minXp} XP</div>
                <div className="mt-2 font-display font-semibold">{r.name}</div>
                <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{r.flavor}</div>
              </li>
            )
          })}
        </ol>
      </section>

      {data && data.guitar.some((g) => g.passed > 0) && (
        <section>
          <h2 className="mb-5 text-2xl font-semibold">吉他工坊</h2>
          {(['rhythm', 'lead'] as const).map((line) => (
            <div key={line} className="mb-4">
              <div className="mb-2 text-sm text-muted-foreground">{line === 'rhythm' ? '节奏吉他' : '主音吉他'}</div>
              <div className="grid grid-cols-8 gap-2">
                {data.guitar
                  .filter((g) => g.unit.line === line)
                  .map((g) => (
                    <Link
                      key={g.unit.id}
                      to={`/guitar/${g.unit.id}`}
                      className={cn('focus-ring rounded-xl border p-2 text-xs transition-colors hover:border-cyan/40', g.complete ? 'border-success/50 bg-success/10' : 'border-border/70')}
                      aria-label={`${g.unit.title}：完成 ${g.passed}/${g.total} 个练习`}
                    >
                      <div className="truncate font-medium">{g.unit.title}</div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-amber" style={{ width: `${g.total ? (g.passed / g.total) * 100 : 0}%` }} />
                      </div>
                      <div className="num mt-1 text-muted-foreground">
                        {g.passed}/{g.total}
                      </div>
                    </Link>
                  ))}
              </div>
            </div>
          ))}
        </section>
      )}

      <section>
        <h2 className="mb-5 text-2xl font-semibold">徽章</h2>
        <div className="grid grid-cols-4 gap-3">
          {BADGES.map((b) => {
            const got = data?.badges.get(b.id)
            return (
              <div key={b.id} className={cn('flex items-center gap-3 rounded-2xl border p-4', got ? 'border-amber/50 bg-card' : 'border-dashed border-border/70')}>
                <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', got ? 'bg-amber/20 text-amber' : 'bg-muted text-muted-foreground')}>
                  {got ? <Award className="h-5 w-5" /> : <Lock className="h-4 w-4" />}
                </span>
                <div className="min-w-0">
                  <div className={cn('text-sm font-medium', !got && 'text-muted-foreground')}>{b.name}</div>
                  <div className="text-xs text-muted-foreground">{b.description}</div>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
