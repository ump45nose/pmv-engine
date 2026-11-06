import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import type { DebugGridProps } from "../../remotion/DebugGrid";
import { SongSchema } from "../schema/song";
import { pmv, required, type Command } from "../lib/cli";
import { run } from "../lib/proc";
import { defaultRange, projectPaths, readJson, readProject, writeJson } from "../lib/project";

const REPO = path.resolve(import.meta.dir, "../..");

export const render: Command = async (args) => {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      project: { type: "string" },
      "debug-grid": { type: "boolean", default: false },
      start: { type: "string" },
      end: { type: "string" },
    },
  });
  const dir = required(values.project, "--project");
  if (!values["debug-grid"]) throw new Error("only `render --debug-grid` exists so far");
  const paths = projectPaths(dir);
  const project = await readProject(dir);
  const song = await readJson(paths.song, SongSchema, "run `pmv analyze` first");

  const { fps } = project;
  const range = defaultRange(project, song);
  const startFrame = values.start === undefined ? range.startFrame : Math.round(Number(values.start) * fps);
  const endFrame = values.end === undefined ? range.endFrame : Math.round(Number(values.end) * fps);
  const lastFrame = Math.floor(song.audio.duration * fps);
  if (!(startFrame >= 0 && endFrame > startFrame && endFrame <= lastFrame))
    throw new Error(`need 0 <= --start < --end <= ${song.audio.duration} s; got frames ${startFrame}-${endFrame} at ${fps} fps`);

  const props: DebugGridProps = {
    title: project.title,
    fps,
    width: project.width,
    height: project.height,
    startFrame,
    endFrame,
    audio: path.relative(paths.songDir, path.join(paths.root, song.audio.path)),
    song,
  };
  const propsFile = path.join(REPO, ".cache", "render", `debug-grid-${process.pid}.json`);
  await writeJson(propsFile, props);
  const tmp = path.join(REPO, ".cache", "tmp");
  await mkdir(tmp, { recursive: true });
  const out = path.join(paths.out, "debug-grid.mp4");
  await run(
    [
      path.join(REPO, "node_modules", ".bin", "remotion"),
      "render",
      "remotion/index.ts",
      "DebugGrid",
      out,
      `--props=${propsFile}`,
      `--public-dir=${paths.songDir}`,
    ],
    { cwd: REPO, env: { ...process.env, TMPDIR: tmp } },
  );

  const start = startFrame / fps;
  return {
    outputs: { video: out },
    summary: { start, end: endFrame / fps, frames: endFrame - startFrame, fps, size: `${project.width}x${project.height}` },
    next: pmv("qa", "--project", dir, "--video", out, "--start", String(start)),
  };
};
