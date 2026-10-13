import { beforeEach, describe, expect, it } from 'vitest'
import { GrooveLabDB, setDbForTests } from '@/infrastructure/db/database'
import { LibraryService } from '@/services/libraryService'

let n = 0
beforeEach(() => setDbForTests(new GrooveLabDB(`library-${Date.now()}-${n++}`)))

/** A fake folder: name → bytes (string content) or a sub-folder. */
type Tree = { [name: string]: string | Tree }

function fileHandle(name: string, content: () => string, stamp: () => number) {
  return {
    kind: 'file' as const,
    name,
    async getFile() {
      return new File([content()], name, { lastModified: stamp() })
    },
  }
}

function dirHandle(name: string, tree: () => Tree, stamps: Map<string, number>, prefix = ''): {
  kind: 'directory'
  name: string
  values(): AsyncIterable<unknown>
  getDirectoryHandle(n: string): Promise<unknown>
  getFileHandle(n: string): Promise<unknown>
} {
  const entry = (k: string) => {
    const v = tree()[k]
    if (v === undefined) throw new DOMException('gone', 'NotFoundError')
    return typeof v === 'string'
      ? fileHandle(k, () => tree()[k] as string, () => stamps.get(prefix + k) ?? 1)
      : dirHandle(k, () => tree()[k] as Tree, stamps, `${prefix}${k}/`)
  }
  return {
    kind: 'directory',
    name,
    async *values() {
      for (const k of Object.keys(tree())) yield entry(k)
    },
    async getDirectoryHandle(k: string) {
      return entry(k)
    },
    async getFileHandle(k: string) {
      return entry(k)
    },
  }
}

describe('歌曲库 scanning', () => {
  it('lists audio files with clean names, keeps edits, follows changes', async () => {
    let tree: Tree = {
      '01. 示例歌手 - 测试歌曲 [无损].flac': 'a',
      'notes.txt': 'x',
      某乐队: { '第二首.mp3': 'bb', '.hidden': { 'x.mp3': 'c' } },
    }
    const stamps = new Map<string, number>()
    const root = dirHandle('下载', () => tree, stamps)
    const folder = await LibraryService.addFolder(root as never)

    const r1 = await LibraryService.scan(folder)
    expect(r1).toMatchObject({ added: 2, updated: 0, removed: 0, total: 2 })
    const songs = await LibraryService.songs()
    const a = songs.find((s) => s.path.endsWith('.flac'))!
    expect(a).toMatchObject({ title: '测试歌曲', artist: '示例歌手', source: 'filename', needsReview: false })
    // the folder name is the artist hint; a lone title needs checking
    expect(songs.find((s) => s.path === '某乐队/第二首.mp3')).toMatchObject({ title: '第二首', needsReview: true })

    // Edit a name, then nothing changes on disk: nothing re-read.
    await LibraryService.rename(a.id, { title: '改过的名字' })
    expect(await LibraryService.scan(folder)).toMatchObject({ added: 0, updated: 0, removed: 0 })

    // The file changes on disk: re-read, but the edited name stays.
    stamps.set('01. 示例歌手 - 测试歌曲 [无损].flac', 2)
    tree = { ...tree, '新歌.m4a': 'ddd', 某乐队: {} }
    expect(await LibraryService.scan(folder)).toMatchObject({ added: 1, updated: 1, removed: 1, total: 2 })
    const after = await LibraryService.songs()
    expect(after.find((s) => s.id === a.id)).toMatchObject({ title: '改过的名字', source: 'manual' })
    expect(after.map((s) => s.path).sort()).toEqual(['01. 示例歌手 - 测试歌曲 [无损].flac', '新歌.m4a'])

    // Reading a song's file, and a missing one.
    const file = await LibraryService.file(after.find((s) => s.path === '新歌.m4a')!)
    expect(file.size).toBe(3)
    tree = {}
    await expect(LibraryService.file(after[0]!)).rejects.toThrow('找不到这个文件')

    await LibraryService.removeFolder(folder.id)
    expect(await LibraryService.songs()).toEqual([])
    expect(await LibraryService.folders()).toEqual([])
  })
})

describe('歌曲库 singer inference', () => {
  it('learns singers from other files and flags pairs that contradict each other', async () => {
    const tree: Tree = {
      '示例歌手 - 歌甲.mp3': 'a',
      '歌乙 - 示例歌手.mp3': 'b',
      '示例歌手 - 歌丙.mp3': 'c',
      '名字一 - 名字二.mp3': 'd',
      '名字二 - 名字一.mp3': 'e',
    }
    const folder = await LibraryService.addFolder(dirHandle('歌', () => tree, new Map()) as never)
    await LibraryService.scan(folder)
    const by = new Map((await LibraryService.songs()).map((s) => [s.fileName, s]))
    expect(by.get('歌乙 - 示例歌手.mp3')).toMatchObject({ artist: '示例歌手', title: '歌乙', needsReview: false })
    expect(by.get('示例歌手 - 歌甲.mp3')).toMatchObject({ artist: '示例歌手', title: '歌甲' })
    expect(by.get('名字一 - 名字二.mp3')).toMatchObject({ artist: '名字一', needsReview: true })
    expect(by.get('名字二 - 名字一.mp3')).toMatchObject({ artist: '名字二', needsReview: true })
  })
})
