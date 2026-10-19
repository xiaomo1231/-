#!/bin/bash
# PDF 转谱（实验）的 Python 环境：在 pdf2gp/.venv 里安装 requirements.txt。只需运行一次。
# 用法：在终端里运行 ./setup.sh（Mac 或 Linux）。需要 Python 3.11 或更高版本。
cd "$(dirname "$0")" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  echo "找不到 python3。请先安装 Python 3.11 或更高版本（https://www.python.org ，或 brew install python@3.12）。"
  exit 1
fi
if ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'; then
  echo "需要 Python 3.11 或更高版本，这台电脑上的 python3 版本太旧：$(python3 -V)。"
  exit 1
fi

if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv || { echo "无法创建虚拟环境 pdf2gp/.venv。"; exit 1; }
fi
.venv/bin/python -m pip install --upgrade pip >/dev/null || { echo "无法更新 pip（请检查网络连接）。"; exit 1; }
.venv/bin/python -m pip install -r requirements.txt || { echo "安装失败，请检查网络连接后重新运行 ./setup.sh。"; exit 1; }
echo "PDF 转谱环境已安装完成。"
