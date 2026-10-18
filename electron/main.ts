/**
 * 律动工坊 应用版 (0.23.0): the built site (dist/) in its own window, plus
 * what a browser cannot do — the vocals model on the graphics card through
 * onnxruntime-node (DirectML), low-latency monitoring through the sound card
 * driver, and folders / microphone without asking every time.
 *
 * The page is served from app://groovelab/ (a fixed origin, so its stored
 * data never "disappears" the way a changed port would make it).
 */
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  session,
  shell,
  type OpenDialogOptions,
  type WebContents,
} from 'electron'
import { existsSync, promises as fsp, statSync } from 'node:fs'
import { cpus } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

const ORIGIN = 'app://groovelab'
const here = __dirname
/** Built site: next to the main script when packaged (web/), else the project's dist/. */
const webRoot = existsSync(path.join(here, '..', 'web', 'index.html'))
  ? path.join(here, '..', 'web')
  : path.join(here, '..', 'dist')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
])
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
// Same data folder however the app is started (%APPDATA%\GrooveLab).
// GROOVELAB_USER_DATA: a separate data folder (testing next to the copy in daily use).
app.setPath(
  'userData',
  process.env.GROOVELAB_USER_DATA ?? path.join(app.getPath('appData'), 'GrooveLab'),
)

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.sf2': 'application/octet-stream',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

/** A file of the site; unknown paths without an extension are app routes (index.html). */
async function serve(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
  let file = path.normalize(path.join(webRoot, rel))
  if (!file.startsWith(webRoot)) return new Response('forbidden', { status: 403 })
  // No service worker in the app: the files are already on this computer.
  if (rel === 'sw.js') return new Response('', { status: 404 })
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (path.extname(rel)) return new Response('not found', { status: 404 })
    file = path.join(webRoot, 'index.html')
  }
  const res = await net.fetch(pathToFileURL(file).href)
  const headers = new Headers({
    'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  })
  const len = res.headers.get('content-length')
  if (len) headers.set('content-length', len)
  return new Response(res.body, { status: 200, headers })
}

// ---- Workers ----------------------------------------------------------------

/** A worker thread answering {id, …} requests with {id, ok, …}. */
class Port {
  private worker: Worker | null = null
  private next = 1
  private waiting = new Map<
    number,
    { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }
  >()
  /** Messages the worker sends by itself (no id), e.g. microphone chunks. */
  onEvent: ((m: Record<string, unknown>) => void) | null = null
  constructor(
    private readonly script: string,
    private readonly data: unknown = undefined,
  ) {}
  private get w(): Worker {
    if (this.worker) return this.worker
    const w = new Worker(path.join(here, this.script), { workerData: this.data })
    w.on('message', (m: { id?: number; ok?: boolean; message?: string }) => {
      if (m.id === undefined) {
        this.onEvent?.(m as Record<string, unknown>)
        return
      }
      const p = this.waiting.get(m.id)
      if (!p) return
      this.waiting.delete(m.id)
      if (m.ok) p.resolve(m as Record<string, unknown>)
      else p.reject(new Error(m.message ?? '出错了'))
    })
    const die = (e: Error) => {
      for (const p of this.waiting.values()) p.reject(e)
      this.waiting.clear()
      this.worker = null
    }
    w.on('error', die)
    w.on('exit', (code) => code !== 0 && die(new Error(`后台进程意外退出（${code}）`)))
    this.worker = w
    return w
  }
  ask(
    req: Record<string, unknown>,
    transfer: ArrayBuffer[] = [],
  ): Promise<Record<string, unknown>> {
    const id = this.next++
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject })
      this.w.postMessage({ ...req, id }, transfer)
    })
  }
  async close(): Promise<void> {
    const w = this.worker
    this.worker = null
    await w?.terminate()
  }
}

const modelPath = path.join(webRoot, 'models', 'vocals-mdx-fp16.onnx')
let separator: Port | null = null
const monitor = new Port('monitor.cjs')
monitor.onEvent = (m) => {
  if (m.event !== 'input') return
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('monitor:input', m.data, m.rate)
}

