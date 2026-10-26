import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFeedings, scopeFeedingIntervals, summarizeFeedingRange } from "../src/lib/feedingAnalysis.ts";
import type { FeedingRecord } from "../shared/types.ts";

const at = (day: number, hour: number) => new Date(2026, 5, day, hour).getTime();
const feed = (id: number, day: number, hour: number, amountML: number | null): FeedingRecord => ({
  id, startedAt: at(day, hour), endedAt: null, formulaStartedAt: null,
  feedingType: "formula", amountML, note: "",
});

test("selected summaries include empty days and only known amounts in the per-feed average", () => {
  const analysis = analyzeFeedings([
    feed(1, 1, 10, 900), feed(2, 2, 12, 40), feed(3, 2, 14, null), feed(4, 4, 9, 160),
  ], [], at(4, 20));
  const selected = summarizeFeedingRange(analysis.days.slice(1))!;
  assert.equal(selected.days, 3);
  assert.equal(selected.dailyML, 200 / 3);
  assert.equal(selected.feedsPerDay, 1);
  assert.equal(selected.perFeedML, 100);
  assert.equal(selected.longestGapHours, 43);
});

test("a single day includes today's records but excludes intervals starting outside the selection", () => {
  const analysis = analyzeFeedings([feed(1, 1, 8, 50), feed(2, 4, 9, 160)], [], at(4, 20));
  const today = summarizeFeedingRange(analysis.days.slice(-1))!;
  assert.equal(today.dailyML, 160);
  assert.equal(today.feedsPerDay, 1);
  assert.equal(today.perFeedML, 160);
  assert.equal(today.longestGapHours, null);
  assert.equal(scopeFeedingIntervals(analysis.days.slice(-1))[0].longestGapHours, null);
  assert.equal(summarizeFeedingRange([]), null);
});

test("empty selections show zero totals and unavailable averages, with no outside interval", () => {
  const analysis = analyzeFeedings([feed(1, 1, 8, 50), feed(2, 4, 9, 160)], [], at(4, 20));
  const emptyDays = summarizeFeedingRange(analysis.days.slice(1, 3))!;
  assert.equal(emptyDays.dailyML, 0);
  assert.equal(emptyDays.feedsPerDay, 0);
  assert.equal(emptyDays.perFeedML, null);
  assert.equal(emptyDays.longestGapHours, null);
});
