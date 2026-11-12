import type { AudioCodecSupport, CapabilityProfile, ContainerSupport, HdrFormat, VideoCodecSupport } from "@kinora/shared";

/**
 * What this TV's HTML5 <video> decodes, asked through MediaSource.isTypeSupported and canPlayType.
 * Imported by the TV shell (a classic ES2015 script for Chromium 53) and by the TV UI, so only APIs
 * that old are used, and every probe is guarded: a throwing or missing API means "not supported".
 *
 * TVs answer the extended MSE form (`…; width=3840; height=2160`) truthfully, so it tells a 4K decoder
 * from a 1080p one; a desktop browser ignores the extra parameters. Known false answers (DTS that plays
 * silence, MKV that canPlayType denies) are corrected on the server by `applyPlatformQuirks`.
 */

type Probe = (type: string) => boolean;

function prober(): Probe {
  let video: HTMLVideoElement | null = null;
  try {
    video = document.createElement("video");
  } catch {
    video = null;
  }
  const source = typeof window !== "undefined" ? (window as unknown as { MediaSource?: { isTypeSupported?: (type: string) => boolean } }).MediaSource : undefined;
  return (type) => {
    try {
      if (source && source.isTypeSupported && source.isTypeSupported(type)) return true;
    } catch {
      // fall through to canPlayType
    }
    try {
      return Boolean(video && video.canPlayType(type) !== "");
    } catch {
      return false;
    }
  };
}

