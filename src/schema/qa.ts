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

const Size = z.tuple([z.number().int().positive(), z.number().int().positive()]);
const Flicker = z.strictObject({ mean: z.number().nonnegative(), max: z.number().nonnegative() });

/** What `pmv artcheck --ab` adds: every later pose's raw drawing against its final frame, pasted back onto the base frame. */
export const PasteCheckSchema = z.strictObject({
  /** Flip test, 1920x540: the raw drawings on the left, the final frames on the right. */
  ab: z.string(),
  /** The base frame and the final frames, each pose's mask below it. */
  sheet: z.string(),
  poses: z.record(
    z.string(),
    z.strictObject({
      /** Share of pixels not taken purely from the base frame. */
      area: Frac,
      /** Mean absolute difference (0-255) between the raw drawing and the base frame inside the feather band: what the seam has to hide. */
      seam: z.number().nonnegative(),
    }),
  ),
  /** The pixels outside every pose's mask, and their mean absolute gray change (0-255) across the switches of ab.mp4, per side. */
  background: z.strictObject({ area: Frac, original: Flicker, paste: Flicker }),
  params: z.strictObject({ half: Size }),
});

/** What `pmv_tools.artcheck` prints for one shot; `pmv artcheck` saves it as art/<shot>/check.json. */
export const ArtCheckSchema = z.strictObject({
  sheet: z.string(),
  flip: z.string(),
  /** Pixel size of each pose's PNG. */
  sizes: z.record(z.string(), Size),
  /**
   * Each later pose against the base frame at 320x180 gray: mean absolute difference (0-255) over the whole frame,
   * over the edge band (top 15%, left and right 10%), a rough proxy for background drift, and over the band's two
   * top corners, background only in the test shots. `shift`: the pose's overall offset in pixels by phase correlation
   * at full size, with the correlation peak (0-1).
   */
  drift: z.record(
    z.string(),
    z.strictObject({
      full: z.number().nonnegative(),
      edge: z.number().nonnegative(),
      corners: z.number().nonnegative(),
      shift: z.strictObject({ dx: z.number().int(), dy: z.number().int(), peak: z.number() }),
    }),
  ),
  /** Frames of flip.mp4 where the drawing changes. */
  switches: z.array(Frame),
  frames: z.number().int().positive(),
  paste: PasteCheckSchema.nullable(),
  params: z.strictObject({
    analysisSize: Size,
    edgeBand: z.strictObject({ top: Frac, sides: Frac }),
    panel: Size,
    bpm: z.number().positive(),
    fps: z.number().int().positive(),
  }),
});

export type VideoEvent = z.infer<typeof VideoEventSchema>;
export type VideoMeasurement = z.infer<typeof VideoMeasurementSchema>;
export type BeatAlignment = z.infer<typeof BeatAlignmentSchema>;
export type QaReport = z.infer<typeof QaReportSchema>;
