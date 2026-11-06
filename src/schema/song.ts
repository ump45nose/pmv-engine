import { z } from "zod";

const Seconds = z.number().nonnegative();
const BarIndex = z.number().int().positive();
const sorted = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1]!);

/** Bars are numbered from 1 at the first downbeat; beats before it are a pickup. */
export const BarSchema = z.strictObject({ index: BarIndex, start: Seconds, end: Seconds });

export const SectionSchema = z.strictObject({
  label: z.string().min(1),
  start: Seconds,
  end: Seconds,
  /** First and last bar (inclusive) whose midpoint lies inside [start, end). */
  bars: z.tuple([BarIndex, BarIndex]),
  source: z.enum(["auto", "manual"]),
});

/** Draft for W3; analyze always writes an empty list for now. */
export const LyricLineSchema = z.strictObject({ start: Seconds, end: Seconds, text: z.string() });

export const SongSchema = z.strictObject({
  version: z.literal(1),
  audio: z.strictObject({
    /** Relative to the project directory. */
    path: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    duration: z.number().positive(),
    sampleRate: z.number().int().positive(),
  }),
  bpm: z.number().positive(),
  beatsPerBar: z.number().int().positive(),
  beats: z.array(Seconds).refine(sorted, "beats must be strictly increasing"),
  downbeats: z.array(Seconds).refine(sorted, "downbeats must be strictly increasing"),
  bars: z
    .array(BarSchema)
    .refine((bars) => bars.every((b, i) => b.index === i + 1 && b.end > b.start), "bars must be numbered 1..n with end > start"),
  sections: z.array(SectionSchema),
  lyrics: z.array(LyricLineSchema),
  analyzer: z.strictObject({ beats: z.string(), sections: z.string() }),
});

/** What `pmv_tools.analyze` prints; the CLI adds the file info, manual sections and lyrics. */
export const SongAnalysisSchema = SongSchema.omit({ version: true, audio: true, lyrics: true }).extend({
  duration: z.number().positive(),
  sampleRate: z.number().int().positive(),
});

export type Bar = z.infer<typeof BarSchema>;
export type Section = z.infer<typeof SectionSchema>;
export type Song = z.infer<typeof SongSchema>;
export type SongAnalysis = z.infer<typeof SongAnalysisSchema>;
