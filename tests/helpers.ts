import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

export const REPO = path.resolve(import.meta.dir, "..");

/** An emptied directory .cache/test/<name>; it keeps the last run's files for inspection. */
export async function tempDir(name: string): Promise<string> {
  const dir = path.join(REPO, ".cache", "test", name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function runCli(...args: string[]) {
  const proc = Bun.spawn(["bun", "run", "pmv", ...args], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  let json;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw new Error(`stdout is not one JSON object:\n${stdout}\nstderr:\n${stderr}`);
  }
  return { code, json, stderr };
}

/** Write the synthetic 165 BPM test track; returns its ground truth. */
export async function synthAudio(file: string) {
  const proc = Bun.spawn(["uv", "run", "--frozen", "python", "tests/synth.py", "audio", file], {
    cwd: path.join(REPO, "py"),
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (code !== 0) throw new Error(`synth.py exited with ${code}`);
  return JSON.parse(stdout) as { bpm: number; beats: number[]; downbeats: number[]; duration: number };
}
