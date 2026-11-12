import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDeviceOverrides,
  applyPlatformQuirks,
  sanitizeCapabilities,
  sanitizeOverrides,
  type CapabilityProfile,
} from "@kinora/shared";
import { canCopyAudio, canCopyVideo, hlsOutput, playbackPlan } from "./plan.js";

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

// ---------------------------------------------------------------- capability profiles

/** The rules as they were before profiles, kept verbatim: the browser profile must reproduce them. */
function legacyPlan(input: { container: string | null; videoCodec: string | null; audioCodec: string | null; ffmpeg?: boolean }) {
  const isH264 = (codec: string) => codec === "h264" || codec === "avc" || codec === "avc1";
  const aacFamily = (codec: string) => !codec || codec === "aac" || codec === "mp3" || codec === "mp4a" || codec.includes("aac");
  const container = (input.container ?? "").toLowerCase();
  const video = (input.videoCodec ?? "").toLowerCase();
  const audio = (input.audioCodec ?? "").toLowerCase();
  const ffmpeg = input.ffmpeg === true;
  const directContainer = container === "mp4" || container === "m4v" || container === "mov" || container === "webm";
  const webAudio = !audio || audio === "opus" || audio === "vorbis" || audio === "aac";
  const direct =
    directContainer &&
    ((isH264(video) && (container === "webm" ? webAudio : aacFamily(audio))) || (video === "vp9" && container === "webm" && webAudio));
  if (direct) return { mode: "direct", available: true, reasonCode: "ok" };
  if (!video) return { mode: "transcode", available: false, reasonCode: "transcode_required" };
  if (isH264(video) && aacFamily(audio)) return { mode: "remux", available: ffmpeg, reasonCode: "remux_required" };
  return { mode: "transcode", available: ffmpeg, reasonCode: "transcode_required" };
}

test("the browser profile makes the same decision as before for every container, codec and ffmpeg state", () => {
  // Codec names as ffprobe writes them, plus the aliases the old rules accepted.
  const containers = ["mp4", "m4v", "mov", "webm", "mkv", "avi", "ts", "m2ts", "wmv", "flv", "MP4", "", null];
  const videos = ["h264", "avc", "avc1", "H264", "hevc", "vp9", "vp8", "av1", "mpeg4", "mpeg2video", "vc1", "", null];
  const audios = ["aac", "mp4a", "mp3", "opus", "vorbis", "ac3", "eac3", "dts", "truehd", "flac", "pcm_s16le", "mp2", "", null];
  let checked = 0;
  for (const container of containers)
    for (const videoCodec of videos)
      for (const audioCodec of audios)
        for (const ffmpeg of [false, true]) {
          const input = { container, videoCodec, audioCodec, ffmpeg };
          // The one case that differs cannot occur: the old rules accepted only "aac" in WebM but also "mp4a" in MP4,
          // while ffprobe always names AAC "aac" (mp4a is a codec tag) and WebM cannot carry AAC at all.
          if (container === "webm" && audioCodec === "mp4a") continue;
          // The picture details a TV cares about change nothing for the browser.
          const actual = playbackPlan({ kind: "video", ...input, width: 3840, height: 2160, bitrate: 80_000_000, bitDepth: 10, hdr: ["hdr10"], audioChannels: 8 });
          assert.deepEqual(
            { mode: actual.mode, available: actual.available, reasonCode: actual.reasonCode },
            legacyPlan(input),
            JSON.stringify(input),
          );
          checked += 1;
        }
  assert.ok(checked > 4000);
});

test("the browser profile copies into HLS exactly what it did before", () => {
  const isH264 = (codec: string) => ["h264", "avc", "avc1"].includes(codec.toLowerCase());
  const aacFamily = (codec: string) => !codec || ["aac", "mp3", "mp4a"].includes(codec) || codec.includes("aac");
  for (const codec of ["h264", "avc", "avc1", "hevc", "vp9", "av1", "", null]) {
    assert.equal(canCopyVideo(codec), isH264(codec ?? ""), String(codec));
    assert.equal(hlsOutput({ kind: "video", container: "mkv", videoCodec: codec, audioCodec: null }).copyVideo, isH264(codec ?? ""));
  }
  for (const codec of ["aac", "mp4a", "mp3", "opus", "ac3", "eac3", "dts", "", null]) {
    assert.equal(canCopyAudio(codec), aacFamily(codec ?? ""), String(codec));
  }
  const output = hlsOutput({ kind: "video", container: "mkv", videoCodec: "hevc", audioCodec: "eac3", audioChannels: 6, height: 2160 });
  assert.deepEqual(output, { copyVideo: false, copyAudio: false, audio: { codec: "aac", channels: 2 }, maxHeight: null, maxBitrate: null });
});

