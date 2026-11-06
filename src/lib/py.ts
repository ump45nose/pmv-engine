import path from "node:path";
import type { z } from "zod";
import { parse } from "./cli";
import { run } from "./proc";

const PY_DIR = path.resolve(import.meta.dir, "../../py");

/** Run `python -m pmv_tools.<tool>` in the uv project. Its stderr streams through; its stdout must be one JSON object. */
export async function runPy<S extends z.ZodType>(tool: string, args: string[], schema: S): Promise<z.output<S>> {
  const stdout = await run(["uv", "run", "--frozen", "python", "-m", `pmv_tools.${tool}`, ...args], {
    cwd: PY_DIR,
    captureStdout: true,
  });
  return parse(schema, JSON.parse(stdout), `pmv_tools.${tool} output`);
}