ipcMain.handle('mdx:init', async () => {
  if (!existsSync(modelPath)) throw new Error('应用里没有找到人声模型文件。')
  separator ??= new Port('separator.cjs', { modelPath, cores: cpus().length })
  const r = await separator.ask({ type: 'init' })
  return { provider: r.provider }
})
ipcMain.handle('mdx:run', async (_e, left: Float32Array[], right: Float32Array[]) => {
  if (!separator) throw new Error('分轨模型还没准备好。')
  const r = await separator.ask({ type: 'run', left, right }, [
    ...new Set([...left, ...right].map((x) => x.buffer as ArrayBuffer)),
  ])
  return { left: r.left, right: r.right }
})
ipcMain.handle('mdx:dispose', async () => {
  await separator?.close()
  separator = null
})
ipcMain.handle('monitor:devices', async () => (await monitor.ask({ type: 'devices' })).value)
ipcMain.handle(
  'monitor:start',
  async (_e, s: Record<string, unknown>) => (await monitor.ask({ type: 'start', ...s })).value,
)
ipcMain.handle(
  'monitor:update',
  async (_e, s: Record<string, unknown>) => void (await monitor.ask({ type: 'update', ...s })),
)
ipcMain.handle('monitor:stats', async () => (await monitor.ask({ type: 'stats' })).value)
ipcMain.handle('monitor:stop', async () => void (await monitor.ask({ type: 'stop' })))
// ---- Pitch (RMVPE and SwiftF0 on the processor) -------------------------------

/** A model file: the built site's, or (developing against the dev server) the project's public/. */
const modelFile = (name: string) =>
  [path.join(webRoot, 'models', name), path.join(here, '..', 'public', 'models', name)].find((p) =>
    existsSync(p),
  ) ?? path.join(webRoot, 'models', name)
const pitchModel = modelFile('pitch-rmvpe-fp16.onnx')
const swiftModel = modelFile('pitch-swiftf0.onnx')
const pitch = new Port('pitch.cjs', {
  rmvpePath: pitchModel,
  swiftPath: swiftModel,
  cores: cpus().length,
})
const askPitch = (req: Record<string, unknown>) => pitch.ask(req)
ipcMain.handle('pitch:available', () => ({
  rmvpe: existsSync(pitchModel),
  swift: existsSync(swiftModel),
}))
ipcMain.handle(
  'pitch:rmvpe',
  async (_e, mel: Float32Array, frames: number) =>
    (await askPitch({ type: 'rmvpe', mel, frames })).hidden,
)
ipcMain.handle('pitch:swift', async (_e, audio: Float32Array, fmin: number, fmax: number) => {
  const r = await askPitch({ type: 'swift', audio, fmin, fmax })
  return { pitch: r.pitch, conf: r.conf }
})

ipcMain.on('app:version', (e) => {
  e.returnValue = app.getVersion()
})

// ---- 谱库 (0.29.0): the student's score folder, read only ----------------------
// Nothing is copied, moved or written into the folder. Every path the page sends
// is checked to be inside the chosen folder.

/** The scan the page gets (same shape as ScoreScan in src/songs/scoreLibraryTypes.ts). */
interface ScoreScanData {
  root: string
  scannedAt: number
  files: Array<[string, number]>
}

const scoreSettingsFile = () => path.join(app.getPath('userData'), 'scores.json')
const scoreIndexFile = () => path.join(app.getPath('userData'), 'scores-index.json')
const MAX_SCORE_BYTES = 200 * 1024 * 1024
const SKIP_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini'])

async function readJsonFile<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

async function writeJsonFile(file: string, data: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(file, JSON.stringify(data))
}

/** The chosen folder, or null when none is saved or it no longer exists. */
async function scoreRoot(): Promise<string | null> {
  const root = (await readJsonFile<{ root?: unknown }>(scoreSettingsFile()))?.root
  if (typeof root !== 'string' || !root) return null
  try {
    return (await fsp.stat(root)).isDirectory() ? root : null
  } catch {
    return null
  }
}

/** Absolute path of a file given relative to the root; refuses anything outside it. */
async function libraryFile(rel: unknown): Promise<string> {
  const root = await scoreRoot()
  if (!root) throw new Error('还没有选择谱库文件夹。')
  if (typeof rel !== 'string') throw new Error('这个文件不在谱库文件夹里。')
  const full = path.resolve(root, rel)
  const back = path.relative(root, full)
  if (!back || back === '..' || back.startsWith(`..${path.sep}`) || path.isAbsolute(back))
    throw new Error('这个文件不在谱库文件夹里。')
  return full
}

let scanning: Promise<ScoreScanData> | null = null

