/**
 * Opening a band song in the rehearsal: its score (or the 组合乐队谱 it uses) in the
 * viewer, following the rehearsal.
 */
import { api, type BandSong } from './api'
import { hrefViewer, navigate } from './route'

/** The viewer link of a band song in the rehearsal (a combo needs its base file: asked once). */
export async function rehearsalHref(song: BandSong): Promise<string> {
  const common = {
    format: 'score',
    title: song.title,
    artist: song.artist,
    band: song.id,
    rehearsal: true,
  }
  if (song.comboId) {
    try {
      const combo = await api.combo(song.comboId)
      return hrefViewer({ ...common, path: combo.base, combo: combo.id })
    } catch {
      // The combo is gone: fall back to the setlist file.
    }
  }
  return hrefViewer({ ...common, path: song.path })
}

/** Opens a band song in the rehearsal (replacing the current history entry when asked). */
export async function openInRehearsal(song: BandSong, replace = false): Promise<void> {
  const href = await rehearsalHref(song)
  if (replace) {
    window.history.replaceState({ sv: 1 }, '', href)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else navigate(href)
}
