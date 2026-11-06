"""ffmpeg helpers on top of the binary shipped with imageio-ffmpeg."""

import re
import subprocess

import imageio_ffmpeg
import numpy as np

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def probe(path):
    """Stream facts parsed from ffmpeg's input banner. Keys are present only for streams that exist."""
    banner = subprocess.run([FFMPEG, "-hide_banner", "-i", str(path)], capture_output=True, text=True).stderr
    lines = banner.splitlines()
    video = next((line for line in lines if " Video: " in line), None)
    audio = next((line for line in lines if " Audio: " in line), None)
    if video is None and audio is None:
        raise RuntimeError(f"ffmpeg found no audio or video stream in {path}: {lines[-1] if lines else ''}")
    info = {}
    if video is not None:
        size = re.search(r", (\d+)x(\d+)", video)
        fps = re.search(r", ([\d.]+) fps", video)
        info.update(width=int(size[1]), height=int(size[2]), fps=float(fps[1]))
    if audio is not None:
        info["sample_rate"] = int(re.search(r", (\d+) Hz", audio)[1])
    return info


def run_ffmpeg(args):
    """Run ffmpeg quietly and return its stdout; raises with its stderr on failure."""
    proc = subprocess.run([FFMPEG, "-v", "error", *args], capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {proc.stderr.decode(errors='replace').strip()}")
    return proc.stdout


def decode_audio(path, sample_rate=None):
    """Mono float32 samples, at the file's own rate unless sample_rate is given."""
    rate = ["-ar", str(sample_rate)] if sample_rate else []
    return np.frombuffer(run_ffmpeg(["-i", str(path), "-vn", "-ac", "1", *rate, "-f", "f32le", "-"]), np.float32)


def _raw_frames(path, width, height, pix_fmt):
    raw = run_ffmpeg(["-i", str(path), "-an", "-vf", f"scale={width}:{height}", "-pix_fmt", pix_fmt, "-c:v", "rawvideo", "-f", "image2pipe", "-"])
    return np.frombuffer(raw, np.uint8)


def read_gray(path, width, height):
    """All frames scaled to width x height, 8-bit gray, shape (frames, height, width)."""
    return _raw_frames(path, width, height, "gray").reshape(-1, height, width)


def read_rgb(path, width, height):
    """All frames scaled to width x height, 8-bit RGB, shape (frames, height, width, 3)."""
    return _raw_frames(path, width, height, "rgb24").reshape(-1, height, width, 3)
