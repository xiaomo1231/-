"""
GrooveLab local stem-separation helper.

Runs on this computer only (127.0.0.1:5175) and lets the GrooveLab page
separate a song in one click with UVR's own engine (audio-separator, MIT):

  1. vocals / instrumental with the best UVR vocal model (BS-RoFormer), then
  2. drums / bass / guitar / piano / other from the instrumental (htdemucs_6s).

Endpoints (CORS limited to the GrooveLab page):
  GET  /health            -> {"ok": true, "device": "...", "version": "..."}
  POST /separate?name=..   body = the audio file  -> {"job": id}
  GET  /jobs/<id>          -> {"state", "ratio", "text", "files": [{"stem", "url"}]}
  POST /jobs/<id>/cancel   -> stop it (queued: at once; running: after the current model pass)
  GET  /files/<id>/<name>  -> the separated WAV

Models download automatically on first use into helper/models.
Start it with helper/start.bat (Start.bat does this when it is installed).
"""
from __future__ import annotations

import json
import os
import queue
import re
import shutil
import threading
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

VERSION = "1.0"
HOST = "127.0.0.1"
PORT = int(os.environ.get("GROOVELAB_HELPER_PORT", "5175"))
ROOT = Path(__file__).resolve().parent
MODELS = ROOT / "models"
JOBS = ROOT / "jobs"
MAX_UPLOAD = 600 * 1024 * 1024
ALLOWED_ORIGINS = {"http://localhost:5174", "http://127.0.0.1:5174"}
VOCAL_MODEL = "model_bs_roformer_ep_317_sdr_12.9755.ckpt"
SIX_MODEL = "htdemucs_6s.yaml"
KEEP_JOBS = 4

jobs: dict[str, dict] = {}
work: "queue.Queue[str]" = queue.Queue()
_separators: dict[str, object] = {}


def device_name() -> str:
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda:" + torch.cuda.get_device_name(0)
    except Exception:
        pass
    return "cpu"


def separator_for(model: str, out_dir: Path):
    """One Separator per model, kept loaded between jobs."""
    from audio_separator.separator import Separator

    sep = _separators.get(model)
    if sep is None:
        MODELS.mkdir(exist_ok=True)
        sep = Separator(model_file_dir=str(MODELS), output_dir=str(out_dir), output_format="WAV")
        sep.load_model(model_filename=model)
        _separators[model] = sep
    sep.output_dir = str(out_dir)
    try:  # some versions keep the output dir on the model instance too
        sep.model_instance.output_dir = str(out_dir)  # type: ignore[attr-defined]
    except Exception:
        pass
    return sep


STEM_RE = re.compile(r"_\(([A-Za-z ]+)\)")


def stem_of(path: str) -> str | None:
    """The stem in an output name; chained passes add one "_(Stem)" each, so the last one counts."""
    found = STEM_RE.findall(Path(path).name)
    return found[-1].strip().title() if found else None


class Cancelled(Exception):
    pass


def run_job(job_id: str) -> None:
    job = jobs.get(job_id)
    if not job:
        return
    out = JOBS / job_id
    try:
        src = out / job["input"]

        def step(ratio: float, text: str) -> None:
            # A model pass cannot be interrupted safely; the job stops between passes.
            if job.get("cancelled"):
                raise Cancelled()
            job.update(ratio=ratio, text=text)

        step(0.05, "正在加载人声模型（第一次会自动下载）…")
        sep = separator_for(VOCAL_MODEL, out)
        step(0.15, "正在分离人声（UVR BS-RoFormer）…")
        files = [str(out / f) if not os.path.isabs(f) else f for f in sep.separate(str(src))]
        vocals = next((f for f in files if stem_of(f) == "Vocals"), None)
        instrumental = next((f for f in files if stem_of(f) == "Instrumental"), None)
        if not vocals or not instrumental:
            raise RuntimeError(f"人声模型没有给出预期的两轨：{files}")
        result = {"Vocals": vocals, "Instrumental": instrumental}

        step(0.5, "正在加载六轨模型（第一次会自动下载）…")
        sep6 = separator_for(SIX_MODEL, out)
        step(0.6, "正在分离鼓、贝斯、吉他、钢琴（htdemucs_6s）…")
        six = [str(out / f) if not os.path.isabs(f) else f for f in sep6.separate(instrumental)]
        for f in six:
            s = stem_of(f)
            if s and s != "Vocals" and s not in result:
                result[s] = f
            elif s == "Vocals":
                os.remove(f)  # residue: the vocals come from the RoFormer pass

        job["files"] = []
        for stem, path in result.items():
            name = f"{stem.lower()}.wav"
            os.replace(path, out / name)
            job["files"].append({"stem": stem, "url": f"/files/{job_id}/{name}"})
        try:
            src.unlink()
        except OSError:
            pass
        step(1.0, "分轨完成")
        job.update(state="done", ratio=1.0, text="分轨完成")
    except Cancelled:
        job.update(state="cancelled", text="已停止")
        shutil.rmtree(out, ignore_errors=True)
    except Exception as exc:  # report to the page
        traceback.print_exc()
        job.update(state="error", error=f"{type(exc).__name__}: {exc}")
    finally:
        prune()


