import { z } from "zod";

export const ManualSectionSchema = z
  .strictObject({
    label: z.string().min(1),
    start: z.number().nonnegative(),
    end: z.number().positive(),
  })
  .refine((s) => s.end > s.start, { message: "section end must be after start" });

export const ProjectSchema = z
  .strictObject({
    version: z.literal(1),
    title: z.string().min(1),
    fps: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    /** Audio file path, relative to the project directory. */
    audio: z.string().min(1),
    /** Hand-picked sections in song seconds; they override auto sections where they overlap. */
    sections: z.array(ManualSectionSchema),
  })
  .refine((p) => p.sections.every((s, i) => i === 0 || s.start >= p.sections[i - 1]!.end), {
    message: "sections must be sorted and must not overlap",
    path: ["sections"],
  });

export type ManualSection = z.infer<typeof ManualSectionSchema>;
export type Project = z.infer<typeof ProjectSchema>;
