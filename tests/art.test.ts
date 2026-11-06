import { describe, expect, test } from "bun:test";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { generateArt, pngSize, readJobs, selectPoses, type ArtOptions, type Backend, type Drawing, type Status } from "../src/lib/art";
import { basePrompt, variantPrompt } from "../src/lib/prompt";
import type { Bible } from "../src/schema/bible";
import type { Shots } from "../src/schema/shots";
import { grayPng, REPO, runCli, tempDir } from "./helpers";

const bible: Bible = {
  version: 1,
  artDirection: "Hand-drawn anime.",
  negative: "No text.",
  characters: [
    { id: "ann", name: "Ann", refs: ["bible/refs/ann-1.png", "bible/refs/ann-2.png"], lock: "Red bob, green coat.", instrument: "A blue guitar." },
    { id: "bo", name: "Bo", refs: ["bible/refs/bo.png"], lock: "Silver braid.", instrument: "A white drum kit." },
  ],
};

const still = { camera: { move: "static" as const, depth: 0 }, fx: [] };
const shots: Shots = {
  version: 1,
  shots: [
    {
      id: "S1",
      bars: [1, 2],
      section: "test",
      characters: ["ann"],
      framing: "medium",
      base: "Ann strums on a rooftop at dusk.",
      poses: [
        { id: "a", edit: null },
        { id: "b", edit: "Ann jumps." },
        { id: "c", edit: "Ann bows." },
      ],
      switch: { on: "beat", pattern: ["a", "b", "a", "c"] },
      ...still,
    },
    {
      id: "S2",
      bars: [3, 4],
      section: "test",
      characters: ["ann", "bo"],
      framing: "wide",
      base: "Both play on the rooftop.",
      poses: [
        { id: "a", edit: null },
        { id: "b", edit: "Bo hits the crash cymbal." },
      ],
      switch: { on: "beat", pattern: ["a", "b"] },
      ...still,
    },
  ],
};
const [S1, S2] = shots.shots as [Shots["shots"][number], Shots["shots"][number]];

async function project(name: string, data: Shots = shots): Promise<string> {
  const dir = await tempDir(name);
  await mkdir(path.join(dir, "bible", "refs"), { recursive: true });
  await Bun.write(path.join(dir, "shots.json"), JSON.stringify(data));
  await Bun.write(path.join(dir, "bible", "characters.json"), JSON.stringify(bible));
  for (const [i, ref] of ["ann-1", "ann-2", "bo"].entries()) await Bun.write(path.join(dir, "bible", "refs", `${ref}.png`), grayPng(8, 8, 40 + i));
  return dir;
}

type Call = { label: string; refs: string[]; worker: number; start: number; end: number };
let made = 0;

/** Writes a distinct placeholder PNG per call; `failures` counts down failed attempts per `shot/pose`. */
function fakeBackend(failures: Record<string, number> = {}) {
  const calls: Call[] = [];
  const backend: Backend = {
    name: "fake",
    async generate({ label, refs, output, worker }) {
      const start = performance.now();
      await Bun.sleep(30);
      let error: string | null = `${label} broke`;
      if (!((failures[label] ?? 0) > 0)) {
        await Bun.write(output, grayPng(16, 9, ++made));
        error = null;
      } else failures[label]!--;
      calls.push({ label, refs, worker, start, end: performance.now() });
      return { error, codex: null };
    },
  };
  return { backend, calls };
}

const run = (dir: string, backend: Backend, options: Partial<ArtOptions> = {}) =>
  generateArt(dir, { jobs: 2, force: false, dry: false, ...options }, backend);
const statuses = (drawings: Drawing[]) => Object.fromEntries(drawings.map((d) => [`${d.shot}/${d.pose}`, d.status]));
const all = (status: Status) => ({ "S1/a": status, "S1/b": status, "S1/c": status, "S2/a": status, "S2/b": status });

