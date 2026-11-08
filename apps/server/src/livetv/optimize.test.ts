import assert from "node:assert/strict";
import test from "node:test";
import { pickFillerVideos } from "./fillerPick.js";
import { decidePrepare, PICKUP_GRACE_MS, PREPARE_BEFORE_MS, SHARE_CPU_BEFORE_MS } from "./prepare.js";
import { continueSchedule, fillSchedule, nextSlot, type ScheduleItem } from "./schedule.js";

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 10, 8, 18, 7, 0);

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

const films = Array.from({ length: 8 }, (_, index) => movie(`m${index}`, 83 + index * 7, index));

test("slots fall on the local grid", () => {
  assert.equal(nextSlot(NOW, 30, 0), Date.UTC(2026, 10, 8, 18, 30));
  assert.equal(nextSlot(Date.UTC(2026, 10, 8, 18, 30), 30, 0), Date.UTC(2026, 10, 8, 18, 30));
  assert.equal(nextSlot(NOW, 60, 0), Date.UTC(2026, 10, 8, 19, 0));
  // At UTC+5:30 the local hour is at :30 UTC.
  assert.equal(nextSlot(NOW, 60, 330), Date.UTC(2026, 10, 8, 18, 30));
  assert.equal(nextSlot(NOW, 0, 0), NOW);
});

test("aligned items start on the grid with a filler before each gap", () => {
  const programs = fillSchedule({ items: films, mode: "sequential", seed: 1, from: NOW, firstSeq: 0, until: NOW + 24 * 60 * MINUTE, alignMinutes: 30, offsetMinutes: 0 });
  const items = programs.filter((program) => program.itemType !== "filler");
  // A new channel starts at once; everything after it waits for :00 or :30.
  assert.equal(items[0]!.start, NOW);
  for (const program of items.slice(1)) assert.equal(new Date(program.start).getUTCMinutes() % 30, 0);
  for (let index = 1; index < programs.length; index += 1) assert.equal(programs[index]!.start, programs[index - 1]!.end);
  const fillers = programs.filter((program) => program.itemType === "filler");
  assert.ok(fillers.length > 0);
  for (const filler of fillers) {
    assert.equal(filler.fileId, null);
    assert.ok(filler.end - filler.start < 30 * MINUTE);
  }
  // Fillers do not use up positions of the play order.
  assert.deepEqual(
    items.map((program) => program.seq),
    items.map((_, index) => index),
  );
});

test("aligned programs extended in steps match one fill", () => {
  const whole = continueSchedule({ existing: [], items: films, mode: "shuffle", seed: 9, now: NOW, horizonMs: 48 * 60 * MINUTE, alignMinutes: 30, offsetMinutes: 0 }).add;
  const first = continueSchedule({ existing: [], items: films, mode: "shuffle", seed: 9, now: NOW, horizonMs: 12 * 60 * MINUTE, alignMinutes: 30, offsetMinutes: 0 }).add;
  const rest = continueSchedule({ existing: first, items: films, mode: "shuffle", seed: 9, now: NOW, horizonMs: 48 * 60 * MINUTE, alignMinutes: 30, offsetMinutes: 0 }).add;
  const stepped = [...first, ...rest];
  const shape = (list: typeof whole) => list.map((program) => `${program.start}-${program.end}-${program.itemType}-${program.itemId}`);
  assert.deepEqual(shape(stepped).slice(0, whole.length), shape(whole).slice(0, stepped.length));
});

test("turning alignment on keeps the program on air and aligns what follows", () => {
  const plain = continueSchedule({ existing: [], items: films, mode: "sequential", seed: 3, now: NOW, horizonMs: 6 * 60 * MINUTE }).add;
  const later = NOW + 10 * MINUTE;
  const onAir = plain.find((program) => program.start <= later && program.end > later)!;
  const plan = continueSchedule({ existing: plain, items: films, mode: "sequential", seed: 3, now: later, cutAt: later, horizonMs: 6 * 60 * MINUTE, alignMinutes: 30, offsetMinutes: 0 });
  assert.equal(plan.add[0]!.start, onAir.end);
  const firstItem = plan.add.find((program) => program.itemType !== "filler")!;
  assert.equal(new Date(firstItem.start).getUTCMinutes() % 30, 0);
  assert.equal(firstItem.seq, onAir.seq + 1);
});

