/**
 * 谱库网页版 → its own folder (default D:\vibe coding\网页): `npm run export:web [目标文件夹]`.
 * Builds the server and the page (npm run build:server) and copies them with
 * start scripts, a config template and a README, so that folder alone can be
 * copied to the Mac mini. The student's own files there (config.env, data/,
 * anything else they put in) are left alone.
 */
import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, chmodSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dest = path.resolve(process.argv[2] ?? path.join(root, '..', '网页'))
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

execSync('npm run build:server', { cwd: root, stdio: 'inherit' })

mkdirSync(dest, { recursive: true })
// The page and the server are replaced as a whole; nothing else is removed.
rmSync(path.join(dest, 'web'), { recursive: true, force: true })
cpSync(path.join(root, 'server-dist', 'web'), path.join(dest, 'web'), { recursive: true })
cpSync(path.join(root, 'server-dist', 'server.mjs'), path.join(dest, 'server.mjs'))

const lf = (s) => s.replace(/\r\n/g, '\n')
const crlf = (s) => lf(s).replace(/\n/g, '\r\n')

const startSh = `#!/bin/bash
# 谱库网页版：读取同一文件夹里的 config.env，然后启动。
# 在 Mac 上双击「启动.command」，或在终端运行 ./start.sh；开机自启用 launchd（见 README）。
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR" || exit 1
if [ ! -f config.env ]; then
  echo "还没有 config.env：把 config.example.env 复制一份，改名为 config.env，填好谱库路径和密码。"
  [ -t 0 ] && read -r -p "按回车关闭" _
  exit 1
fi
set -a
. ./config.env
set +a
export SCORES_DATA="\${SCORES_DATA:-$DIR/data}"
# launchd 启动时没有终端的 PATH：在常见位置找 node。
NODE="$(command -v node || ls /opt/homebrew/bin/node /usr/local/bin/node 2>/dev/null | head -n 1)"
if [ -z "$NODE" ]; then
  echo "找不到 Node.js：请先安装（https://nodejs.org 的 LTS 版，或 brew install node）。"
  exit 1
fi
exec "$NODE" "$DIR/server.mjs"
`

const startBat = `@echo off
rem 谱库网页版（Windows 上测试用）：读取同一文件夹里的 config.env，然后启动。
chcp 65001 >nul
cd /d "%~dp0"
if not exist config.env (
  echo 还没有 config.env：把 config.example.env 复制一份，改名为 config.env，填好谱库路径和密码。
  pause
  exit /b 1
)
for /f "usebackq eol=# tokens=1,* delims==" %%a in ("config.env") do set "%%a=%%~b"
if not defined SCORES_DATA set "SCORES_DATA=%~dp0data"
node "%~dp0server.mjs"
pause
`

const configExample = `# 谱库网页版的设置。复制一份改名为 config.env 再填写（config.env 只放在这台电脑上，不要发给别人）。

# 谱库文件夹的完整路径（Mac 上以 / 开头；Windows 上例如 F:\\吉他谱\\吉他谱库）
SCORES_ROOT="/Users/你的名字/吉他谱库"

# 管理员账号 admin 的初始密码，至少 8 个字符（第一次启动时用它创建账号；之后在网页「我的账号」里改密码）
SCORES_PASSWORD="换成你自己的密码"

# 端口
PORT=8790

# 谁能打开：127.0.0.1 = 只有这台电脑；手机要用时填这台 Mac 的 Tailscale IP（100.x.y.z）
HOST=127.0.0.1

# 扫描缓存和登录密钥放在哪（默认是这个文件夹里的 data）
# SCORES_DATA="/Users/你的名字/.groovelab-scores"
`

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!--
  开机自动运行谱库网页版。把两处「/Users/你的名字/网页」换成这个文件夹在 Mac 上的实际位置，
  然后复制到 ~/Library/LaunchAgents/ 并运行：
    launchctl load -w ~/Library/LaunchAgents/com.groovelab.scores.plist
  密码在 config.env 里，这个文件里没有密码。
-->
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.groovelab.scores</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/Users/你的名字/网页/start.sh</string>
    </array>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/groovelab-scores.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/groovelab-scores.log</string>
</dict>
</plist>
`

const readme = `# 谱库网页版

在 Mac mini 上运行一个**只读、带账号登录**的小服务器，出门用手机也能搜谱、看谱、练习（GP 谱显示六线谱、能播放、变调和循环练习；图片谱、PDF、文本谱都能看；可以下载原文件），还能和乐队成员一起排练。

这个文件夹由律动工坊项目生成（版本 ${version}），整个文件夹拷到 Mac 上就能用。

## 文件夹里有什么

