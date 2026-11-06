"""Synthetic test media with known timing.

Run as a script to write files for the TypeScript end-to-end test:
    python tests/synth.py audio OUT.wav   -> prints the ground truth as JSON
"""

import json
import sys
import wave

import numpy as np

SR = 44100
# Bass roots and triads per bar; section B uses a different progression and a brighter mix.
CHORDS = {
    "A": [(65.41, (261.6, 329.6, 392.0)), (98.00, (246.9, 293.7, 392.0)), (110.0, (220.0, 261.6, 329.6)), (87.31, (220.0, 261.6, 349.2))],
    "B": [(87.31, (349.2, 440.0, 523.3)), (65.41, (329.6, 392.0, 523.3)), (98.00, (293.7, 392.0, 493.9)), (82.41, (329.6, 392.0, 493.9))],
}


def _env(n, decay):
    return np.exp(-np.arange(n) / (decay * SR))


def _kick(rng, gain):
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    freq = 50 + 110 * np.exp(-t / 0.03)
    return gain * np.sin(2 * np.pi * np.cumsum(freq) / SR) * _env(n, 0.12)


def _snare(rng, gain):
    n = int(0.2 * SR)
    noise = np.diff(rng.standard_normal(n + 1))  # crude high-pass
    t = np.arange(n) / SR
    return gain * (0.5 * noise + 0.5 * np.sin(2 * np.pi * 190 * t)) * _env(n, 0.05)


def _hat(rng, gain, decay):
    n = int(0.12 * SR)
    noise = np.diff(rng.standard_normal(n + 2), 2)
    return gain * noise * _env(n, decay)


def _tone(freqs, seconds, gain, attack=0.02):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    x = sum(np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t) for f in freqs) / len(freqs)
    return gain * x * np.minimum(1, t / attack) * np.exp(-t / (seconds * 1.5))


def beat_track(bpm=165.0, beats_per_bar=4, bars=20, first_beat=0.5, sections=(("A", 8), ("B", 8), ("A", 4)), noise_db=-45.0, seed=0):
    """A drum, bass and pad loop. Returns (samples, truth) with beat, downbeat and section times in seconds."""
    rng = np.random.default_rng(seed)
    ibi = 60.0 / bpm
    beats = first_beat + ibi * np.arange(bars * beats_per_bar)
    duration = beats[-1] + ibi + 0.5
    out = np.zeros(int(duration * SR) + SR)
    labels = [label for label, count in sections for _ in range(count)]
    assert len(labels) == bars

    def add(t, x):
        i = int(round(t * SR))
        out[i : i + len(x)] += x

    for i, t in enumerate(beats):
        bar, pos = divmod(i, beats_per_bar)
        label = labels[bar]
        bright = label == "B"
        if pos == 0:
            root, triad = CHORDS[label][bar % 4]
            add(t, _kick(rng, 0.9))
            add(t, _tone([root], ibi * beats_per_bar, 0.45, attack=0.005))
            add(t, _tone(triad, ibi * beats_per_bar, 0.12 if bright else 0.08, attack=0.01))
        elif pos == beats_per_bar // 2:
            add(t, _kick(rng, 0.5))
        if pos % 2 == 1:
            add(t, _snare(rng, 0.35))
        for half in (0, 0.5):
            add(t + half * ibi, _hat(rng, 0.12 if bright else 0.06, 0.06 if bright else 0.02))
        if bright:
            add(t + 0.5 * ibi, _tone([CHORDS[label][bar % 4][1][pos % 3] * 2], ibi * 0.45, 0.05))

    out = out[: int(duration * SR)]
    out += 10 ** (noise_db / 20) * rng.standard_normal(len(out))
    out *= 0.9 / np.abs(out).max()
    bar_starts = beats[::beats_per_bar]
    boundaries, k = [], 0
    for label, count in sections[:-1]:
        k += count
        boundaries.append(k + 1)  # 1-based bar where a new section starts
    truth = {
        "bpm": bpm,
        "beatsPerBar": beats_per_bar,
        "beats": beats.tolist(),
        "downbeats": bar_starts.tolist(),
        "sectionStartBars": boundaries,
        "sectionLabels": [label for label, _ in sections],
        "duration": len(out) / SR,
    }
    return out.astype(np.float32), truth


def write_wav(path, samples):
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(pcm.tobytes())


if __name__ == "__main__":
    kind, out_path = sys.argv[1], sys.argv[2]
    if kind != "audio":
        sys.exit(f"unknown kind {kind!r}")
    samples, truth = beat_track()
    write_wav(out_path, samples)
    print(json.dumps(truth))