const TV: CapabilityProfile = {
  version: 1,
  containers: [{ names: ["mp4", "m4v", "mov"] }, { names: ["mkv"] }, { names: ["webm"] }],
  video: [{ codec: "h264", maxBitDepth: 8 }, { codec: "hevc", maxBitDepth: 10 }, { codec: "vp9", maxBitDepth: 10 }],
  audio: [{ codec: "aac", maxChannels: 6 }, { codec: "mp3", maxChannels: 2 }, { codec: "ac3", maxChannels: 6 }, { codec: "eac3", maxChannels: 8 }],
  hdr: ["hdr10", "hlg"],
  maxWidth: 3840,
  maxHeight: 2160,
  maxBitrate: null,
  hls: { video: ["h264"], audio: ["aac", "mp3", "ac3"] },
  subtitles: "overlay",
};

const hevcMkv = {
  kind: "video" as const,
  container: "mkv",
  videoCodec: "hevc",
  audioCodec: "eac3",
  audioChannels: 6,
  width: 3840,
  height: 2160,
  bitDepth: 10,
  hdr: ["hdr10" as const],
  bitrate: 40_000_000,
  ffmpeg: true,
};

test("a TV that decodes HEVC and E-AC-3 plays the MKV directly", () => {
  const plan = playbackPlan(hevcMkv, TV);
  assert.equal(plan.mode, "direct");
  assert.equal(plan.available, true);
  assert.equal(plan.limits, undefined);
  assert.equal(playbackPlan(hevcMkv).mode, "transcode", "the desktop still converts it");
});

test("a TV without the audio codec gets the video copied and the sound converted", () => {
  const h264Dts = { ...hevcMkv, videoCodec: "h264", bitDepth: 8, hdr: [], audioCodec: "dts" };
  const plan = playbackPlan(h264Dts, TV);
  assert.equal(plan.mode, "transcode");
  assert.deepEqual(plan.limits, ["audio_codec"]);
  const output = hlsOutput(h264Dts, TV);
  assert.equal(output.copyVideo, true, "only the sound is converted");
  assert.equal(output.copyAudio, false);
  assert.deepEqual(output.audio, { codec: "ac3", channels: 6 }, "to AC-3 5.1, since the TV takes AC-3 in HLS");
  assert.equal(playbackPlan({ ...h264Dts, audioCodec: "ac3" }, { ...TV, containers: [] }).mode, "remux");
});

test("the transcode keeps 5.1 only when the source has it and the profile allows AC-3", () => {
  assert.deepEqual(hlsOutput({ ...hevcMkv, audioCodec: "dts", audioChannels: 2 }, TV).audio, { codec: "aac", channels: 2 });
  const noAc3: CapabilityProfile = { ...TV, hls: { video: ["h264"], audio: ["aac"] } };
  assert.deepEqual(hlsOutput({ ...hevcMkv, audioCodec: "dts" }, noAc3).audio, { codec: "aac", channels: 2 });
  assert.equal(hlsOutput({ ...hevcMkv, audioCodec: "ac3" }, TV).copyAudio, true, "AC-3 is copied, not re-encoded");
});