describe("prompts", () => {
  test("are deterministic: base frame layout", () => {
    expect(basePrompt(bible, S1)).toBe(`Reference images 1-2 show Ann. Use the characters in the reference images as the same identities: do not redesign them or create similar-looking new characters. Keep each face, hairstyle, colour scheme, outfit, accessory and instrument as in the references. The references are character sheets: take identity from them, not layout, background or lighting.

Character lock (only these characters appear in the frame):
- Ann: Red bob, green coat.

Scene: Ann strums on a rooftop at dusk.

Framing: medium shot, characters framed from about the waist up. One full-frame film still.

Instruments:
- Ann: A blue guitar.

Art direction: Hand-drawn anime.

Avoid: No text.
`);
    expect(basePrompt(structuredClone(bible), structuredClone(S1))).toBe(basePrompt(bible, S1));
  });

  test("are deterministic: variants edit reference image 1 and keep the rest", () => {
    expect(variantPrompt(bible, S1, S1.poses[1]!)).toBe(`Reference image 1 is the base frame of this shot: edit it. Reference images 2-3 show Ann; use them for identity only.

Change only this: Ann jumps.

Keep everything else as in reference image 1: the camera position and the medium shot framing, composition, background, lighting, colours and line style, and each character's face, hairstyle, outfit, accessories and instrument. Do not redesign the characters, redraw the background or move the camera.

Character lock:
- Ann: Red bob, green coat.

Instruments:
- Ann: A blue guitar.

Art direction: Hand-drawn anime.

Avoid: No text.
`);
  });

  test("number the refs of several characters in shot order", () => {
    expect(basePrompt(bible, S2)).toStartWith("Reference images 1-2 show Ann; Reference image 3 shows Bo. Use the characters");
    expect(variantPrompt(bible, S2, S2.poses[1]!)).toStartWith(
      "Reference image 1 is the base frame of this shot: edit it. Reference images 2-3 show Ann; Reference image 4 shows Bo; use them for identity only.",
    );
    expect(() => basePrompt(bible, { ...S1, characters: ["cy"] })).toThrow('shot S1: character "cy" is not in bible/characters.json');
  });
});

