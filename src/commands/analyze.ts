import path from "node:path";
import { parseArgs } from "node:util";
import { SongAnalysisSchema, SongSchema } from "../schema/song";
import { parse, pmv, required, type Command } from "../lib/cli";
import { projectPaths, readProject, writeJson } from "../lib/project";
import { runPy } from "../lib/py";
import { mergeSections } from "../lib/sections";

export const analyze: Command = async (args) => {
  const { values } = parseArgs({ args, strict: true, options: { project: { type: "string" } } });
  const dir = required(values.project, "--project");
  const paths = projectPaths(dir);
  const project = await readProject(dir);
  const audio = path.join(paths.root, project.audio);

  const analysis = await runPy("analyze", ["--audio", audio], SongAnalysisSchema);
  const sha256 = new Bun.CryptoHasher("sha256").update(await Bun.file(audio).arrayBuffer()).digest("hex");
  const song = parse(
    SongSchema,
    {
      version: 1,
      audio: { path: project.audio, sha256, duration: analysis.duration, sampleRate: analysis.sampleRate },
      bpm: analysis.bpm,
      beatsPerBar: analysis.beatsPerBar,
      beats: analysis.beats,
      downbeats: analysis.downbeats,
      bars: analysis.bars,
      sections: mergeSections(analysis.sections, project.sections, analysis.bars),
      lyrics: [],
      analyzer: analysis.analyzer,
    },
    "song.json",
  );
  await writeJson(paths.song, song);
  return {
    outputs: { song: paths.song },
    summary: {
      duration: song.audio.duration,
      bpm: song.bpm,
      beatsPerBar: song.beatsPerBar,
      beats: song.beats.length,
      bars: song.bars.length,
      sections: song.sections.map((s) => `${s.label} (${s.source}) bars ${s.bars[0]}-${s.bars[1]}`),
    },
    next: pmv("render", "--project", dir, "--debug-grid"),
  };
};
