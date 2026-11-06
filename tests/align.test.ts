import { expect, test } from "bun:test";
import { alignEvents } from "../src/lib/align";

const beats = [10, 10.5, 11, 11.5];

test("offsets are frames from the nearest beat, measured from the song start of frame 0", () => {
  // start 9.5 s at 24 fps: frame 12 is 10.0 s, 25 is ~10.54 s, 47 is ~11.46 s, 51 is 11.625 s.
  const result = alignEvents(
    [
      { frame: 12, type: "cut", strength: 50 },
      { frame: 25, type: "switch", strength: 5 },
      { frame: 47, type: "switch", strength: 5 },
      { frame: 51, type: "switch", strength: 5 },
    ],
    beats,
    9.5,
    24,
  );
  expect(result.events.map((e) => [e.beat, e.offset])).toEqual([
    [0, 0],
    [1, 1],
    [3, -1],
    [3, 3],
  ]);
  expect(result).toMatchObject({ count: 4, withinTolerance: 0.75, withinOneFrame: 0.75, medianOffset: 0.5, medianAbsOffset: 1 });
  expect(result.byType.cut).toEqual({ count: 1, withinTolerance: 1, withinOneFrame: 1, medianOffset: 0, medianAbsOffset: 0 });
});

test("no events gives empty stats", () => {
  const result = alignEvents([], beats, 0, 24);
  expect(result).toMatchObject({ count: 0, withinTolerance: null, medianOffset: null, events: [] });
});
