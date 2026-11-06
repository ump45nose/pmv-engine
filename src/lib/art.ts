import { appendFile, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { BibleSchema } from "../schema/bible";
import { JobSchema, type Job } from "../schema/jobs";
import { PasteSchema, type Paste } from "../schema/paste";
import { ShotsSchema, type Pose, type Shot } from "../schema/shots";
import { parse, round } from "./cli";
import { projectPaths, readJson } from "./project";
import { basePrompt, cast, characterRefs, variantPrompt } from "./prompt";
import { runPy } from "./py";

export type Size = NonNullable<Job["size"]>;
export type Codex = Job["codex"];

export type GenerateRequest = {
  /** `shot/pose`, for logs. */
  label: string;
  prompt: string;
  promptFile: string;
  /** Absolute paths, in prompt order. */
  refs: string[];
  /** Where the backend writes the PNG. */
  output: string;
  /** 1..jobs; no two concurrent requests share a worker number. */
  worker: number;
};

export type Backend = {
  name: string;
  generate(request: GenerateRequest): Promise<{ error: string | null; codex: Codex }>;
};

export type ArtOptions = { only?: string; jobs: number; force: boolean; dry: boolean };

/** planned: what a dry run would generate; blocked: not tried because its base frame failed. */
export type Status = "generated" | "skipped" | "planned" | "failed" | "blocked";

export type Drawing = {
  shot: string;
  pose: string;
  kind: Job["kind"];
  status: Status;
  /** What the backend draws, relative to the project directory: a base frame's final frame or a variant's raw drawing. */
  output: string;
  attempts: number;
  seconds: number;
  size: Size | null;
  error: string | null;
  /** The variant's final frame and mask, when this run pasted it. */
  paste: Paste["poses"][string] | null;
};

const ATTEMPTS = 2;

export async function sha256(file: string): Promise<string> {
  return new Bun.CryptoHasher("sha256").update(await Bun.file(file).arrayBuffer()).digest("hex");
}

export async function pngSize(file: string): Promise<Size> {
  const head = new Uint8Array(await Bun.file(file).slice(0, 24).arrayBuffer());
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (head.length < 24 || signature.some((b, i) => head[i] !== b)) throw new Error(`${file} is not a PNG`);
  const view = new DataView(head.buffer);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export async function readJobs(file: string): Promise<Job[]> {
  const f = Bun.file(file);
  if (!(await f.exists())) return [];
  const lines = (await f.text()).split("\n").filter((line) => line.trim() !== "");
  return lines.map((line, i) => parse(JobSchema, JSON.parse(line), `${file} line ${i + 1}`));
}

type Fingerprint = Pick<Job, "output" | "outputSha256" | "promptSha256" | "refs">;

/** A successful attempt made the current output file from the same prompt and the same reference images. */
export function isDone(jobs: Job[], want: Fingerprint): boolean {
  return jobs.some(
    (j) =>
      j.ok &&
      j.output === want.output &&
      j.outputSha256 === want.outputSha256 &&
      j.promptSha256 === want.promptSha256 &&
      j.refs.length === want.refs.length &&
      j.refs.every((r, i) => r.path === want.refs[i]!.path && r.sha256 === want.refs[i]!.sha256),
  );
}

/** `T1,T2:b` -> every pose of T1 and pose b of T2; undefined selects everything. */
export function selectPoses(shots: Shot[], only: string | undefined): Map<string, Set<string>> {
  const selected = new Map<string, Set<string>>();
  if (only === undefined) {
    for (const shot of shots) selected.set(shot.id, new Set(shot.poses.map((p) => p.id)));
    return selected;
  }
  for (const item of only.split(",")) {
    const [shotId, poseId, ...rest] = item.split(":");
    const shot = shots.find((s) => s.id === shotId);
    if (!shot || rest.length > 0) throw new Error(`--only expects shot or shot:pose items from shots.json, got "${item}"`);
    const poses = selected.get(shot.id) ?? new Set<string>();
    for (const id of poseId === undefined ? shot.poses.map((p) => p.id) : [poseId]) {
      if (!shot.poses.some((p) => p.id === id)) throw new Error(`--only: shot ${shot.id} has no pose "${id}"`);
      poses.add(id);
    }
    selected.set(shot.id, poses);
  }
  return selected;
}

/** Paste variants' raw drawings back onto the shot's base frame, which writes their final frames and masks; see pmv_tools.paste. */
export function pasteVariants(dir: string, shot: Shot, poses: string[]) {
  const folder = path.join(projectPaths(dir).art, shot.id);
  return runPy("paste", ["--dir", folder, "--base", shot.poses[0]!.id, "--poses", poses.join(",")], PasteSchema);
}

/** Runs tasks on at most `n` numbered workers at a time. */
function workers(n: number) {
  const free = Array.from({ length: n }, (_, i) => i + 1);
  const waiting: ((worker: number) => void)[] = [];
  return async <T>(task: (worker: number) => Promise<T>): Promise<T> => {
    const worker = free.shift() ?? (await new Promise<number>((resolve) => waiting.push(resolve)));
    try {
      return await task(worker);
    } finally {
      const next = waiting.shift();
      if (next) next(worker);
      else free.push(worker);
    }
  };
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
/** The only frame of a pose that later steps read. */
const finalOf = (shot: Shot, pose: Pose) => path.join("art", shot.id, `${pose.id}.png`);
const outputOf = (shot: Shot, pose: Pose) => (pose.edit === null ? finalOf(shot, pose) : path.join("art", shot.id, `${pose.id}.raw.png`));

function entry(shot: Shot, pose: Pose, status: Status, rest: Partial<Drawing> = {}): Drawing {
  const kind = pose.edit === null ? "base" : "variant";
  return { shot: shot.id, pose: pose.id, kind, status, output: outputOf(shot, pose), attempts: 0, seconds: 0, size: null, error: null, paste: null, ...rest };
}

/**
 * Draw the selected poses: each shot's base frame first, then its variants as edits of it. A new variant's raw
 * drawing is pasted back onto the base frame, which writes its final frame and mask.
 * A drawing whose output was already made from the same prompt and refs is skipped unless `force`; a skipped variant
 * is pasted again only when its final frame is missing.
 */
export async function generateArt(dir: string, options: ArtOptions, backend: Backend): Promise<Drawing[]> {
  const paths = projectPaths(dir);
  const { shots } = await readJson(paths.shots, ShotsSchema);
  const bible = await readJson(paths.bible, BibleSchema);
  const selected = selectPoses(shots, options.only);
  const jobs = await readJobs(paths.jobs);
  const abs = (rel: string) => path.join(paths.root, rel);
  const exists = (rel: string) => Bun.file(abs(rel)).exists();

  const chosen = shots.filter((s) => selected.has(s.id));
  for (const shot of chosen) {
    for (const character of cast(bible, shot))
      for (const ref of character.refs) if (!(await exists(ref))) throw new Error(`${character.id} reference image not found: ${abs(ref)}`);
    const base = shot.poses[0]!;
    if (!selected.get(shot.id)!.has(base.id) && !(await exists(finalOf(shot, base))))
      throw new Error(`${abs(finalOf(shot, base))} is missing; add ${shot.id}:${base.id} to --only`);
  }

  const run = workers(options.jobs);

  /** `baseRedrawn`: a dry run is about to redraw the base frame, so this variant will be redrawn too. */
  async function draw(shot: Shot, pose: Pose, baseRedrawn = false): Promise<Drawing> {
    const kind = pose.edit === null ? "base" : "variant";
    const output = outputOf(shot, pose);
    const prompt = kind === "base" ? basePrompt(bible, shot) : variantPrompt(bible, shot, pose);
    const promptFile = abs(finalOf(shot, pose).replace(/\.png$/, ".prompt.md"));
    const writePrompt = async () => {
      await mkdir(path.dirname(promptFile), { recursive: true });
      await Bun.write(promptFile, prompt);
    };
    if (baseRedrawn) {
      await writePrompt();
      return entry(shot, pose, "planned");
    }

    const refPaths = kind === "base" ? characterRefs(bible, shot) : [finalOf(shot, shot.poses[0]!), ...characterRefs(bible, shot)];
    const refs = await Promise.all(refPaths.map(async (p) => ({ path: p, sha256: await sha256(abs(p)) })));
    const promptSha256 = new Bun.CryptoHasher("sha256").update(prompt).digest("hex");
    const outputSha256 = (await exists(output)) ? await sha256(abs(output)) : null;
    const pasted = async (drawing: Drawing): Promise<Drawing> => ({ ...drawing, paste: (await pasteVariants(dir, shot, [pose.id])).poses[pose.id]! });
    if (!options.force && isDone(jobs, { output, outputSha256, promptSha256, refs })) {
      const skipped = entry(shot, pose, "skipped");
      return kind === "variant" && !options.dry && !(await exists(finalOf(shot, pose))) ? pasted(skipped) : skipped;
    }
    await writePrompt();
    if (options.dry) return entry(shot, pose, "planned");

    // The output is only ever replaced by a complete, valid PNG.
    const fresh = abs(output.replace(/\.png$/, ".new.png"));
    const drawing = await run(async (worker) => {
      let error: string | null = null;
      for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        const time = new Date().toISOString();
        const started = performance.now();
        await rm(fresh, { force: true });
        const result = await backend
          .generate({ label: `${shot.id}/${pose.id}`, prompt, promptFile, refs: refPaths.map(abs), output: fresh, worker })
          .catch((err: unknown) => ({ error: message(err), codex: null }));
        error = result.error;
        let size: Size | null = null;
        let hash: string | null = null;
        if (error === null) {
          try {
            size = await pngSize(fresh);
            hash = await sha256(fresh);
            await rename(fresh, abs(output));
          } catch (err) {
            error = message(err);
          }
        }
        const seconds = round((performance.now() - started) / 1000, 1);
        const job: Job = {
          time,
          shot: shot.id,
          pose: pose.id,
          kind,
          attempt,
          promptSha256,
          refs,
          output,
          outputSha256: hash,
          ok: error === null,
          seconds,
          size,
          error,
          backend: backend.name,
          codex: result.codex,
        };
        await appendFile(paths.jobs, `${JSON.stringify(parse(JobSchema, job, "job record"))}\n`);
        console.error(`art ${shot.id}/${pose.id} attempt ${attempt}: ${error ?? "ok"} (${seconds} s)`);
        if (error === null) return entry(shot, pose, "generated", { attempts: attempt, seconds, size });
      }
      return entry(shot, pose, "failed", { attempts: ATTEMPTS, error });
    });
    return kind === "variant" && drawing.status === "generated" ? pasted(drawing) : drawing;
  }

  const perShot = await Promise.all(
    chosen.map(async (shot) => {
      const wanted = selected.get(shot.id)!;
      const [base, ...variants] = shot.poses as [Pose, ...Pose[]];
      const first = wanted.has(base.id) ? await draw(shot, base) : null;
      const rest = await Promise.all(
        variants
          .filter((v) => wanted.has(v.id))
          .map((v) =>
            first?.status === "failed"
              ? entry(shot, v, "blocked", { error: `base frame ${shot.id}/${base.id} failed` })
              : draw(shot, v, first?.status === "planned"),
          ),
      );
      return first ? [first, ...rest] : rest;
    }),
  );
  return perShot.flat();
}
