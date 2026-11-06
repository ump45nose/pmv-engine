import numpy as np

from pmv_tools.media import png_size, read_rgb, write_png
from pmv_tools.paste import FEATHER, GROW, change_mask, composite, distance_to, paste, read_mask
from tests.synth import BLOCK, drawing

OLD, NEW = (300, 200), (760, 260)
SPECKS = [(100, 600), (1100, 100), (600, 650)]


def block(at, h=720, w=1280):
    mask = np.zeros((h, w), bool)
    mask[at[1] : at[1] + BLOCK[1], at[0] : at[0] + BLOCK[0]] = True
    return mask


def test_a_moved_block_takes_the_pose_at_both_places_and_the_base_everywhere_else():
    base = drawing(1, OLD)
    pose = drawing(2, NEW, specks=SPECKS)  # texture redrawn everywhere, a few specks
    mask = change_mask(base, pose)
    out = composite(base, pose, mask)
    for at in (OLD, NEW):
        assert (mask[block(at)] == 1).all()
        assert np.array_equal(out[block(at)], pose[block(at)])
    # A few px of blur around each block, then the grown and feathered margin.
    far = distance_to(block(OLD) | block(NEW)) > GROW + FEATHER + 8
    assert (mask[far] == 0).all()
    assert np.array_equal(out[far], base[far])
    for x, y in SPECKS:
        assert mask[y + 5, x + 5] == 0
    assert 0 < mask.mean() < 0.25


def test_the_mask_ramps_from_1_to_0_within_the_feather():
    mask = change_mask(drawing(1, OLD), drawing(2, NEW))
    ramp = (mask > 0) & (mask < 1)
    assert ramp.any()
    assert distance_to(mask == 1)[ramp].max() <= FEATHER


def test_redrawn_texture_alone_takes_nothing_from_the_pose():
    base = drawing(1, OLD)
    assert (change_mask(base, drawing(2, OLD)) == 0).all()
    assert (change_mask(base, base) == 0).all()
    assert np.array_equal(composite(base, drawing(2, OLD), change_mask(base, base)), base)


def test_paste_writes_the_final_frame_and_a_16_bit_mask(tmp_path):
    base, raw = drawing(1, OLD), drawing(2, NEW)
    write_png(tmp_path / "a.png", base)
    write_png(tmp_path / "b.raw.png", raw)
    report = paste(tmp_path, "a", ["b"])
    mask = change_mask(base, raw)
    assert np.array_equal(read_rgb(tmp_path / "b.png", 1280, 720)[0], composite(base, raw, mask))
    assert (tmp_path / "b.mask.png").read_bytes()[24:26] == bytes([16, 0])  # bit depth 16, gray
    assert np.abs(read_mask(tmp_path / "b.mask.png", 1280, 720) - mask).max() <= 0.5 / 65535
    assert report["size"] == [1280, 720]
    assert report["poses"]["b"] == {
        "image": str(tmp_path / "b.png"),
        "mask": str(tmp_path / "b.mask.png"),
        "rawSize": [1280, 720],
        "area": round(float((mask > 0).mean()), 3),
    }
    assert report["params"]["feather"] == FEATHER


def test_paste_scales_a_raw_drawing_of_another_size_to_the_base_frame(tmp_path):
    base = drawing(1, OLD)
    write_png(tmp_path / "a.png", base)
    write_png(tmp_path / "c.raw.png", drawing(2, NEW, size=(1279, 720)))  # like the 1671 px wide T2/c against 1672
    report = paste(tmp_path, "a", ["c"])
    assert report["poses"]["c"]["rawSize"] == [1279, 720]
    assert png_size(tmp_path / "c.png") == png_size(tmp_path / "c.mask.png") == [1280, 720]
    scaled = read_rgb(tmp_path / "c.raw.png", 1280, 720)[0]
    assert np.array_equal(read_rgb(tmp_path / "c.png", 1280, 720)[0], composite(base, scaled, change_mask(base, scaled)))
