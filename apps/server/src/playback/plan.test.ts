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
    playbackPlan({ kind: "video", container: "mkv", videoCodec: "h264", audioCodec: "ac3" }).available,
    false,
  );
});

test("converts H.264 with E-AC-3 when ffmpeg is available", () => {
  const plan = playbackPlan({ kind: "video", container: "mkv", videoCodec: "h264", audioCodec: "eac3", ffmpeg: true });
  assert.equal(plan.mode, "transcode");
  assert.equal(plan.available, true);
  assert.equal(
    playbackPlan({ kind: "video", container: "mp4", videoCodec: "h264", audioCodec: "eac3" }).available,
    false,
  );
});

test("remuxes H.264 and AAC in MKV when ffmpeg is available", () => {
  const plan = playbackPlan({ kind: "video", container: "mkv", videoCodec: "h264", audioCodec: "aac", ffmpeg: true });
  assert.equal(plan.mode, "remux");
  assert.equal(plan.available, true);
});

test("keeps HEVC unavailable even with ffmpeg", () => {
  const plan = playbackPlan({ kind: "video", container: "mp4", videoCodec: "hevc", audioCodec: "aac", ffmpeg: true });
  assert.equal(plan.available, false);
  assert.equal(plan.mode, "transcode");
});

test("plays common audio files directly", () => {
  assert.equal(playbackPlan({ kind: "audio", container: "flac", videoCodec: null, audioCodec: "flac" }).available, true);
  assert.equal(playbackPlan({ kind: "audio", container: "mp3", videoCodec: null, audioCodec: "mp3" }).available, true);
});
