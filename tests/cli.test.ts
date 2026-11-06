import { describe, expect, test } from "bun:test";
import path from "node:path";
import { runCli, tempDir } from "./helpers";

describe("cli", () => {
  test("unknown commands fail with a JSON error", async () => {
    const { code, json } = await runCli("nope");
    expect(code).not.toBe(0);
    expect(json).toMatchObject({ ok: false, command: "nope", outputs: {}, next: null });
    expect(json.error).toContain("expected one of: init");
  });

  test("init writes project.json with defaults and copies the audio", async () => {
    const dir = await tempDir("init");
    const audio = path.join(dir, "Source Song.WAV");
    await Bun.write(audio, "not really audio");
    const project = path.join(dir, "proj");

    const { code, json } = await runCli("init", "--project", project, "--audio", audio, "--section", "chorus:62.5-88");
    expect(code).toBe(0);
    expect(json).toMatchObject({ ok: true, command: "init", next: `bun run pmv analyze --project ${project}` });
    expect(await Bun.file(path.join(project, "project.json")).json()).toEqual({
      version: 1,
      title: "proj",
      fps: 24,
      width: 1920,
      height: 1080,
      audio: "song/audio.wav",
      sections: [{ label: "chorus", start: 62.5, end: 88 }],
    });
    expect(await Bun.file(path.join(project, "song", "audio.wav")).text()).toBe("not really audio");

    const again = await runCli("init", "--project", project, "--audio", audio);
    expect(again.code).not.toBe(0);
    expect(again.json.error).toContain("already exists");
  });

  test("init rejects bad arguments", async () => {
    const dir = await tempDir("init-bad");
    const audio = path.join(dir, "a.wav");
    await Bun.write(audio, "x");
    const bad = async (...args: string[]) => (await runCli("init", "--project", path.join(dir, "p"), ...args)).json.error as string;
    expect(await bad()).toBe("missing --audio");
    expect(await bad("--audio", audio, "--section", "chorus 1-2")).toContain("label:start-end");
    expect(await bad("--audio", audio, "--section", "chorus:9-3")).toContain("section end must be after start");
    expect(await bad("--audio", audio, "--fps", "abc")).toContain("fps");
    expect(await bad("--audio", audio, "--bogus", "1")).toContain("bogus");
  });
});
