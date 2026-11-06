import path from "node:path";
import type { z } from "zod";
import { parse } from "./cli";

const PY_DIR = path.resolve(import.meta.dir, "../../py");

async function forward(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) {
    process.stderr.write(chunk);
    text += decoder.decode(chunk, { stream: true });
  }
  return text;
}

/** Run `python -m pmv_tools.<tool>` in the uv project. Its stderr streams through; its stdout must be one JSON object. */
export async function runPy<S extends z.ZodType>(tool: string, args: string[], schema: S): Promise<z.output<S>> {
  const proc = Bun.spawn(["uv", "run", "--frozen", "python", "-m", `pmv_tools.${tool}`, ...args], {
    cwd: PY_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), forward(proc.stderr), proc.exited]);
  if (code !== 0) {
    const tail = stderr.trim().split("\n").slice(-3).join(" | ");
    throw new Error(`pmv_tools.${tool} exited with code ${code}: ${tail}`);
  }
  return parse(schema, JSON.parse(stdout), `pmv_tools.${tool} output`);
}