describe("art", () => {
  test("variants wait for their base frame and edit it; --jobs caps the workers", async () => {
    const dir = await project("art-order");
    const { backend, calls } = fakeBackend();
    expect(statuses(await run(dir, backend))).toEqual(all("generated"));

    for (const shot of ["S1", "S2"]) {
      const base = calls.find((c) => c.label === `${shot}/a`)!;
      for (const variant of calls.filter((c) => c.label.startsWith(`${shot}/`) && c !== base)) {
        expect(variant.start).toBeGreaterThanOrEqual(base.end);
        expect(variant.refs[0]).toBe(path.join(dir, "art", shot, "a.png"));
      }
    }
    expect(calls.find((c) => c.label === "S2/a")!.refs).toEqual(["ann-1", "ann-2", "bo"].map((r) => path.join(dir, "bible", "refs", `${r}.png`)));
    const overlaps = calls.map((c) => calls.filter((o) => o.start <= c.start && c.start < o.end));
    expect(Math.max(...overlaps.map((o) => o.length))).toBe(2);
    for (const o of overlaps) expect(new Set(o.map((c) => c.worker)).size).toBe(o.length);

    expect(await Bun.file(path.join(dir, "art", "S1", "b.prompt.md")).text()).toBe(variantPrompt(bible, S1, S1.poses[1]!));
    const jobs = await readJobs(path.join(dir, "jobs.jsonl"));
    expect(jobs.map((j) => `${j.shot}/${j.pose} ${j.kind} ${j.ok}`).sort()).toEqual([
      "S1/a base true",
      "S1/b variant true",
      "S1/c variant true",
      "S2/a base true",
      "S2/b variant true",
    ]);
    const s1b = jobs.find((j) => j.shot === "S1" && j.pose === "b")!;
    expect(s1b).toMatchObject({ output: "art/S1/b.png", size: { width: 16, height: 9 }, error: null, backend: "fake", attempt: 1 });
    expect(s1b.refs.map((r) => r.path)).toEqual(["art/S1/a.png", "bible/refs/ann-1.png", "bible/refs/ann-2.png"]);
    expect(s1b.promptSha256).toBe(new Bun.CryptoHasher("sha256").update(variantPrompt(bible, S1, S1.poses[1]!)).digest("hex"));
  });

  test("the ledger skips a drawing until its prompt, a ref or its output changes", async () => {
    const dir = await project("art-skip");
    await run(dir, fakeBackend().backend);

    let fake = fakeBackend();
    expect(statuses(await run(dir, fake.backend))).toEqual(all("skipped"));
    expect(fake.calls).toEqual([]);

    const edited = structuredClone(shots);
    edited.shots[0]!.poses[1]!.edit = "Ann jumps higher.";
    await Bun.write(path.join(dir, "shots.json"), JSON.stringify(edited));
    expect(statuses(await run(dir, fakeBackend().backend))).toEqual({ ...all("skipped"), "S1/b": "generated" });

    await Bun.write(path.join(dir, "bible", "refs", "bo.png"), grayPng(8, 8, 99));
    expect(statuses(await run(dir, fakeBackend().backend))).toEqual({ ...all("skipped"), "S2/a": "generated", "S2/b": "generated" });

    await Bun.write(path.join(dir, "art", "S1", "c.png"), grayPng(16, 9, 200));
    expect(statuses(await run(dir, fakeBackend().backend))).toEqual({ ...all("skipped"), "S1/c": "generated" });

    expect(statuses(await run(dir, fakeBackend().backend, { force: true }))).toEqual(all("generated"));

    // A redrawn base frame is a new first ref for its variants.
    expect(statuses(await run(dir, fakeBackend().backend, { force: true, only: "S1:a" }))).toEqual({ "S1/a": "generated" });
    expect(statuses(await run(dir, fakeBackend().backend))).toEqual({ ...all("skipped"), "S1/b": "generated", "S1/c": "generated" });
  });

  test("a failed attempt is retried once; a failed base frame blocks its variants", async () => {
    const dir = await project("art-retry");
    const first = fakeBackend({ "S1/a": 1 });
    const drawings = await run(dir, first.backend, { only: "S1" });
    expect(drawings.find((d) => d.pose === "a")).toMatchObject({ status: "generated", attempts: 2 });
    const jobs = await readJobs(path.join(dir, "jobs.jsonl"));
    expect(jobs.filter((j) => j.pose === "a").map((j) => [j.attempt, j.ok, j.error, j.size])).toEqual([
      [1, false, "S1/a broke", null],
      [2, true, null, { width: 16, height: 9 }],
    ]);

    const second = fakeBackend({ "S2/a": 2 });
    expect(statuses(await run(dir, second.backend, { only: "S2" }))).toEqual({ "S2/a": "failed", "S2/b": "blocked" });
    expect(second.calls.map((c) => c.label)).toEqual(["S2/a", "S2/a"]);
    expect(await Bun.file(path.join(dir, "art", "S2", "a.png")).exists()).toBe(false);
  });

  test("--only picks shots and poses; a variant needs its base frame", async () => {
    const picked = selectPoses(shots.shots, "S1:b,S2,S1:c");
    expect([...picked].map(([shot, poses]) => [shot, [...poses]])).toEqual([
      ["S1", ["b", "c"]],
      ["S2", ["a", "b"]],
    ]);
    expect(() => selectPoses(shots.shots, "S9")).toThrow('--only expects shot or shot:pose items from shots.json, got "S9"');
    expect(() => selectPoses(shots.shots, "S1:z")).toThrow('--only: shot S1 has no pose "z"');

    const dir = await project("art-only");
    await expect(run(dir, fakeBackend().backend, { only: "S1:b" })).rejects.toThrow(`${path.join(dir, "art", "S1", "a.png")} is missing; add S1:a to --only`);
    await run(dir, fakeBackend().backend, { only: "S1:a" });
    expect(statuses(await run(dir, fakeBackend().backend, { only: "S1:b" }))).toEqual({ "S1/b": "generated" });
  });

  test("--dry writes the prompts and generates nothing", async () => {
    const dir = await project("art-dry");
    const { code, json } = await runCli("art", "--project", dir, "--dry", "--only", "S1,S2");
    expect(code).toBe(0);
    expect(json.summary).toMatchObject({ generated: 0, skipped: 0, planned: 5, attempts: 0 });
    expect(json.next).toBe(`bun run pmv art --project ${dir} --only S1,S2`);
    expect(await Bun.file(path.join(dir, "art", "S2", "b.prompt.md")).text()).toBe(variantPrompt(bible, S2, S2.poses[1]!));
    expect(await Bun.file(path.join(dir, "art", "S2", "b.png")).exists()).toBe(false);
    expect(await Bun.file(path.join(dir, "jobs.jsonl")).exists()).toBe(false);

    const bad = await runCli("art", "--project", dir, "--jobs", "0");
    expect(bad.json.error).toBe('--jobs expects a positive integer, got "0"');
  });
});

