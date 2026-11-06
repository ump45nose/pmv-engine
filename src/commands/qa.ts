import path from "node:path";
import { parseArgs } from "node:util";
import { QaReportSchema, VideoMeasurementSchema, type QaReport } from "../schema/qa";
import { SongSchema } from "../schema/song";
import { alignEvents } from "../lib/align";
import { parse, required, type Command } from "../lib/cli";
import { defaultRange, projectPaths, readJson, readProject, writeJson } from "../lib/project";
import { runPy } from "../lib/py";

/** motion_stats.py on the two 5-minute, 24 fps cuts of the previous attempt (ai-band-pv). */
const BASELINE: QaReport["baseline"] = {
  source: "motion_stats.json, 2026-11-06 analysis of the two ai-band-pv cuts (5 min, 24 fps)",
  videos: {
    gemini: {
      changedPxWithinShot: { median: 0.034, p90: 0.48 },
      identicalFrac: 0.064,
      madWithinShotMedian: 1.99,
      shotLengthMedian: 6.0,
      cutsPerMin: 13.4,
    },
    codex: {
      changedPxWithinShot: { median: 0.0, p90: 0.067 },
      identicalFrac: 0.008,
      madWithinShotMedian: 0.9,
      shotLengthMedian: 3.0,
      cutsPerMin: 18.6,
    },
  },
};

export const qa: Command = async (args) => {
  const { values } = parseArgs({
    args,
    strict: true,
    options: { project: { type: "string" }, video: { type: "string" }, start: { type: "string" } },
  });
  const dir = required(values.project, "--project");
  const paths = projectPaths(dir);
  const project = await readProject(dir);
  const song = await readJson(paths.song, SongSchema, "run `pmv analyze` first");
  const video = path.resolve(required(values.video, "--video"));
  if (!(await Bun.file(video).exists())) throw new Error(`video not found: ${video}`);
  const start = values.start === undefined ? defaultRange(project, song).startFrame / project.fps : Number(values.start);
  if (!(start >= 0)) throw new Error(`--start must be a non-negative number of seconds, got "${values.start}"`);

  const audio = path.join(paths.root, song.audio.path);
  const measured = await runPy("qa", ["--video", video, "--audio", audio, "--start", String(start)], VideoMeasurementSchema);
  const report = parse(
    QaReportSchema,
    {
      version: 1,
      video: measured.video,
      start,
      motion: measured.motion,
      beats: alignEvents(measured.events, song.beats, start, measured.video.fps),
      audio: measured.audio,
      baseline: BASELINE,
      params: measured.params,
    },
    "qa report",
  );
  const out = path.join(paths.qa, `${path.parse(video).name}.json`);
  await writeJson(out, report);
  return {
    outputs: { report: out },
    summary: {
      start,
      frames: report.video.frames,
      cuts: report.motion.cuts.length,
      events: report.beats.count,
      onBeatWithin2Frames: report.beats.withinTolerance,
      onBeatWithin1Frame: report.beats.withinOneFrame,
      medianOffsetFrames: report.beats.medianOffset,
      changedPxWithinShotMedian: report.motion.changedPxWithinShot.median,
      identicalFrac: report.motion.identicalFrac,
      longestStill: report.motion.longestStill,
      audioLagMs: report.audio?.lagMs ?? null,
    },
    next: null,
  };
};
