import { z } from "zod";

export type CommandResult = {
  /** Files written by the command, as absolute paths. */
  outputs: Record<string, string>;
  summary: Record<string, unknown>;
  /** Suggested next command, or null at the end of the pipeline. */
  next: string | null;
};

export type Command = (args: string[]) => Promise<CommandResult>;

export function required<T>(value: T | undefined, flag: string): T {
  if (value === undefined) throw new Error(`missing ${flag}`);
  return value;
}

export function parse<S extends z.ZodType>(schema: S, data: unknown, what: string): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw new Error(`${what} is invalid:\n${z.prettifyError(result.error)}`);
  return result.data;
}

const quote = (arg: string) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`);

/** A copy-pasteable `bun run pmv ...` command line. */
export function pmv(...args: string[]): string {
  return ["bun", "run", "pmv", ...args].map(quote).join(" ");
}

export function round(x: number, digits: number): number {
  const k = 10 ** digits;
  return Math.round(x * k) / k;
}
