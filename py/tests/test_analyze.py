import numpy as np
import pytest

from pmv_tools.analyze import analyze
from tests.synth import beat_track, write_wav

TOL = 0.042  # one frame at 24 fps


def hit_rates(est, ref):
    """(precision, recall) of est against ref within TOL seconds."""
    est, ref = np.asarray(est), np.asarray(ref)
    precision = np.mean([np.abs(ref - t).min() <= TOL for t in est])
    recall = np.mean([np.abs(est - t).min() <= TOL for t in ref])
    return precision, recall


@pytest.fixture(scope="module")
def synthetic(tmp_path_factory):
    samples, truth = beat_track()
    path = tmp_path_factory.mktemp("audio") / "synth.wav"
    write_wav(path, samples)
    return analyze(path), truth


def test_beats_within_one_frame(synthetic):
    result, truth = synthetic
    precision, recall = hit_rates(result["beats"], truth["beats"])
    assert precision >= 0.95 and recall >= 0.95, (precision, recall)


def test_bpm(synthetic):
    result, truth = synthetic
    assert abs(result["bpm"] - truth["bpm"]) <= 1


def test_downbeats(synthetic):
    result, truth = synthetic
    precision, recall = hit_rates(result["downbeats"], truth["downbeats"])
    assert precision >= 0.9 and recall >= 0.9, (precision, recall)
    assert result["beatsPerBar"] == 4


def test_bars_follow_downbeats(synthetic):
    result, _ = synthetic
    bars = result["bars"]
    assert [b["start"] for b in bars] == result["downbeats"]
    assert all(a["end"] == b["start"] for a, b in zip(bars, bars[1:]))
    assert bars[-1]["end"] <= result["duration"]


def test_sections_find_the_timbre_changes(synthetic):
    result, truth = synthetic
    starts = [s["bars"][0] for s in result["sections"][1:]]
    assert len(starts) == len(truth["sectionStartBars"])
    assert all(abs(a - b) <= 1 for a, b in zip(starts, truth["sectionStartBars"])), starts
    assert [s["label"] for s in result["sections"]] == truth["sectionLabels"]


def test_uniform_track_is_one_section(tmp_path):
    samples, _ = beat_track(sections=(("A", 20),))
    path = tmp_path / "uniform.wav"
    write_wav(path, samples)
    sections = analyze(path)["sections"]
    assert [s["label"] for s in sections] == ["A"]
