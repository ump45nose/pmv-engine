import numpy as np

from pmv_tools.paste import FEATHER, GROW, change_mask, composite, distance_to
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
