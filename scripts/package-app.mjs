/**
 * 打包应用版（免安装）: `npm run package` (builds the site and electron-dist
 * first). Stages build/app/ — the built site (web/), the app code (main/) and
 * only the native modules the app needs (onnxruntime-node for Windows x64,
 * audify) — lets electron-builder make the Windows app folder, and zips it to
 * release/律动工坊-<version>-win-x64.zip.
 *
 * The zip includes the vocals model (public/models, not in git, no licence to
 * publish): it is for sharing privately, not for a public release.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const stage = path.join(root, 'build', 'app')
const out = path.join(root, 'build', 'app-out')
const nm = (p) => path.join(root, 'node_modules', p)
const version = pkg.version
const electronVersion = JSON.parse(readFileSync(nm('electron/package.json'), 'utf8')).version

for (const need of ['dist/index.html', 'electron-dist/main.cjs'])
  if (!existsSync(path.join(root, need))) throw new Error(`missing ${need}: run npm run package`)
if (!existsSync(path.join(root, 'dist/models/vocals-mdx-fp16.onnx')))
  console.warn('! no vocals model in dist/models: the app will use the six-stem download instead')

rmSync(stage, { recursive: true, force: true })
rmSync(out, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })

const copy = (from, to, filter) =>
  cpSync(from, path.join(stage, to), { recursive: true, ...(filter ? { filter } : {}) })
copy(path.join(root, 'dist'), 'web', (src) => !src.endsWith('.map'))
copy(path.join(root, 'electron-dist'), 'main')

writeFileSync(
  path.join(stage, 'package.json'),
  JSON.stringify(
    {
      name: 'groovelab',
      productName: '律动工坊',
      version,
      description: '律动工坊 GrooveLab',
      main: 'main/main.cjs',
      author: 'xiaomo1231',
      license: 'UNLICENSED',
    },
    null,
    2,
  ),
)

const config = {
  appId: 'com.xiaomo1231.groovelab',
  productName: '律动工坊',
  electronVersion,
  asar: false,
  npmRebuild: false,
  nodeGypRebuild: false,
  directories: { app: stage, output: out },
  files: ['**/*'],
  win: {
    target: [{ target: 'dir', arch: ['x64'] }],
    icon: path.join(stage, 'web', 'icons', 'icon-512.png'),
    signAndEditExecutable: true,
  },
}
writeFileSync(path.join(root, 'build', 'builder.json'), JSON.stringify(config, null, 2))
execFileSync(
  process.execPath,
  [
    nm('electron-builder/cli.js'),
    '--win',
    '--x64',
    '--config',
    path.join(root, 'build', 'builder.json'),
    '--projectDir',
    stage,
  ],
  { stdio: 'inherit', cwd: root },
)

const unpacked = path.join(out, 'win-unpacked')
// The native modules go in after electron-builder (it only copies dependencies it can
// resolve itself); the app folder is not an asar archive, so they load from there.
const appDir = path.join(unpacked, 'resources', 'app')
const copyNative = (from, to) => cpSync(from, path.join(appDir, to), { recursive: true })
// onnxruntime-node: its JS and the Windows x64 binaries (DirectML included) only.
copyNative(nm('onnxruntime-node/package.json'), 'node_modules/onnxruntime-node/package.json')
copyNative(nm('onnxruntime-node/dist'), 'node_modules/onnxruntime-node/dist')
copyNative(
  nm('onnxruntime-node/bin/napi-v6/win32/x64'),
  'node_modules/onnxruntime-node/bin/napi-v6/win32/x64',
)
copyNative(nm('onnxruntime-common'), 'node_modules/onnxruntime-common')
// audify (prebuilt for Node-API) and what its loader needs.
for (const f of ['package.json', 'index.js', 'LICENSE', 'build/Release'])
  copyNative(nm(`audify/${f}`), `node_modules/audify/${f}`)
copyNative(nm('bindings'), 'node_modules/bindings')
copyNative(nm('file-uri-to-path'), 'node_modules/file-uri-to-path')
const folder = `律动工坊-${version}`
const zipDir = path.join(out, folder)
rmSync(zipDir, { recursive: true, force: true })
cpSync(unpacked, zipDir, { recursive: true })
writeFileSync(
  path.join(zipDir, '使用说明.txt'),
  [
    `律动工坊 ${version}（应用版，免安装）`,
    '',
    '1. 把整个文件夹解压到任意位置（不要直接在压缩包里运行）。',
    '2. 双击「律动工坊.exe」打开。第一次 Windows 可能提示“已保护你的电脑”：点“更多信息” → “仍要运行”。',
    '3. 数据保存在 %APPDATA%\\GrooveLab，换新版本时直接用新文件夹，数据还在。',
    '4. 和浏览器版的数据是分开的：要搬过来，在浏览器版「设置 → 数据管理」导出，再到应用里导入。',
    '',
    '应用版的不同：分轨用显卡加速（不需要本机助手）；跟唱监听可以开「低延迟」；歌曲库和歌词文件夹不用每次点允许。',
    '',
  ].join('\r\n'),
  'utf8',
)
mkdirSync(path.join(root, 'release'), { recursive: true })
const zip = path.join(root, 'release', `${folder}-win-x64.zip`)
rmSync(zip, { force: true })
// .NET's zip writer marks non-ASCII names as UTF-8 (Windows' tar cannot write Chinese names).
const ps = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:GL_SRC, $env:GL_ZIP, [System.IO.Compression.CompressionLevel]::Optimal, $true)`
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'inherit', env: { ...process.env, GL_SRC: zipDir, GL_ZIP: zip } })
console.log(`\n应用版已打包：${zip}`)
