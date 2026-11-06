import { analyze } from "./commands/analyze";
import { art } from "./commands/art";
import { init } from "./commands/init";
import { qa } from "./commands/qa";
import { render } from "./commands/render";
import type { Command } from "./lib/cli";

const commands: Record<string, Command> = { init, analyze, art, render, qa };

const [name, ...args] = process.argv.slice(2);
try {
  const command = name === undefined ? undefined : commands[name];
  if (!command) throw new Error(`unknown command "${name ?? ""}"; expected one of: ${Object.keys(commands).join(", ")}`);
  const result = await command(args);
  console.log(JSON.stringify({ ok: true, command: name, ...result }, null, 2));
} catch (err) {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  const error = err instanceof Error ? err.message : String(err);
  console.log(JSON.stringify({ ok: false, command: name ?? null, outputs: {}, summary: null, next: null, error }, null, 2));
  process.exitCode = 1;
}
