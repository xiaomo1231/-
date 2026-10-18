"""
Makes the vocals separation model BS-RoFormer for the GrooveLab app (0.29.0).

    helper\\.venv\\Scripts\\python.exe -I scripts\\make-roformer-model.py

Takes BS-RoFormer (viperx, model_bs_roformer_ep_317_sdr_12.9755, the model the
本机分轨助手 already downloads into helper/models) and exports the network
between the STFT and the mask to ONNX, with weights stored as float16 (computed
in float32) → public/models/vocals-roformer-fp16.onnx. The app does the STFT,
the mask multiply and the inverse STFT itself (audio/separation/roformer.ts).

Input  x:    (1, 801, 4100) float32: STFT frames (n_fft 2048, hop 441, Hann,
             centred / reflect-padded), per frame [f0 L re, f0 L im, f0 R re,
             f0 R im, f1 L re, ...] (frequency-major, stereo inner, re/im last).
Output mask: (1, 801, 4100) float32, same layout; vocals = stft × mask (complex).

Writes tests/fixtures/roformer.json: a short test signal's STFT frames and the
mask the original model gives, which the app's JavaScript must reproduce.

Needs the helper's Python environment (torch, audio-separator, onnx, onnxruntime).
"""
import json
import os
import sys
import types

import numpy as np
import onnx
import onnxruntime as ort
import torch
import yaml
from einops import pack, rearrange, unpack

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from importlib import import_module  # noqa: E402

fp16_weights = import_module("make-pitch-models").fp16_weights
from audio_separator.separator.uvr_lib_v5.roformer.bs_roformer import BSRoformer  # noqa: E402

NAME = "model_bs_roformer_ep_317_sdr_12.9755"
CKPT = os.path.join(ROOT, "helper", "models", NAME + ".ckpt")
CFG = os.path.join(ROOT, "helper", "models", NAME + ".yaml")
TMP = os.path.join(ROOT, "helper", "models", "vocals-roformer-f32.onnx")
OUT = os.path.join(ROOT, "public", "models", "vocals-roformer-fp16.onnx")
FIXTURE = os.path.join(ROOT, "tests", "fixtures", "roformer.json")
N_FFT, HOP, FRAMES = 2048, 441, 801


class Core(torch.nn.Module):
    """BSRoformer.forward between the STFT and the complex mask multiply."""

    def __init__(self, net):
        super().__init__()
        self.net = net

    def forward(self, x):
        net = self.net
        x = net.band_split(x)
        for block in net.layers:
            if len(block) == 3:
                lin, tt, ft = block
                x, ps0 = pack([x], "b * d")
                x = lin(x)
                (x,) = unpack(x, ps0, "b * d")
            else:
                tt, ft = block
            x = rearrange(x, "b t f d -> b f t d")
            x, ps = pack([x], "* t d")
            x = tt(x)
            (x,) = unpack(x, ps, "* t d")
            x = rearrange(x, "b f t d -> b t f d")
            x, ps = pack([x], "* f d")
            x = ft(x)
            (x,) = unpack(x, ps, "* f d")
        x = net.final_norm(x)
        return net.mask_estimators[0](x)


def attend_matmul(self, q, k, v):
    scale = self.scale if self.scale is not None else q.shape[-1] ** -0.5
    attn = (torch.matmul(q, k.transpose(-1, -2)) * scale).softmax(dim=-1)
    return torch.matmul(attn, v)


def frames_of(audio: torch.Tensor) -> torch.Tensor:
    """(2, n) audio → (1, frames, 4100) model input."""
    st = torch.stft(audio, n_fft=N_FFT, hop_length=HOP, win_length=N_FFT, window=torch.hann_window(N_FFT), center=True, return_complex=True)
    st = rearrange(torch.view_as_real(st), "s f t c -> 1 (f s) t c")
    return rearrange(st, "b f t c -> b t (f c)")


def main() -> int:
    cfg = yaml.load(open(CFG), Loader=yaml.FullLoader)
    m = cfg["model"]
    m["flash_attn"] = False
    model = BSRoformer(**m)
    state = torch.load(CKPT, map_location="cpu", weights_only=False)
    model.load_state_dict(state.get("state_dict", state) if isinstance(state, dict) else state)
    model.eval()
    # Attention as plain MatMul + Softmax (the non-flash path is written with einsum,
    # which DirectML runs slowly and less exactly).
    for mod in model.modules():
        if type(mod).__name__ == "Attend":
            mod.forward = types.MethodType(attend_matmul, mod)
    core = Core(model).eval()

    # A test signal the app's test can rebuild exactly: a vibrato tone with harmonics,
    # a little quieter on the right.
    n = HOP * (FRAMES - 1)
    t = torch.arange(n, dtype=torch.float64) / 44100
    f0 = 220 * 2 ** (0.3 * torch.sin(2 * torch.pi * 5 * t) / 12)
    phase = 2 * torch.pi * torch.cumsum(f0, 0) / 44100
    tone = sum(torch.sin(k * phase) / k for k in range(1, 8)) * 0.2
    audio = torch.stack([tone, tone * 0.8]).float()
    with torch.no_grad():
        x = frames_of(audio)
        mask = core(x)
        # The wrapper must match the full model.
        full = model(audio[None])[0]
        st = rearrange(x, "b t (f c) -> b f t c", c=2)
        mk = rearrange(mask, "b t (f c) -> b f t c", c=2)
        y = rearrange(torch.view_as_complex(st.contiguous()) * torch.view_as_complex(mk.contiguous()), "1 (f s) t -> s f t", s=2)
        y = torch.istft(y, n_fft=N_FFT, hop_length=HOP, win_length=N_FFT, window=torch.hann_window(N_FFT), center=True, length=n)
        print("wrapper vs model: max diff", float((y - full).abs().max()), "peak", float(full.abs().max()))
        torch.onnx.export(core, (x,), TMP, input_names=["x"], output_names=["mask"], opset_version=17, dynamo=False)

    half = fp16_weights(onnx.load(TMP))
    onnx.save(half, OUT)
    os.remove(TMP)
    print("wrote", OUT, round(os.path.getsize(OUT) / 1e6, 1), "MB")
    got = ort.InferenceSession(OUT, providers=["CPUExecutionProvider"]).run(None, {"x": x.numpy()})[0]
    print("onnx (fp16 weights) vs torch: max mask diff", float(np.abs(got - mask.numpy()).max()))

    # Fixture: a few frames of input and mask, plus the audio's first samples to check the STFT.
    pick = [0, 1, 400, 800]
    os.makedirs(os.path.dirname(FIXTURE), exist_ok=True)
    with open(FIXTURE, "w", encoding="utf-8") as fh:
        json.dump(
            {
                "frames": FRAMES,
                "stft": {str(i): [round(float(v), 5) for v in x[0, i, :64]] for i in pick},
                "mask": {str(i): [round(float(v), 4) for v in mask[0, i, :64]] for i in pick},
            },
            fh,
        )
    print("wrote", FIXTURE)
    return 0


if __name__ == "__main__":
    sys.exit(main())
