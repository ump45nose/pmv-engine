import { describe, expect, test } from "bun:test";
import example from "../examples/shots.example.json";
import { ProjectSchema } from "../src/schema/project";
import { ShotsSchema, type Shot } from "../src/schema/shots";
import { SongSchema } from "../src/schema/song";

const shot = example.shots[1] as Shot;
const withShot = (patch: Partial<Shot>) => ({ version: 1, shots: [{ ...shot, ...patch }] });
const messages = (data: unknown) => {
  const result = ShotsSchema.safeParse(data);
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

describe("shots schema", () => {
  test("the example validates", () => {
    expect(ShotsSchema.parse(example).shots.map((s) => s.id)).toEqual(["C1-01", "C1-03"]);
  });

  test("pattern must reference existing poses", () => {
    expect(messages(withShot({ switch: { on: "beat", pattern: ["a", "c"] } }))).toEqual(['unknown pose id "c"']);
  });

  test("the first pose is the unedited base frame", () => {
    expect(messages(withShot({ poses: [{ id: "a", edit: "raise arm" }, { id: "b", edit: null }] }))).toEqual([
      "the first pose is the base frame and must have edit: null",
      "only the first pose may have edit: null",
    ]);
  });

  test("single-pose shots hold, multi-pose shots switch", () => {
    expect(messages(withShot({ switch: null }))).toEqual(["shots with several poses need a switch"]);
    expect(messages(withShot({ poses: [{ id: "a", edit: null }], switch: { on: "beat", pattern: ["a"] } }))).toEqual([
      "a single-pose shot must have switch: null",
    ]);
  });

  test("bars, fx and unknown keys are checked", () => {
    expect(messages(withShot({ bars: [35, 33] }))).toEqual(["bars must be [first, last] with first <= last"]);
    expect(messages(withShot({ fx: ["flash@chorus"] }))).toEqual(["expected effect or effect@beat|half-beat|downbeat"]);
    expect(messages({ version: 1, shots: [{ ...shot, lyrics: "la" }] })).toHaveLength(1);
  });

  test("shots are ordered and do not overlap", () => {
    const [a, b] = example.shots;
    expect(messages({ version: 1, shots: [b, a] })).toEqual(["shots must be in bar order and must not overlap"]);
    expect(messages({ version: 1, shots: [a, { ...b, id: a!.id }] })).toEqual([`duplicate shot id "${a!.id}"`]);
  });
});

describe("project and song schemas", () => {
  const project = { version: 1, title: "t", fps: 24, width: 1920, height: 1080, audio: "song/audio.wav", sections: [] };

  test("manual sections must not overlap", () => {
    const sections = [
      { label: "verse", start: 10, end: 30 },
      { label: "chorus", start: 25, end: 50 },
    ];
    expect(ProjectSchema.safeParse({ ...project, sections }).success).toBe(false);
    expect(ProjectSchema.safeParse({ ...project, sections: [sections[0]] }).success).toBe(true);
  });

  test("audio may be missing until analyze", () => {
    expect(ProjectSchema.safeParse({ ...project, audio: null }).success).toBe(true);
    expect(ProjectSchema.safeParse({ ...project, audio: "" }).success).toBe(false);
  });

  test("beats must be increasing", () => {
    const song = {
      version: 1,
      audio: { path: "song/audio.wav", sha256: "0".repeat(64), duration: 10, sampleRate: 44100 },
      bpm: 120,
      beatsPerBar: 4,
      beats: [0.5, 1, 1.5],
      downbeats: [0.5],
      bars: [{ index: 1, start: 0.5, end: 2.5 }],
      sections: [{ label: "A", start: 0.5, end: 2.5, bars: [1, 1], source: "auto" }],
      lyrics: [],
      analyzer: { beats: "x", sections: "y" },
    };
    expect(SongSchema.safeParse(song).success).toBe(true);
    expect(SongSchema.safeParse({ ...song, beats: [0.5, 1.5, 1] }).success).toBe(false);
  });
});
