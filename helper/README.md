# 律动工坊 · 本机分轨助手

让网站里的「自动分轨」用这台电脑的显卡、用 UVR（Ultimate Vocal Remover）自己的引擎来分轨：速度快、音质好。不装它也能用——网站会改为在浏览器里分轨（慢一些）。

## 安装（只需一次）

双击 `helper\install.bat`。它会：

1. 用 Python 安装管理器 `py` 安装 Python 3.12（不影响电脑上已有的其它 Python）；
2. 在 `helper\.venv` 建一个独立环境；
3. 安装 [audio-separator](https://github.com/nomadkaraoke/python-audio-separator)（UVR 的后端库，MIT 许可）和 PyTorch（有 NVIDIA 显卡时装 CUDA 版）。

大约 3–4 GB。第一次分轨时会自动下载模型（约 1 GB）到 `helper\models`。读 mp3 / m4a 需要 ffmpeg（`winget install Gyan.FFmpeg`）。

## 使用

装好以后，用项目根目录的 `Start.bat` 启动网站时会自动在后台开启助手（最小化的「GrooveLab helper」窗口）。也可以单独运行 `helper\start.bat`。

网站的「自动分轨」对话框会显示「本机加速：已连接」。

## 它做什么

- 只监听本机 `127.0.0.1:5175`，只接受来自 `http://localhost:5174` 的网页请求。
- 先用 BS-RoFormer（UVR 里最好的人声模型）分出人声和伴奏，再用 htdemucs_6s 把伴奏分成鼓、贝斯、吉他、钢琴、其它。
- 歌曲和结果只保存在 `helper\jobs`（只保留最近几次），不联网上传。

## 致谢

分轨引擎与模型来自 Ultimate Vocal Remover 项目（Anjok07 等，MIT）和 audio-separator（MIT）；htdemucs_6s 来自 Meta 的 Demucs（MIT）。
