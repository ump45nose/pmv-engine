"""Beats, downbeats, bars and coarse sections of one audio file, printed as JSON on stdout.

    python -m pmv_tools.analyze --audio song.wav
"""

import argparse
import json
import os
import string
from pathlib import Path

# beat_this fetches its checkpoint through torch.hub; keep it in the repo's cache, not ~/.cache.
os.environ["TORCH_HOME"] = str(Path(__file__).resolve().parents[2] / ".cache" / "torch")

import numpy as np  # noqa: E402
from beat_this.inference import Audio2Beats  # noqa: E402

from pmv_tools.media import decode_audio, probe  # noqa: E402

CHECKPOINT = "final0"
SPECT_FPS = 50  # beat_this log-mel frame rate
SECTION_WINDOW = 4  # bars compared on each side of a candidate boundary; also the shortest section
# RMS difference of mean log-mel features. Synthetic tests: about 0.02 inside a section, 0.7 at a change.
NOVELTY_MIN = 0.25


def tempo(beats):
    """BPM from the mean of inter-beat intervals within 10% of the median (a median alone is quantised to 20 ms)."""
    ibis = np.diff(beats)
    median = np.median(ibis)
    return 60.0 / ibis[np.abs(ibis - median) < 0.1 * median].mean()


def make_bars(beats, downbeats, duration, bpm):
    counts = np.diff(np.searchsorted(beats, downbeats))
    beats_per_bar = int(np.bincount(counts).argmax())
    ends = np.append(downbeats[1:], min(duration, downbeats[-1] + beats_per_bar * 60.0 / bpm))
    bars = [{"index": i + 1, "start": round(float(s), 4), "end": round(float(e), 4)} for i, (s, e) in enumerate(zip(downbeats, ends))]
    return beats_per_bar, bars


def find_sections(spect, bars):
    """Split bars where the mean log-mel spectrum of the next SECTION_WINDOW bars departs from the previous ones.

    A short final bar (the remainder after the last downbeat) is left out of the comparison and joins the last section.
    """
    lengths = [b["end"] - b["start"] for b in bars]
    n = len(bars) - int(lengths[-1] < 0.9 * np.median(lengths))
    feats = np.stack([spect[int(b["start"] * SPECT_FPS) : max(int(b["end"] * SPECT_FPS), int(b["start"] * SPECT_FPS) + 1)].mean(0) for b in bars[:n]])
    w = SECTION_WINDOW
    rms = lambda a, b: float(np.sqrt(np.mean((a - b) ** 2)))  # noqa: E731
    novelty = np.zeros(n)
    for i in range(w, n - w + 1):
        novelty[i] = rms(feats[i - w : i].mean(0), feats[i : i + w].mean(0))
    cuts = [i for i in range(w, n - w + 1) if novelty[i] >= NOVELTY_MIN and novelty[i] == novelty[max(0, i - w + 1) : i + w].max()]
    spans = list(zip([0, *cuts], [*cuts, len(bars)]))

    labels, prototypes = [], []
    for a, b in spans:
        mean = feats[a:b].mean(0)
        match = next((k for k, p in enumerate(prototypes) if rms(mean, p) < NOVELTY_MIN), None)
        if match is None:
            prototypes.append(mean)
            match = len(prototypes) - 1
        labels.append(string.ascii_uppercase[match] if match < 26 else f"S{match + 1}")

    sections = []
    for (a, b), label in zip(spans, labels):
        if sections and sections[-1]["label"] == label:
            sections[-1].update(end=bars[b - 1]["end"], bars=[sections[-1]["bars"][0], b])
        else:
            sections.append({"label": label, "start": bars[a]["start"], "end": bars[b - 1]["end"], "bars": [a + 1, b], "source": "auto"})
    return sections


def analyze(path):
    sample_rate = probe(path)["sample_rate"]
    signal = decode_audio(path)
    duration = len(signal) / sample_rate
    tracker = Audio2Beats(checkpoint_path=CHECKPOINT, device="cpu")
    spect = tracker.signal2spect(signal, sample_rate)
    beats, downbeats = (np.asarray(x, float) for x in tracker.frames2beats(*tracker.spect2frames(spect)))
    if len(downbeats) < 2:
        raise RuntimeError(f"beat_this found {len(beats)} beats and {len(downbeats)} downbeats; need at least two bars")
    bpm = tempo(beats)
    beats_per_bar, bars = make_bars(beats, downbeats, duration, bpm)
    return {
        "duration": round(duration, 4),
        "sampleRate": sample_rate,
        "bpm": round(float(bpm), 2),
        "beatsPerBar": beats_per_bar,
        "beats": [round(float(t), 4) for t in beats],
        "downbeats": [round(float(t), 4) for t in downbeats],
        "bars": bars,
        "sections": find_sections(spect.cpu().numpy(), bars),
        "analyzer": {
            "beats": f"beat_this {CHECKPOINT}, minimal postprocessing",
            "sections": f"bar log-mel novelty, window {SECTION_WINDOW} bars, threshold {NOVELTY_MIN}",
        },
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio", required=True)
    print(json.dumps(analyze(parser.parse_args().audio)))
