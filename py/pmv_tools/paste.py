"""Paste a pose back onto its base frame: keep only the region where the pose really differs and take every other
pixel from the base frame, so the background holds perfectly still when the drawings switch.

    python -m pmv_tools.paste --dir art/T1 --base a --poses b,c

reads the base frame a.png and each pose's raw drawing <pose>.raw.png, scaled to the base frame's size when it differs,
and writes <pose>.png, the final frame, and <pose>.mask.png, the soft mask as a 16-bit gray PNG (0 keeps the base
frame, 65535 takes the raw drawing). It prints the mask areas as JSON on stdout.

The mask comes from colour differences alone, with no segmentation model. Both drawings are blurred; the largest
per-channel difference is thresholded, opened, closed and stripped of small blobs; what survives is grown, its holes
are filled, and it is feathered outward. A part that moved differs at both its old and its new place, so both take
the pose's pixels.

The constants were tuned by eye on the four-band test shots and are in pixels of their 1672x941 drawings.
"""

import argparse
import json
from pathlib import Path

import numpy as np
from scipy import ndimage as ndi

from pmv_tools.media import png_size, read_gray16, read_rgb, write_png, write_png16

BLUR = 4.0  # Gaussian sigma: flattens the 1-2 px line misregistration and the redrawn 2-4 px textures (cloud wisps, lamp grilles) of an edit.
THRESHOLD = 22  # 0-255: above the blurred background noise of the test shots (p99 10-20 in the top corners), below the weakest real change seen (an eye opening).
OPEN = 2  # Radius: removes the slivers under 5 px wide that strong misregistered edges still push over the threshold.
CLOSE = 16  # Radius: joins fragments of one change up to 32 px apart (the eyes and mouth of a new expression) so that they count as one blob.
MIN_AREA = 800  # Pixels, a 28 px square: drops the specks left by redrawn texture, while a fingertip or stick end that really moved leaves more.
GROW = 40  # Pixels: covers what the threshold misses at the edge of a change (hair tips, stick ends, splashes) and moves the seam off the outline.
FEATHER = 24  # Pixels of ramp outside the grown region: wide enough to hide the colour shift between the drawings (up to 6/255), short enough not to ghost.


def distance_to(mask):
    """Distance from every pixel to the nearest True pixel of `mask`, infinite when there is none."""
    return ndi.distance_transform_edt(~mask) if mask.any() else np.full(mask.shape, np.inf)


def dilate(mask, radius):
    return distance_to(mask) <= radius


def erode(mask, radius):
    """Pixels beyond the image edge count as inside, so a region touching the edge is not eaten from there."""
    return distance_to(~mask) > radius


def change_mask(base, pose):
    """Soft mask in [0, 1] of where `pose` differs from `base` (uint8 RGB arrays of one size): 1 over each change and a
    margin around it, ramping down to exactly 0."""
    blur = lambda image: ndi.gaussian_filter(image.astype(np.float32), (BLUR, BLUR, 0))  # noqa: E731
    changed = np.abs(blur(base) - blur(pose)).max(axis=2) > THRESHOLD
    changed = erode(dilate(dilate(erode(changed, OPEN), OPEN), CLOSE), CLOSE)
    labels, _ = ndi.label(changed)
    changed &= (np.bincount(labels.ravel()) >= MIN_AREA)[labels]
    core = ndi.binary_fill_holes(dilate(changed, GROW))
    t = np.clip(1 - distance_to(core) / FEATHER, 0, 1)
    return t * t * (3 - 2 * t)


def composite(base, pose, mask):
    """base x (1 - mask) + pose x mask, back to uint8: exactly the base where the mask is 0, exactly the pose where it is 1."""
    m = mask[..., None]
    return np.round(base * (1 - m) + pose * m).astype(np.uint8)


def review(image, mask):
    """`image` dimmed to 35% outside the mask, with a 3 px red line along the mask's outer edge, for checking it by eye."""
    inside = mask > 0
    out = image * (0.35 + 0.65 * mask[..., None])
    out[inside & (distance_to(~inside) <= 3)] = (255, 0, 0)
    return np.round(out).astype(np.uint8)


def write_mask(path, mask):
    write_png16(path, np.round(mask * 65535).astype(np.uint16))


def read_mask(path, width, height):
    """A mask written by `write_mask`, back in [0, 1]. Final frames are composited with the unrounded mask, so
    compositing with this one can be 1 off in a few feather pixels."""
    return read_gray16(path, width, height)[0] / 65535


def paste(folder, base, poses):
    folder = Path(folder)
    size = png_size(folder / f"{base}.png")
    base_rgb = read_rgb(folder / f"{base}.png", *size)[0]
    report = {}
    for pose in poses:
        raw, image, mask_file = folder / f"{pose}.raw.png", folder / f"{pose}.png", folder / f"{pose}.mask.png"
        drawing = read_rgb(raw, *size)[0]
        mask = change_mask(base_rgb, drawing)
        # The final frame goes last: `pmv art` pastes again when it is missing.
        write_mask(mask_file, mask)
        write_png(image, composite(base_rgb, drawing, mask))
        report[pose] = {"image": str(image), "mask": str(mask_file), "rawSize": png_size(raw), "area": round(float((mask > 0).mean()), 3)}
    return {
        "size": size,
        "poses": report,
        "params": {"blur": BLUR, "threshold": THRESHOLD, "open": OPEN, "close": CLOSE, "minArea": MIN_AREA, "grow": GROW, "feather": FEATHER},
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", required=True, help="a shot's folder with the base frame and the raw drawings")
    parser.add_argument("--base", required=True, help="pose id of the base frame")
    parser.add_argument("--poses", required=True, help="comma-separated ids of the poses to paste")
    args = parser.parse_args()
    print(json.dumps(paste(args.dir, args.base, args.poses.split(","))))
