import type { PlaybackPlan } from "@kinora/shared";

export interface PlanInput {
  missing?: boolean;
  container: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  kind: "video" | "audio";
  ffmpeg?: boolean;
}

const AUDIO_DIRECT = new Set(["mp3", "flac", "aac", "m4a", "mp4", "ogg", "opus", "wav", "oga", "aiff"]);

function isH264(codec: string) {
  return codec === "h264" || codec === "avc" || codec === "avc1";
}

function aacFamily(codec: string) {
  return !codec || codec === "aac" || codec === "mp3" || codec === "mp4a" || codec.includes("aac");
}

export function playbackPlan(input: PlanInput): PlaybackPlan {
  const container = (input.container ?? "").toLowerCase();
  const video = (input.videoCodec ?? "").toLowerCase();
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

  const directContainer = container === "mp4" || container === "m4v" || container === "mov" || container === "webm";
  const webAudio = !audio || audio === "opus" || audio === "vorbis" || audio === "aac";
  const direct =
    directContainer &&
    ((isH264(video) && (container === "webm" ? webAudio : aacFamily(audio))) ||
      (video === "vp9" && container === "webm" && webAudio));
  if (direct) return { mode: "direct", available: true, reasonCode: "ok", ...base };

  if (isH264(video)) {
    if (aacFamily(audio)) return { mode: "remux", available: ffmpeg, reasonCode: "remux_required", ...base };
    return { mode: "transcode", available: ffmpeg, reasonCode: "transcode_required", ...base };
  }

  const remux = video === "vp9" && (!audio || audio === "opus" || audio === "vorbis");
  if (remux) return { mode: "remux", available: false, reasonCode: "remux_required", ...base };
  return { mode: "transcode", available: false, reasonCode: "transcode_required", ...base };
}

export function contentTypeFor(container: string | null, kind: "audio" | "video") {
  const value = (container ?? "").toLowerCase();
  const table: Record<string, string> = {
    mp4: kind === "audio" ? "audio/mp4" : "video/mp4",
    m4v: "video/mp4",
    mov: "video/quicktime",
    webm: kind === "audio" ? "audio/webm" : "video/webm",
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
