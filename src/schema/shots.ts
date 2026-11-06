import { z } from "zod";

const BarIndex = z.number().int().positive();
const PoseId = z.string().regex(/^[a-z0-9]+$/, "pose ids are short lowercase tokens like a, b, c");

export const PoseSchema = z.strictObject({
  id: PoseId,
  /** null for the base frame itself; otherwise the edit applied to the base frame. */
  edit: z.string().min(1).nullable(),
});

export const ShotSchema = z
  .strictObject({
    id: z.string().min(1),
    /** First and last bar, inclusive, using song.json bar numbers. */
    bars: z.tuple([BarIndex, BarIndex]),
    /** A section label from song.json. */
    section: z.string().min(1),
    /** Character ids from the project bible; empty for scenery shots. */
    characters: z.array(z.string().min(1)),
    framing: z.enum(["wide", "full", "medium", "medium-close", "close-up", "extreme-close-up"]),
    /** Description of the base frame. */
    base: z.string().min(1),
    /** 1-4 drawings for the same camera setup; the first one is the base frame. */
    poses: z.array(PoseSchema).min(1).max(4),
    /** Advance one step through `pattern` on every unit; the pattern repeats. null holds the single pose. */
    switch: z
      .strictObject({
        on: z.enum(["beat", "half-beat", "downbeat"]),
        pattern: z.array(PoseId).min(1),
      })
      .nullable(),
    camera: z.strictObject({
      move: z.enum(["static", "push", "pull", "pan-left", "pan-right", "tilt-up", "tilt-down"]),
      /** Parallax strength, 0 (flat) to 1 (strong). */
      depth: z.number().min(0).max(1),
    }),
    /** `effect` or `effect@trigger`, for example `flash@downbeat`. */
    fx: z.array(z.string().regex(/^[a-z][a-z0-9-]*(@(beat|half-beat|downbeat))?$/, "expected effect or effect@beat|half-beat|downbeat")),
  })
  .superRefine((shot, ctx) => {
    const issue = (message: string, path: PropertyKey[]) => ctx.addIssue({ code: "custom", message, path });
    if (shot.bars[0] > shot.bars[1]) issue("bars must be [first, last] with first <= last", ["bars"]);
    const ids = shot.poses.map((p) => p.id);
    if (new Set(ids).size !== ids.length) issue("pose ids must be unique", ["poses"]);
    shot.poses.forEach((p, i) => {
      if (i === 0 && p.edit !== null) issue("the first pose is the base frame and must have edit: null", ["poses", 0, "edit"]);
      if (i > 0 && p.edit === null) issue("only the first pose may have edit: null", ["poses", i, "edit"]);
    });
    if (shot.poses.length > 1 && shot.switch === null) issue("shots with several poses need a switch", ["switch"]);
    if (shot.poses.length === 1 && shot.switch !== null) issue("a single-pose shot must have switch: null", ["switch"]);
    shot.switch?.pattern.forEach((id, i) => {
      if (!ids.includes(id)) issue(`unknown pose id "${id}"`, ["switch", "pattern", i]);
    });
  });

export const ShotsSchema = z
  .strictObject({
    version: z.literal(1),
    shots: z.array(ShotSchema).min(1),
  })
  .superRefine(({ shots }, ctx) => {
    const seen = new Set<string>();
    shots.forEach((shot, i) => {
      if (seen.has(shot.id)) ctx.addIssue({ code: "custom", message: `duplicate shot id "${shot.id}"`, path: ["shots", i, "id"] });
      seen.add(shot.id);
      const prev = shots[i - 1];
      if (prev && shot.bars[0] <= prev.bars[1])
        ctx.addIssue({ code: "custom", message: "shots must be in bar order and must not overlap", path: ["shots", i, "bars"] });
    });
  });

export type Pose = z.infer<typeof PoseSchema>;
export type Shot = z.infer<typeof ShotSchema>;
export type Shots = z.infer<typeof ShotsSchema>;
