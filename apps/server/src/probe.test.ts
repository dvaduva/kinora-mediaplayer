import assert from "node:assert/strict";
import test from "node:test";
import { bitDepthOf, hdrOf, videoInfoOf } from "./probe.js";

test("reads the bit depth from the pixel format", () => {
  assert.equal(bitDepthOf({ pix_fmt: "yuv420p" }), 8);
  assert.equal(bitDepthOf({ pix_fmt: "yuv420p10le" }), 10);
  assert.equal(bitDepthOf({ pix_fmt: "yuv444p12be" }), 12);
  assert.equal(bitDepthOf({ pix_fmt: "nv12", bits_per_raw_sample: "10" }), 10);
  assert.equal(bitDepthOf({}), null);
});

test("tells HDR10, HLG and Dolby Vision apart", () => {
  assert.deepEqual(hdrOf({ color_transfer: "bt709" }), []);
  assert.deepEqual(hdrOf({ color_transfer: "smpte2084" }), ["hdr10"]);
  assert.deepEqual(hdrOf({ color_transfer: "arib-std-b67" }), ["hlg"]);
  assert.deepEqual(hdrOf({ color_transfer: "smpte2084", side_data_list: [{ side_data_type: "DOVI configuration record" }] }), ["dolby_vision", "hdr10"]);
});

test("collects what a profile checks from ffprobe's streams", () => {
  const info = videoInfoOf({ profile: "Main 10", level: 153, pix_fmt: "yuv420p10le", color_transfer: "smpte2084" }, "42000000");
  assert.deepEqual(info, { profile: "Main 10", level: 153, bitDepth: 10, hdr: ["hdr10"], bitrate: 42_000_000 });
  assert.deepEqual(videoInfoOf(undefined, "N/A"), { profile: null, level: null, bitDepth: null, hdr: [], bitrate: null });
});
