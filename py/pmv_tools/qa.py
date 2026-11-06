"""Motion, cut and beat-event measurements of one video, printed as JSON on stdout.

    python -m pmv_tools.qa --video out.mp4 [--audio song.wav --start 62.5]

Extends the motion_stats.py used on the two old cuts: frames are read at 160x90 gray; a cut candidate is a
32-bin histogram distance above 0.35 or a mean frame difference above 30, and candidates within 12 frames
of a group's first one are merged into it.
"""

import argparse
import json

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

from pmv_tools.media import decode_audio, probe, read_gray

W, H = 160, 90
CUT_HIST = 0.35
CUT_MAD = 30.0
CUT_MERGE = 12  # frames
FLASH_RETURN = 12  # a candidate group whose previous picture comes back within this many frames is a flash, not a cut
CHANGED_PX = 8  # gray levels
IDENTICAL_MAD = 0.05
SPIKE_MIN_MAD = 1.0
SPIKE_RATIO = 3.0  # times the rolling median difference
SPIKE_WINDOW = 8  # frames on each side for that median
LAG_RATE = 16000
LAG_MAX = 0.5  # seconds searched either way
LAG_SPAN = 20.0  # seconds of the video's audio used


def r(x, digits=4):
    return round(float(x), digits)


def detect_cuts(frames, hist, mad, hd):
    """Frame indices where a new shot starts."""

    def differs(a, b):
        return np.abs(hist[a] - hist[b]).sum() > CUT_HIST or np.abs(frames[a].astype(np.int16) - frames[b]).mean() > CUT_MAD

    groups = []
    for c in (np.where((hd > CUT_HIST) | (mad > CUT_MAD))[0] + 1).tolist():
        if groups and c - groups[-1][0] <= CUT_MERGE:
            groups[-1].append(c)
        else:
            groups.append([c])
    last = len(frames) - 1
    return [g[0] for g in groups if all(differs(g[0] - 1, k) for k in range(g[0], min(g[-1] + FLASH_RETURN, last) + 1))]


def detect_spikes(mad):
    """Frame indices whose difference to the previous frame is a local peak well above the recent level."""
    baseline = np.median(sliding_window_view(np.pad(mad, SPIKE_WINDOW, mode="edge"), 2 * SPIKE_WINDOW + 1), axis=1)
    local_max = mad == sliding_window_view(np.pad(mad, 1, constant_values=-1), 3).max(axis=1)
    rising = np.concatenate([[True], mad[1:] > mad[:-1]])
    keep = (mad >= SPIKE_MIN_MAD) & (mad >= SPIKE_RATIO * baseline) & local_max & rising
    return (np.where(keep)[0] + 1).tolist()


def longest_run(mask):
    best = run = 0
    for x in mask:
        run = run + 1 if x else 0
        best = max(best, run)
    return best


def audio_lag(video, audio, start):
    """Lag of the video's audio against the song from `start`, by cross-correlation."""
    v = decode_audio(video, LAG_RATE)[: int(LAG_SPAN * LAG_RATE)]
    song = decode_audio(audio, LAG_RATE)
    m = int(LAG_MAX * LAG_RATE)
    lo = int(round(start * LAG_RATE)) - m
    seg = np.zeros(len(v) + 2 * m, np.float32)
    src = song[max(lo, 0) : max(lo + len(seg), 0)]
    seg[max(-lo, 0) : max(-lo, 0) + len(src)] = src
    size = 1 << int(np.ceil(np.log2(len(seg) + len(v))))
    corr = np.fft.irfft(np.fft.rfft(seg, size) * np.conj(np.fft.rfft(v, size)), size)[: 2 * m + 1]
    k = int(np.argmax(corr))
    norm = np.linalg.norm(v) * np.linalg.norm(seg[k : k + len(v)])
    return {"lagMs": r((m - k) / LAG_RATE * 1000, 2), "peak": r(corr[k] / norm if norm else 0.0, 3)}


def measure(video, audio=None, start=0.0):
    info = probe(video)
    fps = info["fps"]
    frames = read_gray(video, W, H)
    n = len(frames)
    if n < 2:
        raise ValueError(f"{video} has {n} frames; need at least 2")
    diff = np.abs(np.diff(frames.astype(np.int16), axis=0))
    mad = diff.mean(axis=(1, 2))  # transition i is frame i -> i + 1
    changed = (diff > CHANGED_PX).mean(axis=(1, 2))
    hist = np.stack([np.histogram(f, bins=32, range=(0, 256))[0] for f in frames]) / (W * H)
    hd = np.abs(np.diff(hist, axis=0)).sum(axis=1)

    cuts = detect_cuts(frames, hist, mad, hd)
    within = np.ones(n - 1, bool)
    within[np.array(cuts, int) - 1] = False
    shots = np.diff([0, *cuts, n]) / fps
    events = [{"frame": c, "type": "cut", "strength": r(mad[c - 1], 2)} for c in cuts]
    events += [{"frame": f, "type": "switch", "strength": r(mad[f - 1], 2)} for f in detect_spikes(mad) if all(abs(f - c) > 2 for c in cuts)]

    return {
        "video": {"path": str(video), "frames": n, "fps": fps, "width": info["width"], "height": info["height"], "duration": r(n / fps)},
        "motion": {
            "cuts": cuts,
            "cutsPerMin": r(len(cuts) / (n / fps / 60), 2),
            "shotLengths": {"count": len(shots), "median": r(np.median(shots), 3), "mean": r(shots.mean(), 3), "max": r(shots.max(), 3)},
            "madWithinShot": {k: r(np.percentile(mad[within], p), 3) for k, p in (("p10", 10), ("median", 50), ("p90", 90))},
            "changedPxWithinShot": {"median": r(np.median(changed[within])), "p90": r(np.percentile(changed[within], 90))},
            "identicalFrac": r((mad[within] < IDENTICAL_MAD).mean()),
            "longestStill": r((longest_run(mad < IDENTICAL_MAD) + 1) / fps, 3),
        },
        "events": sorted(events, key=lambda e: e["frame"]),
        "audio": audio_lag(video, audio, start) if audio and "sample_rate" in info else None,
        "params": {
            "analysisSize": [W, H],
            "cutHist": CUT_HIST,
            "cutMad": CUT_MAD,
            "cutMergeFrames": CUT_MERGE,
            "flashReturnFrames": FLASH_RETURN,
            "changedPx": CHANGED_PX,
            "identicalMad": IDENTICAL_MAD,
            "spikeMinMad": SPIKE_MIN_MAD,
            "spikeRatio": SPIKE_RATIO,
            "spikeWindow": SPIKE_WINDOW,
        },
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", required=True)
    parser.add_argument("--audio", help="song audio; enables the audio lag measurement")
    parser.add_argument("--start", type=float, default=0.0, help="song second shown on video frame 0")
    args = parser.parse_args()
    print(json.dumps(measure(args.video, args.audio, args.start)))
