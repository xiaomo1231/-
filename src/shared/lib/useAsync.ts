import { useCallback, useEffect, useState } from 'react'

/** Load data once (and on `reload()`); errors surface as a message, not a throw. */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useCallback(load, deps)
  useEffect(() => {
    let cancelled = false
    stable().then(
      (d) => {
        if (!cancelled) {
          setData(d)
          setError(null)
        }
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      },
    )
    return () => {
      cancelled = true
    }
  }, [stable, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, reload }
}
