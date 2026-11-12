import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { transcodePlaybackReady } from "@kinora/shared";
import { commandWorks } from "../process.js";
import {
  backgroundTranscodes,
  consumeProgress,
  discardTranscode,
  ensureTranscode,
  hasForegroundTranscode,
  hasOtherTranscode,
  hlsArgs,
  keyframeBefore,
  subtitleRunFile,
  parseClock,
  playlistCursor,
  playlistForClient,
  playlistHasSegment,
  prepareAppendPlaylist,
  sessionKey,
  transcodeLocation,
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

test("hands a query token on to every segment for players that cannot send headers", () => {
  const playlist = playlistForClient("#EXTM3U\n#EXTINF:4.000,\nseg00000.ts\n#EXTINF:4.000,\nseg00001.ts\n", "kd_a b");
  assert.match(playlist, /^seg00000\.ts\?token=kd_a%20b$/m);
  assert.match(playlist, /^seg00001\.ts\?token=kd_a%20b$/m);
  assert.doesNotMatch(playlistForClient("#EXTM3U\nseg00000.ts\n", null), /token/);
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

test("the browser's encoder arguments are unchanged by profiles", () => {
  const args = hlsArgs("movie.mkv", "C:\\cache", { copyVideo: false, copyAudio: false });
  assert.equal(args[args.indexOf("-vf") + 1], "scale='min(1920,iw)':-2:flags=bicubic,format=yuv420p");
  assert.deepEqual(args.slice(args.indexOf("-c:a"), args.indexOf("-c:a") + 8), ["-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "192k"]);
  assert.equal(args.includes("-maxrate"), false);
});

test("a TV profile gets AC-3 5.1, a lower resolution and a bitrate cap", () => {
  const args = hlsArgs("movie.mkv", "C:\\cache", {
    copyVideo: false,
    copyAudio: false,
    audio: { codec: "ac3", channels: 6 },
    maxHeight: 720,
    maxBitrate: 4_000_000,
  });
  assert.deepEqual(args.slice(args.indexOf("-c:a"), args.indexOf("-c:a") + 8), ["-c:a", "ac3", "-ac", "6", "-ar", "48000", "-b:a", "640k"]);
  assert.equal(args[args.indexOf("-vf") + 1], "scale='min(1920,iw)':-2:flags=bicubic,scale=-2:'min(720,ih)',format=yuv420p");
  assert.equal(args[args.indexOf("-maxrate") + 1], "3360k", "the cap leaves room for the 640k sound");
  const nvenc = hlsArgs("movie.mkv", "C:\\cache", { copyVideo: false, copyAudio: true, videoEncoder: "h264_nvenc", maxBitrate: 4_000_000 });
  assert.equal(nvenc[nvenc.indexOf("-maxrate") + 1], "3808k");
});

test("each output variant has its own session and cache directory", () => {
  const browser = transcodeLocation({ fileId: "f1", size: 10, mtime: 20 });
  const tv = transcodeLocation({ fileId: "f1", size: 10, mtime: 20, variant: "vc-aac36" });
  assert.equal(browser.key, "f1-10-20", "conversions made before profiles are still found");
  assert.equal(tv.key, "f1-10-20-vc-aac36");
  assert.equal(transcodeLocation({ fileId: "f1", size: 10, mtime: 20, variant: "vc-aac36", start: 60 }).key, "f1-10-20-vc-aac36-at60");
  assert.equal(sessionKey("f1", 0, "vc-aac36"), "f1~vc-aac36");
  assert.equal(sessionKey("f1", 60, "vc-aac36"), "f1~vc-aac36@60");
});

test("starts a separate session midway for Live TV", () => {
  const args = hlsArgs("movie.mkv", "C:\cache", { copyVideo: true, copyAudio: true }, { seek: 1800, startNumber: 0, append: false });
  assert.equal(args[args.indexOf("-ss") + 1], "1800.000");
  assert.ok(args.indexOf("-ss") < args.indexOf("-i"));
  assert.doesNotMatch(args[args.indexOf("-hls_flags") + 1]!, /append_list/);
  assert.equal(args.includes("-start_number"), false);
  const whole = transcodeLocation({ fileId: "f1", size: 10, mtime: 20 });
  const midway = transcodeLocation({ fileId: "f1", size: 10, mtime: 20, start: 1800 });
  assert.notEqual(whole.dir, midway.dir);
  assert.equal(transcodeLocation({ fileId: "f1", size: 10, mtime: 20, start: 0 }).key, whole.key);
  assert.equal(sessionKey("f1"), "f1");
  assert.equal(sessionKey("f1", 1800), "f1@1800");
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

test("a background conversion runs beside the open one and joins it when a player asks", { timeout: 60_000 }, async () => {
  if (!commandWorks("ffmpeg") || !encoderExists("libx264")) return;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kinora-"));
  const make = (name: string) => {
    const source = path.join(directory, `${name}.mkv`);
    const created = spawnSync(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24:duration=40", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=40", "-map", "0:v", "-map", "1:a", "-c:v", "mpeg4", "-c:a", "aac", "-shortest", source],
      { encoding: "utf8", windowsHide: true },
    );
    if (created.status !== 0) assert.fail(created.stderr || "could not create a sample");
    const stat = fs.statSync(source);
    return { fileId: `file_${name}_bg_test`, sourcePath: source, size: stat.size, mtime: Math.round(stat.mtimeMs), duration: 40, copyVideo: false, copyAudio: true };
  };
  const watching = make("watching");
  const next = make("next");
  try {
    discardTranscode(watching);
    discardTranscode(next);
    assert.equal((await ensureTranscode(watching, true)).status.state, "running");
    assert.equal((await ensureTranscode({ ...next, background: true })).status.state, "running");
    // The player's conversion keeps running, and does not count the prepared one as a rival.
    assert.equal(hasForegroundTranscode(), true);
    assert.equal(hasOtherTranscode(watching.fileId), false);
    assert.deepEqual(backgroundTranscodes(), [next.fileId]);
    // The next program starts: its player joins the running conversion instead of starting over.
    assert.equal((await ensureTranscode(next)).status.state, "running");
    assert.deepEqual(backgroundTranscodes(), []);
  } finally {
    discardTranscode(watching);
    discardTranscode(next);
    fs.rmSync(directory, { recursive: true, force: true });
  }
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

test("hlsArgs writes embedded subtitles from the same pass, named by the run start", () => {
  const args = hlsArgs("movie.mkv", "C:\\cache", { copyVideo: true, copyAudio: true }, { seek: 100, startNumber: 25 }, [2, 5]);
  assert.equal(args.filter((arg) => arg === "-i").length, 1);
  const hlsOutput = args.indexOf(path.join("C:\\cache", "index.m3u8"));
  const subtitleMap = args.indexOf("0:2");
  assert.ok(hlsOutput > 0 && subtitleMap > hlsOutput);
  assert.equal(args[args.length - 1], subtitleRunFile("C:\\cache", 5, 100));
  assert.ok(subtitleRunFile("C:\\cache", 5, 100).endsWith("sub5_100000.vtt"));
  assert.equal(hlsArgs("movie.mkv", "C:\\cache", { copyVideo: true, copyAudio: true }).includes("webvtt"), false);
});

test("keyframeBefore picks the last keyframe at or before the seek point", () => {
  const csv = ["95.000000,K__", "96.000000,___", "99.960000,K__", "100.200000,___", "101.000000,K__"].join("\n");
  assert.equal(keyframeBefore(csv, 100), 99.96);
  assert.equal(keyframeBefore("1.0,___", 100), null);
});
