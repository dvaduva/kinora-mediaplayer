import assert from "node:assert/strict";
import test from "node:test";
import { CHUNK_SECONDS, cuesInChunk, parseVtt } from "./cues.js";

const vtt = "WEBVTT\n\n00:51.000 --> 00:53.000\nFirst\n\n01:01.500 --> 01:03.000 align:start\n<i>Second</i>\nline two\n\n01:00:00.000 --> 01:00:02.000\nHour\n";

test("parseVtt reads minute and hour timestamps with multi-line text", () => {
  assert.deepEqual(parseVtt(vtt), [
    { start: 51, end: 53, text: "First" },
    { start: 61.5, end: 63, text: "<i>Second</i>\nline two" },
    { start: 3600, end: 3602, text: "Hour" },
  ]);
});

test("parseVtt skips an unfinished last cue of a growing file", () => {
  const growing = "WEBVTT\n\n00:01.000 --> 00:02.000\nDone\n\n00:05.000 --> 00:06.000\nHalf";
  assert.deepEqual(parseVtt(growing, true).map((cue) => cue.text), ["Done"]);
  assert.deepEqual(parseVtt(`${growing}\n\n`, true).map((cue) => cue.text), ["Done", "Half"]);
});

test("cuesInChunk keeps cues that start in the window, shifted by the run offset", () => {
  const cues = parseVtt(vtt);
  assert.equal(CHUNK_SECONDS, 60);
  assert.deepEqual(cuesInChunk(cues, 0).map((cue) => cue.text), ["First"]);
  assert.deepEqual(cuesInChunk(cues, 1).map((cue) => cue.start), [61.5]);
  // A resumed conversion starting at 100s writes 00:01 for media time 101s.
  assert.deepEqual(cuesInChunk([{ start: 1, end: 3, text: "x" }], 1, 100), [{ start: 101, end: 103, text: "x" }]);
});