/** Bit depth and colour type from a PNG header. */
const pngFormat = async (file: string) => [...new Uint8Array(await Bun.file(file).slice(24, 26).arrayBuffer())];

describe("paste", () => {
  test("rebuilds final frames and 16-bit masks from the raw drawings, scaling each to its base frame", async () => {
    const dir = await project("paste");
    const folder = path.join(dir, "art", "S1");
    await mkdir(folder, { recursive: true });
    await Bun.write(path.join(folder, "a.png"), grayPng(160, 90, 40));
    await Bun.write(path.join(folder, "b.raw.png"), grayPng(159, 90, 90)); // differs everywhere, 1 px narrower
    await Bun.write(path.join(folder, "c.raw.png"), grayPng(160, 90, 41)); // differs nowhere
    const { code, json } = await runCli("paste", "--project", dir, "--only", "S1");
    expect(code).toBe(0);
    expect(json.outputs).toEqual({
      "S1/b": path.join(folder, "b.png"),
      "S1/b.mask": path.join(folder, "b.mask.png"),
      "S1/c": path.join(folder, "c.png"),
      "S1/c.mask": path.join(folder, "c.mask.png"),
    });
    expect(json.summary).toMatchObject({ pasted: 2, poses: ["S1/b mask area 1, raw 159x90 scaled to 160x90", "S1/c mask area 0"], params: { grow: 40, feather: 24 } });
    for (const pose of ["b", "c"]) {
      expect(await pngSize(path.join(folder, `${pose}.png`))).toEqual({ width: 160, height: 90 });
      expect(await pngSize(path.join(folder, `${pose}.mask.png`))).toEqual({ width: 160, height: 90 });
      expect(await pngFormat(path.join(folder, `${pose}.mask.png`))).toEqual([16, 0]);
    }
    expect(await Bun.file(path.join(dir, "jobs.jsonl")).exists()).toBe(false);

    const bad = await runCli("paste", "--project", dir, "--only", "S1:a");
    expect(bad.json.error).toBe("nothing to paste: the selected poses are all base frames, which are their own final frames");
  }, 30_000);
});

