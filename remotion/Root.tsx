import { Composition } from "remotion";
import { DebugGrid, type DebugGridProps } from "./DebugGrid";

const placeholder: DebugGridProps = {
  title: "debug grid",
  fps: 24,
  width: 1920,
  height: 1080,
  startFrame: 0,
  endFrame: 96,
  audio: null,
  song: {
    beatsPerBar: 4,
    beats: [0.5, 1, 1.5, 2, 2.5, 3, 3.5],
    downbeats: [0.5, 2.5],
    bars: [
      { index: 1, start: 0.5, end: 2.5 },
      { index: 2, start: 2.5, end: 4 },
    ],
    sections: [],
  },
};

export const Root = () => (
  <Composition
    id="DebugGrid"
    component={DebugGrid}
    defaultProps={placeholder}
    calculateMetadata={({ props }) => ({
      fps: props.fps,
      width: props.width,
      height: props.height,
      durationInFrames: props.endFrame - props.startFrame,
    })}
  />
);
