import { z } from "zod";

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const Tokens = z.number().int().nonnegative();

/** One image generation attempt: a line of <project>/jobs.jsonl. Paths are relative to the project directory. */
export const JobSchema = z.strictObject({
  /** Start of the attempt. */
  time: z.iso.datetime(),
  shot: z.string().min(1),
  pose: z.string().min(1),
  /** base: drawn from the character refs; variant: an edit of the shot's base frame. */
  kind: z.enum(["base", "variant"]),
  /** 1, then 2 for the automatic retry. */
  attempt: z.number().int().positive(),
  promptSha256: Sha256,
  /** In the order given to the backend; a variant's first ref is its base frame. */
  refs: z.array(z.strictObject({ path: z.string().min(1), sha256: Sha256 })),
  output: z.string().min(1),
  /** null when the attempt failed. */
  outputSha256: Sha256.nullable(),
  ok: z.boolean(),
  seconds: z.number().nonnegative(),
  size: z.strictObject({ width: z.number().int().positive(), height: z.number().int().positive() }).nullable(),
  error: z.string().nullable(),
  backend: z.string().min(1),
  /** The `codex exec` session behind the attempt, when the backend reports it. */
  codex: z
    .strictObject({
      threadId: z.string().nullable(),
      tokens: z.strictObject({ input: Tokens, cachedInput: Tokens, output: Tokens, reasoning: Tokens }).nullable(),
    })
    .nullable(),
});

export type Job = z.infer<typeof JobSchema>;