| 文件 | 作用 |
| --- | --- |
| \`server.mjs\` | 服务器本身 |
| \`web/\` | 网页 |
| \`config.example.env\` | 设置模板：复制一份改名为 \`config.env\` 再填写 |
| \`启动.command\` / \`start.sh\` | Mac 上启动（双击 \`启动.command\`） |
| \`启动.bat\` | Windows 上启动（在这台电脑上先试用） |
| \`com.groovelab.scores.plist\` | Mac 开机自动运行的配置 |
| \`data/\` | 运行后自动生成：账号、收藏、练习记录、乐队歌单、扫描缓存和登录密钥（**备份它**） |

高品质音色（MuseScore General 38 MB、FluidR3 142 MB）已包含在 \`web/alphatab/soundfont/\` 里；不想占空间可以删掉这两个 \`.sf3\` / \`.sf2\` 文件，网页里就只显示标准音色。

## 在这台 Windows 电脑上先试

1. 把 \`config.example.env\` 复制一份，改名为 \`config.env\`，填好：
   \`SCORES_ROOT="F:\\吉他谱\\吉他谱库"\`、\`SCORES_PASSWORD="至少 8 位的密码"\`。
2. 双击 \`启动.bat\`。第一次会扫描整个谱库（约一两分钟），看到「已启动」后，浏览器打开 **http://localhost:8790**，用账号登录（第一次用 admin 和 SCORES_PASSWORD）。
3. 关掉那个黑色窗口，网页就停了。

## 放到 Mac mini 上

1. **装 Node.js**：https://nodejs.org 下载 LTS 版安装（或 \`brew install node\`）。
2. **拷文件**：把谱库文件夹和这个「网页」文件夹都拷到 Mac 上（谱库也可以在一直插着的外接硬盘上）。
3. **填设置**：在 Mac 的「网页」文件夹里，把 \`config.example.env\` 复制为 \`config.env\`，填 \`SCORES_ROOT\`（Mac 上的谱库路径，例如 \`/Users/你的名字/吉他谱库\`）和密码。
4. **允许运行**：在终端里进入这个文件夹，运行一次：
   \`\`\`bash
   chmod +x start.sh 启动.command
   \`\`\`
5. **试一下**：双击 \`启动.command\`，Mac 上的浏览器打开 http://127.0.0.1:8790 。

## 在外面用手机打开（Tailscale）

1. Mac 和手机都装 **Tailscale**，用同一个账号登录。
2. 在 Mac 上查它的 Tailscale IP：终端运行 \`tailscale ip -4\`（类似 \`100.x.y.z\`）。
3. 把 \`config.env\` 里的 \`HOST\` 改成这个 IP，重新启动。
4. 手机打开 \`http://Mac的名字:8790\`（或 \`http://100.x.y.z:8790\`），用账号登录（第一次用 admin 和 SCORES_PASSWORD）。

Tailscale 只在你自己的设备之间建立加密通道。**不要在路由器上做端口转发**，那样整个互联网都能看到这个登录页。

## 开机自动运行

1. 打开 \`com.groovelab.scores.plist\`，把里面的 \`/Users/你的名字/网页\` 换成这个文件夹在 Mac 上的实际位置。
2. 运行：
   \`\`\`bash
   cp com.groovelab.scores.plist ~/Library/LaunchAgents/
   launchctl load -w ~/Library/LaunchAgents/com.groovelab.scores.plist
   \`\`\`
3. 停止并取消自启：\`launchctl unload -w ~/Library/LaunchAgents/com.groovelab.scores.plist\`。运行记录在 \`/tmp/groovelab-scores.log\`。

## 账号和乐队

- 第一次启动会自动创建管理员账号：用户名 \`admin\`，密码是 \`config.env\` 里的 \`SCORES_PASSWORD\`。登录后在「我的账号」里改掉它。
- 在「成员」页给乐队成员建账号：可以选「可看完整谱库」，不选的话他只能看乐队歌单里的谱子。
- 成员要从外面访问，推荐在 Tailscale 里把这台 Mac「共享」给他的 Tailscale 账号（Share machine），仍然**不要做端口转发**。
- 「乐队」页：排练歌单、给每首歌分配声部（成员打开时自动显示自己的声部并静音它）、统一排练速度、备注、每人的练习进度。
- 「找乐队谱」：服务器第一次启动后会在后台把所有 GP 谱的音轨读一遍（几万个文件约半小时），期间网页照常可用，读完的结果保存在 \`data/\` 里。
- 「一起播放」：大家打开同一首歌，一个人点「成为主控」，他按播放 / 暂停时，所有人的谱子同时开始和停下。

## 加了新谱子之后

在网页右上角点「重新扫描」（↻）。

## 更新网页版

在律动工坊项目里运行 \`npm run export:web\`，会重新生成并覆盖这里的 \`server.mjs\` 和 \`web/\`，你的 \`config.env\` 和 \`data/\` 不会被动。然后把新的文件拷到 Mac 上，重启一次。

## 安全

- 只读：不上传、不修改、不删除谱库里的任何文件。
- 每个页面和文件都要先登录；连续输错 5 次要等 10 分钟。
- 只能访问谱库文件夹里的文件。
- 想让所有已登录的设备都退出：删除 \`data/secret\`，再重启。
`

const write = (name, text, mode) => {
  const file = path.join(dest, name)
  writeFileSync(file, text, 'utf8')
  if (mode) {
    try {
      chmodSync(file, mode)
    } catch {
      // Windows: the Mac needs chmod +x once (README)
    }
  }
}
write('start.sh', lf(startSh), 0o755)
write('启动.command', lf(startSh), 0o755)
write('启动.bat', crlf(startBat))
write('config.example.env', lf(configExample))
write('com.groovelab.scores.plist', lf(plist))
write('README.md', lf(readme))
if (!existsSync(path.join(dest, 'config.env'))) console.log('提示：还没有 config.env，复制 config.example.env 改名后填写。')
console.log(`\n谱库网页版 ${version} → ${dest}`)
