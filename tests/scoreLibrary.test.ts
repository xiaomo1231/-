import { describe, expect, it } from 'vitest'
import { pinyin } from 'pinyin-pro'
import * as OpenCC from 'opencc-js'
import {
  buildLibrary,
  buildSearchIndex,
  formatOf,
  locate,
  parseName,
  search,
  type TextTools,
} from '@/songs/scoreLibrary'

const conv = OpenCC.Converter({ from: 't', to: 'cn' })
const tools: TextTools = {
  toSimplified: (s) => conv(s),
  pinyin: (s) => pinyin(s, { toneType: 'none', type: 'array', v: true }),
}

/** parseName with the file's format taken from its extension. */
const parse = (
  base: string,
  ext: string,
  artists: string[] = ['周杰伦'],
  songFolder: string | null = null,
) => parseName(base, formatOf(ext), artists, songFolder, tools)

const SIZE = 1000

describe('scoreLibrary parseName: titles', () => {
  it('reads the title from 《》 and the page from an image name', () => {
    const r = parse('周杰伦《七里香》吉他谱六线谱3', 'png')
    expect(r.title).toBe('七里香')
    expect(r.page).toBe(3)
  })

  it('reads a 【artist】-title name', () => {
    expect(parse('【周杰伦】-断了的弦', 'gp4').title).toBe('断了的弦')
  })

  it('drops an artist name in brackets', () => {
    expect(parse('后悔爱上你（邓丽君）', 'jpg', ['邓丽君']).title).toBe('后悔爱上你')
  })

  it('drops an artist name written next to the title', () => {
    expect(parse('南山南  张磊', 'jpg', ['张磊']).title).toBe('南山南')
  })

  it('drops numbering and the artist name in front and behind', () => {
    expect(parse('038_077_不要害怕_王力宏', 'pdf', ['王力宏']).title).toBe('不要害怕')
  })

  it('removes a season/episode prefix and reads the page number', () => {
    const r = parse('第二季第1集许巍 执着02', 'gif', ['许巍'])
    expect(r.title).toBe('执着')
    expect(r.page).toBe(2)
  })

  it('treats 钢琴谱 as a tag, not part of the title', () => {
    const r = parse('钢琴谱：晴天（片段）', 'pdf')
    expect(r.title).toBe('晴天')
    expect(r.tags).toContain('钢琴谱')
  })

  it('strips a sorting letter in front of the title', () => {
    expect(parse('B-半岛铁盒', 'pdf').title).toBe('半岛铁盒')
  })

  it('reads a numbered version and 男- prefix', () => {
    const r = parse('男-周杰伦-开不了口（3）', 'gp3')
    expect(r.title).toBe('开不了口')
    expect(r.version).toBe(3)
    expect(r.tags.filter((t) => t === '版本 3')).toHaveLength(1)
  })

  it('takes 独奏 as a tag', () => {
    const r = parse('安静独奏', 'gp5')
    expect(r.title).toBe('安静')
    expect(r.tags).toContain('独奏')
  })

  it('finds the song inside a long Chinese file name with 指弹 and 独奏', () => {
    const r = parse('卢家宏版指弹独奏七里香吉他谱', 'gp5')
    expect(r.title).toBe('七里香')
    expect(r.tags).toContain('指弹')
  })

  it('takes 弹唱 and C调 as tags for a Latin title', () => {
    const r = parse('Mojito【弹唱谱】C调', 'pdf')
    expect(r.title).toBe('Mojito')
    expect(r.tags).toContain('弹唱')
  })

  it('drops an album note in brackets', () => {
    expect(parse('钢琴谱：跨时代（选自2010年专辑《跨时代》）', 'pdf').title).toBe('跨时代')
  })

  it('converts a traditional file name to simplified and drops the artist', () => {
    expect(parse('安靜_周杰倫', 'pdf').title).toBe('安静')
  })

  it('reads a trailing digit after Chinese as a version', () => {
    const r = parse('七里香2', 'gp4')
    expect(r.title).toBe('七里香')
    expect(r.version).toBe(2)
  })

  it('reads a Latin title with an artist prefix and a version', () => {
    const r = parse('Dion, Celine - My Heart Will Go On', 'gp3', ['Celine Dion'])
    expect(r.title).toBe('My Heart Will Go On')
  })

  it('reads a Latin title with a version in brackets', () => {
    const r = parse('Green Day - Minority (3)', 'gp3', ['Green Day'])
    expect(r.title).toBe('Minority')
    expect(r.version).toBe(3)
  })

  it("reads an apostrophe written as _' and keeps it", () => {
    expect(parse("Queen - Now I_'m Here (2)", 'gp3', ['Queen']).title).toBe("Now I'm Here")
  })

  it('drops a 迪克牛仔 artist prefix and keeps 钉子版 as a tag', () => {
    const r = parse('迪克牛仔-有多少爱可以重来(钉子版)', 'gp3', ['迪克牛仔'])
    expect(r.title).toBe('有多少爱可以重来')
    expect(r.tags).toContain('钉子版')
  })

  it('takes the song folder name when the file is numbered inside it', () => {
    expect(parse('1月老', 'gp4', ['刘德华'], '月老').title).toBe('月老')
  })

  it('takes the song folder name for a numbered Latin file', () => {
    expect(parse('1yngwie_malmsteen-brothers', 'gp5', ['Yngwie Malmsteen'], 'Brothers').title).toBe(
      'Brothers',
    )
  })

  it('reads a page number from a TIFF file name', () => {
    const r = parse("The Who - Won't Get Fooled Again_0006", 'tif', ['The Who'])
    expect(r.title).toBe("Won't Get Fooled Again")
    expect(r.page).toBe(6)
  })

  it('keeps a bracket that is part of the title', () => {
    expect(parse('Helloween - Heavy Metal (Is The Law)', 'gp3', ['Helloween']).title).toBe(
      'Heavy Metal (Is The Law)',
    )
  })

  it('keeps Acoustic as a tag and the title intact', () => {
    const r = parse('Incubus - The Warmth (Acoustic)', 'gp4', ['Incubus'])
    expect(r.title).toBe('The Warmth')
    expect(r.tags).toContain('Acoustic')
  })
})