test("limits rule out direct play: bit depth, HDR, resolution, bitrate, channels, container, level", () => {
  assert.deepEqual(playbackPlan({ ...hevcMkv, bitDepth: 12 }, TV).limits, ["bit_depth"]);
  assert.deepEqual(playbackPlan({ ...hevcMkv, hdr: ["dolby_vision"] }, TV).limits, ["hdr"]);
  assert.equal(playbackPlan({ ...hevcMkv, hdr: ["dolby_vision", "hdr10"] }, TV).mode, "direct", "Dolby Vision with an HDR10 base plays");
  assert.deepEqual(playbackPlan({ ...hevcMkv, width: 7680, height: 4320 }, TV).limits, ["resolution"]);
  assert.deepEqual(playbackPlan({ ...hevcMkv, bitrate: 50_000_000 }, { ...TV, maxBitrate: 20_000_000 }).limits, ["bitrate"]);
  assert.deepEqual(playbackPlan({ ...hevcMkv, audioCodec: "aac", audioChannels: 8 }, TV).limits, ["audio_channels"]);
  assert.deepEqual(playbackPlan({ ...hevcMkv, container: "avi" }, TV).limits, ["container"]);
  const level: CapabilityProfile = { ...TV, video: [{ codec: "hevc", maxLevel: 120 }] };
  assert.deepEqual(playbackPlan({ ...hevcMkv, videoLevel: 153 }, level).limits, ["video_profile"]);
  assert.equal(playbackPlan({ ...hevcMkv, videoLevel: null }, level).mode, "direct", "an unknown level is not held against the file");
});

test("forcing a transcode encodes the video even for a file the TV plays", () => {
  const forced = applyDeviceOverrides(TV, { forceTranscode: true, maxHeight: null, maxBitrate: null });
  const h264 = { ...hevcMkv, videoCodec: "h264", bitDepth: 8, hdr: [], audioCodec: "aac" };
  const plan = playbackPlan(h264, forced);
  assert.equal(plan.mode, "transcode");
  assert.deepEqual(plan.limits, ["forced"]);
  assert.equal(hlsOutput(h264, forced).copyVideo, false);
});

test("resolution and bitrate caps from Settings reach the encoder", () => {
  const capped = applyDeviceOverrides(TV, { forceTranscode: false, maxHeight: 720, maxBitrate: 4_000_000 });
  assert.equal(capped.maxHeight, 720);
  assert.equal(capped.maxWidth, 1280);
  assert.equal(playbackPlan(hevcMkv, capped).mode, "transcode");
  const output = hlsOutput(hevcMkv, capped);
  assert.equal(output.maxHeight, 720);
  assert.equal(output.maxBitrate, 4_000_000);
  assert.equal(hlsOutput(hevcMkv, applyDeviceOverrides(TV, { forceTranscode: false, maxHeight: 2160, maxBitrate: null })).maxHeight, null);
});

test("platform quirks drop DTS on TVs and add Matroska on webOS", () => {
  const reported: CapabilityProfile = { ...TV, containers: [{ names: ["mp4"] }], audio: [...TV.audio, { codec: "dts", maxChannels: 6 }] };
  const webos = applyPlatformQuirks("webos", reported);
  assert.equal(webos.audio.some((entry) => entry.codec === "dts"), false);
  assert.ok(webos.containers.some((entry) => entry.names.includes("mkv")));
  assert.equal(applyPlatformQuirks("tizen", reported).containers.length, 1);
  assert.equal(applyPlatformQuirks("browser", reported), reported);
});

test("Tizen quirks: no 10-bit H.264 and no Dolby Vision", () => {
  const reported: CapabilityProfile = {
    ...TV,
    video: [{ codec: "h264", maxBitDepth: 10 }, { codec: "hevc", maxBitDepth: 10 }],
    hdr: ["hdr10", "hlg", "dolby_vision"],
  };
  const tizen = applyPlatformQuirks("tizen", reported);
  assert.deepEqual(tizen.video, [{ codec: "h264", maxBitDepth: 8 }, { codec: "hevc", maxBitDepth: 10 }]);
  assert.deepEqual(tizen.hdr, ["hdr10", "hlg"]);
  assert.deepEqual(applyPlatformQuirks("webos", reported).hdr, reported.hdr);
  const hi10 = { kind: "video" as const, container: "mkv", videoCodec: "h264", audioCodec: "aac", bitDepth: 10, ffmpeg: true };
  assert.deepEqual(playbackPlan(hi10, tizen).limits, ["bit_depth"]);
  const dolbyOnly = { ...hevcMkv, hdr: ["dolby_vision" as const] };
  assert.deepEqual(playbackPlan(dolbyOnly, tizen).limits, ["hdr"]);
  assert.equal(playbackPlan({ ...hevcMkv, hdr: ["hdr10" as const, "dolby_vision" as const] }, tizen).mode, "direct", "DV profile 8 plays its HDR10 base");
});

