import { z } from "zod";

export const CharacterSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/, "character ids are lowercase tokens like gpt or deepseek"),
  name: z.string().min(1),
  /** Image paths relative to the project directory; together they define the identity. */
  refs: z.array(z.string().min(1)).min(1).max(3),
  /** English. Face, hair, colours, outfit and accessories that stay the same in every drawing. */
  lock: z.string().min(1),
  /** English. How the character's instrument always looks. */
  instrument: z.string().min(1),
});

/** bible/characters.json */
export const BibleSchema = z
  .strictObject({
    version: z.literal(1),
    /** English. The look shared by every drawing. */
    artDirection: z.string().min(1),
    /** English. What no drawing may contain. */
    negative: z.string().min(1),
    characters: z.array(CharacterSchema).min(1),
  })
  .superRefine(({ characters }, ctx) => {
    const seen = new Set<string>();
    characters.forEach((c, i) => {
      if (seen.has(c.id)) ctx.addIssue({ code: "custom", message: `duplicate character id "${c.id}"`, path: ["characters", i, "id"] });
      seen.add(c.id);
    });
  });

export type Character = z.infer<typeof CharacterSchema>;
export type Bible = z.infer<typeof BibleSchema>;
