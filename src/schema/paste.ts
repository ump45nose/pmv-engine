import { z } from "zod";

const Size = z.tuple([z.number().int().positive(), z.number().int().positive()]);

/** What `pmv_tools.paste` prints for one shot. */
export const PasteSchema = z.strictObject({
  /** The base frame's size, which every final frame and mask gets. */
  size: Size,
  poses: z.record(
    z.string(),
    z.strictObject({
      /** The final frame, art/<shot>/<pose>.png. */
      image: z.string(),
      /** The soft mask, art/<shot>/<pose>.mask.png: 16-bit gray, 0 keeps the base frame, 65535 takes the raw drawing. */
      mask: z.string(),
      /** The raw drawing art/<shot>/<pose>.raw.png is scaled to `size` first when its own size differs. */
      rawSize: Size,
      /** Share of pixels not taken purely from the base frame. */
      area: z.number().min(0).max(1),
    }),
  ),
  params: z.strictObject({
    blur: z.number().positive(),
    threshold: z.number().positive(),
    open: z.number().nonnegative(),
    close: z.number().nonnegative(),
    minArea: z.number().nonnegative(),
    grow: z.number().nonnegative(),
    feather: z.number().positive(),
  }),
});

export type Paste = z.infer<typeof PasteSchema>;
