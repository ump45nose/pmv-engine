import { copyFile, mkdir } from "node:fs/promises";
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
    shots: path.join(root, "shots.json"),
    bible: path.join(root, "bible", "characters.json"),
    art: path.join(root, "art"),
    jobs: path.join(root, "jobs.jsonl"),
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

/** Copy a song into the project's song/ folder; returns its path relative to the project. */
export async function importAudio(dir: string, file: string): Promise<string> {
  const paths = projectPaths(dir);
  const source = path.resolve(file);
  if (!(await Bun.file(source).exists())) throw new Error(`audio file not found: ${source}`);
  const audio = path.join("song", `audio${path.extname(source).toLowerCase()}`);
  await mkdir(paths.songDir, { recursive: true });
  await copyFile(source, path.join(paths.root, audio));
  return audio;
}

/**
 * The song range a render covers by default, in whole frames: the first manual section, else the whole song.
 * Renders start on a frame boundary, so qa defaults to the same quantised start.
 */
export function defaultRange(project: Project, song: Song) {
  const section = project.sections[0];
  return section
    ? { startFrame: Math.round(section.start * project.fps), endFrame: Math.round(section.end * project.fps) }
    : { startFrame: 0, endFrame: Math.floor(song.audio.duration * project.fps) };
}
