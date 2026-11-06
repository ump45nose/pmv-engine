import numpy as np
import pytest

from pmv_tools.qa import measure
from tests.synth import FPS, SR, beat_track, pulse_clip, write_video, write_wav


def unmatched(found, expected, tol=1):
    """Expected frames with no found frame within tol, and found frames with no expected one."""
    missing = [e for e in expected if not any(abs(f - e) <= tol for f in found)]
    extra = [f for f in found if not any(abs(f - e) <= tol for e in expected)]
    return missing, extra


@pytest.fixture(scope="module")
def clip(tmp_path_factory):
    frames, truth = pulse_clip()
    path = tmp_path_factory.mktemp("video") / "pulse.mp4"
    write_video(path, frames)
    return measure(path), truth


def test_video_info(clip):
    result, _ = clip
    assert result["video"]["frames"] == 240
    assert result["video"]["fps"] == FPS
    assert (result["video"]["width"], result["video"]["height"]) == (640, 360)


def test_cuts_found_and_flashes_are_not_cuts(clip):
    result, truth = clip
    assert unmatched(result["motion"]["cuts"], truth["cuts"]) == ([], [])
    assert result["motion"]["shotLengths"]["count"] == 3


def test_switches_and_flashes_are_events(clip):
    result, truth = clip
    switches = [e["frame"] for e in result["events"] if e["type"] == "switch"]
    assert unmatched(switches, truth["switches"] + truth["flashes"]) == ([], [])
    assert [e["frame"] for e in result["events"] if e["type"] == "cut"] == result["motion"]["cuts"]


def test_still_tail(clip):
    result, truth = clip
    assert abs(result["motion"]["longestStill"] - truth["stillFrames"] / FPS) <= 1 / FPS
    assert result["motion"]["identicalFrac"] > 0


def test_audio_lag(tmp_path):
    samples, _ = beat_track()
    start, delay, seconds = 5.0, 0.05, 4.0
    a = int((start - delay) * SR)
    audio = tmp_path / "slice.wav"
    write_wav(audio, samples[a : a + int(seconds * SR)])
    song = tmp_path / "song.wav"
    write_wav(song, samples)
    video = tmp_path / "late.mp4"
    write_video(video, [np.zeros((360, 640), np.uint8)] * int(seconds * FPS), audio_path=audio)

    lag = measure(video, song, start)["audio"]
    assert abs(lag["lagMs"] - delay * 1000) <= 1, lag
    assert lag["peak"] > 0.9, lag
    assert measure(video)["audio"] is None