function matches(query: string) {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

type TizenWebApis = { productinfo?: { isUdPanelSupported?: () => boolean; is8KPanelSupported?: () => boolean }; avinfo?: { isHdrTvSupport?: () => boolean } };

function tizenApis(): TizenWebApis | null {
  const host = window as unknown as { webapis?: TizenWebApis };
  return host.webapis || null;
}

function detectHdr(probe: Probe): HdrFormat[] {
  let hdr = matches("(dynamic-range: high)") || matches("(video-dynamic-range: high)");
  try {
    const avinfo = tizenApis()?.avinfo;
    if (avinfo && avinfo.isHdrTvSupport) hdr = hdr || avinfo.isHdrTvSupport();
  } catch {
    // avinfo needs no privilege, but older firmware lacks it
  }
  if (!hdr) return [];
  const formats: HdrFormat[] = ["hdr10", "hlg"];
  if (probe('video/mp4; codecs="dvh1.05.06"') || probe('video/mp4; codecs="dvhe.05.06"')) formats.push("dolby_vision");
  return formats;
}

function detectSize(probe: Probe, hevc: boolean) {
  let uhd = false;
  try {
    const info = tizenApis()?.productinfo;
    if (info && info.isUdPanelSupported) uhd = info.isUdPanelSupported() || Boolean(info.is8KPanelSupported && info.is8KPanelSupported());
  } catch {
    // productinfo needs its privilege; fall back to asking the decoder
  }
  const codec = hevc ? 'video/mp4; codecs="hvc1.1.6.L153.90"' : 'video/mp4; codecs="avc1.640033"';
  if (!uhd) uhd = probe(`${codec}; width=3840; height=2160`) && !probe(`${codec}; width=99999; height=99999`);
  return uhd ? { maxWidth: 3840, maxHeight: 2160 } : { maxWidth: 1920, maxHeight: 1080 };
}

export function detectCapabilities(): CapabilityProfile {
  const probe = prober();
  const video: VideoCodecSupport[] = [];
  const h264High10 = probe('video/mp4; codecs="avc1.6e0033"');
  video.push({ codec: "h264", maxBitDepth: h264High10 ? 10 : 8 });
  const hevc = probe('video/mp4; codecs="hvc1.1.6.L120.90"') || probe('video/mp4; codecs="hev1.1.6.L120.90"');
  if (hevc) video.push({ codec: "hevc", maxBitDepth: probe('video/mp4; codecs="hvc1.2.4.L153.B0"') ? 10 : 8 });
  if (probe('video/webm; codecs="vp9"') || probe('video/webm; codecs="vp09.00.40.08"')) {
    video.push({ codec: "vp9", maxBitDepth: probe('video/webm; codecs="vp09.02.51.10"') ? 10 : 8 });
  }
  if (probe('video/mp4; codecs="av01.0.08M.08"')) video.push({ codec: "av1", maxBitDepth: probe('video/mp4; codecs="av01.0.12M.10"') ? 10 : 8 });
  if (probe('video/mp2t; codecs="mp2v"') || probe("video/mpeg")) video.push({ codec: "mpeg2" });

  const audio: AudioCodecSupport[] = [{ codec: "aac", maxChannels: 6 }, { codec: "mp3", maxChannels: 2 }];
  if (probe('audio/mp4; codecs="ac-3"')) audio.push({ codec: "ac3", maxChannels: 6 });
  if (probe('audio/mp4; codecs="ec-3"')) audio.push({ codec: "eac3", maxChannels: 8 });
  if (probe('audio/mp4; codecs="dtsc"') || probe('audio/mp4; codecs="dtse"')) audio.push({ codec: "dts", maxChannels: 6 });
  if (probe('audio/webm; codecs="opus"')) audio.push({ codec: "opus", maxChannels: 8 });
  if (probe('audio/webm; codecs="vorbis"')) audio.push({ codec: "vorbis", maxChannels: 6 });
  if (probe('audio/mp4; codecs="flac"') || probe("audio/flac")) audio.push({ codec: "flac", maxChannels: 8 });

  const containers: ContainerSupport[] = [{ names: ["mp4", "m4v", "mov"] }];
  if (probe("video/webm")) containers.push({ names: ["webm"] });
  if (probe("video/x-matroska") || probe("video/mkv")) containers.push({ names: ["mkv"] });
  if (probe("video/mp2t")) containers.push({ names: ["ts", "m2ts"] });

  // HLS segments are MPEG-TS played through hls.js: H.264 only, and AC-3 where MSE takes it (E-AC-3 is not demuxed from TS).
  const hlsAudio = ["aac", "mp3"];
  if (probe('audio/mp4; codecs="ac-3"')) hlsAudio.push("ac3");

  return {
    version: 1,
    containers,
    video,
    audio,
    hdr: detectHdr(probe),
    ...detectSize(probe, hevc),
    maxBitrate: null,
    hls: { video: ["h264"], audio: hlsAudio },
    subtitles: "overlay",
    player: "html5",
  };
}

type AvplayHost = { webapis?: { avplay?: unknown } };

/** AVPlay exists in this page (the Tizen shell, with webapis.js loaded). */
export function hasAvplay() {
  try {
    return Boolean((window as unknown as AvplayHost).webapis?.avplay);
  } catch {
    return false;
  }
}

/**
 * What Samsung's native player (AVPlay) decodes. AVPlay has no capability query, so this is the
 * published Samsung TV media spec for the 2019+ models Kinora targets, narrowed by what the TV itself
 * says: 4K and HDR from productinfo/avinfo, VP9 and AV1 from the decoder (only some years have them).
 * AVPlay opens Matroska, AVI and MPEG-TS as files and plays HLS with HEVC and Dolby audio in the
 * segments, which hls.js cannot. DTS and Dolby Vision are dropped on the server (`applyPlatformQuirks`).
 */
export function detectAvplayCapabilities(): CapabilityProfile {
  const probe = prober();
  const video: VideoCodecSupport[] = [{ codec: "h264", maxBitDepth: 8 }, { codec: "hevc", maxBitDepth: 10 }, { codec: "mpeg2" }, { codec: "mpeg4" }];
  if (probe('video/webm; codecs="vp9"') || probe('video/webm; codecs="vp09.00.40.08"')) video.push({ codec: "vp9", maxBitDepth: 10 });
  if (probe('video/mp4; codecs="av01.0.08M.08"')) video.push({ codec: "av1", maxBitDepth: 10 });
  const audio: AudioCodecSupport[] = [
    { codec: "aac", maxChannels: 6 },
    { codec: "mp3", maxChannels: 2 },
    { codec: "ac3", maxChannels: 6 },
    { codec: "eac3", maxChannels: 8 },
    { codec: "pcm", maxChannels: 8 },
    { codec: "opus", maxChannels: 8 },
    { codec: "vorbis", maxChannels: 6 },
  ];
  const containers: ContainerSupport[] = [
    { names: ["mp4", "m4v", "mov"] },
    { names: ["mkv"] },
    { names: ["webm"], video: ["vp9", "av1"], audio: ["opus", "vorbis"] },
    { names: ["ts", "m2ts"] },
    { names: ["avi"], video: ["h264", "mpeg4"], audio: ["mp3", "ac3", "aac", "pcm"] },
  ];
  // HDR without the Dolby Vision probe: Samsung has none (the server drops it too).
  const hdr = detectHdr(probe).filter((format) => format !== "dolby_vision");
  return {
    version: 1,
    containers,
    video,
    audio,
    hdr,
    ...detectSize(probe, true),
    maxBitrate: null,
    hls: { video: ["h264", "hevc"], audio: ["aac", "mp3", "ac3", "eac3"] },
    subtitles: "overlay",
    player: "avplay",
  };
}

/** What the webOS shell learns from Luna (`com.webos.service.tv.systemproperty`); each field may be unknown. */
export type WebosInfo = {
  modelName: string | null;
  /** webOS SDK version ("6.3.0"; webOS 22 reports 7.x, 23 reports 8.x…). */
  sdkVersion: string | null;
  /** A 4K panel. */
  uhd: boolean | null;
};

/**
 * What LG's media pipeline plays when a <video> gets a plain `src` (not MSE): the webOS media spec for
 * the 2020+ models Kinora targets, narrowed by the TV. canPlayType there under-reports (it says nothing
 * for Matroska, which plays), so most of this is the published spec, not a probe. 4K comes from Luna or
 * the decoder; VP9, AV1 and Dolby Vision from the decoder, since only some models and years have them.
 * The pipeline also plays HLS itself, so HEVC and Dolby audio may be copied into the segments (hls.js
 * is not used on webOS). DTS and TrueHD are dropped on the server (`applyPlatformQuirks`).
 */
export function detectWebosCapabilities(info: WebosInfo, probe: (type: string) => boolean = prober()): CapabilityProfile {
  const video: VideoCodecSupport[] = [{ codec: "h264", maxBitDepth: 8 }, { codec: "hevc", maxBitDepth: 10 }, { codec: "mpeg2" }, { codec: "mpeg4" }];
  const vp9 = probe('video/webm; codecs="vp9"') || probe('video/webm; codecs="vp09.00.40.08"');
  if (vp9) video.push({ codec: "vp9", maxBitDepth: probe('video/webm; codecs="vp09.02.51.10"') ? 10 : 8 });
  const av1 = probe('video/mp4; codecs="av01.0.08M.08"');
  if (av1) video.push({ codec: "av1", maxBitDepth: 10 });
  const audio: AudioCodecSupport[] = [
    { codec: "aac", maxChannels: 6 },
    { codec: "mp3", maxChannels: 2 },
    { codec: "ac3", maxChannels: 6 },
    { codec: "eac3", maxChannels: 8 },
    { codec: "pcm", maxChannels: 8 },
  ];
  if (probe('audio/webm; codecs="opus"')) audio.push({ codec: "opus", maxChannels: 8 });
  if (probe('audio/webm; codecs="vorbis"')) audio.push({ codec: "vorbis", maxChannels: 6 });
  const webm: string[] = [];
  if (vp9) webm.push("vp9");
  if (av1) webm.push("av1");
  const containers: ContainerSupport[] = [
    { names: ["mp4", "m4v", "mov"] },
    { names: ["mkv"] },
    { names: ["ts", "m2ts"] },
    { names: ["avi"], video: ["h264", "mpeg4"], audio: ["mp3", "ac3", "aac", "pcm"] },
  ];
  if (webm.length) containers.push({ names: ["webm"], video: webm, audio: ["opus", "vorbis"] });
  const size = info.uhd === true ? { maxWidth: 3840, maxHeight: 2160 } : info.uhd === false ? { maxWidth: 1920, maxHeight: 1080 } : detectSize(probe, true);
  // Every LG 4K model since 2017 takes HDR10 and HLG (tone-mapped on the cheaper panels); Dolby Vision only where the decoder has it.
  let hdr = detectHdr(probe);
  if (size.maxHeight >= 2160 && hdr.length === 0) {
    hdr = ["hdr10", "hlg"];
    if (probe('video/mp4; codecs="dvh1.05.06"') || probe('video/mp4; codecs="dvhe.05.06"')) hdr.push("dolby_vision");
  }
  return {
    version: 1,
    containers,
    video,
    audio,
    hdr,
    ...size,
    maxBitrate: null,
    hls: { video: ["h264", "hevc"], audio: ["aac", "mp3", "ac3", "eac3"] },
    subtitles: "overlay",
    player: "webos",
  };
}
