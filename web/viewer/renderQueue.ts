import type { AlphaTabApi, model } from '@coderline/alphatab'

/** Our renders of the sheet, one at a time (see renderQueue). */
export interface RenderQueue {
  /** Re-renders with the current settings. */
  render(): void
  /** Shows these tracks (and re-renders). */
  renderTracks(tracks: model.Track[]): void
  /** The api is going away: nothing more is rendered. */
  dispose(): void
}

/**
 * One render at a time. Opening a score asks for several renders within a few
 * milliseconds (the file's own, the shown track, the notation settings, 变调); when
 * they overlap, alphaTab keeps stale placeholders on the page and the rows scrolled
 * to later are never drawn (the sheet goes blank after a couple of scrolls). Our
 * renders go through here: one asked for while a render runs waits for it to end,
 * and several waiting ones become one (the last track choice wins). alphaTab's own
 * renders (loading, resizing) are left alone but counted.
 */
export function renderQueue(a: AlphaTabApi): RenderQueue {
  let busy = false
  let waiting = false
  let tracks: model.Track[] | null = null
  let guard = 0
  let dead = false

  const hold = (ms: number) => {
    busy = true
    window.clearTimeout(guard)
    // A render that never starts (fonts not ready, sheet hidden) or never reports back
    // must not block the next ones.
    guard = window.setTimeout(release, ms)
  }
  const run = () => {
    if (dead) return
    hold(3000)
    const t = tracks
    tracks = null
    if (t) a.renderTracks(t)
    else a.render()
  }
  function release() {
    window.clearTimeout(guard)
    busy = false
    if (!waiting) return
    waiting = false
    run()
  }

  a.renderStarted.on(() => hold(20000))
  a.renderFinished.on(release)
  a.error.on(release)

  return {
    render() {
      if (busy) waiting = true
      else run()
    },
    renderTracks(t) {
      tracks = t
      if (busy) waiting = true
      else run()
    },
    dispose() {
      dead = true
      waiting = false
      window.clearTimeout(guard)
    },
  }
}
