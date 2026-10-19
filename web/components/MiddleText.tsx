import { cx } from '../lib/classes'

/**
 * Where to cut a one-line name so its ending stays: file names of one song differ at the
 * end ("… (songsterr 18).gp"), so the cut goes in the middle. Splits before the last
 * " (" when that leaves a short tail, else keeps the last `tail` characters.
 */
export function splitTail(text: string, tail = 16): { head: string; tail: string } {
  const chars = Array.from(text)
  if (chars.length <= tail + 4) return { head: text, tail: '' }
  const joined = chars.join('')
  const paren = joined.lastIndexOf(' (')
  if (paren > 0) {
    const rest = Array.from(joined.slice(paren))
    if (rest.length <= tail + 8 && rest.length >= 4)
      return { head: joined.slice(0, paren), tail: rest.join('') }
  }
  return { head: chars.slice(0, -tail).join(''), tail: chars.slice(-tail).join('') }
}

/** One line of text that, when too long, loses its middle (with the full text on hover). */
export function MiddleText({
  text,
  tail,
  className,
}: {
  text: string
  tail?: number
  className?: string
}) {
  const cut = splitTail(text, tail)
  return (
    <span className={cx('flex min-w-0', className)} title={text}>
      <span className="min-w-0 truncate">{cut.head}</span>
      {cut.tail && <span className="shrink-0 whitespace-pre">{cut.tail}</span>}
    </span>
  )
}
