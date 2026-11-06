import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";

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

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array([...new TextEncoder().encode(type), ...data]);
  let crc = 0xffffffff;
  for (const b of body) crc = CRC_TABLE[(crc ^ b) & 0xff]! ^ (crc >>> 8);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
  return out;
}

/** An 8-bit gray PNG, flat or with pixel (x, y) at `level(x, y)`. */
export function grayPng(width: number, height: number, level: number | ((x: number, y: number) => number)): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 0, 0, 0, 0], 8); // bit depth 8, grayscale
  const rows = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++)
    if (typeof level === "number") rows.fill(level, y * (width + 1) + 1, (y + 1) * (width + 1));
    else for (let x = 0; x < width; x++) rows[y * (width + 1) + 1 + x] = level(x, y);
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks = [pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(rows)), pngChunk("IEND", new Uint8Array())];
  return new Uint8Array([...signature, ...chunks.flatMap((c) => [...c])]);
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
