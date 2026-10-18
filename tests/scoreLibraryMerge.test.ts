import { describe, expect, it } from 'vitest'
import { pinyin } from 'pinyin-pro'
import * as OpenCC from 'opencc-js'
import {
  applyMerges,
  buildLibrary,
  buildSearchIndex,
  search,
  type TextTools,
} from '@/songs/scoreLibrary'

const conv = OpenCC.Converter({ from: 't', to: 'cn' })
const tools: TextTools = {
  toSimplified: (s) => conv(s),
  pinyin: (s) => pinyin(s, { toneType: 'none', type: 'array', v: true }),
}

const CHOU = '1-华语/男歌手/Jay Chou'
const CHOW = '1-华语/男歌手/Jay Chow'
const ZHOU = '1-华语/男歌手/Jay Zhou'
const ZH = '1-华语/男歌手/周杰伦'

const files: Array<[string, number]> = [
  [`${ZH}/七里香.gp4`, 100],
  [`${ZH}/晴天.gp4`, 100],
  [`${ZH}/IMG_0001.jpg`, 10],
  [`${CHOU}/七里香.gp5`, 200],
  [`${CHOU}/Mojito.gp4`, 100],
  [`${CHOW}/晴天.gp3`, 100],
  [`${CHOW}/IMG_0002.jpg`, 10],
  [`${ZHOU}/Mojito.gp3`, 100],
]

const base = () => buildLibrary(files, tools)

describe('谱库 applyMerges', () => {
  it('moves the merged folders into the target and records them as aliases', () => {
    const lib = base()
    const m = applyMerges(
      lib,
      [
        [CHOU, ZH],
        [CHOW, ZH],
        [ZHOU, ZH],
      ],
      tools,
    )
    expect([...m.artistById.keys()]).toEqual([ZH])
    const zh = m.artistById.get(ZH)!
    expect(zh.files).toBe(8)
    expect([...(zh.aliases ?? [])].sort()).toEqual(['Jay Chou', 'Jay Chow', 'Jay Zhou'])
    expect([...(zh.aliasIds ?? [])].sort()).toEqual([CHOU, CHOW, ZHOU].sort())
    expect(m.artists.get('1-华语/男歌手')!.map((a) => a.id)).toEqual([ZH])
  })

  it('combines songs with the same title key and concatenates their versions', () => {
    const m = applyMerges(
      base(),
      [
        [CHOU, ZH],
        [CHOW, ZH],
        [ZHOU, ZH],
      ],
      tools,
    )
    const songs = m.songs.get(ZH)!
    const qlx = songs.find((s) => s.title === '七里香')!
    expect(qlx.id).toBe(`${ZH}#七里香`)
    expect(qlx.artistId).toBe(ZH)
    expect(qlx.versions).toHaveLength(2)
    // The larger file is opened first (same format rank).
    expect(qlx.versions[0]!.file.size).toBe(200)
    expect(songs.find((s) => s.title === '晴天')!.versions).toHaveLength(2)
    expect(songs.find((s) => s.title === 'Mojito')!.versions).toHaveLength(2)
    // Unknown titles are combined too, and stay last.
    const unknown = songs.filter((s) => s.unknownTitle)
    expect(unknown).toHaveLength(1)
    expect(unknown[0]!.versions).toHaveLength(2)
    expect(songs[songs.length - 1]!.unknownTitle).toBe(true)
    expect(m.artistById.get(ZH)!.songs).toBe(songs.length)
  })

  it('keeps group and category file counts and does not change the input', () => {
    const lib = base()
    const group = lib.categories[0]!.groups[0]!
    const m = applyMerges(lib, [[CHOU, ZH]], tools)
    const mg = m.categories[0]!.groups[0]!
    expect(mg.files).toBe(group.files)
    expect(m.categories[0]!.files).toBe(lib.categories[0]!.files)
    expect(mg.artists).toBe(group.artists - 1)
    // The library passed in is untouched, so it can be merged again.
    expect(lib.artistById.size).toBe(4)
    expect(lib.artistById.get(ZH)!.aliases).toBeUndefined()
    expect(lib.songs.get(ZH)!.find((s) => s.title === '七里香')!.versions).toHaveLength(1)
    expect(applyMerges(lib, [], tools)).toBe(lib)
  })

  it('follows a chain of merges to the final artist', () => {
    const m = applyMerges(
      base(),
      [
        [ZHOU, CHOU],
        [CHOU, ZH],
      ],
      tools,
    )
    expect([...m.artistById.keys()].sort()).toEqual([CHOW, ZH].sort())
    expect([...(m.artistById.get(ZH)!.aliasIds ?? [])].sort()).toEqual([CHOU, ZHOU].sort())
  })

  it('ignores merges that name unknown artists, self-merges and cycles', () => {
    const lib = base()
    const m = applyMerges(
      lib,
      [
        ['missing', ZH],
        [ZH, 'missing'],
        [CHOU, CHOU],
        [CHOU, CHOW],
        [CHOW, CHOU],
      ],
      tools,
    )
    expect(m.artistById.size).toBe(4)
    expect(m.artistById.get(ZH)!.aliases).toBeUndefined()
  })

  it('makes the aliases searchable', () => {
    const merged = applyMerges(base(), [[CHOW, ZH]], tools)
    const index = buildSearchIndex(merged, tools)
    const hit = search(merged, index, 'Jay Chow', tools)
    expect(hit.artists.map((a) => a.id)).toContain(ZH)
    // The merged folder itself is gone from the results.
    expect(search(merged, index, 'Jay Chow', tools).artists.map((a) => a.id)).not.toContain(CHOW)
    expect(search(merged, index, '周杰伦', tools).artists.map((a) => a.id)).toContain(ZH)
  })
})
