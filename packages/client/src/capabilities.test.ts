import assert from "node:assert/strict";
import test from "node:test";
import { applyPlatformQuirks, sanitizeCapabilities } from "@kinora/shared";
import { detectWebosCapabilities } from "./capabilities";

const none = () => false;

test("webOS profile: the LG media spec, MKV and HEVC in HLS, without a desktop browser's probes", () => {
  const profile = detectWebosCapabilities({ modelName: "OLED55C1", sdkVersion: "6.3.0", uhd: true }, none);
  assert.equal(profile.player, "webos");
  assert.ok(profile.containers.some((entry) => entry.names.includes("mkv")));
  assert.ok(!profile.containers.some((entry) => entry.names.includes("webm")), "WebM only with a VP9 or AV1 decoder");
  assert.deepEqual(profile.video.map((entry) => entry.codec), ["h264", "hevc", "mpeg2", "mpeg4"]);
  assert.deepEqual(profile.hls, { video: ["h264", "hevc"], audio: ["aac", "mp3", "ac3", "eac3"] });
  assert.equal(profile.maxHeight, 2160);
  assert.deepEqual(profile.hdr, ["hdr10", "hlg"]);
  assert.deepEqual(sanitizeCapabilities(profile), profile, "the server keeps every field");
});

test("webOS profile: a 1080p panel gets no HDR, decoders add VP9, AV1 and Dolby Vision", () => {
  assert.equal(detectWebosCapabilities({ modelName: null, sdkVersion: null, uhd: false }, none).maxHeight, 1080);
  assert.deepEqual(detectWebosCapabilities({ modelName: null, sdkVersion: null, uhd: false }, none).hdr, []);
  const all = detectWebosCapabilities({ modelName: null, sdkVersion: null, uhd: true }, (type) => !type.includes("99999"));
  assert.ok(all.video.some((entry) => entry.codec === "vp9" && entry.maxBitDepth === 10));
  assert.ok(all.video.some((entry) => entry.codec === "av1"));
  assert.deepEqual(all.containers.find((entry) => entry.names.includes("webm"))?.video, ["vp9", "av1"]);
  assert.ok(all.audio.some((entry) => entry.codec === "opus"));
});

test("webOS profile: unknown panel size falls back to asking the decoder", () => {
  const uhd = detectWebosCapabilities({ modelName: null, sdkVersion: null, uhd: null }, (type) => type.includes("width=3840"));
  assert.equal(uhd.maxHeight, 2160);
});

test("webOS quirks: H.264 capped at 8-bit, DTS dropped, Dolby Vision kept", () => {
  const profile = detectWebosCapabilities({ modelName: null, sdkVersion: null, uhd: true }, (type) => type.includes("dvh1"));
  const fixed = applyPlatformQuirks("webos", {
    ...profile,
    video: [{ codec: "h264", maxBitDepth: 10 }, ...profile.video.slice(1)],
    audio: [...profile.audio, { codec: "dts", maxChannels: 6 }],
  });
  assert.equal(fixed.video[0]?.maxBitDepth, 8);
  assert.ok(!fixed.audio.some((entry) => entry.codec === "dts"));
  assert.ok(fixed.hdr?.includes("dolby_vision"));
});
