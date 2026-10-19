"""Command line for the PDF -> GP5 conversion, run by the score server (see README.md).

usage: python convert_cli.py <input.pdf> <output.gp5>

Prints ONE line of JSON to stdout. Success: {"ok": true, "bars", "tracks", "warnings", "title", "artist"}.
Failure: {"ok": false, "kind": "image" | "no-tab" | "invalid" | "too-big" | "error", "message"} and exit code 2.
Reads only the one file it is given; writes only the one output file.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pdf2gp5 import i18n  # noqa: E402
from pdf2gp5.converter import (  # noqa: E402
    ConversionError,
    ConversionOptions,
    InvalidFileError,
    NoTabError,
    OcrNeededError,
    TooBigError,
    convert,
)

MAX_INPUT_BYTES = 30 * 1024 * 1024

MESSAGES = {
    "image": "这是扫描图片做成的 PDF，暂时无法自动识别。",
    "no-tab": "这份 PDF 里没有找到六线谱（可能是五线谱、简谱或歌词谱）。",
    "invalid": "PDF 文件损坏或无法读取。",
    "too-big": "PDF 太大（超过 30 MB 或页数过多），暂时无法转换。",
}


def fail(kind: str, message: str) -> int:
    print(json.dumps({"ok": False, "kind": kind, "message": message}, ensure_ascii=False))
    return 2


def translate_warning(text: str) -> str:
    """Chinese for the warnings this tool meets often; other warnings stay as the converter wrote them."""
    match = re.match(r"Pages that are pictures were skipped \(no OCR\): (.*)\.$", text)
    if match:
        return f"第 {match.group(1)} 页是图片，已跳过（不做 OCR）。"
    match = re.match(r"Bars not found in the PDF, filled with rests: (.*)\.$", text)
    if match:
        return f"PDF 中找不到第 {match.group(1)} 小节，已用休止符补齐。"
    match = re.match(r"(\d+) tab line\(s\) with a number of strings other than (\d+) were ignored\.$", text)
    if match:
        return f"{match.group(1)} 行 tab 的弦数不是 {match.group(2)}，已忽略。"
    return text


def main(argv: list[str]) -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    if len(argv) != 3:
        return fail("error", "用法：python convert_cli.py <输入.pdf> <输出.gp5>")
    source, target = Path(argv[1]), Path(argv[2])
    try:
        size = os.path.getsize(source)
    except OSError:
        return fail("error", "找不到输入文件。")
    if size > MAX_INPUT_BYTES:
        return fail("too-big", MESSAGES["too-big"])
    pdf = source.read_bytes()
    i18n.use("en")  # the converter's own messages, in English (they are mapped to Chinese below)
    try:
        result = convert(pdf, ConversionOptions(expand_repeats=False, max_pages=40))
    except OcrNeededError:
        return fail("image", MESSAGES["image"])
    except NoTabError:
        return fail("no-tab", MESSAGES["no-tab"])
    except InvalidFileError:
        return fail("invalid", MESSAGES["invalid"])
    except TooBigError:
        return fail("too-big", MESSAGES["too-big"])
    except ConversionError as exc:
        return fail("error", f"转换失败：{exc}")
    except Exception as exc:  # the converter should not raise anything else; keep the JSON contract anyway
        return fail("error", f"转换出错：{type(exc).__name__}")
    target.write_bytes(result.gp5)
    report = result.report
    print(
        json.dumps(
            {
                "ok": True,
                "bars": report["measures"],
                "tracks": [track["name"] for track in report["tracks"]],
                "warnings": [translate_warning(w) for w in report["warnings"]],
                "title": report["title"] or "",
                "artist": report["artist"] or "",
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
