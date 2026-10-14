/**
 * 把打包好的应用版同步到本机的固定文件夹（默认 D:\1）：`npm run install:local`
 * （先 `npm run package`）。应用自己的文件和 build/app-out/律动工坊-<版本> 保持一致
 * （新文件复制过去，旧版本多出来的删掉）；用户自己放进这个文件夹的东西（第一层里
 * 应用没有的文件和文件夹，例如「原曲」）一律不动。用户数据在 %APPDATA%\GrooveLab。
 *
 *   node scripts/install-local.mjs [目标文件夹]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const src = path.join(root, 'build', 'app-out', `律动工坊-${version}`)
const dest = process.argv[2] ?? 'D:\\1'

if (!existsSync(path.join(src, '律动工坊.exe'))) {
  console.error(`没有找到 ${version} 的打包结果（${src}）。先运行 npm run package。`)
  process.exit(1)
}

// The running app locks its files: ask to close it rather than half-copying.
try {
  const running = execFileSync('tasklist', ['/FI', 'IMAGENAME eq 律动工坊.exe', '/NH'], { encoding: 'utf8' })
  if (running.includes('律动工坊.exe')) {
    console.error('律动工坊正在运行，请先关掉再同步。')
    process.exit(1)
  }
} catch {
  // tasklist unavailable: robocopy reports locked files itself
}

// The student's own things at the top of the folder (not part of the app): left out of the mirror.
const appTop = new Set(readdirSync(src).map((n) => n.toLowerCase()))
const own = existsSync(dest) ? readdirSync(dest, { withFileTypes: true }).filter((d) => !appTop.has(d.name.toLowerCase())) : []
const keepDirs = own.filter((d) => d.isDirectory()).map((d) => path.join(dest, d.name))
const keepFiles = own.filter((d) => !d.isDirectory()).map((d) => path.join(dest, d.name))
if (own.length) console.log(`保留你自己放的：${own.map((d) => d.name).join('、')}`)

// robocopy /MIR: mirror the app's files (exit codes below 8 mean success).
try {
  const args = [src, dest, '/MIR', '/NFL', '/NDL', '/NJH', '/NP', '/R:2', '/W:1']
  if (keepDirs.length) args.push('/XD', ...keepDirs)
  if (keepFiles.length) args.push('/XF', ...keepFiles)
  execFileSync('robocopy', args, { stdio: 'inherit' })
} catch (e) {
  const code = e?.status ?? 16
  if (code >= 8) {
    console.error(`同步失败（robocopy 返回 ${code}）。`)
    process.exit(1)
  }
}
console.log(`\n已同步 律动工坊 ${version} → ${dest}`)
