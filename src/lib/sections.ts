import type { ManualSection } from "../schema/project";
import type { Bar, Section } from "../schema/song";

/** First and last bar whose midpoint lies in [start, end), or null when there is none. */
export function barsIn(bars: Bar[], start: number, end: number): [number, number] | null {
  const inside = bars.filter((b) => (b.start + b.end) / 2 >= start && (b.start + b.end) / 2 < end);
  return inside.length ? [inside[0]!.index, inside.at(-1)!.index] : null;
}

/** Manual sections are kept as given; auto sections keep only the parts outside them that still hold a bar. */
export function mergeSections(auto: Section[], manual: ManualSection[], bars: Bar[]): Section[] {
  const merged: Section[] = manual.map((m) => {
    const range = barsIn(bars, m.start, m.end);
    if (!range) throw new Error(`manual section "${m.label}" (${m.start}-${m.end}s) contains no bar`);
    return { label: m.label, start: m.start, end: m.end, bars: range, source: "manual" };
  });
  for (const section of auto) {
    let pieces: [number, number][] = [[section.start, section.end]];
    for (const m of manual) {
      pieces = pieces.flatMap(([s, e]): [number, number][] => [
        [s, Math.min(e, m.start)],
        [Math.max(s, m.end), e],
      ]);
      pieces = pieces.filter(([s, e]) => e > s);
    }
    for (const [start, end] of pieces) {
      const range = barsIn(bars, start, end);
      if (range) merged.push({ label: section.label, start, end, bars: range, source: "auto" });
    }
  }
  return merged.sort((a, b) => a.start - b.start);
}
