import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { transcodePlaybackReady } from "@kinora/shared";
import { commandWorks } from "../process.js";
import {
  consumeProgress,
  discardTranscode,
  ensureTranscode,
  hlsArgs,
  parseClock,
  playlistCursor,
  playlistForClient,
  playlistHasSegment,
  prepareAppendPlaylist,
  videoEncoder,
} from "./transcode.js";

test("parses ffmpeg progress clocks", () => {
  assert.equal(parseClock("00:01:02.500000"), 62.5);
  assert.equal(parseClock("N/A"), null);
  const parsed = consumeProgress("out_time=00:00:0", "1.250000\nprogress=continue\n");
  assert.equal(parsed.seconds, 1.25);
  assert.equal(parsed.rest, "");
});

test("rewrites absolute playlist paths to segment names", () => {
  const playlist = playlistForClient("#EXTM3U\n#EXTINF:4.000,\nD:\\\\cache\\\\seg00000.ts\n#EXT-X-ENDLIST\n");
  assert.match(playlist, /^seg00000\.ts$/m);
  assert.doesNotMatch(playlist, /cache/);
  assert.equal(playlistHasSegment(playlist), true);
});

test("starts playback once the resume point has been converted", () => {
  assert.equal(transcodePlaybackReady({ state: "running", seconds: 1, playlist: true }, 0), true);
  assert.equal(transcodePlaybackReady({ state: "running", seconds: 10, playlist: true }, 40), false);
  assert.equal(transcodePlaybackReady({ state: "running", seconds: 44, playlist: true }, 40), true);
  assert.equal(transcodePlaybackReady({ state: "error", seconds: 44, playlist: true }, 0), false);
});

test("copies H.264 and encodes other audio for the browser", () => {
  const encoded = hlsArgs("movie.mkv", "C:\\cache", { copyVideo: true, copyAudio: false });
  assert.equal(encoded.includes("-c:v") && encoded[encoded.indexOf("-c:v") + 1], "copy");
  assert.ok(encoded.includes("aac"));
  assert.equal(encoded[encoded.indexOf("-hls_list_size") + 1], "0");
  assert.equal(encoded.includes("-ss"), false);
  const copied = hlsArgs("movie.mkv", "C:\\cache", { copyVideo: true, copyAudio: true });
  assert.equal(copied[copied.indexOf("-c:a") + 1], "copy");
});

test("encodes other video to 8-bit H.264 with keyframes on segment boundaries", () => {
  const args = hlsArgs("movie.mkv", "C:\\cache", { copyVideo: false, copyAudio: true });
  assert.equal(args[args.indexOf("-c:v") + 1], "libx264");
  assert.match(args[args.indexOf("-vf") + 1], /format=yuv420p/);
  assert.equal(args[args.indexOf("-force_key_frames") + 1], "expr:gte(t,n_forced*4)");
  const nvenc = hlsArgs("movie.mkv", "C:\\cache", { copyVideo: false, copyAudio: true, videoEncoder: "h264_nvenc" });
  assert.equal(nvenc[nvenc.indexOf("-c:v") + 1], "h264_nvenc");
  assert.equal(nvenc.includes("-crf"), false);
  assert.equal(videoEncoder(undefined), "libx264");
  assert.equal(videoEncoder("h264_qsv"), "h264_qsv");
  assert.equal(videoEncoder("x; rm -rf"), "libx264");
});

test("continues a partial transcode after the segments already written", () => {
  const cursor = playlistCursor("#EXTM3U\n#EXTINF:4.5,\nseg00000.ts\n#EXTINF:4,\nseg00001.ts\n");
  assert.deepEqual(cursor, { seconds: 8.5, count: 2, nextNumber: 2 });
  const prepared = prepareAppendPlaylist("#EXTM3U\n#EXTINF:4,\nseg00000.ts\n#EXT-X-ENDLIST\n");
  assert.match(prepared, /#EXT-X-DISCONTINUITY/);
  assert.equal(prepared.includes("#EXT-X-ENDLIST"), false);
  const resumed = hlsArgs("movie.mkv", "C:\\cache", { copyVideo: true, copyAudio: false }, { seek: 8.5, startNumber: 2 });
  assert.equal(resumed[resumed.indexOf("-ss") + 1], "8.500");
  assert.ok(resumed.indexOf("-ss") < resumed.indexOf("-i"));
  assert.match(resumed[resumed.indexOf("-hls_flags") + 1], /append_list/);
  assert.equal(resumed[resumed.indexOf("-start_number") + 1], "2");
});

test("builds a browser playlist from H.264 and E-AC-3", { timeout: 60_000 }, async () => {
  if (!commandWorks("ffmpeg")) return;
  const audioCodec = encoderExists("eac3") ? "eac3" : encoderExists("ac3") ? "ac3" : null;
  if (!audioCodec) return;
  await transcodeSample({ name: "file_transcode_test", videoCodec: "libx264", audioCodec, copyVideo: true, copyAudio: false });
});

test("encodes non-H.264 video into a browser playlist", { timeout: 60_000 }, async () => {
  if (!commandWorks("ffmpeg") || !encoderExists("libx264")) return;
  await transcodeSample({ name: "file_video_encode_test", videoCodec: "mpeg4", audioCodec: "aac", copyVideo: false, copyAudio: true });
});

async function transcodeSample(sample: { name: string; videoCodec: string; audioCodec: string; copyVideo: boolean; copyAudio: boolean }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kinora-"));
  const source = path.join(directory, "sample.mkv");
  const created = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=160x120:rate=24:duration=2",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=2",
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-c:v",
      sample.videoCodec,
      "-pix_fmt",
      "yuv420p",
      "-g",
      "24",
      "-c:a",
      sample.audioCodec,
      "-b:a",
      "96k",
      "-shortest",
      source,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (created.status !== 0) {
    assert.fail(created.stderr || "could not create a sample");
  }
  const stat = fs.statSync(source);
  const input = {
    fileId: sample.name,
    sourcePath: source,
    size: stat.size,
    mtime: Math.round(stat.mtimeMs),
    duration: 2,
    copyVideo: sample.copyVideo,
    copyAudio: sample.copyAudio,
  };
  try {
    await ensureTranscode(input, true);
    const deadline = Date.now() + 30_000;
    let status = (await ensureTranscode(input)).status;
    while (status.state === "running" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      status = (await ensureTranscode(input)).status;
    }
    assert.equal(status.state, "ready", status.error ?? "transcode did not finish");
    assert.equal(status.playlist, true);
  } finally {
    discardTranscode(input);
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function encoderExists(name: string) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8", windowsHide: true });
  return new RegExp(`\\b${name}\\b`).test(result.stdout);
}
