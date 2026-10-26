import assert from "node:assert/strict";
import test from "node:test";
import { moveDayRange, resolveDayRange } from "../src/lib/feedingRange.ts";

test("range handles cannot cross or leave the available history", () => {
  const range = { start: 10, end: 20 };
  assert.deepEqual(moveDayRange(range, 30, "start", 99), { start: 20, end: 20 });
  assert.deepEqual(moveDayRange(range, 30, "end", -99), { start: 10, end: 10 });
  assert.deepEqual(moveDayRange(range, 30, "start", -99), { start: 0, end: 20 });
  assert.deepEqual(moveDayRange(range, 30, "end", 99), { start: 10, end: 29 });
});

test("dragging the selected window preserves its inclusive length at both edges", () => {
  assert.deepEqual(moveDayRange({ start: 10, end: 20 }, 30, "move", -99), { start: 0, end: 10 });
  assert.deepEqual(moveDayRange({ start: 10, end: 20 }, 30, "move", 99), { start: 19, end: 29 });
  assert.deepEqual(moveDayRange({ start: 0, end: 29 }, 30, "move", 4), { start: 0, end: 29 });
  assert.deepEqual(moveDayRange({ start: 0, end: 0 }, 1, "move", 4), { start: 0, end: 0 });
});

test("presets cover available days, while custom dates stay anchored as records arrive", () => {
  assert.deepEqual(resolveDayRange([10, 20, 30], 14, null), { start: 0, end: 2 });
  assert.deepEqual(resolveDayRange([10, 20, 30], 2, null), { start: 1, end: 2 });
  assert.deepEqual(resolveDayRange([10, 20, 30], null, null), { start: 0, end: 2 });
  assert.deepEqual(resolveDayRange([5, 10, 20, 30, 40], null, { start: 10, end: 30 }), { start: 1, end: 3 });
  assert.deepEqual(resolveDayRange([20, 30], null, { start: 5, end: 10 }), { start: 0, end: 0 });
  assert.deepEqual(resolveDayRange([20, 30], null, { start: 40, end: 50 }), { start: 1, end: 1 });
});