test("a gap shorter than a second goes to the program before it", () => {
  const items = [movie("a", 30 - 1 / 120), movie("b", 30)];
  const programs = fillSchedule({ items, mode: "sequential", seed: 1, from: Date.UTC(2026, 10, 8, 18, 0), firstSeq: 0, until: Date.UTC(2026, 10, 8, 20, 0), alignMinutes: 30, offsetMinutes: 0 });
  assert.equal(programs.filter((program) => program.itemType === "filler").length, 0);
  assert.equal(programs[0]!.end, Date.UTC(2026, 10, 8, 18, 30));
});

test("the soonest upcoming program is prepared a few minutes ahead", () => {
  const now = NOW;
  const upcoming = [
    { channelId: "a", start: now + PREPARE_BEFORE_MS + MINUTE, fileId: "far" },
    { channelId: "b", start: now + 3 * MINUTE, fileId: "soon" },
    { channelId: "c", start: now + 2 * MINUTE, fileId: "sooner" },
  ];
  const decision = decidePrepare({ now, upcoming, recent: [], foregroundBusy: false });
  assert.equal(decision.start?.fileId, "sooner");
  assert.ok(decision.keep.has("soon"));
  assert.ok(!decision.keep.has("far"));
});

test("preparing waits for a running conversion until shortly before the start", () => {
  const now = NOW;
  const early = decidePrepare({ now, upcoming: [{ channelId: "a", start: now + 3 * MINUTE, fileId: "f" }], recent: [], foregroundBusy: true });
  assert.equal(early.start, null);
  assert.ok(early.keep.has("f"));
  const close = decidePrepare({ now, upcoming: [{ channelId: "a", start: now + SHARE_CPU_BEFORE_MS - 1000, fileId: "f" }], recent: [], foregroundBusy: true });
  assert.equal(close.start?.fileId, "f");
});

test("a program that just started stays prepared for its player", () => {
  const now = NOW;
  const kept = decidePrepare({ now, upcoming: [], recent: [{ channelId: "a", start: now - PICKUP_GRACE_MS / 2, fileId: "f" }], foregroundBusy: false });
  assert.ok(kept.keep.has("f"));
  const dropped = decidePrepare({ now, upcoming: [], recent: [{ channelId: "a", start: now - PICKUP_GRACE_MS - 1000, fileId: "f" }], foregroundBusy: false });
  assert.ok(!dropped.keep.has("f"));
});

test("fillers show the channel's own trailers first and are stable", () => {
  const trailers = [
    { key: "aaaaaaaaaaa", title: "A", kind: "trailer" as const, titleId: "m1" },
    { key: "bbbbbbbbbbb", title: "B", kind: "trailer" as const, titleId: "m2" },
    { key: "ccccccccccc", title: "C", kind: "trailer" as const, titleId: "m3" },
  ];
  const clips = [{ key: "ddddddddddd", title: "D", kind: "clip" as const }];
  const video = pickFillerVideos({ trailers, clips, ownTitles: new Set(["m3"]), music: false, seed: 5, seconds: 20 * 60 });
  assert.equal(video[0]!.key, "ccccccccccc");
  assert.equal(video[video.length - 1]!.key, "ddddddddddd");
  assert.deepEqual(video, pickFillerVideos({ trailers, clips, ownTitles: new Set(["m3"]), music: false, seed: 5, seconds: 20 * 60 }));
  const music = pickFillerVideos({ trailers, clips, ownTitles: new Set(), music: true, seed: 5, seconds: 20 * 60 });
  assert.equal(music[0]!.kind, "clip");
  // A short gap gets a short list.
  assert.equal(pickFillerVideos({ trailers, clips, ownTitles: new Set(), music: false, seed: 5, seconds: 60 }).length, 3);
});
