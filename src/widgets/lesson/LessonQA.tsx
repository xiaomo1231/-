import { useRef, useState } from 'react'
import { Loader2, MessageCircleQuestion, Send, Square } from 'lucide-react'
import type { Lesson } from '@/course/types'
import { LessonQAService, MAX_QUESTION_CHARS, type QAMessage } from '@/services/lessonQAService'
import { aiErrorMessage } from '@/services/ai/aiClient'
import { useAIConfigured } from '@/features/ai/useAIConfigured'
import { AIError, AILabel, AISetupHint } from '@/widgets/ai/AIBits'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

/**
 * Ask the AI teaching assistant about this lesson. The conversation stays in
 * memory only; the lesson text gives the assistant context, and it gives
 * hints for the micro-creation, never the answer.
 */
export function LessonQA({ lesson }: { lesson: Lesson }) {
  const configured = useAIConfigured()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<QAMessage[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  const send = async () => {
    const q = draft.trim()
    if (!q || busy) return
    setBusy(true)
    setError(null)
    const ctrl = new AbortController()
    abort.current = ctrl
    const history = messages
    setMessages([...history, { role: 'user', content: q }])
    setDraft('')
    try {
      const { answer } = await LessonQAService.ask(lesson, history, q, ctrl.signal)
      setMessages((m) => [...m, { role: 'assistant', content: answer }])
    } catch (e) {
      setError(aiErrorMessage(e))
      setMessages(history)
      setDraft(q)
    } finally {
      setBusy(false)
      abort.current = null
    }
  }

  return (
    <section className="rounded-3xl border border-border/80 bg-card p-6">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="focus-ring flex w-full items-center justify-between gap-3 rounded-xl text-left">
        <span className="flex items-center gap-2 text-lg font-semibold">
          <MessageCircleQuestion className="h-5 w-5 text-cyan" aria-hidden /> 有问题？问助教
        </span>
        <AILabel>可选</AILabel>
      </button>
      {open && (
        <div className="mt-4 space-y-4">
          {configured === false && <AISetupHint what="可以随时问这一课里没看懂的地方，助教会结合课文回答" />}
          {configured && (
            <>
              {messages.length === 0 && (
                <p className="text-sm text-muted-foreground">比如：“为什么 ♭VII 听起来像摇滚？”“我的旋律最后一个音落在 2 级可以吗？”助教只给思路和检查方法，不会替你完成微创作。</p>
              )}
              <ol className="space-y-3" aria-live="polite">
                {messages.map((m, i) => (
                  <li key={i} className={cn('max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-6', m.role === 'user' ? 'ml-auto bg-amber-soft/40' : 'border border-cyan/30 bg-cyan-soft/10')}>
                    {m.content}
                  </li>
                ))}
                {busy && (
                  <li className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> 助教正在想…
                  </li>
                )}
              </ol>
              <AIError message={error} />
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  void send()
                }}
              >
                <label className="sr-only" htmlFor={`qa-${lesson.id}`}>
                  你的问题
                </label>
                <textarea
                  id={`qa-${lesson.id}`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.slice(0, MAX_QUESTION_CHARS))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault()
                      void send()
                    }
                  }}
                  rows={2}
                  placeholder="写下你的问题（Ctrl + Enter 发送）"
                  className="focus-ring min-h-[44px] flex-1 resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm"
                />
                {busy ? (
                  <Button type="button" variant="outline" onClick={() => abort.current?.abort()} aria-label="停止">
                    <Square />
                  </Button>
                ) : (
                  <Button type="submit" disabled={!draft.trim()} aria-label="发送问题">
                    <Send />
                  </Button>
                )}
              </form>
              <p className="text-right text-xs text-muted-foreground">
                {draft.length}/{MAX_QUESTION_CHARS} · 只发送课文和你的问题，对话不会保存
              </p>
            </>
          )}
        </div>
      )}
    </section>
  )
}
