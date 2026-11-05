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
  playlistForClient,
  playlistHasSegment,
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
  const encoded = hlsArgs("movie.mkv", "C:\\cache", false);
  assert.equal(encoded.includes("-c:v") && encoded[encoded.indexOf("-c:v") + 1], "copy");
  assert.ok(encoded.includes("aac"));
  assert.equal(encoded[encoded.indexOf("-hls_list_size") + 1], "0");
  const copied = hlsArgs("movie.mkv", "C:\\cache", true);
  assert.equal(copied[copied.indexOf("-c:a") + 1], "copy");
});

test("builds a browser playlist from H.264 and E-AC-3", { timeout: 60_000 }, async () => {
  if (!commandWorks("ffmpeg")) return;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kinora-"));
  const source = path.join(directory, "sample.mkv");
  const audioCodec = encoderExists("eac3") ? "eac3" : encoderExists("ac3") ? "ac3" : null;
  if (!audioCodec) return;
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
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "24",
      "-c:a",
      audioCodec,
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
    fileId: "file_transcode_test",
    sourcePath: source,
    size: stat.size,
    mtime: Math.round(stat.mtimeMs),
    duration: 2,
    copyAudio: false,
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
});

function encoderExists(name: string) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8", windowsHide: true });
  return new RegExp(`\\b${name}\\b`).test(result.stdout);
}
