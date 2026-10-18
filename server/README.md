# 谱库服务器（Mac mini 上运行，手机随时打开）

这是一个**只读**的小服务。它把你电脑上的吉他谱库（一个文件夹）通过网页提供给你自己的浏览器，
在外面用手机也能查歌、打开谱子。

## 它做什么，不做什么

- **只读**：不上传、不修改、不删除谱库里的任何文件。
- **账号登录**：每个页面和每个文件都需要先登录。第一次启动自动创建管理员 `admin`（密码为 `SCORES_PASSWORD`），其他成员由管理员在网页「成员」页创建；不能看完整谱库的成员只能打开乐队歌单里的谱子。登录后浏览器保存一个 30 天有效的 cookie，改密码会让其他设备退出。
- **文件不离开这台 Mac**：谱子只会发给你自己的浏览器，服务器不会把它们交给任何第三方。
- **外网访问走 Tailscale**：Tailscale 是一个只在你自己的设备之间建立的加密通道。**不要在路由器上做端口转发**，那样整个互联网都能访问到这个服务。

## 准备工作

- 一台 Mac mini（常开通电）和你的手机。
- Mac 上的 Node.js 20 或更新版本。
- 谱库文件夹（例如 `/Users/你的名字/吉他谱库`）。外接硬盘上的文件夹也可以，但硬盘需要一直连着。

---

## 第一步：安装 Node.js

任选一种方式：

- 官网安装包：打开 https://nodejs.org ，下载 **LTS** 版本，双击安装。
- 或者用 Homebrew（如果你已经装了 Homebrew）：
  ```bash
  brew install node
  ```

在终端里确认版本：

```bash
node -v        # 应显示 v20 或更高
which node     # 记下这个路径，后面写 launchd 配置要用
```

## 第二步：把谱库放到 Mac 上

把整个谱库文件夹复制到 Mac（例如 `/Users/你的名字/吉他谱库`），或者直接放在外接硬盘上。
文件夹里的分类结构保持不变，服务会按文件夹层级来整理。

## 第三步：在 Windows 上构建服务器包

在开发用的 Windows 电脑上，进入项目文件夹，运行：

```bash
npm run build:server
```

完成后会生成 `server-dist/` 文件夹，里面有 `server.mjs`（服务本身）和 `web/`（网页）。
把整个 `server-dist` 文件夹复制到 Mac，例如 `/Users/你的名字/groovelab/server-dist`。

> 也可以把整个项目复制到 Mac，在 Mac 上运行 `npm install` 和 `npm run build:server`，效果一样。

## 第四步：手动启动一次，确认能用

在 Mac 的终端里运行（把尖括号里的内容换成你自己的）：

```bash
SCORES_ROOT=/Users/你的名字/吉他谱库 \
SCORES_PASSWORD=至少八个字符的密码 \
HOST=100.x.y.z \
node /Users/你的名字/groovelab/server-dist/server.mjs
```

- `100.x.y.z` 是这台 Mac 的 Tailscale IP（第六步会讲怎么查）。第一次运行时可以先写 `127.0.0.1`，只在本机测试。
- 第一次启动会扫描整个谱库，文件多时（约 11 万个文件）可能需要几分钟，终端里会显示进度。扫描结果会缓存下来，之后启动很快。
- 看到 `已启动：http://…` 就说明服务在运行。按 `Control + C` 可以停止。

在同一台 Mac 的浏览器里打开 `http://127.0.0.1:8790` 试一下，输入密码即可。

### 配置项一览

| 环境变量          | 必填 | 默认值                | 说明                                                                                |
| ----------------- | ---- | --------------------- | ----------------------------------------------------------------------------------- |
| `SCORES_ROOT`     | 是   | 无                    | 谱库文件夹的**绝对路径**（以 `/` 开头）                                             |
| `SCORES_PASSWORD` | 是   | 无                    | 管理员 admin 的初始密码，**至少 8 个字符**（已有账号后不再使用）                      |
| `PORT`            | 否   | `8790`                | 端口                                                                                |
| `HOST`            | 否   | `127.0.0.1`           | 监听的地址。只给本机用时保持默认；要让手机访问，填 Tailscale IP（推荐）或 `0.0.0.0` |
| `SCORES_DATA`     | 否   | `~/.groovelab-scores` | 保存扫描缓存（`library-cache.json`）和登录密钥（`secret`）的文件夹                  |

如果配置不对，服务会直接退出并用中文告诉你哪一项有问题。

## 第五步：开机自动运行（launchd）

### 1. 创建配置文件

