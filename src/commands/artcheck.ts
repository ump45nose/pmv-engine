import path from "node:path";
import { parseArgs } from "node:util";
import { ArtCheckSchema } from "../schema/qa";
import { ShotsSchema } from "../schema/shots";
import { required, type Command } from "../lib/cli";
import { projectPaths, readJson, readProject, writeJson } from "../lib/project";
import { runPy } from "../lib/py";

/**
 * Per shot: a contact sheet, a flip test at a given tempo, and how far each pose's final frame drifts from the base frame.
 * `--ab` also compares each pose's raw drawing with its final frame and writes an A/B flip test.
 */
export const artcheck: Command = async (args) => {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      project: { type: "string" },
      bpm: { type: "string" },
      only: { type: "string" },
      seconds: { type: "string", default: "4" },
      ab: { type: "boolean", default: false },
    },
  });
  const dir = required(values.project, "--project");
  const bpm = Number(required(values.bpm, "--bpm"));
  if (!(bpm > 0)) throw new Error(`--bpm expects a positive number, got "${values.bpm}"`);
  const seconds = Number(values.seconds);
  if (!(seconds > 0)) throw new Error(`--seconds expects a positive number, got "${values.seconds}"`);
  const project = await readProject(dir);
  const paths = projectPaths(dir);
  const { shots } = await readJson(paths.shots, ShotsSchema);
  const chosen = (values.only?.split(",") ?? shots.map((s) => s.id)).map((id) => {
    const shot = shots.find((s) => s.id === id);
    if (!shot) throw new Error(`--only: no shot "${id}" in shots.json`);
    return shot;
  });

  const outputs: Record<string, string> = {};
  const drift: Record<string, unknown> = {};
  const paste: Record<string, unknown> = {};
  for (const shot of chosen) {
    const folder = path.join(paths.art, shot.id);
    const poses = shot.poses.map((p) => p.id);
    const missing: string[] = [];
    for (const pose of poses) if (!(await Bun.file(path.join(folder, `${pose}.png`)).exists())) missing.push(pose);
    if (missing.length > 0) throw new Error(`shot ${shot.id} has no drawing for pose ${missing.join(", ")}; run \`pmv art\` first`);
    const pattern = shot.switch?.pattern ?? poses.slice(0, 1);
    const report = await runPy(
      "artcheck",
      ["--dir", folder, "--poses", poses.join(","), "--pattern", pattern.join(","), "--bpm", String(bpm), "--fps", String(project.fps), "--seconds", String(seconds)].concat(
        values.ab ? ["--ab"] : [],
      ),
      ArtCheckSchema,
    );
    const file = path.join(folder, "check.json");
    await writeJson(file, report);
    Object.assign(outputs, { [`${shot.id}/sheet`]: report.sheet, [`${shot.id}/flip`]: report.flip, [`${shot.id}/check`]: file });
    drift[shot.id] = report.drift;
    if (report.paste) {
      Object.assign(outputs, { [`${shot.id}/ab`]: report.paste.ab, [`${shot.id}/sheet-paste`]: report.paste.sheet });
      paste[shot.id] = { poses: report.paste.poses, background: report.paste.background };
    }
  }
  return { outputs, summary: { bpm, fps: project.fps, seconds, drift, ...(values.ab && { paste }) }, next: null };
};
