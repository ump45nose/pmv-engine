import numpy as np
import pytest

from pmv_tools.artcheck import check, flip_poses, shift
from pmv_tools.media import probe, read_gray, read_rgb, write_png
from tests.synth import drawing

PATTERN = ["a", "b", "a", "c"]


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
    b, c = report["drift"]["b"], report["drift"]["c"]
    assert b["edge"] < 0.5 < b["full"]
    assert b["corners"] < 0.5 < 5 < c["corners"]
    assert c["edge"] > 5
    assert report["sizes"] == {"a": [1280, 720], "b": [1280, 720], "c": [1280, 720]}
    assert report["paste"] is None


def test_shift_follows_the_textured_background():
    big = drawing(0, (600, 300), size=(1320, 760)).mean(axis=2)
    moved = shift(big[20:740, 20:1300], big[10:730, 0:1280])  # the whole picture 20 px right, 10 px down
    assert (moved["dx"], moved["dy"]) == (20, 10)
    still = shift(drawing(0, (300, 200)).mean(axis=2), drawing(0, (760, 260)).mean(axis=2))  # only the character moves
    assert (still["dx"], still["dy"]) == (0, 0)
    assert still["peak"] > 0.5


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


@pytest.fixture(scope="module")
def pasted(tmp_path_factory):
    """Every drawing redraws the background texture; the character block moves right in b and down in c."""
    folder = tmp_path_factory.mktemp("paste")
    for seed, (pose, at) in enumerate({"a": (300, 200), "b": (760, 260), "c": (300, 460)}.items()):
        write_png(folder / f"{pose}.png", drawing(seed, at))
    return folder, check(folder, ["a", "b", "c"], PATTERN, 165, 24, 4, paste=True)["paste"]


def test_paste_writes_the_pasted_poses_and_their_masks(pasted):
    folder, paste = pasted
    for pose in "bc":
        assert paste["poses"][pose]["image"] == str(folder / "paste" / f"{pose}.png")
        assert (probe(folder / "paste" / f"{pose}.png")["width"], probe(folder / "paste" / f"{pose}.mask.png")["height"]) == (1280, 720)
        assert 0 < paste["poses"][pose]["area"] < 0.3
        assert paste["poses"][pose]["seam"] > 0
    info = probe(folder / "sheet-paste.jpg")
    assert (info["width"], info["height"]) == (3 * 1280, 2 * 720)


def test_ab_shows_the_original_left_and_the_pasted_right_with_a_still_background(pasted):
    folder, paste = pasted
    info = probe(folder / "ab.mp4")
    assert (info["width"], info["height"], info["fps"]) == (1920, 540, 24)
    frames = read_gray(folder / "ab.mp4", 320, 90).astype(int)
    assert len(frames) == 96
    original = {p: read_gray(folder / f"{p}.png", 160, 90)[0].astype(int) for p in "abc"}
    pasted_ = {"a": original["a"]} | {p: read_gray(folder / "paste" / f"{p}.png", 160, 90)[0].astype(int) for p in "bc"}
    nearest = lambda side, f: min(side, key=lambda p: np.abs(side[p] - f).mean())  # noqa: E731
    expected = flip_poses(PATTERN, 165, 24, 4)
    assert [nearest(original, f[:, :160]) for f in frames] == expected
    assert [nearest(pasted_, f[:, 160:]) for f in frames] == expected
    assert paste["background"]["paste"]["max"] < 0.5 < 2 < paste["background"]["original"]["mean"]
    assert 0.3 < paste["background"]["area"] < 1


def test_paste_composites_at_full_size(pasted):
    folder, _ = pasted
    base = read_rgb(folder / "a.png", 1280, 720)[0]
    b = read_rgb(folder / "b.png", 1280, 720)[0]
    out = read_rgb(folder / "paste" / "b.png", 1280, 720)[0]
    assert np.array_equal(out[:100, :100], base[:100, :100])  # far from both places of the block
    assert np.array_equal(out[200:360, 300:420], b[200:360, 300:420])  # where the block was: the pose's background
    assert np.array_equal(out[260:420, 760:880], b[260:420, 760:880])  # where it is now
