import type { MouseEvent, ReactNode } from 'react'
import { navigate } from '../lib/route'

/** An in-app link: a normal hash link that goes through navigate() so history stays in step. */
export function Link({
  href,
  className,
  ariaLabel,
  title,
  children,
}: {
  href: string
  className?: string
  ariaLabel?: string
  title?: string
  children: ReactNode
}) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return
    e.preventDefault()
    navigate(href)
  }
  return (
    <a href={href} onClick={onClick} className={className} aria-label={ariaLabel} title={title}>
      {children}
    </a>
  )
}
