import path from "node:path";
import { parseArgs } from "node:util";
import { ProjectSchema, type ManualSection } from "../schema/project";
import { parse, pmv, required, type Command } from "../lib/cli";
import { importAudio, projectPaths, writeJson } from "../lib/project";

/** `chorus:62.5-88` -> { label: "chorus", start: 62.5, end: 88 } */
function parseSection(spec: string): ManualSection {
  const m = /^([^:]+):(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(spec);
  if (!m) throw new Error(`--section expects label:start-end in seconds, got "${spec}"`);
  return { label: m[1]!, start: Number(m[2]), end: Number(m[3]) };
}

export const init: Command = async (args) => {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      project: { type: "string" },
      audio: { type: "string" },
      title: { type: "string" },
      fps: { type: "string", default: "24" },
      width: { type: "string", default: "1920" },
      height: { type: "string", default: "1080" },
      section: { type: "string", multiple: true, default: [] },
    },
  });
  const dir = required(values.project, "--project");
  const paths = projectPaths(dir);
  if (await Bun.file(paths.project).exists()) throw new Error(`${paths.project} already exists`);

  const project = parse(
    ProjectSchema,
    {
      version: 1,
      title: values.title ?? path.basename(paths.root),
      fps: Number(values.fps),
      width: Number(values.width),
      height: Number(values.height),
      audio: null,
      sections: values.section.map(parseSection),
    },
    "project settings",
  );
  if (values.audio !== undefined) project.audio = await importAudio(dir, values.audio);
  await writeJson(paths.project, project);
  return {
    outputs: { project: paths.project, ...(project.audio && { audio: path.join(paths.root, project.audio) }) },
    summary: {
      title: project.title,
      fps: project.fps,
      size: `${project.width}x${project.height}`,
      audio: project.audio,
      sections: project.sections.map((s) => `${s.label} ${s.start}-${s.end}s`),
    },
    next: project.audio ? pmv("analyze", "--project", dir) : pmv("analyze", "--project", dir, "--audio", "<song file>"),
  };
};
