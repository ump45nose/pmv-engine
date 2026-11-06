import path from "node:path";
import { parseArgs } from "node:util";
import { generateArt, type Status } from "../lib/art";
import { pmv, required, type Command } from "../lib/cli";
import { codexBackend } from "../lib/imagegen";
import { projectPaths } from "../lib/project";

export const art: Command = async (args) => {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      project: { type: "string" },
      only: { type: "string" },
      jobs: { type: "string", default: "2" },
      force: { type: "boolean", default: false },
      dry: { type: "boolean", default: false },
    },
  });
  const dir = required(values.project, "--project");
  const jobs = Number(values.jobs);
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error(`--jobs expects a positive integer, got "${values.jobs}"`);
  const paths = projectPaths(dir);

  const drawings = await generateArt(dir, { only: values.only, jobs, force: values.force, dry: values.dry }, codexBackend);
  const missed = drawings.filter((d) => d.status === "failed" || d.status === "blocked");
  if (missed.length > 0)
    throw new Error(
      `${missed.length} of ${drawings.length} drawings were not made (${missed.map((d) => `${d.shot}/${d.pose}: ${d.error}`).join("; ")}); attempts are in ${paths.jobs}`,
    );

  const count = (status: Status) => drawings.filter((d) => d.status === status).length;
  const generated = drawings.filter((d) => d.status === "generated");
  return {
    outputs: {
      ...Object.fromEntries(generated.map((d) => [`${d.shot}/${d.pose}`, path.join(paths.root, d.output)])),
      ...(generated.length > 0 && { jobs: paths.jobs }),
    },
    summary: {
      generated: count("generated"),
      skipped: count("skipped"),
      planned: count("planned"),
      attempts: generated.reduce((n, d) => n + d.attempts, 0),
      drawings: drawings.map(
        (d) =>
          `${d.shot}/${d.pose} ${d.kind} ${d.status}` +
          (d.size ? ` ${d.size.width}x${d.size.height} in ${d.seconds} s` : "") +
          (d.attempts > 1 ? ` after ${d.attempts} attempts` : ""),
      ),
    },
    next: values.dry ? pmv("art", ...args.filter((a) => a !== "--dry")) : pmv("artcheck", "--project", dir, "--bpm", "<bpm>"),
  };
};
