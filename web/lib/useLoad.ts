import { useEffect, useRef, useState } from 'react'
import { errorText } from './api'

export type Loaded<T> =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T }

/**
 * Loads data for a key (re-run when the key changes). A response for an
 * older key is dropped, so fast taps never show the wrong list.
 */
export function useLoad<T>(load: (signal: AbortSignal) => Promise<T>, key: string): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' })
  const loader = useRef(load)
  loader.current = load

  useEffect(() => {
    const ac = new AbortController()
    setState({ status: 'loading' })
    loader.current(ac.signal).then(
      (data) => {
        if (!ac.signal.aborted) setState({ status: 'ready', data })
      },
      (e: unknown) => {
        if (!ac.signal.aborted) setState({ status: 'error', message: errorText(e) })
      },
    )
    return () => ac.abort()
  }, [key])

  return state
}
