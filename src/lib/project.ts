import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import { ProjectSchema, type Project } from "../schema/project";
import type { Song } from "../schema/song";
import { parse } from "./cli";

export function projectPaths(dir: string) {
  const root = path.resolve(dir);
  return {
    root,
    project: path.join(root, "project.json"),
    songDir: path.join(root, "song"),
    song: path.join(root, "song", "song.json"),
    out: path.join(root, "out"),
    qa: path.join(root, "out", "qa"),
  };
}

export async function readJson<S extends z.ZodType>(file: string, schema: S, hint = ""): Promise<z.output<S>> {
  const f = Bun.file(file);
  if (!(await f.exists())) throw new Error(`${file} not found${hint ? `; ${hint}` : ""}`);
  return parse(schema, await f.json(), file);
}

export async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await Bun.write(file, `${JSON.stringify(data, null, 2)}\n`);
}

export const readProject = (dir: string) => readJson(projectPaths(dir).project, ProjectSchema, "run `pmv init` first");

/**
 * The song range a render covers by default, in whole frames: the first manual section, else the whole song.
 * Renders start on a frame boundary, so qa defaults to the same quantised start.
 */
export function defaultRange(project: Project, song: Song) {
  const section = project.sections[0];
  return {
    startFrame: Math.round((section?.start ?? 0) * project.fps),
    endFrame: Math.round((section?.end ?? song.audio.duration) * project.fps),
  };
}
