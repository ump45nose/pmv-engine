import { parseArgs } from "node:util";
import { pasteVariants, selectPoses } from "../lib/art";
import { pmv, required, type Command } from "../lib/cli";
import { projectPaths, readJson } from "../lib/project";
import { ShotsSchema } from "../schema/shots";

/** Rebuild the selected variants' final frames and masks from the base frames and raw drawings on disk; draws nothing. */
export const paste: Command = async (args) => {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      project: { type: "string" },
      only: { type: "string" },
    },
  });
  const dir = required(values.project, "--project");
  const { shots } = await readJson(projectPaths(dir).shots, ShotsSchema);
  const selected = selectPoses(shots, values.only);
  const work = shots.flatMap((shot) => {
    const variants = shot.poses.slice(1).filter((p) => selected.get(shot.id)?.has(p.id));
    return variants.length > 0 ? [{ shot, variants: variants.map((p) => p.id) }] : [];
  });
  if (work.length === 0) throw new Error("nothing to paste: the selected poses are all base frames, which are their own final frames");

  const outputs: Record<string, string> = {};
  const poses: string[] = [];
  let params;
  for (const { shot, variants } of work) {
    const result = await pasteVariants(dir, shot, variants);
    const [width, height] = result.size;
    for (const [pose, p] of Object.entries(result.poses)) {
      Object.assign(outputs, { [`${shot.id}/${pose}`]: p.image, [`${shot.id}/${pose}.mask`]: p.mask });
      const [w, h] = p.rawSize;
      poses.push(`${shot.id}/${pose} mask area ${p.area}` + (w !== width || h !== height ? `, raw ${w}x${h} scaled to ${width}x${height}` : ""));
    }
    params = result.params;
  }
  return { outputs, summary: { pasted: poses.length, poses, params }, next: pmv("artcheck", "--project", dir, "--bpm", "<bpm>") };
};
