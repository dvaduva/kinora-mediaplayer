import assert from "node:assert/strict";
import test from "node:test";
import { activeCueLines, parseTimestamp, parseVtt } from "./vtt";

test("reads WebVTT timestamps with and without hours", () => {
  assert.equal(parseTimestamp("00:01.500"), 1.5);
  assert.equal(parseTimestamp("01:02:03.250"), 3723.25);
  assert.equal(parseTimestamp("00:00:04,000"), 4);
  assert.equal(parseTimestamp("nope"), null);
});

test("parses cues and drops headers, notes and markup", () => {
  const cues = parseVtt(
    "﻿WEBVTT\r\n\r\nNOTE made by Kinora\r\n\r\n1\r\n00:00:05.000 --> 00:00:07.000 line:90%\r\n<i>Hello</i> &amp; welcome\r\nsecond line\r\n\r\n00:00:01.000 --> 00:00:02.000\r\n<c.yellow>First</c>\r\n\r\n00:00:09.000 --> 00:00:08.000\r\nbackwards\r\n",
  );
  assert.deepEqual(cues, [
    { start: 1, end: 2, lines: ["First"] },
    { start: 5, end: 7, lines: ["Hello & welcome", "second line"] },
  ]);
});

test("shows the cues active at a time, shifted by the subtitle delay", () => {
  const cues = parseVtt("WEBVTT\n\n00:01.000 --> 00:03.000\nA\n\n00:02.000 --> 00:04.000\nB\n\n00:10.000 --> 00:11.000\nC\n");
  assert.deepEqual(activeCueLines(cues, 0.5), []);
  assert.deepEqual(activeCueLines(cues, 2.5), ["A", "B"]);
  assert.deepEqual(activeCueLines(cues, 3), ["B"]);
  assert.deepEqual(activeCueLines(cues, 10.5, 0.5), ["C"]);
  assert.deepEqual(activeCueLines(cues, 10.5, 1), [], "a later delay holds the cue back");
  assert.deepEqual(activeCueLines(cues, 9.5, -0.6), ["C"], "an earlier delay brings it forward");
});
