"""Contact sheet, flip test and drift numbers for one shot's final frames <pose>.png, printed as JSON on stdout.

    python -m pmv_tools.artcheck --dir art/T1 --poses a,b,c --pattern a,b,a,c --bpm 165 --fps 24 --seconds 4 [--ab]

Writes sheet.jpg (the poses side by side, labelled) and flip.mp4 (one drawing per beat, stepping through the
pattern) into --dir. Each later pose is compared with the first one, the base frame, at 320x180 gray: the mean
absolute difference (0-255) over the whole frame, over an edge band made of the top 15% and the left and right
10%, a rough proxy for how much the background moved, and over the band's two top corners, which hold nothing but
background in the test shots. Phase correlation at full size gives the pose's overall shift from the base frame.

--ab also compares every later pose's raw drawing <pose>.raw.png with its final frame, which pmv_tools.paste made
from it with the mask <pose>.mask.png, and writes ab.mp4 (the flip test with the raw drawings on the left and the
final frames on the right) and sheet-paste.jpg (the final frames, their masks below).
"""

import argparse
import json
from pathlib import Path

import imageio_ffmpeg
import numpy as np

from pmv_tools.media import png_size, read_gray, read_rgb, run_ffmpeg
from pmv_tools.paste import distance_to, read_mask

W, H = 320, 180
TOP, SIDE = 0.15, 0.10
PANEL = (1280, 720)  # sheet panels and flip frames
HALF = (960, 540)  # each side of ab.mp4
MARGIN = 8  # px of the full drawing kept between a mask and the still region, beyond the reach of the scaler for ab.mp4


def r(x, digits=2):
    return round(float(x), digits)


def edge_band():
    mask = np.zeros((H, W), bool)
    mask[: round(TOP * H)] = True
    mask[:, : round(SIDE * W)] = True
    mask[:, W - round(SIDE * W) :] = True
    return mask


def corners():
    mask = np.zeros((H, W), bool)
    mask[: round(TOP * H), : round(SIDE * W)] = True
    mask[: round(TOP * H), W - round(SIDE * W) :] = True
    return mask


def drift(base, other):
    diff = np.abs(base.astype(np.int16) - other)
    return {"full": r(diff.mean()), "edge": r(diff[edge_band()].mean()), "corners": r(diff[corners()].mean())}


