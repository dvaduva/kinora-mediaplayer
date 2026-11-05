import assert from "node:assert/strict";
import test from "node:test";
import { playbackPlan } from "./plan.js";

test("plays browser-safe mp4 directly", () => {
  const plan = playbackPlan({ kind: "video", container: "mp4", videoCodec: "h264", audioCodec: "aac" });
  assert.equal(plan.mode, "direct");
  assert.equal(plan.available, true);
});

test("asks for a remux when the codecs are fine but the container is MKV", () => {
  const plan = playbackPlan({ kind: "video", container: "mkv", videoCodec: "h264", audioCodec: "aac" });
  assert.equal(plan.mode, "remux");
  assert.equal(plan.available, false);
  assert.equal(plan.reasonCode, "remux_required");
});

test("asks for a transcode for HEVC and for AC-3", () => {
  assert.equal(
    playbackPlan({ kind: "video", container: "mp4", videoCodec: "hevc", audioCodec: "aac" }).reasonCode,
    "transcode_required",
  );
  assert.equal(
    playbackPlan({ kind: "video", container: "mkv", videoCodec: "h264", audioCodec: "ac3" }).reasonCode,
    "transcode_required",
  );
});

test("plays common audio files directly", () => {
  assert.equal(playbackPlan({ kind: "audio", container: "flac", videoCodec: null, audioCodec: "flac" }).available, true);
  assert.equal(playbackPlan({ kind: "audio", container: "mp3", videoCodec: null, audioCodec: "mp3" }).available, true);
});