新建 `~/Library/LaunchAgents/com.groovelab.scores.plist`，内容如下。
把所有 `你的名字`、路径、密码和 IP 换成你自己的：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.groovelab.scores</string>

    <key>ProgramArguments</key>
    <array>
        <!-- 第一步里 which node 的结果；Homebrew 通常是 /opt/homebrew/bin/node，官网安装包通常是 /usr/local/bin/node -->
        <string>/opt/homebrew/bin/node</string>
        <string>/Users/你的名字/groovelab/server-dist/server.mjs</string>
    </array>

    <key>EnvironmentVariables</key>
    <dict>
        <key>SCORES_ROOT</key>
        <string>/Users/你的名字/吉他谱库</string>
        <key>SCORES_PASSWORD</key>
        <string>至少八个字符的密码</string>
        <key>PORT</key>
        <string>8790</string>
        <key>HOST</key>
        <string>100.x.y.z</string>
        <key>SCORES_DATA</key>
        <string>/Users/你的名字/.groovelab-scores</string>
    </dict>

    <!-- 退出后自动重启 -->
    <key>KeepAlive</key>
    <true/>
    <!-- 登录后自动启动 -->
    <key>RunAtLoad</key>
    <true/>

    <key>StandardOutPath</key>
    <string>/Users/你的名字/.groovelab-scores/server.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/你的名字/.groovelab-scores/server.log</string>
    <key>WorkingDirectory</key>
    <string>/Users/你的名字/groovelab</string>
</dict>
</plist>
```

因为配置里写着密码，建议收紧文件权限：

```bash
chmod 600 ~/Library/LaunchAgents/com.groovelab.scores.plist
mkdir -p ~/.groovelab-scores
```

### 2. 加载并启动

```bash
launchctl load -w ~/Library/LaunchAgents/com.groovelab.scores.plist
```

查看是否在运行：

```bash
launchctl list | grep groovelab
tail -n 20 ~/.groovelab-scores/server.log
```

停止并取消自动启动：

```bash
launchctl unload -w ~/Library/LaunchAgents/com.groovelab.scores.plist
```

修改了 plist 或 `server-dist` 之后，先 `unload` 再 `load`。

## 第六步：在外面用手机访问（Tailscale）

1. 在 **Mac** 和 **手机** 上都安装 Tailscale（Mac 版在 App Store 或 https://tailscale.com 下载；手机版在对应应用商店）。
2. 两台设备用**同一个账号**登录 Tailscale。
3. 在 Mac 上查 IP，并记下 Mac 的名字：
   ```bash
   tailscale ip -4      # 类似 100.x.y.z，填进 HOST
   ```
   Tailscale 的菜单里也能看到这台 Mac 的名字（例如 `mac-mini`）。
4. 手机用 Safari 或 Chrome 打开：
   ```
   http://mac-mini:8790
   ```
   或者直接用 IP：`http://100.x.y.z:8790`。输入密码即可。

Tailscale 会把两台设备之间的全部流量加密，所以即使地址是 `http://` 开头，数据在外网上也是加密传输的。

**请不要做的事**：

- 不要在路由器上设置端口转发（port forwarding）到 8790 端口。那样互联网上任何人都能尝试访问这个服务。
- 不要把 `SCORES_PASSWORD` 发给别人，也不要把它写进可以公开的地方。

## 添加了新的谱子之后

服务在启动时只读缓存，**不会自动发现新文件**。有两种办法：

- **在网页里**点「重新扫描」（如果页面上有这个按钮）。扫描在后台进行，不影响正在看的谱子。
- **或者在 Mac 上**删除缓存，然后重启服务：
  ```bash
  rm ~/.groovelab-scores/library-cache.json
  launchctl unload -w ~/Library/LaunchAgents/com.groovelab.scores.plist
  launchctl load -w ~/Library/LaunchAgents/com.groovelab.scores.plist
  ```
  （如果是手动启动的，直接按 `Control + C` 再重新运行即可。）

## 让所有设备退出登录

浏览器里的登录保存 30 天。想让所有设备立刻失效，删除 `secret` 文件后重启服务：

```bash
rm ~/.groovelab-scores/secret
```

下次启动会生成新的密钥，之前的登录全部失效。

## 常见问题

| 现象                                                    | 处理                                                                                          |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 启动就退出，提示缺少 `SCORES_ROOT` 或 `SCORES_PASSWORD` | 检查环境变量，密码至少 8 个字符                                                               |
| 提示 `SCORES_ROOT 不是一个存在的文件夹`                 | 检查路径是否正确（外接硬盘是否连着）                                                          |
| 提示 `EADDRINUSE` 或端口占用                            | 另一个程序占用了 8790，改 `PORT` 或关掉旧的服务                                               |
| 手机打不开                                              | 确认 Mac 和手机都在 Tailscale 里并且都已连接；确认 `HOST` 填的是 Tailscale IP（或 `0.0.0.0`） |
| 输入密码后提示「尝试次数太多」                          | 同一个地址 10 分钟内密码错了 5 次，等 10 分钟再试                                             |
| 页面显示「谱库正在扫描」                                | 第一次扫描或重新扫描还没完成，稍等                                                            |
| 网页显示「网页还没有构建」                              | `server-dist/web` 缺失，在 Windows 上重新运行 `npm run build:server` 并复制过来               |
