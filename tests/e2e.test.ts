import { expect, test } from "bun:test";
import path from "node:path";
import type { QaReport } from "../src/schema/qa";
import type { Song } from "../src/schema/song";
import { runCli, synthAudio, tempDir } from "./helpers";

const FRAME = 1 / 24;
const hitRate = (xs: number[], ref: number[]) => xs.filter((x) => ref.some((r) => Math.abs(r - x) <= FRAME)).length / xs.length;

test(
  "synthetic track -> init -> analyze -> render --debug-grid -> qa",
  async () => {
    const dir = await tempDir("e2e");
    const audio = path.join(dir, "track.wav");
    const truth = await synthAudio(audio);
    const project = path.join(dir, "proj");
    const step = async (...args: string[]) => {
      const { code, json, stderr } = await runCli(...args, "--project", project);
      if (code !== 0) throw new Error(`${args[0]} failed: ${json.error}\n${stderr.slice(-2000)}`);
      return json;
    };

    await step("init", "--audio", audio, "--section", "chorus:5-17");

    const analyzed = await step("analyze");
    const song: Song = await Bun.file(analyzed.outputs.song).json();
    expect(Math.abs(song.bpm - truth.bpm)).toBeLessThanOrEqual(1);
    expect(hitRate(song.beats, truth.beats)).toBeGreaterThanOrEqual(0.95);
    expect(hitRate(truth.beats, song.beats)).toBeGreaterThanOrEqual(0.95);
    expect(hitRate(song.downbeats, truth.downbeats)).toBeGreaterThanOrEqual(0.9);
    expect(hitRate(truth.downbeats, song.downbeats)).toBeGreaterThanOrEqual(0.9);
    expect(song.sections.find((s) => s.source === "manual")).toMatchObject({ label: "chorus", start: 5, end: 17 });

    const rendered = await step("render", "--debug-grid");
    expect(rendered.next).toBe(`bun run pmv qa --project ${project} --video ${rendered.outputs.video} --start 5`);

    const checked = await step("qa", "--video", rendered.outputs.video);
    const report: QaReport = await Bun.file(checked.outputs.report).json();
    expect(report.video).toMatchObject({ frames: 288, fps: 24, width: 1920, height: 1080 });
    expect(report.start).toBe(5);
    expect(report.motion.cuts).toEqual([]);
    // Every beat flash after video frame 0 is one event, on the beat to within a frame.
    const flashes = song.beats.map((t) => Math.round(t * 24)).filter((f) => f > 5 * 24 && f < 17 * 24);
    expect(report.beats.count).toBe(flashes.length);
    expect(report.beats.withinOneFrame!).toBeGreaterThanOrEqual(0.98);
    expect(Math.abs(report.audio!.lagMs)).toBeLessThan(5);
    expect(report.audio!.peak).toBeGreaterThan(0.9);
  },
  600_000,
);