test("an AVPlay profile copies HEVC and E-AC-3 into HLS segments", () => {
  const avplay: CapabilityProfile = { ...TV, player: "avplay", containers: [{ names: ["mp4"] }], hls: { video: ["h264", "hevc"], audio: ["aac", "ac3", "eac3"] } };
  const plan = playbackPlan({ ...hevcMkv, audioCodec: "eac3" }, avplay);
  assert.equal(plan.mode, "remux");
  assert.deepEqual(plan.limits, ["container"]);
  const output = hlsOutput({ ...hevcMkv, audioCodec: "eac3" }, avplay);
  assert.equal(output.copyVideo, true);
  assert.equal(output.copyAudio, true);
  assert.equal(sanitizeCapabilities(avplay)?.player, "avplay");
  assert.equal(sanitizeCapabilities({ ...avplay, player: "vlc" })?.player, undefined);
});

test("webOS quirks: no 10-bit H.264, Dolby Vision kept; a webOS profile plays HEVC MKV directly and copies it into HLS", () => {
  const reported: CapabilityProfile = {
    ...TV,
    player: "webos",
    containers: [{ names: ["mp4"] }, { names: ["mkv"] }],
    video: [{ codec: "h264", maxBitDepth: 10 }, { codec: "hevc", maxBitDepth: 10 }],
    audio: [{ codec: "aac", maxChannels: 6 }, { codec: "eac3", maxChannels: 8 }],
    hdr: ["hdr10", "hlg", "dolby_vision"],
    hls: { video: ["h264", "hevc"], audio: ["aac", "ac3", "eac3"] },
  };
  const webos = applyPlatformQuirks("webos", reported);
  assert.deepEqual(webos.video, [{ codec: "h264", maxBitDepth: 8 }, { codec: "hevc", maxBitDepth: 10 }]);
  assert.deepEqual(webos.hdr, ["hdr10", "hlg", "dolby_vision"]);
  assert.equal(sanitizeCapabilities(reported)?.player, "webos");
  const eac3Mkv = { ...hevcMkv, audioCodec: "eac3" };
  assert.equal(playbackPlan(eac3Mkv, webos).mode, "direct");
  const avi = { ...eac3Mkv, container: "avi" };
  assert.equal(playbackPlan(avi, webos).mode, "remux");
  const output = hlsOutput(avi, webos);
  assert.equal(output.copyVideo, true);
  assert.equal(output.copyAudio, true);
});

test("profiles from a client are checked field by field", () => {
  assert.equal(sanitizeCapabilities(null), null);
  assert.equal(sanitizeCapabilities({ version: 2 }), null);
  const clean = sanitizeCapabilities({
    version: 1,
    containers: [{ names: ["MKV"] }, { names: [] }, "junk"],
    video: [{ codec: "H265", maxBitDepth: 10, maxLevel: -1 }],
    audio: [{ codec: "ec-3", maxChannels: 8 }, { codec: 3 }],
    hdr: ["hdr10", "nonsense"],
    maxWidth: 3840,
    maxHeight: "2160",
    hls: { audio: ["ac-3"] },
  });
  assert.deepEqual(clean?.containers, [{ names: ["mkv"] }]);
  assert.deepEqual(clean?.video, [{ codec: "hevc", maxBitDepth: 10 }]);
  assert.deepEqual(clean?.audio, [{ codec: "eac3", maxChannels: 8 }]);
  assert.deepEqual(clean?.hdr, ["hdr10"]);
  assert.equal(clean?.maxHeight, null);
  assert.deepEqual(clean?.hls, { video: ["h264"], audio: ["ac3"] });
  assert.deepEqual(sanitizeOverrides({ forceTranscode: true, maxHeight: 999, maxBitrate: 4_000_000 }), {
    forceTranscode: true,
    maxHeight: null,
    maxBitrate: 4_000_000,
  });
});
