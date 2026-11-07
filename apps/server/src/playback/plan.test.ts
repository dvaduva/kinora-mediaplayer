import assert from "node:assert/strict";
import test from "node:test";
import { canCopyAudio, canCopyVideo, playbackPlan } from "./plan.js";

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

test("encodes HEVC, VP9 in MKV and MPEG-4 video when ffmpeg is available", () => {
  for (const [container, videoCodec] of [["mp4", "hevc"], ["mkv", "vp9"], ["avi", "mpeg4"], ["mkv", "av1"]]) {
    const plan = playbackPlan({ kind: "video", container, videoCodec, audioCodec: "aac", ffmpeg: true });
    assert.equal(plan.available, true, `${container}/${videoCodec}`);
    assert.equal(plan.mode, "transcode");
  }
  assert.equal(playbackPlan({ kind: "video", container: "mp4", videoCodec: "hevc", audioCodec: "aac" }).available, false);
});

test("leaves files without a known video stream unavailable", () => {
  assert.equal(playbackPlan({ kind: "video", container: "mkv", videoCodec: null, audioCodec: "aac", ffmpeg: true }).available, false);
});

test("copies only streams the browser understands", () => {
  assert.equal(canCopyVideo("h264"), true);
  assert.equal(canCopyVideo("hevc"), false);
  assert.equal(canCopyAudio("aac"), true);
  assert.equal(canCopyAudio(null), true);
  assert.equal(canCopyAudio("eac3"), false);
});

test("plays common audio files directly", () => {
  assert.equal(playbackPlan({ kind: "audio", container: "flac", videoCodec: null, audioCodec: "flac" }).available, true);
  assert.equal(playbackPlan({ kind: "audio", container: "mp3", videoCodec: null, audioCodec: "mp3" }).available, true);
});
