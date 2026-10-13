import { useState } from 'react'
import { toast } from '@/features/toast/toastStore'
import { ProfileService } from '@/services/profileService'
import { Button } from '@/shared/ui'
import { makeEarQuiz, type EarQuiz as EarQuizData } from '@/songs/mixLessons'
import type { MixSettings } from '@/songs/singTypes'
import type { MixPlayer, Region } from './mixPlayer'

const MAX_EXCERPT_SEC = 6
const XP_REWARD = 5

const KIND_LABEL = { lowcut: '低切', comp: '压缩' } as const
const EFFECT_HINT = {
  lowcut: { what: '低切', sound: '低频的“嗡嗡”感更少，声音更清爽', listen: '低频' },
  comp: { what: '压缩', sound: '轻声的字更容易听清，音量更平稳', listen: '轻声的字' },
} as const

export interface EarQuizProps {
  player: MixPlayer
  /** The live mix; the quiz swaps only its vocal section, backing and master stay as they are. */
  mix: MixSettings
  /** Current loop region or the whole song (the quiz trims it to a short excerpt). */
  getRegion: () => Region
}

export function EarQuiz({ player, mix, getRegion }: EarQuizProps): JSX.Element {
  const [kind, setKind] = useState<'lowcut' | 'comp'>('lowcut')
  const [quiz, setQuiz] = useState<EarQuizData | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const [playingLabel, setPlayingLabel] = useState<string | null>(null)
  const [rewarded, setRewarded] = useState(false)

  const newQuiz = (k = kind) => {
    setQuiz(makeEarQuiz(k, Date.now()))
    setPicked(null)
    setRewarded(false)
  }

  const chooseKind = (k: 'lowcut' | 'comp') => {
    setKind(k)
    setQuiz(null)
    setPicked(null)
  }

  const play = async () => {
    if (!quiz) return
    const r = getRegion()
    const region = { start: r.start, end: Math.min(r.end, r.start + MAX_EXCERPT_SEC) }
    const pass = (i: number) => ({
      mix: { ...mix, vocal: quiz.variants[i]! },
      label: i === 0 ? '第一段' : '第二段',
    })
    try {
      await player.playPasses(region, [pass(0), pass(1)], (i) =>
        setPlayingLabel(i === 0 ? '第一段' : '第二段'),
      )
    } catch (err) {
      toast({
        title: '播放失败',
        description: err instanceof Error ? err.message : '请再试一次。',
        variant: 'error',
      })
    } finally {
      setPlayingLabel(null)
    }
  }

  const answer = async (i: number) => {
    if (!quiz || picked !== null) return
    setPicked(i)
    if (i === quiz.answer) {
      toast({ title: '听对了！', description: `+${XP_REWARD} 经验值`, variant: 'success' })
      if (!rewarded) {
        setRewarded(true)
        try {
          await ProfileService.addXp(XP_REWARD)
        } catch {
          // XP is a nicety; a failed write should not block the quiz.
        }
      }
    } else {
      toast({ title: '再听一次', variant: 'warning' })
    }
  }

  const correct = quiz !== null && picked === quiz.answer
  const wrong = quiz !== null && picked !== null && picked !== quiz.answer

  return (
    <section className="space-y-4 rounded-3xl border border-border/80 bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-foreground">练练耳朵</h3>
          <p className="text-xs text-muted-foreground">
            两段只有一个效果的开关不同，听出是哪一段做了{KIND_LABEL[kind]}。
          </p>
        </div>
        <div
          role="group"
          aria-label="练习类型"
          className="inline-flex rounded-full border border-border/80 p-0.5"
        >
          {(['lowcut', 'comp'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => chooseKind(k)}
              className={`rounded-full px-3 py-1 text-xs transition-colors ${kind === k ? 'bg-primary-strong text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      {!quiz ? (
        <Button onClick={() => newQuiz()} variant="outline">
          出一题
        </Button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-foreground">{quiz.prompt}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={play} disabled={playingLabel !== null} variant="outline">
              {playingLabel ? `正在播放：${playingLabel}` : '播放两段（最多 6 秒）'}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {quiz.options.map((opt, i) => {
              const isAnswer = picked !== null && i === quiz.answer
              const isWrongPick = picked === i && i !== quiz.answer
              return (
                <Button
                  key={opt}
                  variant={isAnswer ? 'default' : 'outline'}
                  className={isWrongPick ? 'border-destructive text-destructive' : undefined}
                  onClick={() => answer(i)}
                  disabled={picked !== null}
                >
                  {opt}
                </Button>
              )
            })}
          </div>
          {correct && (
            <p className="text-sm text-success">
              答对了。做了{EFFECT_HINT[kind].what}的是{quiz.options[quiz.answer]}：
              {EFFECT_HINT[kind].sound}。
            </p>
          )}
          {wrong && (
            <p className="text-sm text-muted-foreground">
              不对哦。做了{EFFECT_HINT[kind].what}的是{quiz.options[quiz.answer]}：
              {EFFECT_HINT[kind].sound}。再听一遍，留意{EFFECT_HINT[kind].listen}。
            </p>
          )}
          {picked !== null && (
            <Button size="sm" variant="ghost" onClick={() => newQuiz()}>
              再来一题
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
