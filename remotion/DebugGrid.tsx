import type React from "react";
import { AbsoluteFill, Html5Audio, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Song } from "../src/schema/song";

export type DebugGridProps = {
  title: string;
  fps: number;
  width: number;
  height: number;
  /** The composition shows song frames [startFrame, endFrame); video frame 0 is song frame startFrame. */
  startFrame: number;
  endFrame: number;
  /** Audio path inside the public dir, or null for silence. */
  audio: string | null;
  song: Pick<Song, "beatsPerBar" | "beats" | "downbeats" | "bars" | "sections">;
};

// Opacity eases out quadratically so every frame of the decay changes less than the one before: the onset
// stays the only frame-difference peak, and short decays keep qa's rolling baseline at the quiet level.
const BEAT_FLASH = { peak: 0.5, frames: 2 };
const DOWNBEAT_FLASH = { peak: 1, frames: 3 };

/** Index of the last element <= x in an ascending list, or -1. */
function lastAtOrBefore(xs: number[], x: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

export const DebugGrid: React.FC<DebugGridProps> = ({ title, startFrame, audio, song }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const songFrame = startFrame + frame;
  const time = songFrame / fps;

  const beatFrames = song.beats.map((t) => Math.round(t * fps));
  const downbeatFrames = new Set(song.downbeats.map((t) => Math.round(t * fps)));
  const beat = lastAtOrBefore(beatFrames, songFrame);
  let flash = 0;
  if (beat >= 0) {
    const { peak, frames } = downbeatFrames.has(beatFrames[beat]!) ? DOWNBEAT_FLASH : BEAT_FLASH;
    const age = songFrame - beatFrames[beat]!;
    if (age < frames) flash = peak * (1 - age / frames) ** 2;
  }

  const barFrames = song.bars.map((b) => Math.round(b.start * fps));
  const barIndex = lastAtOrBefore(barFrames, songFrame);
  const bar = barIndex >= 0 && time < song.bars[barIndex]!.end ? song.bars[barIndex]! : null;
  const beatInBar = bar && beat >= 0 ? beat - lastAtOrBefore(beatFrames, barFrames[barIndex]!) : -1;
  const section = song.sections.find((s) => time >= s.start && time < s.end);

  return (
    <AbsoluteFill style={{ backgroundColor: "#101418", color: "#f2f2f2", fontFamily: "Helvetica, Arial, sans-serif" }}>
      {audio && <Html5Audio src={staticFile(audio)} trimBefore={startFrame} />}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 40 }}>
        <div style={{ fontSize: 96, color: "#e0a060" }}>{section?.label ?? " "}</div>
        <div style={{ fontSize: 240, fontWeight: 700 }}>{bar ? `bar ${bar.index}` : "pickup"}</div>
        <div style={{ display: "flex", gap: 36 }}>
          {Array.from({ length: song.beatsPerBar }, (_, i) => (
            <div key={i} style={{ width: 90, height: 90, borderRadius: 12, backgroundColor: i === beatInBar ? "#f2f2f2" : "#2a3038" }} />
          ))}
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 48, bottom: 36, fontSize: 36, color: "#8a929c" }}>
        {title} · {time.toFixed(2)} s · song frame {songFrame}
      </div>
      <AbsoluteFill style={{ backgroundColor: "white", opacity: flash }} />
    </AbsoluteFill>
  );
};
