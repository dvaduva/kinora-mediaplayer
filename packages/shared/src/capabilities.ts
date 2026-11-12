/**
 * Capability profiles: what a client can decode, so the server can choose direct play, a remux or a
 * transcode per device. Codec names follow ffprobe's, normalized into families (`videoFamily`, `audioFamily`).
 */

export type HdrFormat = "hdr10" | "hlg" | "dolby_vision";

export const HDR_FORMATS: readonly HdrFormat[] = ["hdr10", "hlg", "dolby_vision"];

export interface VideoCodecSupport {
  /** Codec family: h264, hevc, vp9, av1, mpeg2, mpeg4, vc1. */
  codec: string;
  /** Highest bit depth decoded; absent means not checked. */
  maxBitDepth?: number;
  /** ffprobe profile names accepted ("High", "Main 10"); absent means any. */
  profiles?: string[];
  /** Highest ffprobe level (H.264: 41 is 4.1; HEVC: 153 is 5.1); absent means any. */
  maxLevel?: number;
}

export interface AudioCodecSupport {
  /** Codec family: aac, mp3, ac3, eac3, dts, truehd, flac, opus, vorbis, pcm. */
  codec: string;
  /** Most channels decoded; absent means not checked. */
  maxChannels?: number;
}

export interface ContainerSupport {
  /** File extensions of the container, as the scanner stores them (mp4, m4v, mov, mkv, webm, ts…). */
  names: string[];
  /** Video families allowed in this container; absent means every decoded one. */
  video?: string[];
  /** Audio families allowed in this container; absent means every decoded one. */
  audio?: string[];
}

export interface CapabilityProfile {
  version: 1;
  /** Containers the player opens as a plain file. */
  containers: ContainerSupport[];
  video: VideoCodecSupport[];
  audio: AudioCodecSupport[];
  /** HDR formats shown correctly; null means not checked (the browser profile). */
  hdr: HdrFormat[] | null;
  maxWidth: number | null;
  maxHeight: number | null;
  /** Bits per second; null means no limit. */
  maxBitrate: number | null;
  /** Streams that may be copied into the HLS segments of a remux or transcode (MPEG-TS, played by hls.js). */
  hls: { video: string[]; audio: string[] };
  /** Text subtitles are drawn by Kinora over the video on every platform. */
  subtitles: "overlay";
  /** The pipeline that reported this profile; absent for the HTML5 <video> (and older apps). */
  player?: ProfilePlayer;
}

export type ProfilePlayer = "html5" | "avplay" | "webos" | "exoplayer";
const PROFILE_PLAYERS: readonly ProfilePlayer[] = ["html5", "avplay", "webos", "exoplayer"];

/** Switches a user sets per device in Settings → Devices. */
export interface DeviceOverrides {
  forceTranscode: boolean;
  /** Highest picture height played (2160, 1080, 720, 480); null means the device's own limit. */
  maxHeight: number | null;
  /** Bits per second; null means the device's own limit. */
  maxBitrate: number | null;
}

export const DEFAULT_DEVICE_OVERRIDES: DeviceOverrides = { forceTranscode: false, maxHeight: null, maxBitrate: null };
export const RESOLUTION_CAPS = [2160, 1080, 720, 480] as const;
export const BITRATE_CAPS = [80_000_000, 40_000_000, 20_000_000, 10_000_000, 4_000_000] as const;

/** A profile with the device's overrides applied, as the playback plan uses it. */
export type EffectiveProfile = CapabilityProfile & { forceTranscode: boolean };

/**
 * The desktop web UI: exactly the rules Kinora used before profiles existed. H.264 in MP4/MOV with AAC or
 * MP3; H.264 or VP9 in WebM with AAC, Opus or Vorbis. HLS carries H.264 with AAC or MP3; no other limits.
 */
export const BROWSER_PROFILE: CapabilityProfile = {
  version: 1,
  containers: [
    { names: ["mp4", "m4v", "mov"], video: ["h264"], audio: ["aac", "mp3"] },
    { names: ["webm"], video: ["h264", "vp9"], audio: ["aac", "opus", "vorbis"] },
  ],
  video: [{ codec: "h264" }, { codec: "vp9" }],
  audio: [{ codec: "aac" }, { codec: "mp3" }, { codec: "opus" }, { codec: "vorbis" }],
  hdr: null,
  maxWidth: null,
  maxHeight: null,
  maxBitrate: null,
  hls: { video: ["h264"], audio: ["aac", "mp3"] },
  subtitles: "overlay",
};

export function videoFamily(codec: string | null | undefined) {
  const value = (codec ?? "").toLowerCase().trim();
  if (value === "h264" || value === "avc" || value === "avc1") return "h264";
  if (value === "hevc" || value === "h265" || value === "hvc1" || value === "hev1") return "hevc";
  if (value === "mpeg2video" || value === "mpeg2") return "mpeg2";
  if (value === "mpeg4" || value === "msmpeg4v3" || value === "xvid" || value === "divx") return "mpeg4";
  if (value === "vc1" || value === "wmv3") return "vc1";
  return value;
}

export function audioFamily(codec: string | null | undefined) {
  const value = (codec ?? "").toLowerCase().trim();
  if (value === "mp4a" || value.includes("aac")) return "aac";
  if (value === "mp3" || value === "mp3float") return "mp3";
  if (value === "ac-3" || value === "ac3") return "ac3";
  if (value === "ec-3" || value === "eac3") return "eac3";
  if (value === "dca" || value === "dts") return "dts";
  if (value.startsWith("pcm_")) return "pcm";
  return value;
}

const MAX_LIST = 32;

function stringList(value: unknown, map: (item: string) => string) {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value.slice(0, MAX_LIST)) if (typeof item === "string" && item.length <= 40) out.push(map(item));
  return out;
}

