import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { Backend, Codex } from "./art";
import { run } from "./proc";

const REPO = path.resolve(import.meta.dir, "../..");
const BAOYU = path.join(homedir(), ".agents", "skills", "baoyu-image-gen", "scripts");

/** What baoyu's codex-imagegen logged about the `codex exec` session. */
async function readCodexLog(file: string): Promise<Codex> {
  const f = Bun.file(file);
  if (!(await f.exists())) return null;
  type Usage = { input: number; cached_input: number; output: number; reasoning: number };
  const events: { event: string; thread_id?: string; usage?: Usage | null }[] = (await f.text())
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
  const done = events.filter((e) => e.event === "codex.completed").at(-1);
  if (!done) return null;
  const u = done.usage;
  return {
    threadId: done.thread_id ?? null,
    tokens: u ? { input: u.input, cachedInput: u.cached_input, output: u.output, reasoning: u.reasoning } : null,
  };
}

/**
 * baoyu-image-gen's codex-cli provider. Its `codex exec` runs through scripts/codex-low-effort, which only adds a low
 * reasoning effort and leaves retries to `pmv art`. Temporary files, locks and logs stay in the repo's .cache.
 */
export const codexBackend: Backend = {
  name: "baoyu-image-gen codex-cli, model_reasoning_effort=low",
  async generate({ label, promptFile, refs, output, worker }) {
    const dir = path.join(REPO, ".cache", "imagegen", `worker-${worker}`);
    // The wrapper caches by prompt and ref paths, not contents: a redrawn base frame keeps its path.
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const tmp = path.join(REPO, ".cache", "tmp");
    await mkdir(tmp, { recursive: true });
    const log = path.join(dir, "codex-imagegen.jsonl");
    console.error(`art ${label}: codex image generation on worker ${worker}`);
    let error: string | null = null;
    try {
      await run(
        [
          "bun",
          path.join(BAOYU, "main.ts"),
          "--provider",
          "codex-cli",
          "--promptfiles",
          promptFile,
          "--image",
          output,
          "--ar",
          "16:9",
          ...refs.flatMap((ref) => ["--ref", ref]),
        ],
        {
          cwd: dir,
          env: {
            ...process.env,
            TMPDIR: tmp,
            BAOYU_CODEX_IMAGEGEN_BIN: path.join(REPO, "scripts", "codex-low-effort", "imagegen.sh"),
            BAOYU_CODEX_IMAGEGEN_CACHE_DIR: dir,
            BAOYU_CODEX_IMAGEGEN_TIMEOUT_MS: "600000",
            BAOYU_CODEX_IMAGEGEN_LOG_FILE: log,
            PMV_CODEX_IMAGEGEN: path.join(BAOYU, "codex-imagegen", "main.ts"),
          },
        },
      );
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    return { error, codex: await readCodexLog(log) };
  },
};
