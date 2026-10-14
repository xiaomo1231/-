"""
Makes the pitch models for GrooveLab (0.24.0).

    helper\\.venv\\Scripts\\python.exe -I scripts\\make-pitch-models.py <rmvpe.onnx> <swift_f0 model.onnx>

1. RMVPE (vocal pitch in polyphonic music; code Apache-2.0, weights as
   released by the RVC project under MIT): rmvpe.onnx (~362 MB,
   https://huggingface.co/lj1995/VoiceConversionWebUI) with its weights stored
   as float16 (computed in float32) → public/models/pitch-rmvpe-fp16.onnx.
2. SwiftF0 (MIT, https://github.com/lars76/swift-f0): copies its model.onnx
   (from the swift-f0 wheel) → public/models/pitch-swiftf0.onnx.
3. Runs the original RMVPE on a test signal and writes tests/fixtures/rmvpe.json — the mel spectrogram and pitch the page's
   JavaScript must reproduce (tests/pitchModels.test.ts).

Needs the helper's Python environment (numpy, librosa, onnx, onnxruntime).
"""
import json
import os
import shutil
import sys

import librosa
import numpy as np
import onnx
import onnxruntime as ort

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_RMVPE = os.path.join(ROOT, "public", "models", "pitch-rmvpe-fp16.onnx")
OUT_SWIFT = os.path.join(ROOT, "public", "models", "pitch-swiftf0.onnx")
FIXTURE = os.path.join(ROOT, "tests", "fixtures", "rmvpe.json")

SR, N_FFT, HOP, N_MELS, FMIN, FMAX = 16000, 1024, 160, 128, 30, 8000


def test_signal() -> np.ndarray:
    """2.5 s: 0.3 s silence, a voice-like tone sliding A3 → E4 with vibrato, 0.3 s silence (same recipe in the JS test)."""
    t = np.arange(int(2.5 * SR)) / SR
    midi = 57 + 7 * np.clip((t - 0.3) / 1.9, 0, 1) + 0.3 * np.sin(2 * np.pi * 5.5 * t)
    f = 440 * 2 ** ((midi - 69) / 12)
    phase = 2 * np.pi * np.cumsum(f) / SR
    x = sum(np.sin(k * phase) / k for k in range(1, 9)) * 0.2
    x[(t < 0.3) | (t > 2.2)] = 0
    return x.astype(np.float32)


def mel_spec(x: np.ndarray) -> np.ndarray:
    """As RVC's MelSpectrogram: reflect pad, periodic Hann, |STFT|, HTK mel (Slaney norm), log(clamp 1e-5)."""
    pad = np.pad(x, (N_FFT // 2, N_FFT // 2), mode="reflect")
    win = np.hanning(N_FFT + 1)[:-1]
    frames = 1 + (len(pad) - N_FFT) // HOP
    mag = np.empty((N_FFT // 2 + 1, frames), dtype=np.float64)
    for i in range(frames):
        mag[:, i] = np.abs(np.fft.rfft(pad[i * HOP : i * HOP + N_FFT] * win))
    basis = librosa.filters.mel(sr=SR, n_fft=N_FFT, n_mels=N_MELS, fmin=FMIN, fmax=FMAX, htk=True)
    return np.log(np.maximum(basis @ mag, 1e-5)).astype(np.float32)


def run(path: str, mel: np.ndarray) -> np.ndarray:
    s = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    n = mel.shape[1]
    padded = np.pad(mel, ((0, 0), (0, 32 * ((n - 1) // 32 + 1) - n)))
    return s.run(None, {s.get_inputs()[0].name: padded[None]})[0][0, :n]


def decode(hidden: np.ndarray, thred: float = 0.03) -> np.ndarray:
    cents_map = np.pad(20 * np.arange(360) + 1997.3794084376191, (4, 4))
    sal = np.pad(hidden, ((0, 0), (4, 4)))
    c = np.argmax(hidden, axis=1) + 4
    out = np.zeros(len(hidden))
    for i in range(len(hidden)):
        w = sal[i, c[i] - 4 : c[i] + 5]
        cents = (w * cents_map[c[i] - 4 : c[i] + 5]).sum() / w.sum()
        out[i] = 0 if sal[i].max() <= thred else 10 * 2 ** (cents / 1200)
    return out


def fp16_weights(model: onnx.ModelProto) -> onnx.ModelProto:
    """Store large float32 initializers as float16 and add a Cast back to float32 (compute stays float32)."""
    from onnx import TensorProto, helper, numpy_helper

    g = model.graph
    casts = []
    keep = []
    for init in g.initializer:
        if init.data_type == TensorProto.FLOAT and np.prod(init.dims) >= 1024:
            arr = numpy_helper.to_array(init).astype(np.float16)
            half_name = init.name + "__fp16"
            keep.append(numpy_helper.from_array(arr, half_name))
            casts.append(helper.make_node("Cast", [half_name], [init.name], to=TensorProto.FLOAT, name=init.name + "__cast"))
        else:
            keep.append(init)
    del g.initializer[:]
    g.initializer.extend(keep)
    nodes = list(g.node)
    del g.node[:]
    g.node.extend(casts + nodes)
    return model


def main() -> int:
    src_rmvpe, src_swift = sys.argv[1], sys.argv[2]
    os.makedirs(os.path.dirname(OUT_RMVPE), exist_ok=True)
    # Weights stored as float16 (half the size), computed in float32: every weight is
    # cast back when the model loads. RMVPE's GRU runs ~10× faster on the processor than
    # with DirectML, and onnxruntime has no float16 kernels on the processor.
    half = fp16_weights(onnx.load(src_rmvpe))
    onnx.save(half, OUT_RMVPE)
    shutil.copyfile(src_swift, OUT_SWIFT)
    print("wrote", OUT_RMVPE, round(os.path.getsize(OUT_RMVPE) / 1e6, 1), "MB;", OUT_SWIFT, os.path.getsize(OUT_SWIFT), "bytes")

    # Reference from the original (float32) model on the CPU; the half-precision copy is checked
    # where it runs (onnxruntime-node / DirectML in the app: tests/pitchModels.test.ts).
    x = test_signal()
    mel = mel_spec(x)
    f32 = decode(run(src_rmvpe, mel))
    print("frames", len(f32), "voiced", int((f32 > 0).sum()))
    os.makedirs(os.path.dirname(FIXTURE), exist_ok=True)
    with open(FIXTURE, "w", encoding="utf-8") as fh:
        json.dump({"frames": int(mel.shape[1]), "melFrames": {str(i): [round(float(v), 4) for v in mel[:, i]] for i in (0, 60, 120, 200, 249)}, "f0": [round(float(v), 2) for v in f32]}, fh)
    print("wrote", FIXTURE)
    return 0


if __name__ == "__main__":
    sys.exit(main())
