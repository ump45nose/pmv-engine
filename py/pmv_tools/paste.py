"""Paste a pose back onto its base frame: keep only the region where the pose really differs and take every other
pixel from the base frame, so the background holds perfectly still when the drawings switch.

The mask comes from colour differences alone, with no segmentation model. Both drawings are blurred; the largest
per-channel difference is thresholded, opened, closed and stripped of small blobs; what survives is grown, its holes
are filled, and it is feathered outward. A part that moved differs at both its old and its new place, so both take
the pose's pixels.

The constants were tuned by eye on the four-band test shots and are in pixels of their 1672x941 drawings.
"""

import numpy as np
from scipy import ndimage as ndi

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