/** Walks the whole folder (explicit stack: the library can be 28 folders deep) and caches the result. */
async function scanLibrary(sender: WebContents): Promise<ScoreScanData> {
  const root = await scoreRoot()
  if (!root) throw new Error('还没有选择谱库文件夹。')
  const found: Array<{ full: string; rel: string }> = []
  let lastSent = 0
  const stack: Array<{ dir: string; rel: string }> = [{ dir: root, rel: '' }]
  while (stack.length) {
    const { dir, rel } = stack.pop()!
    try {
      for await (const entry of await fsp.opendir(dir)) {
        const lower = entry.name.toLowerCase()
        if (SKIP_NAMES.has(lower) || lower.startsWith('._')) continue
        const full = path.join(dir, entry.name)
        const childRel = rel ? `${rel}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          stack.push({ dir: full, rel: childRel })
        } else if (entry.isFile()) {
          found.push({ full, rel: childRel })
          const now = Date.now()
          if (now - lastSent >= 250) {
            lastSent = now
            if (!sender.isDestroyed()) sender.send('scores:progress', found.length)
          }
        }
      }
    } catch {
      // A folder that cannot be opened is left out.
    }
  }
  // Sizes: 32 at a time, so a hard disk is busy but the computer stays usable.
  const sized: Array<[string, number] | null> = new Array(found.length).fill(null)
  let next = 0
  const worker = async () => {
    while (next < found.length) {
      const i = next++
      try {
        sized[i] = [found[i].rel, (await fsp.stat(found[i].full)).size]
      } catch {
        // Cannot be read: left out.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(32, found.length) }, worker))
  const files = sized.filter((f): f is [string, number] => f !== null)
  files.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const scan: ScoreScanData = { root, scannedAt: Date.now(), files }
  await writeJsonFile(scoreIndexFile(), scan)
  return scan
}

ipcMain.handle('scores:root', () => scoreRoot())
ipcMain.handle('scores:pickRoot', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const options: OpenDialogOptions = { properties: ['openDirectory'], title: '选择吉他谱库文件夹' }
  const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (r.canceled || r.filePaths.length === 0) return null
  const root = r.filePaths[0]
  await writeJsonFile(scoreSettingsFile(), { root })
  return root
})
ipcMain.handle('scores:cached', async () => {
  const root = await scoreRoot()
  if (!root) return null
  const cached = await readJsonFile<ScoreScanData>(scoreIndexFile())
  return cached?.root === root ? cached : null
})
ipcMain.handle('scores:scan', (e) => {
  // One scan at a time: a second call gets the same promise.
  scanning ??= scanLibrary(e.sender).finally(() => {
    scanning = null
  })
  return scanning
})
ipcMain.handle('scores:read', async (_e, rel: string) => {
  const full = await libraryFile(rel)
  const st = await fsp.stat(full)
  if (!st.isFile()) throw new Error('找不到这个文件。')
  if (st.size > MAX_SCORE_BYTES) throw new Error('文件太大（超过 200 MB）。')
  const buf = await fsp.readFile(full)
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
})
/** What "用系统程序打开" may open: scores, pictures, documents and media — never a program or script in the folder. */
const OPENABLE =
  /\.(gp[345x]?|gp|gtp|ptb|tg|musicxml|xml|mxl|mid|midi|kar|pdf|txt|tab|doc|docx|jpe?g|png|gif|bmp|tiff?|webp|mp3|wav|wma|ogg|m4a|flac|aac|mp4|wmv|avi|mkv|flv|mov)$/i
ipcMain.handle('scores:openExternal', async (_e, rel: string) => {
  const full = await libraryFile(rel)
  if (!OPENABLE.test(full)) return '这种文件不能从谱库里直接打开。'
  return shell.openPath(full)
})
ipcMain.handle('scores:reveal', async (_e, rel: string) => {
  shell.showItemInFolder(await libraryFile(rel))
})

// ---- Window -----------------------------------------------------------------

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: '律动工坊',
    backgroundColor: '#0b0f17',
    icon: path.join(webRoot, 'icons', 'icon-512.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Chromium's built-in PDF viewer: PDF scores are shown inside the page.
      plugins: true,
      // Pitch detection and recording keep full speed when the window is behind another one.
      backgroundThrottling: false,
    },
  })
  // Links to other sites open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (
      url.startsWith(ORIGIN) ||
      (process.env.GROOVELAB_DEV_URL && url.startsWith(process.env.GROOVELAB_DEV_URL))
    )
      return
    e.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  })
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools()
  })
  // GROOVELAB_DEV_URL=http://localhost:5174 shows the dev server instead (developing the app parts).
  void win.loadURL(process.env.GROOVELAB_DEV_URL ?? `${ORIGIN}/`)
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w) {
      if (w.isMinimized()) w.restore()
      w.focus()
    }
  })
  void app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    protocol.handle('app', serve)
    // Microphone and the folders the student chose: allowed without asking again.
    const allowed = new Set([
      'media',
      'fileSystem',
      'clipboard-sanitized-write',
      'clipboard-read',
      'notifications',
      'fullscreen',
      'persistent-storage',
    ])
    session.defaultSession.setPermissionRequestHandler((_wc, permission, done) =>
      done(allowed.has(permission)),
    )
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))
    createWindow()
  })
  app.on('window-all-closed', () => {
    void monitor.ask({ type: 'stop' }).catch(() => undefined)
    app.quit()
  })
}
