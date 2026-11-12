import {
  audioFamily,
  BROWSER_PROFILE,
  videoFamily,
  type CapabilityProfile,
  type EffectiveProfile,
  type HdrFormat,
  type PlaybackLimit,
  type PlaybackPlan,
} from "@kinora/shared";

export interface PlanInput {
  missing?: boolean;
  container: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  kind: "video" | "audio";
  ffmpeg?: boolean;
  width?: number | null;
  height?: number | null;
  /** Bits per second of the whole file. */
  bitrate?: number | null;
  bitDepth?: number | null;
  hdr?: HdrFormat[];
  /** ffprobe's profile name and level of the video stream. */
  videoProfile?: string | null;
  videoLevel?: number | null;
  audioChannels?: number | null;
}

/** How the HLS stream of a remux or transcode is made for one profile. */
export interface HlsOutput {
  copyVideo: boolean;
  copyAudio: boolean;
  /** The encoded sound when it is not copied: stereo AAC, or AC-3 5.1 for a device that decodes it. */
  audio: { codec: "aac" | "ac3"; channels: 2 | 6 };
  /** Encoded picture height cap below the default 1080p; null for the default. */
  maxHeight: number | null;
  /** Bits per second for the whole stream; null for no cap. */
  maxBitrate: number | null;
}

const AUDIO_DIRECT = new Set(["mp3", "flac", "aac", "m4a", "mp4", "ogg", "opus", "wav", "oga", "aiff"]);

/** Video that the browser profile copies into HLS segments. Live TV relays use it too. */
export function canCopyVideo(codec: string | null) {
  return BROWSER_PROFILE.hls.video.includes(videoFamily(codec));
}

/** Audio that the browser profile copies into HLS segments (no audio counts as copyable). */
export function canCopyAudio(codec: string | null) {
  const family = audioFamily(codec);
  return !family || BROWSER_PROFILE.hls.audio.includes(family);
}

function isForced(profile: CapabilityProfile | EffectiveProfile) {
  return "forceTranscode" in profile && profile.forceTranscode === true;
}

/** The video stream itself (codec, profile, level, bit depth) is decoded by the device. */
function videoDecoded(input: PlanInput, profile: CapabilityProfile, limits: Set<PlaybackLimit>) {
  const family = videoFamily(input.videoCodec);
  const support = profile.video.find((entry) => entry.codec === family);
  if (!support) {
    limits.add("video_codec");
    return false;
  }
  let ok = true;
  if (support.maxBitDepth != null && (input.bitDepth ?? 8) > support.maxBitDepth) {
    limits.add("bit_depth");
    ok = false;
  }
  if (support.profiles && input.videoProfile && !support.profiles.includes(input.videoProfile)) {
    limits.add("video_profile");
    ok = false;
  }
  if (support.maxLevel != null && input.videoLevel != null && input.videoLevel > support.maxLevel) {
    limits.add("video_profile");
    ok = false;
  }
  return ok;
}

/** HDR, picture size and bitrate fit the device; a file that breaks one is encoded, not copied. */
function pictureFits(input: PlanInput, profile: CapabilityProfile, limits: Set<PlaybackLimit>) {
  let ok = true;
  const hdr = input.hdr ?? [];
  if (profile.hdr && hdr.length > 0 && !hdr.some((format) => profile.hdr!.includes(format))) {
    limits.add("hdr");
    ok = false;
  }
  if ((profile.maxWidth != null && (input.width ?? 0) > profile.maxWidth) || (profile.maxHeight != null && (input.height ?? 0) > profile.maxHeight)) {
    limits.add("resolution");
    ok = false;
  }
  if (profile.maxBitrate != null && (input.bitrate ?? 0) > profile.maxBitrate) {
    limits.add("bitrate");
    ok = false;
  }
  return ok;
}

function audioDecoded(input: PlanInput, profile: CapabilityProfile, allowed: string[] | undefined, limits: Set<PlaybackLimit>) {
  const family = audioFamily(input.audioCodec);
  if (!family) return true;
  const support = profile.audio.find((entry) => entry.codec === family);
  if (!support || (allowed && !allowed.includes(family))) {
    limits.add("audio_codec");
    return false;
  }
  if (support.maxChannels != null && (input.audioChannels ?? 2) > support.maxChannels) {
    limits.add("audio_channels");
    return false;
  }
  return true;
}

