import { expect, test } from "bun:test";
import { barsIn, mergeSections } from "../src/lib/sections";
import type { Bar, Section } from "../src/schema/song";

// 10 bars of 2 s starting at 1 s: bar i covers [2i - 1, 2i + 1).
const bars: Bar[] = Array.from({ length: 10 }, (_, i) => ({ index: i + 1, start: 1 + 2 * i, end: 3 + 2 * i }));
const auto = (label: string, first: number, last: number): Section => ({
  label,
  start: bars[first - 1]!.start,
  end: bars[last - 1]!.end,
  bars: [first, last],
  source: "auto",
});

test("barsIn uses bar midpoints", () => {
  expect(barsIn(bars, 4.9, 9.1)).toEqual([3, 4]);
  expect(barsIn(bars, 2.5, 3.5)).toBeNull();
});

test("without manual sections the auto sections pass through", () => {
  const sections = [auto("A", 1, 4), auto("B", 5, 10)];
  expect(mergeSections(sections, [], bars)).toEqual(sections);
});

test("manual sections win and split the auto ones around them", () => {
  const merged = mergeSections([auto("A", 1, 4), auto("B", 5, 10)], [{ label: "chorus", start: 6.2, end: 14.8 }], bars);
  expect(merged.map((s) => [s.label, s.source, s.start, s.end, s.bars])).toEqual([
    ["A", "auto", 1, 6.2, [1, 3]],
    ["chorus", "manual", 6.2, 14.8, [4, 7]],
    ["B", "auto", 14.8, 21, [8, 10]],
  ]);
});

test("slivers without a whole bar are dropped, empty manual sections are errors", () => {
  const merged = mergeSections([auto("A", 1, 10)], [{ label: "chorus", start: 1.5, end: 20.5 }], bars);
  expect(merged.map((s) => s.label)).toEqual(["chorus"]);
  expect(() => mergeSections([], [{ label: "x", start: 2.5, end: 3.5 }], bars)).toThrow("contains no bar");
});
