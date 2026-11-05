import assert from "node:assert/strict";
import test from "node:test";
import { decodeSubtitle, romanianOrthography, srtToVtt } from "./srt.js";

test("turns SRT timestamps into WebVTT", () => {
  const vtt = srtToVtt("1\n00:00:01,000 --> 00:00:04,000\nSalut\n");
  assert.match(vtt, /^WEBVTT/);
  assert.match(vtt, /00:00:01\.000 --> 00:00:04\.000/);
  assert.match(vtt, /Salut/);
});

test("decodes Romanian Windows-1250 bytes and leaves UTF-8 alone", () => {
  const legacy = Buffer.from([0x42, 0x75, 0x6e, 0xe3, 0x20, 0xba, 0xfe]);
  assert.equal(decodeSubtitle(legacy), "Bun\u0103 \u015f\u0163");
  assert.equal(romanianOrthography(decodeSubtitle(legacy)), "Bun\u0103 \u0219\u021b");
  assert.equal(decodeSubtitle(Buffer.from("Bun\u0103, \u0219\u021b\u0103.", "utf8")), "Bun\u0103, \u0219\u021b\u0103.");
});
