import assert from "node:assert/strict";
import test from "node:test";
import { isShellKeyMessage, SHELL_MESSAGE_SOURCE } from "@kinora/shared";
import { decodeNative } from "./android";

test("native reports keep their fields and get NaN / Infinity durations back", () => {
  assert.deepEqual(decodeNative(JSON.stringify({ event: "ready", session: 3, duration: 5400.5 })), {
    report: { event: "ready", session: 3, duration: 5400.5 },
  });
  const live = decodeNative(JSON.stringify({ event: "time", session: 3, time: 12.25, duration: "live" }));
  assert.ok(live && "report" in live && live.report.event === "time");
  assert.equal(live.report.time, 12.25);
  assert.equal(live.report.duration, Number.POSITIVE_INFINITY);
  const unknown = decodeNative(JSON.stringify({ event: "ready", session: 3, duration: null }));
  assert.ok(unknown && "report" in unknown && unknown.report.event === "ready");
  assert.ok(Number.isNaN(unknown.report.duration));
  const negative = decodeNative(JSON.stringify({ event: "time", session: 1, time: -4, duration: -1 }));
  assert.ok(negative && "report" in negative && negative.report.event === "time");
  assert.equal(negative.report.time, 0);
  assert.ok(Number.isNaN(negative.report.duration));
});

test("tracks, errors and logs pass through; the bridge source is not added to them", () => {
  const tracks = [{ id: "1:0", language: "eng", label: "eng · E-AC-3 5.1", enabled: true }];
  assert.deepEqual(decodeNative(JSON.stringify({ event: "tracks", session: 2, tracks })), { report: { event: "tracks", session: 2, tracks } });
  assert.deepEqual(decodeNative(JSON.stringify({ event: "error", session: 2, code: "ERROR_CODE_DECODING_FAILED" })), {
    report: { event: "error", session: 2, code: "ERROR_CODE_DECODING_FAILED" },
  });
  assert.deepEqual(decodeNative(JSON.stringify({ event: "buffering", session: 2, percent: null })), {
    report: { event: "buffering", session: 2, percent: null },
  });
});

test("keys are recognised only from the shared list; anything else is dropped", () => {
  assert.deepEqual(decodeNative(JSON.stringify({ key: "MediaPlayPause" })), { key: "MediaPlayPause" });
  assert.equal(decodeNative(JSON.stringify({ key: "Enter" })), null);
  assert.equal(decodeNative(JSON.stringify({ event: "nonsense", session: 1 })), null);
  assert.equal(decodeNative(JSON.stringify({ event: "ready" })), null);
  assert.equal(decodeNative("not json"), null);
  assert.equal(decodeNative("null"), null);
});

test("the UI accepts the key message the shell forwards", () => {
  assert.equal(isShellKeyMessage({ source: SHELL_MESSAGE_SOURCE, type: "key", key: "MediaRewind" }), true);
  assert.equal(isShellKeyMessage({ source: SHELL_MESSAGE_SOURCE, type: "key", key: "Escape" }), false);
  assert.equal(isShellKeyMessage({ source: "other", type: "key", key: "MediaRewind" }), false);
});
