import subprocess

import numpy as np
import pytest

from pmv_tools.artcheck import check, flip_poses
from pmv_tools.media import FFMPEG, probe, read_gray

PATTERN = ["a", "b", "a", "c"]


def write_png(path, rgb):
    h, w, _ = rgb.shape
    cmd = [FFMPEG, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-i", "-", "-frames:v", "1", str(path)]
    subprocess.run(cmd, input=rgb.tobytes(), check=True)


def scene(shift=0, disc=(640, 360)):
    """A smooth background slid `shift` px to the right, with a dark disc (the character) centred at `disc`."""
    h, w = 720, 1280
    x = np.arange(w)[None, :]
    y = np.arange(h)[:, None]
    gray = 60 + 120 * (0.5 + 0.5 * np.sin(2 * np.pi * (x - shift) / 300 + np.pi * y / h))
    gray[(x - disc[0]) ** 2 + (y - disc[1]) ** 2 <= 120**2] = 20
    return np.repeat(gray[:, :, None], 3, axis=2).round().astype(np.uint8)


@pytest.fixture(scope="module")
def shot(tmp_path_factory):
    folder = tmp_path_factory.mktemp("shot")
    write_png(folder / "a.png", scene())
    write_png(folder / "b.png", scene(disc=(760, 360)))  # the character moves, the background stays
    write_png(folder / "c.png", scene(shift=24))  # the background slides
    return folder, check(folder, ["a", "b", "c"], PATTERN, 165, 24, 4)


def test_drift_tells_character_motion_from_background_motion(shot):
    _, report = shot
    assert report["drift"]["b"]["edge"] < 0.5 < report["drift"]["b"]["full"]
    assert report["drift"]["c"]["edge"] > 5
    assert report["sizes"] == {"a": [1280, 720], "b": [1280, 720], "c": [1280, 720]}


def test_flip_switches_on_the_first_frame_of_every_beat(shot):
    folder, report = shot
    assert report["frames"] == 96
    assert report["switches"] == [int(np.ceil(k * 60 / 165 * 24)) for k in range(1, 11)]
    info = probe(folder / "flip.mp4")
    assert (info["width"], info["height"], info["fps"]) == (1280, 720, 24)
    frames = read_gray(folder / "flip.mp4", 160, 90).astype(int)
    poses = {p: read_gray(folder / f"{p}.png", 160, 90)[0].astype(int) for p in "abc"}
    shown = [min(poses, key=lambda p: np.abs(poses[p] - f).mean()) for f in frames]
    assert shown == flip_poses(PATTERN, 165, 24, 4)


def test_sheet_puts_the_poses_side_by_side(shot):
    folder, _ = shot
    info = probe(folder / "sheet.jpg")
    assert (info["width"], info["height"]) == (3 * 1280, 720)
