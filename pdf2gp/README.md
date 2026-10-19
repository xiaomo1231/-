# PDF 转谱（实验）

把**文字版**六线谱 PDF 转成 Guitar Pro 5（`.gp5`）文件，供谱库网页版在网页上点「转换」时调用。它只在用户点击时才运行，只处理那一个文件。

- 来源：[PDF-to-GP5](https://github.com/F100Pilot/PDF-to-GP5)（作者 F100Pilot，MIT 许可证，见 `LICENSE-PDF-to-GP5.txt`）。本目录只取了其中的转换核心（`pdf2gp5/`），并加上了命令行入口 `convert_cli.py`。
- 能识别：PDF 里有文字的六线谱（文字 tab，以及 Guitar Pro、MuseScore、TuxGuitar 等软件导出的谱）。
- **不能识别**：扫描的图片、拍照的谱、纯图形的 PDF。本目录没有装 OCR（光学字符识别），遇到这类文件会提示「暂时无法自动识别」，不会报错崩溃。
- 五线谱、简谱、歌词谱不是六线谱，会提示「没有找到六线谱」。

## 相对原项目删去的部分

YouTube 与音频下载、网页服务器（`main.py`、启动器、安装器）、曲库存储、封面、沙箱、在线状态、缓存、打包与配置文件（`config.py`、`bundled.py`）。`youtube.py`、`audio_download.py` 等一律没有带进来。

## 安装

需要 **Python 3.11 或更高版本**，在这台电脑上运行一次：

- Mac / Linux：在终端进入本文件夹，运行 `./setup.sh`（第一次需要 `chmod +x setup.sh`）。
- Windows：双击 `setup.bat`（或在命令行运行）。

安装会在本文件夹里建立 `.venv/`（约 60 MB），只装 `requirements.txt` 里的几个包。不装也不影响谱库网页版的其它功能。

## 命令行用法

```bash
python convert_cli.py 输入.pdf 输出.gp5
```

标准输出为一行 JSON。成功时：`{"ok": true, "bars": 236, "tracks": [...], "warnings": [...], "title": "...", "artist": "..."}`。失败时：`{"ok": false, "kind": "image" | "no-tab" | "invalid" | "too-big" | "error", "message": "..."}`，退出码为 2。

限制：输入不超过 30 MB，最多 40 页；超过 120 秒由调用方结束进程。
