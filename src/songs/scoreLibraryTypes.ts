/**
 * 谱库 (0.29.0): the student's own folder of guitar scores (e.g.
 * F:\吉他谱\吉他谱库), browsed where it is — nothing is copied or imported.
 * The folder's own layout is the classification:
 *
 *   <N-分类>\<分组>\<歌手>\…            1-华语\男歌手\周杰伦\七里香.gp4
 *   <N-分类>\<歌手>\…                    4-指弹演奏家\Andy Mckee\…（no groups）
 *   2-欧美\未分曲风\<A–Z>\<歌手>\…        one extra letter level
 *
 * Paths are relative to the library root, with '/' separators.
 */

/** How a file is opened. */
export type ScoreFormat =
  /** Guitar Pro 3–8 / MusicXML: the app's score viewer (alphaTab). */
  | 'score'
  /** Guitar Pro 1–2 (.gtp), Power Tab (.ptb): opened with the computer's own program. */
  | 'legacy'
  | 'image'
  | 'pdf'
  /** Chord / tab text (.txt, often GBK). */
  | 'text'
  | 'midi'
  | 'audio'
  | 'video'
  | 'other'

export interface ScoreFile {
  path: string
  size: number
  format: ScoreFormat
  /** Lower-case extension without the dot. */
  ext: string
}

/** One way to play a song: a file, or the pages of an image score. */
export interface ScoreVersion {
  /** The file opened (for an image score: its first page). */
  file: ScoreFile
  /** Image scores: every page in order (length ≥ 1). */
  pages?: ScoreFile[]
  /** What the file name says about this version: 指弹, 独奏, 总谱, 版本 2, 3 页… */
  tags: string[]
  /** File name as shown (pages: "名字1–6.png"). */
  label: string
  /** Total bytes (all pages). */
  size: number
}

export interface ScoreSong {
  /** Unique within the library: `${artistId}#${normalized title}`. */
  id: string
  title: string
  artistId: string
  versions: ScoreVersion[]
  /** The title could not be read from the file names (only digits etc.). */
  unknownTitle?: boolean
}

export interface ScoreArtist {
  /** Its folder, relative to the root ("1-华语/男歌手/周杰伦"). */
  id: string
  name: string
  groupId: string
  files: number
  songs: number
  /** First letter for the A–Z jump: Latin initial, or the pinyin initial of a Chinese name; '#' otherwise. */
  initial: string
}

export interface ScoreGroup {
  /** "1-华语/男歌手"; a category without groups has one group with id = the category id. */
  id: string
  name: string
  categoryId: string
  artists: number
  files: number
  /** What its entries are called: 歌手 / 乐队 / 作曲家 / 作品 / 合集… */
  noun: string
}

export interface ScoreCategory {
  /** The top folder ("1-华语"). */
  id: string
  /** Without the sorting number ("华语"). */
  name: string
  groups: ScoreGroup[]
  files: number
}

export interface ScoreSearchResult {
  artists: Array<ScoreArtist & { categoryName: string; groupName: string; match: SearchMatch }>
  songs: Array<{ song: ScoreSong; artistName: string; match: SearchMatch }>
  /** More songs matched than returned. */
  moreSongs: boolean
}

/** How a result matched (shown as a small tag). */
export type SearchMatch = 'name' | 'traditional' | 'pinyin' | 'initials' | 'fuzzy'

/** The scan the app sends: every file under the root. */
export interface ScoreScan {
  root: string
  scannedAt: number
  /** [relative path with '/', size in bytes] */
  files: Array<[string, number]>
}