describe('scoreLibrary parseName: unknown titles', () => {
  it.each([
    ['113044400', 'gp3'],
    ['IMG_1016', 'jpg'],
    ['2018-03-10 170857(5)', 'jpg'],
    ['Guitar pro v1.2安装步骤图片演示步骤10', 'jpg'],
  ])('flags %s as unknown', (base, ext) => {
    expect(parse(base, ext).unknown).toBe(true)
  })
})

describe('scoreLibrary locate', () => {
  it('reads category, group and artist from a 华语 path', () => {
    const at = locate('1-华语/男歌手/周杰伦/七里香.gp4')
    expect(at?.category).toBe('1-华语')
    expect(at?.group).toBe('1-华语/男歌手')
    expect(at?.artist).toBe('1-华语/男歌手/周杰伦')
    expect(at?.inner).toEqual([])
  })

  it('treats 指弹演奏家 as a flat category (no group level)', () => {
    const at = locate('4-指弹演奏家/Andy Mckee/x.gp4')
    expect(at?.group).toBe('4-指弹演奏家')
    expect(at?.artist).toBe('4-指弹演奏家/Andy Mckee')
  })

  it('skips the letter folder before the artist', () => {
    expect(locate('2-欧美/未分曲风/A/Adele/x.gp4')?.artist).toBe('2-欧美/未分曲风/A/Adele')
  })

  it('returns null for 非谱文件', () => {
    expect(locate('10-非谱文件/音频/a.mp3')).toBeNull()
  })

  it('gives files outside an artist folder the group as artist', () => {
    expect(locate('8-教学练习/连复段/Demo v5.gp5')?.artist).toBe('8-教学练习/连复段/')
  })

  it('keeps folders below the artist as inner', () => {
    expect(locate('1-华语/男歌手/许巍/许巍专辑1/闪亮的瞬间.gp4')?.inner).toEqual(['许巍专辑1'])
  })
})

const LIBRARY_FILES: Array<[string, number]> = [
  ...[1, 2, 3, 4, 5, 6].map((n): [string, number] => [
    `1-华语/男歌手/周杰伦/周杰伦《七里香》吉他谱六线谱${n}.png`,
    SIZE,
  ]),
  ['1-华语/男歌手/周杰伦/【周杰伦】-七里香.gp4', SIZE],
  ['1-华语/男歌手/周杰伦/七里香 .txt', SIZE],
  ['1-华语/男歌手/周杰伦/七里香2.gp4', SIZE],
  ['1-华语/男歌手/周杰伦/【周杰伦】-晴天.gp4', SIZE],
  ['1-华语/男歌手/周杰伦/Qing Tian.gp5', SIZE],
  ['1-华语/男歌手/周杰伦/诡计.gp4', SIZE],
  ['1-华语/男歌手/周杰伦/guiji.gp4', SIZE],
  ['2-欧美/硬摇滚与重金属/Metallica/Metallica - One (2).gp3', SIZE],
  ['2-欧美/硬摇滚与重金属/Metallica/Metallica - One.gp4', SIZE],
  ['10-非谱文件/音频/a.mp3', SIZE],
]

