import type { BeatAlignment, VideoEvent } from "../schema/qa";
import { round } from "./cli";

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function stats(offsets: number[], tolerance: number) {
  const share = (limit: number) => (offsets.length ? round(offsets.filter((o) => Math.abs(o) <= limit).length / offsets.length, 4) : null);
  const med = median(offsets);
  const medAbs = median(offsets.map(Math.abs));
  return {
    count: offsets.length,
    withinTolerance: share(tolerance),
    withinOneFrame: share(1),
    medianOffset: med === null ? null : round(med, 2),
    medianAbsOffset: medAbs === null ? null : round(medAbs, 2),
  };
}

/** Offset of each event from its nearest beat, in frames. `start` is the song second shown on video frame 0. */
export function alignEvents(events: VideoEvent[], beats: number[], start: number, fps: number, tolerance = 2): BeatAlignment {
  if (!beats.length) throw new Error("song.json has no beats");
  const rows = events.map((e) => {
    const time = start + e.frame / fps;
    let beat = 0;
    for (let i = 1; i < beats.length; i++) if (Math.abs(beats[i]! - time) < Math.abs(beats[beat]! - time)) beat = i;
    return { ...e, time: round(time, 4), beat, offset: round((time - beats[beat]!) * fps, 2) };
  });
  const offsets = (type?: VideoEvent["type"]) => rows.filter((r) => !type || r.type === type).map((r) => r.offset);
  return {
    tolerance,
    ...stats(offsets(), tolerance),
    byType: { cut: stats(offsets("cut"), tolerance), switch: stats(offsets("switch"), tolerance) },
    events: rows,
  };
}
