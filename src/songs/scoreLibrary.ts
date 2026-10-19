/**
 * 谱库 (0.29.0): the student's score folder as categories → groups → artists
 * → songs → versions, read from the folder layout and the file names alone
 * (no file is opened). Pure: runs in a worker and in tests. Text tools
 * (traditional → simplified, pinyin) are passed in, so tests can use stubs.
 *
 * Folder layout (see scoreLibraryTypes.ts): `<N-分类>/<分组>/<歌手>/…`, or
 * `<N-分类>/<歌手>/…` for 指弹演奏家 and 网友原创; a group of letter folders
 * (2-欧美/未分曲风/A/…) has the artists one level further down.
 *
 * Song titles come from file names, which follow many sites' habits:
 *   周杰伦《七里香》吉他谱六线谱3.png   → 七里香, page 3
 *   【周杰伦】-断了的弦.gp4             → 断了的弦
 *   Dion, Celine - My Heart Will Go On  → My Heart Will Go On
 *   月老/1月老.gp4                      → 月老 (a song folder, numbered file)
 *   后悔爱上你（邓丽君）.jpg            → 后悔爱上你
 *   第二季第1集许巍 执着02.gif          → 执着, page 2
 *   Green Day - Minority (3).gp3        → Minority, 版本 3
 *   迪克牛仔-有多少爱可以重来(钉子版)   → 有多少爱可以重来, 钉子版
 */
import type {
  ScoreArtist,
  ScoreCategory,
  ScoreFile,
  ScoreFormat,
  ScoreGroup,
  ScoreSearchResult,
  ScoreSong,
  ScoreVersion,
  SearchMatch,
} from './scoreLibraryTypes'

export interface TextTools {
  /** Traditional Chinese → simplified (identity when unavailable). */
  toSimplified(s: string): string
  /** Pinyin syllables (no tones), one per Chinese character; other text passes through as its own items. */
  pinyin(s: string): string[]
}

export const PLAIN_TOOLS: TextTools = { toSimplified: (s) => s, pinyin: (s) => [s] }

const EXT_FORMAT: Record<string, ScoreFormat> = {}
const formats: Array<[ScoreFormat, string]> = [
  ['score', 'gp3 gp4 gp5 gpx gp musicxml xml mxl'],
  ['legacy', 'gtp ptb'],
  ['image', 'jpg jpeg png gif bmp tif tiff webp'],
  ['pdf', 'pdf'],
  ['text', 'txt tab'],
  ['midi', 'mid midi kar'],
  ['audio', 'mp3 wav wma ogg m4a flac aac'],
  ['video', 'mp4 wmv avi mkv flv mov rm rmvb'],
]
for (const [f, exts] of formats) for (const e of exts.split(' ')) EXT_FORMAT[e] = f

export function formatOf(ext: string): ScoreFormat {
  return EXT_FORMAT[ext.toLowerCase()] ?? 'other'
}

/** Folders the library leaves out (audio and video collections). */
const SKIP_CATEGORY = /^\d+-非谱文件$/
/** Categories whose second level is already the artist (动漫音乐: the work, e.g. BanG Dream!). */
const FLAT_CATEGORY = /^(指弹演奏家|网友原创|动漫音乐)$/
/** Folders that hold no scores: amp / effect presets and their screenshots (音色). */
const SKIP_FOLDER = /^(音色|音色预设)$/
/** The organiser's folder for files whose names give no song title. */
const NO_TITLE_FOLDER = '未识别歌名'
/** A level of letter folders: the artists are one level further down. */
const LETTER_FOLDER = /^([A-Za-z]|0-9与符号)$/

const CJK = /[㐀-鿿豈-﫿]/
const hasCjk = (s: string) => CJK.test(s)

const stripOrder = (name: string) => name.replace(/^\d+[-.、]\s*/, '')

function nounOf(category: string, group: string): string {
  if (/作曲家/.test(group)) return '作曲家'
  if (/乐队|组合/.test(group)) return '乐队'
  if (/^(动漫|游戏|影视)$/.test(group)) return '作品'
  if (/无法确认的文件夹/.test(group)) return '文件夹'
  if (/合集|首$|练习曲|连复段/.test(group) || /未识别歌手/.test(category)) return '合集'
  if (/网友原创/.test(category)) return '作者'
  if (/动漫音乐/.test(category)) return '作品'
  if (/指弹演奏家/.test(category)) return '演奏家'
  return '歌手'
}

// ---------------------------------------------------------------------------
// text normalisation
// ---------------------------------------------------------------------------

/** Lower case, full width → half width, simplified, letters and digits only. */
export function normKey(s: string, tools: TextTools): string {
  let memo = memos.get(tools)
  if (!memo) memos.set(tools, (memo = new Map()))
  let k = memo.get(s)
  if (k === undefined) {
    k = computeKey(s, tools)
    if (memo.size > 400_000) memo.clear()
    memo.set(s, k)
  }
  return k
}

const memos = new WeakMap<TextTools, Map<string, string>>()