describe('scoreLibrary buildLibrary', () => {
  const lib = buildLibrary(LIBRARY_FILES, tools)
  const jay = lib.songs.get('1-华语/男歌手/周杰伦') ?? []
  const find = (title: string) => jay.find((s) => s.title === title)

  it('lists categories in folder order and skips 非谱文件', () => {
    expect(lib.categories.map((c) => c.id)).toEqual(['1-华语', '2-欧美'])
    expect(lib.categories.map((c) => c.name)).toEqual(['华语', '欧美'])
  })

  it('gives 七里香 four versions, one of them a six-page image score', () => {
    const song = find('七里香')
    expect(song?.versions).toHaveLength(4)
    const image = song?.versions.find((v) => v.pages !== undefined)
    expect(image?.pages).toHaveLength(6)
    expect(image?.tags).toContain('6 页')
  })

  it('merges a pinyin-named file into the Chinese title it spells (晴天 / Qing Tian)', () => {
    const song = find('晴天')
    expect(song?.versions.some((v) => v.file.path.endsWith('Qing Tian.gp5'))).toBe(true)
  })

  it('merges guiji.gp4 into 诡计', () => {
    expect(find('诡计')?.versions.some((v) => v.file.path.endsWith('guiji.gp4'))).toBe(true)
  })

  it('gives Metallica "One" two versions', () => {
    const one = lib.songs.get('2-欧美/硬摇滚与重金属/Metallica')?.find((s) => s.title === 'One')
    expect(one?.versions).toHaveLength(2)
  })

  it('initials: 周杰伦 is Z, Metallica is M', () => {
    expect(lib.artistById.get('1-华语/男歌手/周杰伦')?.initial).toBe('Z')
    expect(lib.artistById.get('2-欧美/硬摇滚与重金属/Metallica')?.initial).toBe('M')
  })

  it('names the group entries 歌手', () => {
    const group = lib.categories[0]?.groups.find((g) => g.id === '1-华语/男歌手')
    expect(group?.noun).toBe('歌手')
  })
})

describe('scoreLibrary search', () => {
  const lib = buildLibrary(LIBRARY_FILES, tools)
  const index = buildSearchIndex(lib, tools)

  it('finds a song by its Chinese name', () => {
    const r = search(lib, index, '七里香', tools)
    const hit = r.songs.find((s) => s.song.title === '七里香')
    expect(hit?.match).toBe('name')
  })

  it('finds a song by full pinyin', () => {
    const r = search(lib, index, 'qilixiang', tools)
    const hit = r.songs.find((s) => s.song.title === '七里香')
    expect(hit?.match).toBe('pinyin')
  })

  it('finds an artist by pinyin initials', () => {
    const r = search(lib, index, 'zjl', tools)
    const hit = r.artists.find((a) => a.name === '周杰伦')
    expect(hit?.match).toBe('initials')
  })

  it('matches a traditional spelling of the query', () => {
    const r = search(lib, index, '七裡香', tools)
    const hit = r.songs.find((s) => s.song.title === '七里香')
    expect(hit?.match).toBe('traditional')
  })

  it('finds an artist with a one-letter typo', () => {
    const r = search(lib, index, 'metalica', tools)
    const hit = r.artists.find((a) => a.name === 'Metallica')
    expect(hit?.match).toBe('fuzzy')
  })

  it('finds nothing for gibberish', () => {
    const r = search(lib, index, 'zzzzqqq', tools)
    expect(r.artists).toHaveLength(0)
    expect(r.songs).toHaveLength(0)
  })
})

describe('a bare number is not a title', () => {
  const lib = buildLibrary(
    [
      ['6-动漫音乐/足球小将/未识别歌名/足球小将1.gp4', 100],
      ['2-欧美/新金属与另类/Rize/未识别歌名/Rize - 02.gp4', 100],
      ['8-网友原创/某人/1/1.gp5', 100],
    ],
    tools,
  )
  const titles = [...lib.songs.values()].flat().map((s) => s.title)
  it('drops a number left after taking off the artist, keeps a song called “1”', () => {
    expect(titles).not.toContain('02')
    expect(titles.filter((t) => t === '1')).toHaveLength(1)
  })
})

describe('untitled files (未识别歌名)', () => {
  const lib = buildLibrary(
    [
      ['1-华语/男歌手/张震岳/未识别歌名/未识别歌名.gp4', 100],
      ['1-华语/男歌手/张震岳/未识别歌名/未识别歌名 (2).gp4', 100],
      ['1-华语/男歌手/张震岳/爱我别走/爱我别走.gp5', 100],
    ],
    tools,
  )
  it('keeps them out of search and never titles a song 未识别歌名', () => {
    const r = search(lib, buildSearchIndex(lib, tools), '未识别', tools)
    expect(r.songs).toHaveLength(0)
    expect([...lib.songs.values()].flat().some((s) => s.title === '未识别歌名')).toBe(false)
  })
})

describe('分谱 stays in a title', () => {
  it('does not strip the 谱 of 分谱, still strips 吉他谱', () => {
    expect(parseName('我们的歌（2021 年巡回演唱会北京站现场版，附完整吉他独奏与贝斯分谱）', 'score', [], null, tools).title).toContain('分谱')
    expect(parseName('七里香吉他谱', 'score', [], null, tools).title).toBe('七里香')
  })
})
