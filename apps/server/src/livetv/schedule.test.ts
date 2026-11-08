import assert from "node:assert/strict";
import test from "node:test";
import { continueSchedule, createPicker, fillSchedule, HORIZON_MS, shuffledOrder, type ScheduleItem } from "./schedule.js";

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 10, 8, 18, 0, 0);

function movie(id: string, minutes: number, order = 0): ScheduleItem {
  return {
    itemType: "movie",
    itemId: id,
    fileId: `file-${id}`,
    durationMs: minutes * MINUTE,
    title: id,
    subtitle: null,
    description: null,
    image: null,
    group: "movies",
    order,
  };
}

function episode(series: string, season: number, number: number, minutes = 25): ScheduleItem {
  return {
    ...movie(`${series}-s${season}e${number}`, minutes),
    itemType: "episode",
    group: `series:${series}`,
    order: season * 1000 + number,
  };
}

const films = Array.from({ length: 12 }, (_, index) => movie(`m${index}`, 90 + index * 5, index));

test("shuffle is the same for the same seed and differs between seeds", () => {
  const a = fillSchedule({ items: films, mode: "shuffle", seed: 42, from: NOW, firstSeq: 0, until: NOW + 48 * 60 * MINUTE });
  const b = fillSchedule({ items: [...films].reverse(), mode: "shuffle", seed: 42, from: NOW, firstSeq: 0, until: NOW + 48 * 60 * MINUTE });
  const c = fillSchedule({ items: films, mode: "shuffle", seed: 7, from: NOW, firstSeq: 0, until: NOW + 48 * 60 * MINUTE });
  assert.deepEqual(a.map((program) => program.itemId), b.map((program) => program.itemId));
  assert.notDeepEqual(a.map((program) => program.itemId), c.map((program) => program.itemId));
});

test("a shuffled pass plays every item once and never repeats across passes", () => {
  for (let cycle = 0; cycle < 20; cycle += 1) {
    const order = shuffledOrder(5, 99, cycle);
    assert.deepEqual([...order].sort(), [0, 1, 2, 3, 4]);
  }
  const pick = createPicker(films.slice(0, 4), "shuffle", 3)!;
  for (let seq = 1; seq < 400; seq += 1) assert.notEqual(pick(seq).itemId, pick(seq - 1).itemId);
});

test("sequential plays episodes in order and rotates between series", () => {
  const items = [episode("b", 1, 2), episode("a", 1, 1), episode("b", 1, 1), episode("a", 2, 1), episode("a", 1, 2)];
  const pick = createPicker(items, "sequential", 1)!;
  const aired = Array.from({ length: 6 }, (_, seq) => pick(seq).itemId);
  // a: S1E1, S1E2, S2E1 – b: S1E1, S1E2, then b starts over while a continues.
  assert.deepEqual(aired, ["a-s1e1", "b-s1e1", "a-s1e2", "b-s1e2", "a-s2e1", "b-s1e1"]);
});

test("programs are continuous and reach the horizon", () => {
  const { add } = continueSchedule({ existing: [], items: films, mode: "shuffle", seed: 5, now: NOW });
  assert.equal(add[0]!.start, NOW);
  for (let index = 1; index < add.length; index += 1) assert.equal(add[index]!.start, add[index - 1]!.end);
  assert.ok(add[add.length - 1]!.end >= NOW + HORIZON_MS);
  assert.ok(add[add.length - 1]!.start < NOW + HORIZON_MS);
});

test("extending in steps gives the same program as filling at once", () => {
  const items = [...films, episode("x", 1, 1), episode("x", 1, 2), episode("x", 1, 3)];
  for (const mode of ["shuffle", "sequential"] as const) {
    const whole = continueSchedule({ existing: [], items, mode, seed: 11, now: NOW }).add;
    const first = continueSchedule({ existing: [], items, mode, seed: 11, now: NOW, horizonMs: 20 * 60 * MINUTE }).add;
    // A day later the daily job tops the program up again.
    const second = continueSchedule({ existing: first, items, mode, seed: 11, now: NOW + 3 * 60 * MINUTE, horizonMs: HORIZON_MS - 3 * 60 * MINUTE }).add;
    const stepped = [...first, ...second];
    assert.deepEqual(
      stepped.map((program) => [program.start, program.itemId]),
      whole.slice(0, stepped.length).map((program) => [program.start, program.itemId]),
      mode,
    );
  }
});

test("a channel edit keeps the program on air and rebuilds after it", () => {
  const existing = continueSchedule({ existing: [], items: films, mode: "shuffle", seed: 5, now: NOW }).add;
  const now = existing[1]!.start + 10 * MINUTE;
  const fewer = films.slice(0, 3);
  const { removeFrom, add } = continueSchedule({ existing, items: fewer, mode: "shuffle", seed: 5, now, cutAt: now });
  assert.equal(removeFrom, now);
  assert.equal(add[0]!.start, existing[1]!.end);
  assert.equal(add[0]!.seq, existing[1]!.seq + 1);
  assert.ok(add.every((program) => fewer.some((item) => item.itemId === program.itemId)));
});

test("a missing file is replaced from its slot onward", () => {
  const existing = continueSchedule({ existing: [], items: films, mode: "sequential", seed: 5, now: NOW }).add;
  const gone = existing[3]!;
  const remaining = films.filter((item) => item.fileId !== gone.fileId);
  // Found while it airs: the cut lies in the past.
  const now = gone.start + 20 * MINUTE;
  const { removeFrom, add } = continueSchedule({ existing, items: remaining, mode: "sequential", seed: 5, now, cutAt: gone.start });
  assert.equal(removeFrom, gone.start);
  assert.equal(add[0]!.start, gone.start);
  assert.equal(add[0]!.seq, gone.seq);
  assert.ok(add.every((program) => program.fileId !== gone.fileId));
  assert.ok(add[add.length - 1]!.end >= now + HORIZON_MS);
});

test("a program that ran out restarts at the current time", () => {
  const existing = continueSchedule({ existing: [], items: films, mode: "shuffle", seed: 5, now: NOW, horizonMs: 60 * MINUTE }).add;
  const later = NOW + 5 * 24 * 60 * MINUTE + 1234;
  const { add } = continueSchedule({ existing, items: films, mode: "shuffle", seed: 5, now: later });
  assert.equal(add[0]!.start, Math.floor(later / 1000) * 1000);
  assert.equal(add[0]!.seq, existing[existing.length - 1]!.seq + 1);
});

test("nothing is scheduled without playable items", () => {
  assert.deepEqual(continueSchedule({ existing: [], items: [movie("tiny", 0.1)], mode: "shuffle", seed: 1, now: NOW }).add, []);
});