describe("artcheck", () => {
  test("writes a contact sheet, a flip test and drift numbers per shot", async () => {
    const dir = await project("artcheck");
    await Bun.write(
      path.join(dir, "project.json"),
      JSON.stringify({ version: 1, title: "t", fps: 24, width: 1920, height: 1080, audio: null, sections: [] }),
    );
    const before = await runCli("artcheck", "--project", dir, "--bpm", "165");
    expect(before.json.error).toBe("shot S1 has no drawing for pose a, b, c; run `pmv art` first");

    await run(dir, fakeBackend().backend);
    const { code, json } = await runCli("artcheck", "--project", dir, "--bpm", "165", "--only", "S2");
    expect(code).toBe(0);
    expect(Object.keys(json.outputs)).toEqual(["S2/sheet", "S2/flip", "S2/check"]);
    // Flat placeholder drawings differ by the same amount everywhere.
    const { full, edge } = json.summary.drift.S2.b;
    expect(full).toBeGreaterThan(0);
    expect(edge).toBe(full);
    const check = await Bun.file(json.outputs["S2/check"]).json();
    expect(check).toMatchObject({ frames: 96, switches: [9, 18, 27, 35, 44, 53, 62, 70, 79, 88], sizes: { a: [16, 9], b: [16, 9] } });
    expect(await Bun.file(path.join(dir, "art", "S2", "sheet.jpg")).exists()).toBe(true);
    expect(await Bun.file(path.join(dir, "art", "S2", "flip.mp4")).exists()).toBe(true);
  }, 30_000);

  test("--paste takes the pose only where it changed and holds the background still", async () => {
    const dir = await project("artcheck-paste");
    await Bun.write(
      path.join(dir, "project.json"),
      JSON.stringify({ version: 1, title: "t", fps: 24, width: 1920, height: 1080, audio: null, sections: [] }),
    );
    // Per-pixel noise stands in for the background texture every drawing redraws; the dark block is the character.
    const drawing = (seed: number, bx: number, by: number) =>
      grayPng(1280, 720, (x, y) => {
        if (x >= bx && x < bx + 120 && y >= by && y < by + 160) return 30;
        const h = Math.imul(x * 374761393 + y * 668265263 + seed * 2246822519, 1274126177);
        return 110 + Math.round(40 * Math.sin(x / 80) * Math.cos(y / 64)) + ((h ^ (h >>> 15)) >>> 0) % 25 - 12;
      });
    await mkdir(path.join(dir, "art", "S2"), { recursive: true });
    await Bun.write(path.join(dir, "art", "S2", "a.png"), drawing(1, 300, 200));
    await Bun.write(path.join(dir, "art", "S2", "b.png"), drawing(2, 760, 260));

    const { code, json } = await runCli("artcheck", "--project", dir, "--bpm", "165", "--only", "S2", "--paste");
    expect(code).toBe(0);
    expect(Object.keys(json.outputs)).toEqual(["S2/sheet", "S2/flip", "S2/check", "S2/ab", "S2/sheet-paste", "S2/paste/b", "S2/paste/b.mask"]);
    const { poses, background } = json.summary.paste.S2;
    // Both places of the block, grown and feathered, and nothing of the redrawn noise.
    expect(poses.b.area).toBeGreaterThan(0.08);
    expect(poses.b.area).toBeLessThan(0.25);
    expect(background.paste.max).toBeLessThan(0.5);
    expect(background.original.mean).toBeGreaterThan(1);
    expect(await pngSize(json.outputs["S2/paste/b"])).toEqual({ width: 1280, height: 720 });
    expect(await Bun.file(json.outputs["S2/ab"]).exists()).toBe(true);
    const check = await Bun.file(json.outputs["S2/check"]).json();
    expect(check.paste.params).toMatchObject({ threshold: 22, grow: 40, feather: 24, half: [960, 540] });
  }, 120_000);
});

describe("codex low-effort wrapper", () => {
  const scripts = path.join(REPO, "scripts", "codex-low-effort");

  test("runs baoyu's codex-imagegen with its own retries off and the codex shim first on PATH", async () => {
    const dir = await tempDir("codex-wrapper");
    const fakeCodex = path.join(dir, "bin", "codex");
    await Bun.write(fakeCodex, "#!/bin/sh\nexit 0\n");
    await chmod(fakeCodex, 0o755);
    const wrapper = path.join(dir, "codex-imagegen.ts");
    await Bun.write(wrapper, 'console.log(JSON.stringify({ argv: process.argv.slice(2), codex: Bun.which("codex"), real: process.env.PMV_REAL_CODEX }));');
    const proc = Bun.spawn([path.join(scripts, "imagegen.sh"), "--image", "/x/out.png", "--retries", "2"], {
      env: { ...process.env, PATH: `${path.dirname(fakeCodex)}:${process.env.PATH}`, PMV_CODEX_IMAGEGEN: wrapper },
      stdout: "pipe",
    });
    expect(JSON.parse(await new Response(proc.stdout).text())).toEqual({
      argv: ["--image", "/x/out.png", "--retries", "2", "--retries", "0"],
      codex: path.join(scripts, "codex"),
      real: fakeCodex,
    });
  });

  test("the shim adds the effort override to codex exec and passes the rest through", async () => {
    const dir = await tempDir("codex-shim");
    const fakeCodex = path.join(dir, "codex");
    await Bun.write(fakeCodex, "#!/bin/sh\nprintf '%s\\n' \"$@\"\n");
    await chmod(fakeCodex, 0o755);
    const proc = Bun.spawn([path.join(scripts, "codex"), "exec", "--json", "--image", "/r/a.png", "-"], {
      env: { ...process.env, PMV_REAL_CODEX: fakeCodex },
      stdout: "pipe",
    });
    expect((await new Response(proc.stdout).text()).trim().split("\n")).toEqual([
      "exec",
      "-c",
      'model_reasoning_effort="low"',
      "--json",
      "--image",
      "/r/a.png",
      "-",
    ]);
  });
});