function positive(value: unknown, max: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max ? Math.round(value) : null;
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const lower = (item: string) => item.toLowerCase().trim();

/** A profile sent by a client, checked field by field; null when it is not a profile at all. */
export function sanitizeCapabilities(value: unknown): CapabilityProfile | null {
  const input = record(value);
  if (!input || input.version !== 1) return null;
  const containers: ContainerSupport[] = [];
  for (const entry of Array.isArray(input.containers) ? input.containers.slice(0, MAX_LIST) : []) {
    const item = record(entry);
    const names = item ? stringList(item.names, lower) : null;
    if (!item || !names || names.length === 0) continue;
    const video = stringList(item.video, videoFamily);
    const audio = stringList(item.audio, audioFamily);
    containers.push({ names, ...(video ? { video } : {}), ...(audio ? { audio } : {}) });
  }
  const video: VideoCodecSupport[] = [];
  for (const entry of Array.isArray(input.video) ? input.video.slice(0, MAX_LIST) : []) {
    const item = record(entry);
    if (!item || typeof item.codec !== "string") continue;
    const support: VideoCodecSupport = { codec: videoFamily(item.codec) };
    const depth = positive(item.maxBitDepth, 16);
    if (depth) support.maxBitDepth = depth;
    const level = positive(item.maxLevel, 1000);
    if (level) support.maxLevel = level;
    const profiles = stringList(item.profiles, (name) => name);
    if (profiles) support.profiles = profiles;
    video.push(support);
  }
  const audio: AudioCodecSupport[] = [];
  for (const entry of Array.isArray(input.audio) ? input.audio.slice(0, MAX_LIST) : []) {
    const item = record(entry);
    if (!item || typeof item.codec !== "string") continue;
    const channels = positive(item.maxChannels, 32);
    audio.push(channels ? { codec: audioFamily(item.codec), maxChannels: channels } : { codec: audioFamily(item.codec) });
  }
  const hdr = Array.isArray(input.hdr) ? HDR_FORMATS.filter((format) => (input.hdr as unknown[]).includes(format)) : null;
  const hls = record(input.hls);
  const player = PROFILE_PLAYERS.find((name) => name === input.player);
  return {
    version: 1,
    containers,
    video,
    audio,
    hdr,
    maxWidth: positive(input.maxWidth, 16384),
    maxHeight: positive(input.maxHeight, 16384),
    maxBitrate: positive(input.maxBitrate, 1_000_000_000),
    hls: {
      video: (hls && stringList(hls.video, videoFamily)) ?? ["h264"],
      audio: (hls && stringList(hls.audio, audioFamily)) ?? ["aac", "mp3"],
    },
    subtitles: "overlay",
    ...(player ? { player } : {}),
  };
}

/** Known gaps between what a TV reports and what it really does; applied by the server, so a server update fixes them. */
export function applyPlatformQuirks(platform: string, profile: CapabilityProfile): CapabilityProfile {
  if (platform !== "tizen" && platform !== "webos" && platform !== "android") return profile;
  // TVs answer "probably" for DTS and TrueHD and then play silence (Samsung dropped DTS in 2018, LG in 2020).
  const silent = platform === "android" ? ["truehd"] : ["dts", "truehd"];
  const audio = profile.audio.filter((entry) => !silent.includes(entry.codec));
  const containers = profile.containers.map((entry) =>
    entry.audio ? { ...entry, audio: entry.audio.filter((codec) => !silent.includes(codec)) } : entry,
  );
  // webOS plays Matroska in its <video> pipeline but leaves canPlayType("video/x-matroska") empty.
  if (platform === "webos" && !containers.some((entry) => entry.names.includes("mkv"))) containers.push({ names: ["mkv"] });
  let video = profile.video;
  let hdr = profile.hdr;
  if (platform === "tizen" || platform === "webos") {
    // TV hardware decodes H.264 up to 8-bit only (Samsung and LG alike); MSE may answer yes for High 10 and then show a black picture.
    video = video.map((entry) => (entry.codec === "h264" && (entry.maxBitDepth ?? 8) > 8 ? { ...entry, maxBitDepth: 8 } : entry));
  }
  if (platform === "tizen") {
    // Samsung TVs have no Dolby Vision; a DV-only file (profile 5) has no HDR10 base layer to fall back on.
    if (hdr) hdr = hdr.filter((format) => format !== "dolby_vision");
  }
  return { ...profile, video, audio, hdr, containers };
}

export function applyDeviceOverrides(profile: CapabilityProfile, overrides: DeviceOverrides): EffectiveProfile {
  const capHeight = overrides.maxHeight;
  const maxHeight = capHeight == null ? profile.maxHeight : Math.min(profile.maxHeight ?? capHeight, capHeight);
  const maxWidth =
    capHeight == null ? profile.maxWidth : Math.min(profile.maxWidth ?? Math.round((capHeight * 16) / 9), Math.round((capHeight * 16) / 9));
  const capRate = overrides.maxBitrate;
  const maxBitrate = capRate == null ? profile.maxBitrate : Math.min(profile.maxBitrate ?? capRate, capRate);
  return { ...profile, maxWidth, maxHeight, maxBitrate, forceTranscode: overrides.forceTranscode };
}

export function sanitizeOverrides(value: unknown): DeviceOverrides {
  const input = record(value) ?? {};
  const maxHeight = (RESOLUTION_CAPS as readonly number[]).includes(input.maxHeight as number) ? (input.maxHeight as number) : null;
  const maxBitrate = (BITRATE_CAPS as readonly number[]).includes(input.maxBitrate as number) ? (input.maxBitrate as number) : null;
  return { forceTranscode: input.forceTranscode === true, maxHeight, maxBitrate };
}
