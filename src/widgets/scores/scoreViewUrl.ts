import type { ScoreVersion } from '@/songs/scoreLibraryTypes'

/** The score viewer's address for a version; image scores also carry every page. */
export function scoreViewUrl(version: ScoreVersion, title: string, artist: string): string {
  const parts = [`p=${encodeURIComponent(version.file.path)}`]
  if (version.pages && version.pages.length > 0) {
    parts.push(`pages=${encodeURIComponent(JSON.stringify(version.pages.map((p) => p.path)))}`)
  }
  parts.push(`title=${encodeURIComponent(title)}`, `artist=${encodeURIComponent(artist)}`)
  return `/scores/view?${parts.join('&')}`
}