def shift(base, other):
    """How far `other` is shifted from `base` (gray float arrays of one size) by phase correlation: px right and down,
    and the correlation peak (0-1), low when there is no clear common shift."""
    h, w = base.shape
    window = np.outer(np.hanning(h), np.hanning(w))
    cross = np.fft.fft2((base - base.mean()) * window) * np.conj(np.fft.fft2((other - other.mean()) * window))
    corr = np.fft.ifft2(cross / (np.abs(cross) + 1e-9)).real
    y, x = np.unravel_index(np.argmax(corr), corr.shape)
    return {"dx": -int(x - w if x > w // 2 else x), "dy": -int(y - h if y > h // 2 else y), "peak": r(corr.max(), 3)}


def write_sheet(rows, out):
    """rows of (image, label) cells, None for an empty cell; each cell is scaled to one panel and labelled."""
    w, h = PANEL
    cells = [(x, y, *cell) for y, row in enumerate(rows) for x, cell in enumerate(row) if cell is not None]
    inputs = [arg for _, _, image, _ in cells for arg in ("-i", str(image))]
    panels = ";".join(
        f"[{i}:v]scale={w}:{h},drawtext=text='{label}':fontsize=64:fontcolor=white:borderw=4:bordercolor=black:x=24:y=16[p{i}]"
        for i, (_, _, _, label) in enumerate(cells)
    )
    layout = "|".join(f"{x * w}_{y * h}" for x, y, _, _ in cells)
    stack = "".join(f"[p{i}]" for i in range(len(cells))) + (f"xstack=inputs={len(cells)}:layout={layout}:fill=black" if len(cells) > 1 else "null")
    run_ffmpeg(["-y", *inputs, "-filter_complex", f"{panels};{stack}", "-frames:v", "1", "-q:v", "3", str(out)])


def flip_poses(pattern, bpm, fps, seconds):
    """The pose shown on each frame: the pattern advances one step on every beat, starting at frame 0."""
    return [pattern[int(i * bpm / (60 * fps) + 1e-9) % len(pattern)] for i in range(round(seconds * fps))]


def write_flip(frames, shown, fps, out):
    """One video frame per entry of `shown`, taken from `frames` (pose -> RGB array)."""
    h, w, _ = next(iter(frames.values())).shape
    writer = imageio_ffmpeg.write_frames(str(out), (w, h), fps=fps, quality=None, macro_block_size=2, output_params=["-crf", "18"])
    writer.send(None)
    for pose in shown:
        writer.send(np.ascontiguousarray(frames[pose]))
    writer.close()


def flicker(frames, region, switches):
    """Mean absolute gray change (0-255) inside `region` from the frame before each switch to the switch frame."""
    if not region.any():
        raise ValueError("--ab: every pixel lies inside some pose's mask, so no background is left to measure")
    values = [np.abs(frames[i].astype(np.int16) - frames[i - 1])[region].mean() for i in switches]
    return {"mean": r(np.mean(values)), "max": r(np.max(values))}


def compare_raw(folder, images, poses, shown, switches, fps):
    if not switches:
        raise ValueError("--ab needs a pattern that switches drawings")
    w, h = png_size(images[poses[0]])
    base = read_rgb(images[poses[0]], w, h)[0]
    raw, masks = {poses[0]: images[poses[0]]}, {}
    report, changed = {}, np.zeros((h, w), bool)
    for pose in poses[1:]:
        raw[pose], masks[pose] = folder / f"{pose}.raw.png", folder / f"{pose}.mask.png"
        drawing = read_rgb(raw[pose], w, h)[0]
        mask = read_mask(masks[pose], w, h)
        band = (mask > 0) & (mask < 1)
        seam = np.abs(drawing.astype(np.int16) - base)[band].mean() if band.any() else 0
        report[pose] = {"area": r((mask > 0).mean(), 3), "seam": r(seam)}
        changed |= mask > 0

    ab, sheet = folder / "ab.mp4", folder / "sheet-paste.jpg"
    hw, hh = HALF
    write_flip({pose: np.hstack([read_rgb(raw[pose], hw, hh)[0], read_rgb(images[pose], hw, hh)[0]]) for pose in poses}, shown, fps, ab)
    labels = {pose: f"{pose} paste" for pose in poses[1:]} | {poses[0]: poses[0]}
    write_sheet([[(images[p], labels[p]) for p in poses], [None] + [(masks[p], f"{p} mask") for p in poses[1:]]], sheet)

    # Pixels outside every mask, sampled at ab.mp4's half size, with a margin so that the scaler cannot reach a mask.
    still = distance_to(changed) > MARGIN
    region = still[np.ix_(((np.arange(hh) + 0.5) * h / hh).astype(int), ((np.arange(hw) + 0.5) * w / hw).astype(int))]
    frames = read_gray(ab, 2 * hw, hh)
    return {
        "ab": str(ab),
        "sheet": str(sheet),
        "poses": report,
        "background": {
            "area": r(1 - changed.mean(), 3),
            "original": flicker(frames[:, :, :hw], region, switches),
            "paste": flicker(frames[:, :, hw:], region, switches),
        },
        "params": {"half": list(HALF)},
    }


def check(folder, poses, pattern, bpm, fps, seconds, ab=False):
    folder = Path(folder)
    images = {pose: folder / f"{pose}.png" for pose in poses}
    gray = {pose: read_gray(path, W, H)[0] for pose, path in images.items()}
    size = png_size(images[poses[0]])
    full = {pose: read_gray(path, *size)[0].astype(float) for pose, path in images.items()}
    shown = flip_poses(pattern, bpm, fps, seconds)
    switches = [i for i in range(1, len(shown)) if shown[i] != shown[i - 1]]
    sheet, flip = folder / "sheet.jpg", folder / "flip.mp4"
    write_sheet([[(images[pose], pose) for pose in poses]], sheet)
    write_flip({pose: read_rgb(path, *PANEL)[0] for pose, path in images.items()}, shown, fps, flip)
    return {
        "sheet": str(sheet),
        "flip": str(flip),
        "sizes": {pose: png_size(path) for pose, path in images.items()},
        "drift": {pose: {**drift(gray[poses[0]], gray[pose]), "shift": shift(full[poses[0]], full[pose])} for pose in poses[1:]},
        "switches": switches,
        "frames": len(shown),
        "paste": compare_raw(folder, images, poses, shown, switches, fps) if ab else None,
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
    parser.add_argument("--ab", action="store_true", help="also compare each pose's raw drawing with its final frame")
    args = parser.parse_args()
    split = lambda s: s.split(",")  # noqa: E731
    print(json.dumps(check(args.dir, split(args.poses), split(args.pattern), args.bpm, args.fps, args.seconds, args.ab)))
