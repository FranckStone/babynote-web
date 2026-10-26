export interface DayRange {
  start: number;
  end: number;
}

export type RangeHandle = "start" | "end" | "move";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Inclusive day indices; dragging a window keeps its length at either edge. */
export function moveDayRange(range: DayRange, count: number, handle: RangeHandle, delta: number): DayRange {
  if (count <= 1) return { start: 0, end: 0 };
  if (handle === "start") return { start: clamp(range.start + delta, 0, range.end), end: range.end };
  if (handle === "end") return { start: range.start, end: clamp(range.end + delta, range.start, count - 1) };
  const length = range.end - range.start;
  const start = clamp(range.start + delta, 0, count - length - 1);
  return { start, end: start + length };
}

/** Store custom selection as dates so incoming records don't shift its meaning. */
export function resolveDayRange(days: number[], presetDays: number | null, dates: DayRange | null): DayRange {
  const last = Math.max(days.length - 1, 0);
  if (!dates) return { start: presetDays == null ? 0 : Math.max(0, days.length - presetDays), end: last };
  const firstMatch = days.findIndex((day) => day >= dates.start);
  const afterEnd = days.findIndex((day) => day > dates.end);
  const start = firstMatch < 0 ? last : firstMatch;
  return { start, end: Math.max(start, afterEnd < 0 ? last : Math.max(0, afterEnd - 1)) };
}