function computeKey(s: string, tools: TextTools): string {
  return tools
    .toSimplified(s.normalize('NFKC').toLowerCase())
    .replace(/^the\s+/, '')
    .replace(/\s*\(the\)\s*/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

const rawKey = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')

// ---------------------------------------------------------------------------
// file names → title, tags, page
// ---------------------------------------------------------------------------

/** Latin words in brackets or after a dash that describe a version rather than name the song. */
const LATIN_TAG =
  /^(live|acoustic|unplugged|remix|intro|outro|solo|cover|version|bass|demo|instrumental|edit|mix|radio edit|full band|guitar|lead|rhythm|tab|tabs|op\d*|ed\d*)\b|\b(live|acoustic|remix|intro|solo|cover|version|bass|demo|instrumental|tab)$/i
/** Chinese version notes: 钉子版, C调, 片段, 弹唱, 改编… */
const CJK_TAG =
  /(版|谱|调|片段|改编|编配|教学|指法|简易|精编|演奏|演绎|练习|弹唱|指弹|独奏|伴奏|插电|前奏|间奏|尾奏|主题曲|插曲|片头|片尾|歌词|吉他|钢琴|贝[斯司]|男生|女生|男声|女声|完整|原声|电声|双手|四手|联弹|四重奏|结尾)/

const TAG_NAMES: Array<[RegExp, string]> = [
  [/乐队总谱|总谱/, '总谱'],
  [/指弹/, '指弹'],
  [/独奏|^solo$/i, '独奏'],
  [/弹唱/, '弹唱'],
  [/伴奏/, '伴奏'],
  [/贝[斯司]|^bass$/i, 'Bass'],
  [/钢琴/, '钢琴谱'],
  [/^intro$|前奏/i, '前奏'],
  [/单吉他/, '单吉他'],
  [/双吉他/, '双吉他'],
]

/** A tag as shown: the vocabulary names where known, else the note itself (钉子版, Acoustic…). */
function tagName(t: string): string {
  for (const [re, name] of TAG_NAMES) if (re.test(t)) return name
  return t.length > 16 ? t.slice(0, 16) + '…' : t
}

const isTagText = (t: string) =>
  hasCjk(t) ? t.length <= 14 && !/[+＋]/.test(t) && CJK_TAG.test(t) : LATIN_TAG.test(t.trim())

/** Version words found anywhere in a Chinese title: taken out and kept as tags. */
const INLINE_TAGS: Array<[RegExp, string]> = [
  [/乐队总谱|总谱/, '总谱'],
  [/贝[斯司]谱/, 'Bass'],
  [/钢琴谱|钢琴版/, '钢琴谱'],
  [/弹唱(谱|版)?/, '弹唱'],
  [/指弹(谱|版)?/, '指弹'],
  [/独奏(谱|版)?/, '独奏'],
  [/伴奏(谱|版)?/, '伴奏'],
  [/前奏/, '前奏'],
  [/(?:^|[\s-])([A-G][b#]?调|原调|[男女](?:生|声)?(?:调|版)?)(?=$|[\s-])/, ''],
]

/** Decorations that sites add around a title. */
const DECORATION =
  /(吉他)?(六线|和弦|简|曲|乐)?谱(六线谱)?|六线谱|五线谱|GTP谱?|_?音乐路|_?解压|下载|国内男歌手|国内女歌手|男歌手|女歌手|吉他中国|你我吉他网?|niwojita\.?cn|www\.\S+|\S+\.(com|cn|net)\b|^\s*第[一二三四五六七八九十\d]+季\s*第[一二三四五六七八九十\d]+[集期]/gi

/** File names that are not songs at all. */
const NOT_A_SONG = /安装|说明|readme|使用方法|教程目录|^目录$/i

export interface ParsedName {
  title: string
  tags: string[]
  /** Image page number. */
  page?: number
  /** "(2)" etc.: another version of the same song. */
  version?: number
  unknown?: boolean
}

/**
 * Title, tags and page from a file name. `artistNames` are the names of the
 * folder's artist (and frequent Latin prefixes found in its files);
 * `songFolder` is the folder the file sits in inside the artist's folder.
 */
export function parseName(
  base: string,
  format: ScoreFormat,
  artistNames: string[],
  songFolder: string | null,
  tools: TextTools,
): ParsedName {
  const tags: string[] = []
  const tag = (t: string) => {
    const n = tagName(t.trim())
    if (n && !tags.includes(n)) tags.push(n)
  }
  let page: number | undefined
  let version: number | undefined
  let s = tools
    .toSimplified(base.normalize('NFKC'))
    .replace(/_'/g, "'")
    .replace(/〖/g, '【')
    .replace(/〗/g, '】')
    .replace(/—+|–/g, '-')
  const names = artistNames.map((a) => tools.toSimplified(a.normalize('NFKC')))
  const artistKeys = names.map((a) => normKey(a, tools)).filter((k) => k.length >= 2)
  const isArtist = (t: string) => {
    const k = normKey(t, tools)
    return k.length >= 2 && artistKeys.some((a) => a === k || (k.length >= 3 && a.includes(k)))
  }

  // "(2)" "[1]" at the end: another version (a download's "[1]" is a copy).
  let m = s.match(/\s*[([](\d{1,2})[)\]]\s*$/)
  if (m) {
    if (!s.endsWith(']')) version = Number(m[1])
    s = s.slice(0, m.index)
  }
  // Pages of an image score: "…_0006", "… 2", "…02", "xxx1".
  if (format === 'image') {
    m = s.match(/(?:[_\s-]*(?:第|p|page)?\s*(\d{1,4})\s*(?:页)?)$/i)
    if (m && m.index! > 0 && Number(m[1]) < 1000) {
      page = Number(m[1])
      s = s.slice(0, m.index)
    }
  }
  // Album notes name the album, not the song: "（选自2007年专辑《我很忙》）".
  s = s.replace(/[(（【[][^)）】\]]*(选自|专辑)[^)）】\]]*[)）】\]]?/g, ' ')
  // 《title》 names the song outright.
  m = s.match(/《([^》]+)》/)
  if (m) s = m[1]!

  // Brackets, innermost first ("[七里香（完美版）]"): tags, the artist's name, or part of the title.
  // An unclosed one ("…（片段") runs to the end.
  const bracket = (whole: string, inner: string) => {
    const t = inner.trim()
    if (!t) return ' '
    if (isArtist(t) || /^the$/i.test(t)) return ' '
    // A duet's names: "（周杰伦.洪榮宏）".
    if (names.some((n) => n.length >= 2 && t.includes(n)) && t.length <= 20) return ' '
    if (isTagText(t)) {
      tag(t)
      return ' '
    }
    return whole
  }
  for (let pass = 0; pass < 3; pass++) {
    const next = s.replace(/[(【[]([^()【】[\]]*)[)】\]]/g, (w, inner: string) => {
      const r = bracket(w, inner)
      // A kept bracket is marked so the next pass does not look at it again.
      return r === w ? `\uE000${inner}\uE001` : r
    })
    if (next === s) break
    s = next
  }
  s = s.replace(/[(【[]([^()【】[\]\uE000\uE001]*)$/, (w, inner: string) => bracket(w, inner))
  // An unmatched closing bracket ("37门外看]").
  s = s.replace(/[)】\]]/g, ' ')
  // The title only in brackets ("1周杰伦[七里香]"): unwrap it; other kept brackets go back to "(…)".
  const outside = s.replace(/\uE000[^\uE001]*\uE001/g, '').replace(/\d+/g, '')
  const inside = s.match(/\uE000([^\uE001]*)\uE001/)
  if (inside && !names.reduce((o, n) => o.replace(n, ''), outside).trim()) s = inside[1]!
  s = s.replace(/\uE000/g, '(').replace(/\uE001/g, ')')
  // A label before a colon: "钢琴谱：晴天".
  m = s.match(/^([^：:]{1,8})[：:]\s*(?=\S)/)
  if (m) {
    if (isTagText(m[1]!)) tag(m[1]!)
    s = s.slice(m[0].length)
  }
  s = s.replace(/[：:]\s*$/, '')

  // "Artist - Title" (spaced dash, Mysongbook style "Last, First - Title"): the left side names the artist.
  const spaced = s.split(/\s+-+\s+/)
  if (spaced.length > 1 && !hasCjk(spaced[0]!) && spaced.slice(1).join(' - ').trim())
    s = spaced.slice(1).join(' - ')
  else if (spaced.length > 1 && isArtist(spaced[0]!)) s = spaced.slice(1).join(' - ')
  // A sorting letter or 男/女 in front: "B-半岛铁盒", "男-开不了口".
  s = s.replace(/^\s*([A-Z]|[男女])\s*-\s*(?=[㐀-鿿])/, '')
  // Unspaced dashes: drop the parts that are the artist's name or version words.
  if (/-/.test(s)) {
    const parts = s.split(/-+/)
    const isTagPart = (t: string) => isTagText(t) && t.length <= 10
    const kept = parts.filter((p) => p.trim() && !isArtist(p.trim().replace(/_/g, ' ')))
    const titled = kept.filter((p) => !isTagPart(p.trim()))
    if (titled.length) {
      for (const p of kept) if (isTagPart(p.trim())) tag(p)
      s = titled.join('-')
    } else if (kept.length) s = kept.join('-')
  }
  s = s.replace(/_+/g, ' ')
  // The artist's name written next to the title ("南山南  张磊", "水手怕水 周杰伦").
  for (const name of names)
    if (
      name.length >= 2 &&
      s.includes(name) &&
      s.replace(name, '').replace(/[\s'"+&,，、·~-]+/g, '').length >= 1
    )
      s = s.replace(name, ' ')
  // Version words inside a Chinese title ("安静独奏", "卢家宏版指弹独奏七里香", "Mojito C调").
  for (const [re, name] of INLINE_TAGS) {
    const hit = s.match(re)
    if (hit && s.replace(re, '').replace(/[\s-]+/g, '').length >= 1) {
      tag(name || hit[1]!)
      s = s.replace(re, ' ')
    }
  }
  if (hasCjk(s)) {
    // "卢家宏版 七里香": a "…版" word apart from the title.
    s = s.replace(/(?:^|\s)(\S{1,8}?版)(?=\s|$)/g, (w, v: string) => {
      if (s.replace(w, '').trim()) {
        tag(v)
        return ' '
      }
      return w
    })
  }
  s = s.replace(DECORATION, ' ')
  // Numbering in front: "038_077_不要害怕", "37门外看", "1月老", "s时间都去哪了".
  s = s
    .replace(/^\s*(\d{1,4}[\s._、-]+)+(?=\S)/, '')
    .replace(/^\s*\d{1,3}(?=[㐀-鿿])/, '')
    .replace(/^\s*[a-z](?=[㐀-鿿])/i, '')
    .replace(/^[\s'"+&,，、·~#-]+|[\s'"+&,，、·~#-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  // A trailing digit right after Chinese ("七里香2", "开不了口2"): another version of the same song.
  if (format !== 'image' && version === undefined) {
    m = s.match(/(?<=[㐀-鿿])(\d)$/)
    if (m) {
      version = Number(m[1])
      s = s.slice(0, -1)
    }
  }
  // Inside a song folder, a file that contains the folder's name is that song ("月老/1月老", "Brothers/1yngwie_malmsteen-brothers").
  if (songFolder) {
    const folder = parseName(songFolder, 'other', artistNames, null, tools)
    const fk = normKey(folder.title, tools)
    const sk = normKey(s, tools)
    if (fk.length >= 2 && (sk.includes(fk) || !sk || /^\d+$/.test(sk))) {
      s = folder.title
      for (const t of folder.tags) tag(t)
    }
  }
  if (version !== undefined && version > 1) tag(`版本 ${version}`)
  const key = normKey(s, tools)
  const unknown =
    !key ||
    NOT_A_SONG.test(s) ||
    s.trim() === NO_TITLE_FOLDER ||
    // Only a short number is left once the artist / folder name is taken off ("足球小将1",
    // "Rize - 02"): a part or track number, not the song's title.
    (/^\d{1,3}$/.test(key) && /[^\d\s._()\-[\]]/u.test(base)) ||
    /^\d{5,}$/.test(key) ||
    /^(img|dsc|scan|image|微信图片|截图|屏幕截图)\d*/.test(key) ||
    /^\d{4}\d{2}\d{2}/.test(key) ||
    (format === 'image' && /^\d+$/.test(key))
  return {
    title: unknown ? '' : s,
    tags,
    ...(page !== undefined ? { page } : {}),
    ...(version !== undefined ? { version } : {}),
    ...(unknown ? { unknown } : {}),
  }
}

// ---------------------------------------------------------------------------
// building the library
// ---------------------------------------------------------------------------

export interface ScoreLibraryData {
  categories: ScoreCategory[]
  /** By group id, most files first. */
  artists: Map<string, ScoreArtist[]>
  artistById: Map<string, ScoreArtist>
  /** By artist id, sorted by title. */
  songs: Map<string, ScoreSong[]>
  files: number
}

interface Entry {
  file: ScoreFile
  /** Path parts below the artist's folder (folders only). */
  inner: string[]
  base: string
}

const extOf = (name: string) => {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}
const baseOf = (name: string) => {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

/** Where a path sits: category, group, artist folder, and what is below it. */
export function locate(
  path: string,
): { category: string; group: string; artist: string; inner: string[]; name: string } | null {
  const parts = path.split('/')
  const name = parts.pop()!
  if (parts.length === 0) return null
  const category = parts[0]!
  if (SKIP_CATEGORY.test(category)) return null
  if (parts.some((p) => SKIP_FOLDER.test(p))) return null
  if (FLAT_CATEGORY.test(stripOrder(category))) {
    const artist = parts[1] ?? ''
    return {
      category,
      group: category,
      artist: artist ? `${category}/${artist}` : `${category}/`,
      inner: parts.slice(2),
      name,
    }
  }
  const group = parts[1] ? `${category}/${parts[1]}` : category
  let i = 2
  if (parts[i] && LETTER_FOLDER.test(parts[i]!) && parts.length > i + 1) i++
  const artist = parts[i] ? `${parts.slice(0, i).join('/')}/${parts[i]}` : `${group}/`
  return { category, group, artist, inner: parts.slice(i + 1), name }
}

const lastPart = (id: string) => id.slice(id.lastIndexOf('/', id.length - 2) + 1).replace(/\/$/, '')

export function buildLibrary(files: Array<[string, number]>, tools: TextTools): ScoreLibraryData {
  const byArtist = new Map<string, Entry[]>()
  const groupOf = new Map<string, string>()
  const categoryOfGroup = new Map<string, string>()
  for (const [path, size] of files) {
    const at = locate(path)
    if (!at) continue
    const ext = extOf(at.name)
    const format = formatOf(ext)
    if (format === 'audio' || format === 'video') continue
    const entry: Entry = {
      file: { path, size, format, ext },
      inner: at.inner,
      base: baseOf(at.name),
    }
    let list = byArtist.get(at.artist)
    if (!list) byArtist.set(at.artist, (list = []))
    list.push(entry)
    groupOf.set(at.artist, at.group)
    categoryOfGroup.set(at.group, at.category)
  }

  const artists = new Map<string, ScoreArtist[]>()
  const artistById = new Map<string, ScoreArtist>()
  const songs = new Map<string, ScoreSong[]>()
  for (const [artistId, entries] of byArtist) {
    const groupId = groupOf.get(artistId)!
    const name = artistId.endsWith('/') ? '（没放进文件夹的谱）' : lastPart(artistId)
    const collection =
      nounOf(stripOrder(categoryOfGroup.get(groupId)!), stripOrder(lastPart(groupId + '/'))) ===
      '合集'
    const list = buildSongs(artistId, name, entries, collection, tools)
    songs.set(artistId, list)
    const artist: ScoreArtist = {
      id: artistId,
      name,
      groupId,
      files: entries.length,
      songs: list.length,
      initial: initialOf(name, tools),
    }
    artistById.set(artistId, artist)
    let g = artists.get(groupId)
    if (!g) artists.set(groupId, (g = []))
    g.push(artist)
  }
  for (const list of artists.values())
    list.sort((a, b) => b.files - a.files || a.name.localeCompare(b.name, 'zh-Hans-CN'))

  // Categories in their folder order, groups as found.
  const cats = new Map<string, ScoreCategory>()
  for (const [groupId, list] of artists) {
    const categoryId = categoryOfGroup.get(groupId)!
    let c = cats.get(categoryId)
    if (!c)
      cats.set(
        categoryId,
        (c = { id: categoryId, name: stripOrder(categoryId), groups: [], files: 0 }),
      )
    const fileCount = list.reduce((n, a) => n + a.files, 0)
    const groupName = groupId === categoryId ? c.name : lastPart(groupId + '/')
    c.groups.push({
      id: groupId,
      name: groupName,
      categoryId,
      artists: list.length,
      files: fileCount,
      noun: nounOf(c.name, groupName),
    })
    c.files += fileCount
  }
  const order = (id: string) => Number(id.match(/^(\d+)/)?.[1] ?? 999)
  const categories = [...cats.values()].sort(
    (a, b) => order(a.id) - order(b.id) || a.name.localeCompare(b.name, 'zh-Hans-CN'),
  )
  for (const c of categories) c.groups.sort((a: ScoreGroup, b: ScoreGroup) => b.files - a.files)
  return {
    categories,
    artists,
    artistById,
    songs,
    files: categories.reduce((n, c) => n + c.files, 0),
  }
}

/**
 * 谱库 (0.31.0): artist folders the student has merged (周杰伦 / Jay Chou).
 * Returns a new library and leaves `lib` unchanged, so the same unmerged
 * library can be merged again with other choices. The merged folder's songs
 * join the target's: songs with the same title key (the id's suffix) become
 * one song with all their versions. The merged folder leaves its group's
 * list; the target gets `aliases` / `aliasIds`. Its files stay where they are
 * on disk, so categories and file counts do not change. Merges that name an
 * unknown artist, or that would make a cycle, are ignored.
 */
export function applyMerges(
  lib: ScoreLibraryData,
  merges: Array<[string, string]>,
  _tools: TextTools,
): ScoreLibraryData {
  // Direct merges that name two existing artists.
  const direct = new Map<string, string>()
  for (const [from, to] of merges)
    if (from !== to && lib.artistById.has(from) && lib.artistById.has(to)) direct.set(from, to)
  // Each merged folder → the final artist its chain reaches (cycles are dropped).
  const finalOf = new Map<string, string>()
  for (const from of direct.keys()) {
    const seen = new Set<string>([from])
    let cur = direct.get(from)!
    while (direct.has(cur) && !seen.has(cur)) {
      seen.add(cur)
      cur = direct.get(cur)!
    }
    if (!seen.has(cur)) finalOf.set(from, cur)
  }
  if (finalOf.size === 0) return lib

  const removed = new Set(finalOf.keys())
  const incoming = new Map<string, string[]>()
  for (const [from, to] of finalOf) {
    const list = incoming.get(to)
    if (list) list.push(from)
    else incoming.set(to, [from])
  }

  const artistById = new Map<string, ScoreArtist>()
  for (const [id, a] of lib.artistById) if (!removed.has(id)) artistById.set(id, a)
  const songs = new Map<string, ScoreSong[]>()
  for (const [id, list] of lib.songs) if (!removed.has(id)) songs.set(id, list)

  // The song key is the part of the song id after '#' (normalised title, or '__unknown__').
  const keyOf = (s: ScoreSong) => s.id.slice(s.id.lastIndexOf('#') + 1)
  for (const [to, froms] of incoming) {
    const base = lib.artistById.get(to)!
    const byKey = new Map<string, ScoreSong>()
    const add = (s: ScoreSong) => {
      const key = keyOf(s)
      const cur = byKey.get(key)
      if (cur) cur.versions = [...cur.versions, ...s.versions]
      else byKey.set(key, { ...s, artistId: to, id: `${to}#${key}`, versions: [...s.versions] })
    }
    for (const s of lib.songs.get(to) ?? []) add(s)
    for (const f of froms) for (const s of lib.songs.get(f) ?? []) add(s)
    const list = [...byKey.values()]
    for (const s of list)
      s.versions.sort(
        (a, b) => formatRank(a.file.format) - formatRank(b.file.format) || b.size - a.size,
      )
    list.sort(
      (a, b) =>
        Number(!!a.unknownTitle) - Number(!!b.unknownTitle) ||
        a.title.localeCompare(b.title, 'zh-Hans-CN'),
    )
    songs.set(to, list)
    artistById.set(to, {
      ...base,
      files: base.files + froms.reduce((n, f) => n + (lib.artistById.get(f)?.files ?? 0), 0),
      songs: list.length,
      aliases: froms.map((f) => lib.artistById.get(f)!.name),
      aliasIds: [...froms],
    })
  }

  const artists = new Map<string, ScoreArtist[]>()
  for (const [groupId, list] of lib.artists) {
    const next = list
      .filter((a) => !removed.has(a.id))
      .map((a) => artistById.get(a.id) ?? a)
      .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name, 'zh-Hans-CN'))
    artists.set(groupId, next)
  }
  const categories = lib.categories.map((c) => ({
    ...c,
    groups: c.groups.map((g) => {
      const n = artists.get(g.id)?.length ?? g.artists
      return n === g.artists ? g : { ...g, artists: n }
    }),
  }))
  return { categories, artists, artistById, songs, files: lib.files }
}

function initialOf(name: string, tools: TextTools): string {
  const ch = name
    .normalize('NFKC')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .charAt(0)
  if (/[a-z]/i.test(ch)) return ch.toUpperCase()
  if (hasCjk(ch)) {
    const p = tools.pinyin(ch)[0]?.charAt(0) ?? ''
    if (/[a-z]/i.test(p)) return p.toUpperCase()
  }
  return '#'
}

/** Prefixes before a dash that recur in an artist's file names ("Kotaro oshio-…" in 押尾光太郎): treated as the artist's name. */
function frequentPrefixes(entries: Entry[]): string[] {
  const counts = new Map<string, number>()
  for (const e of entries) {
    const m = e.base.match(/^([^-–]{2,30}?)\s*-/)
    // Latin only: a Chinese prefix is usually the song ("轨迹-弹唱", "轨迹-总谱").
    if (m && !hasCjk(m[1]!) && !/^\d+$/.test(m[1]!.trim()))
      counts.set(m[1]!.trim(), (counts.get(m[1]!.trim()) ?? 0) + 1)
  }
  return [...counts].filter(([, n]) => n >= 3).map(([p]) => p)
}

function buildSongs(
  artistId: string,
  artistName: string,
  entries: Entry[],
  collection: boolean,
  tools: TextTools,
): ScoreSong[] {
  const names = [artistName, ...frequentPrefixes(entries)]
  const work = /^\d+-动漫音乐\//.test(artistId)
  // Image pages first: same folder + same name without the page number = one score.
  const versions = new Map<
    string,
    { title: string; unknown: boolean; versions: ScoreVersion[]; titles: string[] }
  >()
  const imageGroups = new Map<
    string,
    { parsed: ParsedName; pages: Array<[number, ScoreFile]>; folder: string }
  >()
  const addVersion = (title: string, unknown: boolean, v: ScoreVersion) => {
    const key = unknown ? '__unknown__' : normKey(title, tools)
    let s = versions.get(key)
    if (!s) versions.set(key, (s = { title, unknown, versions: [], titles: [] }))
    s.versions.push(v)
    if (title) s.titles.push(title)
  }
  for (const e of entries) {
    // The song is the folder right below the artist (deeper ones are parts / sources: 贝斯/GTP…).
    const songFolder = e.inner.length ? e.inner[0]! : null
    const hint = songFolder === NO_TITLE_FOLDER ? null : songFolder
    const parsed = parseName(e.base, e.file.format, names, collection ? null : hint, tools)
    // 动漫音乐: <作品>/<歌名>/… — the folder is the song whatever the file is called ("Final", "教学版").
    if (work && hint && !parsed.unknown) {
      const folder = parseName(hint, 'other', names, null, tools)
      if (!folder.unknown && folder.title) parsed.title = folder.title
    }
    const folderTag = collection && songFolder ? [songFolder] : []
    if (e.file.format === 'image') {
      const dir = e.file.path.slice(0, e.file.path.lastIndexOf('/'))
      const k = `${dir}|${parsed.unknown ? e.base : normKey(parsed.title, tools)}|${parsed.version ?? 0}|${parsed.tags.join(',')}`
      let g = imageGroups.get(k)
      if (!g)
        imageGroups.set(
          k,
          (g = {
            parsed: { ...parsed, tags: [...folderTag, ...parsed.tags] },
            pages: [],
            folder: dir,
          }),
        )
      g.pages.push([parsed.page ?? 0, e.file])
      continue
    }
    addVersion(parsed.title, !!parsed.unknown, {
      file: e.file,
      tags: [...folderTag, ...parsed.tags],
      label: e.base + '.' + e.file.ext,
      size: e.file.size,
    })
  }
  for (const g of imageGroups.values()) {
    const pages = g.pages
      .sort((a, b) => a[0] - b[0] || a[1].path.localeCompare(b[1].path))
      .map(([, f]) => f)
    const first = pages[0]!
    const name = first.path.slice(first.path.lastIndexOf('/') + 1)
    const label =
      pages.length > 1
        ? `${baseOf(name).replace(/[_\s-]*\d+$/, '')}${g.parsed.page !== undefined ? '1–' + pages.length : ''}.${first.ext}`
        : name
    const tags = pages.length > 1 ? [...g.parsed.tags, `${pages.length} 页`] : g.parsed.tags
    addVersion(g.parsed.title, !!g.parsed.unknown, {
      file: first,
      pages,
      tags,
      label,
      size: pages.reduce((n, p) => n + p.size, 0),
    })
  }
  // A title written in pinyin ("Qing Tian", "guiji") joins the Chinese one it spells.
  const byPinyin = new Map<string, string>()
  for (const [key, s] of versions)
    if (!s.unknown && hasCjk(s.title))
      byPinyin.set(
        tools
          .pinyin(s.title)
          .join('')
          .toLowerCase()
          .replace(/[^a-z]/g, ''),
        key,
      )
  for (const [key, s] of [...versions]) {
    if (s.unknown || hasCjk(s.title) || !/^[a-z]+$/.test(key)) continue
    const target = byPinyin.get(key)
    const into = target && versions.get(target)
    if (into && target !== key) {
      into.versions.push(...s.versions)
      versions.delete(key)
    }
  }
  const list: ScoreSong[] = []
  for (const [key, s] of versions) {
    s.versions.sort(
      (a, b) => formatRank(a.file.format) - formatRank(b.file.format) || b.size - a.size,
    )
    // Same file name in different folders: say which folder each one is in.
    const labels = new Map<string, number>()
    for (const v of s.versions) labels.set(v.label, (labels.get(v.label) ?? 0) + 1)
    for (const v of s.versions)
      if (labels.get(v.label)! > 1) {
        const dir = v.file.path
          .slice(artistId.length, v.file.path.lastIndexOf('/') + 1)
          .replace(/^\/|\/$/g, '')
        v.tags = [`文件夹：${dir || '（最外层）'}`, ...v.tags]
      }
    list.push({
      id: `${artistId}#${key}`,
      title: s.unknown ? '' : bestTitle(s.titles, s.title, tools),
      artistId,
      versions: s.versions,
      ...(s.unknown ? { unknownTitle: true } : {}),
    })
  }
  list.sort(
    (a, b) =>
      Number(!!a.unknownTitle) - Number(!!b.unknownTitle) ||
      a.title.localeCompare(b.title, 'zh-Hans-CN'),
  )
  return list
}

/** Opened first: scores the app reads, then pictures and PDFs, then the rest. */
function formatRank(f: ScoreFormat): number {
  return ['score', 'image', 'pdf', 'text', 'midi', 'legacy', 'other'].indexOf(f)
}

/** The title most of its versions give (the shorter one on a tie). */
function bestTitle(titles: string[], fallback: string, tools: TextTools): string {
  const counts = new Map<string, number>()
  for (const t of titles) counts.set(t, (counts.get(t) ?? 0) + 1)
  const best =
    [...counts].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] ?? fallback
  return hasCjk(best) ? tools.toSimplified(best) : best
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

interface Keys {
  /** Simplified, normalised. */
  norm: string
  /** As written (no script conversion), normalised. */
  raw: string
  /** Full pinyin without spaces ('' when the text has no Chinese). */
  py: string
  /** Initials of the Chinese characters (and of the other words). */
  ini: string
}

export function keysOf(text: string, tools: TextTools): Keys {
  const norm = normKey(text, tools)
  const raw = rawKey(text)
  if (!hasCjk(text)) return { norm, raw, py: '', ini: '' }
  const syll = tools
    .pinyin(tools.toSimplified(text.normalize('NFKC')))
    .map((s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter(Boolean)
  return { norm, raw, py: syll.join(''), ini: syll.map((s) => s[0]).join('') }
}

export interface SearchIndex {
  /** An artist's keys: its name, then each merged folder's name (aliases). */
  artists: Array<{ artist: ScoreArtist; keys: Keys[] }>
  songs: Array<{ song: ScoreSong; keys: Keys; artistName: string }>
}

export function buildSearchIndex(lib: ScoreLibraryData, tools: TextTools): SearchIndex {
  const artists: SearchIndex['artists'] = []
  for (const a of lib.artistById.values())
    artists.push({
      artist: a,
      keys: [keysOf(a.name, tools), ...(a.aliases ?? []).map((n) => keysOf(n, tools))],
    })
  const songs: SearchIndex['songs'] = []
  for (const [artistId, list] of lib.songs) {
    const artistName = lib.artistById.get(artistId)?.name ?? ''
    for (const s of list)
      if (!s.unknownTitle) songs.push({ song: s, keys: keysOf(s.title, tools), artistName })
  }
  return { artists, songs }
}

/** Edit distance ≤ limit (early exit). */
function within(a: string, b: string, limit: number): boolean {
  if (Math.abs(a.length - b.length) > limit) return false
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      cur.push(v)
      if (v < rowMin) rowMin = v
    }
    if (rowMin > limit) return false
    prev = cur
  }
  return prev[b.length]! <= limit
}

/** How well `keys` match the query; lower is better, null = no match. */
function matchOf(
  keys: Keys,
  q: Keys,
  qLetters: boolean,
): { match: SearchMatch; rank: number } | null {
  if (!q.norm) return null
  if (keys.raw.includes(q.raw) && q.raw)
    return { match: 'name', rank: keys.raw.startsWith(q.raw) ? 0 : 1 }
  if (keys.norm.includes(q.norm))
    return { match: 'traditional', rank: keys.norm.startsWith(q.norm) ? 0 : 1 }
  if (qLetters && keys.py) {
    if (keys.py.includes(q.norm))
      return { match: 'pinyin', rank: keys.py.startsWith(q.norm) ? 2 : 3 }
    if (q.norm.length >= 2 && keys.ini.includes(q.norm))
      return { match: 'initials', rank: keys.ini.startsWith(q.norm) ? 2 : 4 }
  }
  // Similar spellings: one wrong / missing / extra character (two for longer words).
  if (q.norm.length >= (qLetters ? 4 : 3)) {
    const limit = q.norm.length >= 7 ? 2 : 1
    if (within(q.norm, keys.norm, limit)) return { match: 'fuzzy', rank: 5 }
    if (keys.norm.length > q.norm.length && keys.norm.length <= q.norm.length * 3) {
      // A similar part of a longer name.
      for (let i = 0; i + q.norm.length - limit <= keys.norm.length; i++)
        if (within(q.norm, keys.norm.slice(i, i + q.norm.length), limit))
          return { match: 'fuzzy', rank: 6 }
    }
    if (q.py && keys.py && within(q.py, keys.py, limit)) return { match: 'fuzzy', rank: 6 }
  }
  return null
}

/** The best of several keys (an artist's name and its aliases). */
function bestMatchOf(
  keys: Keys[],
  q: Keys,
  qLetters: boolean,
): { match: SearchMatch; rank: number } | null {
  let best: { match: SearchMatch; rank: number } | null = null
  for (const k of keys) {
    const m = matchOf(k, q, qLetters)
    if (m && (!best || m.rank < best.rank)) best = m
  }
  return best
}

export const SONG_LIMIT = 200
const ARTIST_LIMIT = 50

export function search(
  lib: ScoreLibraryData,
  index: SearchIndex,
  query: string,
  tools: TextTools,
): ScoreSearchResult {
  const q = keysOf(query, tools)
  const qLetters = /^[a-z]+$/.test(q.norm)
  const groupName = new Map<string, { category: string; group: string }>()
  for (const c of lib.categories)
    for (const g of c.groups) groupName.set(g.id, { category: c.name, group: g.name })
  const artists = index.artists
    .map((a) => ({ a, m: bestMatchOf(a.keys, q, qLetters) }))
    .filter((x) => x.m)
    .sort((x, y) => x.m!.rank - y.m!.rank || y.a.artist.files - x.a.artist.files)
    .slice(0, ARTIST_LIMIT)
    .map(({ a, m }) => ({
      ...a.artist,
      categoryName: groupName.get(a.artist.groupId)?.category ?? '',
      groupName: groupName.get(a.artist.groupId)?.group ?? '',
      match: m!.match,
    }))
  const hits: Array<{ s: SearchIndex['songs'][number]; m: { match: SearchMatch; rank: number } }> =
    []
  for (const s of index.songs) {
    const m = matchOf(s.keys, q, qLetters)
    if (m) hits.push({ s, m })
  }
  hits.sort(
    (x, y) =>
      x.m.rank - y.m.rank ||
      x.s.keys.norm.length - y.s.keys.norm.length ||
      y.s.song.versions.length - x.s.song.versions.length,
  )
  return {
    artists,
    songs: hits
      .slice(0, SONG_LIMIT)
      .map(({ s, m }) => ({ song: s.song, artistName: s.artistName, match: m.match })),
    moreSongs: hits.length > SONG_LIMIT,
  }
}
