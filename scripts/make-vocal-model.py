"""
Makes the in-browser vocals model (half precision) for GrooveLab.

    helper\\.venv\\Scripts\\python.exe -I scripts\\make-vocal-model.py

1. Downloads UVR-MDX-NET-Voc_FT.onnx (UVR's public model repository on
   GitHub, ~67 MB) into helper/models/ when it is not there yet.
2. Converts it to float16 compute with float32 input / output and writes
   public/models/vocals-mdx-fp16.onnx (~33 MB), which the site ships.

Needs the helper's Python environment (onnx + onnxruntime are installed there).
"""
import os
import sys
import urllib.request

import onnx
from onnxruntime.transformers.float16 import convert_float_to_float16

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Voc_FT.onnx"
SRC = os.path.join(ROOT, "helper", "models", "UVR-MDX-NET-Voc_FT.onnx")
OUT = os.path.join(ROOT, "public", "models", "vocals-mdx-fp16.onnx")


def main() -> int:
    if not os.path.exists(SRC):
        os.makedirs(os.path.dirname(SRC), exist_ok=True)
        print("downloading", URL)
        urllib.request.urlretrieve(URL, SRC)
    model = onnx.load(SRC)
    half = convert_float_to_float16(model, keep_io_types=True)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    onnx.save(half, OUT)
    print("wrote", OUT, round(os.path.getsize(OUT) / 1e6, 1), "MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
