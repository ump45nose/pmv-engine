import { z } from "zod";

const Frac = z.number().min(0).max(1);
const Frame = z.number().int().nonnegative();

export const VideoInfoSchema = z.strictObject({
  path: z.string(),
  frames: z.number().int().positive(),
  fps: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  duration: z.number().positive(),
});

/** Ported from the motion_stats.py used on the two old cuts; frames are analysed at 160x90 gray. */
export const MotionSchema = z.strictObject({
  /** Frame index of the first frame of each new shot. */
  cuts: z.array(Frame),
  cutsPerMin: z.number().nonnegative(),
  /** Seconds. */
  shotLengths: z.strictObject({ count: z.number().int().positive(), median: z.number(), mean: z.number(), max: z.number() }),
  /** Mean absolute gray difference to the previous frame (0-255), cut frames excluded. */
  madWithinShot: z.strictObject({ p10: z.number(), median: z.number(), p90: z.number() }),
  /** Share of pixels whose gray value changed by more than 8 since the previous frame, cut frames excluded. */
  changedPxWithinShot: z.strictObject({ median: Frac, p90: Frac }),
  /** Share of non-cut frames identical to the previous frame. */
  identicalFrac: Frac,
  /** Longest time the picture stays exactly the same, in seconds. */
  longestStill: z.number().nonnegative(),
});

export const VideoEventSchema = z.strictObject({
  /** First frame showing the new picture. */
  frame: Frame,
  /** cut: a new shot; switch: a frame-difference spike inside a shot (drawing switch, flash). */
  type: z.enum(["cut", "switch"]),
  /** Mean absolute gray difference to the previous frame. */
  strength: z.number().nonnegative(),
});

export const AudioLagSchema = z.strictObject({
  /** Positive when the video's audio is late relative to the song. */
  lagMs: z.number(),
  /** Normalised cross-correlation at the lag; close to 1 when the audio matches the song. */
  peak: z.number(),
});

export const VideoParamsSchema = z.strictObject({
  analysisSize: z.tuple([z.number().int(), z.number().int()]),
  cutHist: z.number(),
  cutMad: z.number(),
  cutMergeFrames: z.number().int(),
  flashReturnFrames: z.number().int(),
  changedPx: z.number(),
  identicalMad: z.number(),
  spikeMinMad: z.number(),
  spikeRatio: z.number(),
  spikeWindow: z.number().int(),
});

/** What `pmv_tools.qa` prints. */
export const VideoMeasurementSchema = z.strictObject({
  video: VideoInfoSchema,
  motion: MotionSchema,
  events: z.array(VideoEventSchema),
  audio: AudioLagSchema.nullable(),
  params: VideoParamsSchema,
});

const AlignmentStatsSchema = z.strictObject({
  count: z.number().int().nonnegative(),
  withinTolerance: Frac.nullable(),
  withinOneFrame: Frac.nullable(),
  medianOffset: z.number().nullable(),
  medianAbsOffset: z.number().nullable(),
});

export const BeatAlignmentSchema = AlignmentStatsSchema.extend({
  /** Frames. */
  tolerance: z.number().positive(),
  byType: z.strictObject({ cut: AlignmentStatsSchema, switch: AlignmentStatsSchema }),
  events: z.array(
    VideoEventSchema.extend({
      /** Song seconds. */
      time: z.number(),
      /** Index into song.json beats. */
      beat: z.number().int().nonnegative(),
      /** Frames from the nearest beat; negative is early. */
      offset: z.number(),
    }),
  ),
});

const BaselineVideoSchema = z.strictObject({
  changedPxWithinShot: z.strictObject({ median: Frac, p90: Frac }),
  identicalFrac: Frac,
  madWithinShotMedian: z.number(),
  shotLengthMedian: z.number(),
  cutsPerMin: z.number(),
});

export const QaReportSchema = z.strictObject({
  version: z.literal(1),
  video: VideoInfoSchema,
  /** Song second shown on video frame 0. */
  start: z.number().nonnegative(),
  motion: MotionSchema,
  beats: BeatAlignmentSchema,
  audio: AudioLagSchema.nullable(),
  baseline: z.strictObject({ source: z.string(), videos: z.record(z.string(), BaselineVideoSchema) }),
  params: VideoParamsSchema,
});

export type VideoEvent = z.infer<typeof VideoEventSchema>;
export type VideoMeasurement = z.infer<typeof VideoMeasurementSchema>;
export type BeatAlignment = z.infer<typeof BeatAlignmentSchema>;
export type QaReport = z.infer<typeof QaReportSchema>;