def prune() -> None:
    finished = sorted((j for j in jobs.values() if j["state"] != "running"), key=lambda j: j["created"])
    for j in finished[:-KEEP_JOBS]:
        shutil.rmtree(JOBS / j["id"], ignore_errors=True)
        jobs.pop(j["id"], None)


def worker() -> None:
    while True:
        job_id = work.get()
        job = jobs.get(job_id)
        if job and job.get("cancelled"):
            shutil.rmtree(JOBS / job_id, ignore_errors=True)
            continue
        run_job(job_id)


class Handler(BaseHTTPRequestHandler):
    server_version = "GrooveLabHelper/" + VERSION

    def log_message(self, fmt: str, *args) -> None:  # quieter console
        if "/jobs/" not in (args[0] if args else ""):
            super().log_message(fmt, *args)

    def cors(self) -> bool:
        origin = self.headers.get("Origin")
        if origin and origin not in ALLOWED_ORIGINS:
            return False
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        return True

    def reply(self, code: int, body: dict | bytes, ctype: str = "application/json") -> None:
        data = json.dumps(body, ensure_ascii=False).encode() if isinstance(body, dict) else body
        self.send_response(code)
        if not self.cors():
            self.end_headers()
            return
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if self.headers.get("Origin") and self.headers.get("Origin") not in ALLOWED_ORIGINS:
            return self.reply(403, {"error": "origin not allowed"})
        if path == "/health":
            return self.reply(200, {"ok": True, "device": device_name(), "version": VERSION})
        m = re.fullmatch(r"/jobs/([0-9a-f]{32})", path)
        if m:
            job = jobs.get(m.group(1))
            if not job:
                return self.reply(404, {"error": "no such job"})
            return self.reply(200, {k: job.get(k) for k in ("state", "ratio", "text", "files", "error")})
        m = re.fullmatch(r"/files/([0-9a-f]{32})/([a-z]+\.wav)", path)
        if m and (JOBS / m.group(1) / m.group(2)).is_file():
            return self.reply(200, (JOBS / m.group(1) / m.group(2)).read_bytes(), "audio/wav")
        self.reply(404, {"error": "not found"})

    def do_POST(self) -> None:
        url = urlparse(self.path)
        if self.headers.get("Origin") not in ALLOWED_ORIGINS:
            return self.reply(403, {"error": "origin not allowed"})
        m = re.fullmatch(r"/jobs/([0-9a-f]{32})/cancel", url.path)
        if m:
            job = jobs.get(m.group(1))
            if not job:
                return self.reply(404, {"error": "no such job"})
            job["cancelled"] = True
            if job["state"] == "running" and job.get("text") == "排队中…":
                job.update(state="cancelled", text="已停止")
            return self.reply(200, {"ok": True, "state": job["state"]})
        if url.path != "/separate":
            return self.reply(404, {"error": "not found"})
        size = int(self.headers.get("Content-Length") or 0)
        if size <= 0 or size > MAX_UPLOAD:
            return self.reply(413, {"error": "file missing or too large"})
        name = parse_qs(url.query).get("name", ["song.mp3"])[0]
        ext = re.sub(r"[^a-z0-9]", "", Path(name).suffix.lower())[:5] or "mp3"
        job_id = uuid.uuid4().hex
        out = JOBS / job_id
        out.mkdir(parents=True)
        (out / f"input.{ext}").write_bytes(self.rfile.read(size))
        jobs[job_id] = {"id": job_id, "state": "running", "ratio": 0.0, "text": "排队中…", "input": f"input.{ext}", "created": time.time()}
        work.put(job_id)
        self.reply(200, {"job": job_id})


def main() -> None:
    JOBS.mkdir(exist_ok=True)
    threading.Thread(target=worker, daemon=True).start()
    print(f"GrooveLab helper {VERSION} on http://{HOST}:{PORT}  device={device_name()}")
    print("Keep this window open while separating songs. Close it to stop.")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
