"""Contact sheet, flip test and drift numbers for one shot's drawings, printed as JSON on stdout.

    python -m pmv_tools.artcheck --dir art/T1 --poses a,b,c --pattern a,b,a,c --bpm 165 --fps 24 --seconds 4

Writes sheet.jpg (the poses side by side, labelled) and flip.mp4 (one drawing per beat, stepping through the
pattern) into --dir. Each later pose is compared with the first one, the base frame, at 320x180 gray: the mean
absolute difference (0-255) over the whole frame and over an edge band made of the top 15% and the left and right
10%, a rough proxy for how much the background moved.
"""

import argparse
import json
import struct
from pathlib import Path

import imageio_ffmpeg
import numpy as np

from pmv_tools.media import read_gray, read_rgb, run_ffmpeg

W, H = 320, 180
TOP, SIDE = 0.15, 0.10
PANEL = (1280, 720)  # sheet panels and flip frames


def r(x, digits=2):
    return round(float(x), digits)


def png_size(path):
    head = Path(path).read_bytes()[:24]
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path} is not a PNG")
    return list(struct.unpack(">II", head[16:24]))


def edge_band():
    mask = np.zeros((H, W), bool)
    mask[: round(TOP * H)] = True
    mask[:, : round(SIDE * W)] = True
    mask[:, W - round(SIDE * W) :] = True
    return mask


def drift(base, other):
    diff = np.abs(base.astype(np.int16) - other)
    return {"full": r(diff.mean()), "edge": r(diff[edge_band()].mean())}


def write_sheet(images, labels, out):
    w, h = PANEL
    inputs = [arg for image in images for arg in ("-i", str(image))]
    panels = ";".join(
        f"[{i}:v]scale={w}:{h},drawtext=text='{label}':fontsize=64:fontcolor=white:borderw=4:bordercolor=black:x=24:y=16[p{i}]"
        for i, label in enumerate(labels)
    )
    stack = "".join(f"[p{i}]" for i in range(len(images))) + (f"hstack=inputs={len(images)}" if len(images) > 1 else "null")
    run_ffmpeg(["-y", *inputs, "-filter_complex", f"{panels};{stack}", "-frames:v", "1", "-q:v", "3", str(out)])


def flip_poses(pattern, bpm, fps, seconds):
    """The pose shown on each frame: the pattern advances one step on every beat, starting at frame 0."""
    return [pattern[int(i * bpm / (60 * fps) + 1e-9) % len(pattern)] for i in range(round(seconds * fps))]


def write_flip(images, shown, fps, out):
    frames = {pose: read_rgb(path, *PANEL)[0] for pose, path in images.items()}
    writer = imageio_ffmpeg.write_frames(str(out), PANEL, fps=fps, quality=None, output_params=["-crf", "18"])
    writer.send(None)
    for pose in shown:
        writer.send(np.ascontiguousarray(frames[pose]))
    writer.close()


def check(folder, poses, pattern, bpm, fps, seconds):
    folder = Path(folder)
    images = {pose: folder / f"{pose}.png" for pose in poses}
    gray = {pose: read_gray(path, W, H)[0] for pose, path in images.items()}
    shown = flip_poses(pattern, bpm, fps, seconds)
    sheet, flip = folder / "sheet.jpg", folder / "flip.mp4"
    write_sheet(list(images.values()), poses, sheet)
    write_flip(images, shown, fps, flip)
    return {
        "sheet": str(sheet),
        "flip": str(flip),
        "sizes": {pose: png_size(path) for pose, path in images.items()},
        "drift": {pose: drift(gray[poses[0]], gray[pose]) for pose in poses[1:]},
        "switches": [i for i in range(1, len(shown)) if shown[i] != shown[i - 1]],
        "frames": len(shown),
        "params": {"analysisSize": [W, H], "edgeBand": {"top": TOP, "sides": SIDE}, "panel": list(PANEL), "bpm": bpm, "fps": fps},
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", required=True, help="folder with <pose>.png for every pose")
    parser.add_argument("--poses", required=True, help="comma-separated pose ids; the first is the base frame")
    parser.add_argument("--pattern", required=True, help="comma-separated pose ids, one per beat, repeating")
    parser.add_argument("--bpm", type=float, required=True)
    parser.add_argument("--fps", type=int, required=True)
    parser.add_argument("--seconds", type=float, required=True)
    args = parser.parse_args()
    split = lambda s: s.split(",")  # noqa: E731
    print(json.dumps(check(args.dir, split(args.poses), split(args.pattern), args.bpm, args.fps, args.seconds)))