function channelsFor(profile: CapabilityProfile, codec: string) {
  const support = profile.audio.find((entry) => entry.codec === codec);
  return support ? (support.maxChannels ?? 2) : 0;
}

/** What goes into the HLS segments for this profile; also used for Live TV, which streams HLS even when direct play would work. */
export function hlsOutput(input: PlanInput, profile: CapabilityProfile | EffectiveProfile = BROWSER_PROFILE): HlsOutput {
  const ignored = new Set<PlaybackLimit>();
  const video = videoFamily(input.videoCodec);
  const copyVideo =
    !isForced(profile) &&
    profile.hls.video.includes(video) &&
    videoDecoded(input, profile, ignored) &&
    pictureFits(input, profile, ignored);
  const copyAudio = audioDecoded(input, profile, profile.hls.audio, ignored);
  const surround = (input.audioChannels ?? 2) > 2 && profile.hls.audio.includes("ac3") && channelsFor(profile, "ac3") >= 6;
  return {
    copyVideo,
    copyAudio,
    audio: surround ? { codec: "ac3", channels: 6 } : { codec: "aac", channels: 2 },
    maxHeight: profile.maxHeight != null && profile.maxHeight < 1080 ? profile.maxHeight : null,
    maxBitrate: profile.maxBitrate,
  };
}

export function playbackPlan(input: PlanInput, profile: CapabilityProfile | EffectiveProfile = BROWSER_PROFILE): PlaybackPlan {
  const container = (input.container ?? "").toLowerCase();
  const video = videoFamily(input.videoCodec);
  const audio = (input.audioCodec ?? "").toLowerCase();
  const base = { container: container || null, videoCodec: input.videoCodec, audioCodec: input.audioCodec };
  const ffmpeg = input.ffmpeg === true;
  if (input.missing) return { mode: "direct", available: false, reasonCode: "missing", ...base };
  if (input.kind === "audio") {
    const available = AUDIO_DIRECT.has(container);
    return {
      mode: "direct",
      available,
      reasonCode: available ? "ok" : "transcode_required",
      container: container || null,
      videoCodec: null,
      audioCodec: audio || container || null,
    };
  }

  const limits = new Set<PlaybackLimit>();
  const entry = profile.containers.find((item) => item.names.includes(container));
  if (!entry) limits.add("container");
  const decoded = video ? videoDecoded(input, profile, limits) : false;
  const fits = pictureFits(input, profile, limits);
  const sound = audioDecoded(input, profile, undefined, limits);
  const family = audioFamily(input.audioCodec);
  const inContainer =
    entry != null && (!entry.video || entry.video.includes(video)) && (!family || !entry.audio || entry.audio.includes(family));
  if (entry && !inContainer) limits.add("container");
  if (isForced(profile)) limits.add("forced");
  const direct = Boolean(video) && entry != null && inContainer && decoded && fits && sound && !isForced(profile);
  if (direct) return { mode: "direct", available: true, reasonCode: "ok", ...base };

  const why = [...limits];
  if (!video) return { mode: "transcode", available: false, reasonCode: "transcode_required", ...base, limits: why };
  const output = hlsOutput(input, profile);
  if (output.copyVideo && output.copyAudio) return { mode: "remux", available: ffmpeg, reasonCode: "remux_required", ...base, limits: why };
  return { mode: "transcode", available: ffmpeg, reasonCode: "transcode_required", ...base, limits: why };
}

export function contentTypeFor(container: string | null, kind: "audio" | "video") {
  const value = (container ?? "").toLowerCase();
  const table: Record<string, string> = {
    mp4: kind === "audio" ? "audio/mp4" : "video/mp4",
    m4v: "video/mp4",
    mov: "video/quicktime",
    webm: kind === "audio" ? "audio/webm" : "video/webm",
    mkv: "video/x-matroska",
    ts: "video/mp2t",
    m2ts: "video/mp2t",
    mp3: "audio/mpeg",
    flac: "audio/flac",
    m4a: "audio/mp4",
    ogg: "audio/ogg",
    opus: "audio/ogg",
    oga: "audio/ogg",
    wav: "audio/wav",
    aac: "audio/aac",
    aiff: "audio/aiff",
  };
  return table[value] ?? "application/octet-stream";
}
