import type { AudioStream, HdrFormat } from "@kinora/shared";
import { languageCode } from "./parse/names.js";
import { bins, run, tools } from "./process.js";

export interface ProbeResult {
  duration: number | null;
  videoCodec: string | null;
  width: number | null;
  height: number | null;
  audio: AudioStream[];
  subtitles: EmbeddedSubtitle[];
  info: VideoInfo;
}

/** What a capability profile checks beyond the codec name; stored as media_files.video_info_json. */
export interface VideoInfo {
  profile: string | null;
  level: number | null;
  bitDepth: number | null;
  hdr: HdrFormat[];
  /** Bits per second of the whole file. */
  bitrate: number | null;
}

export interface EmbeddedSubtitle {
  streamIndex: number;
  codec: string;
  language: string | null;
  forced: boolean;
  hearingImpaired: boolean;
  isDefault: boolean;
  textBased: boolean;
}

const TEXT_CODECS = new Set(["subrip", "srt", "ass", "ssa", "mov_text", "webvtt", "text"]);

interface ProbeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  channels?: number;
  profile?: string;
  level?: number;
  pix_fmt?: string;
  bits_per_raw_sample?: string;
  color_transfer?: string;
  side_data_list?: { side_data_type?: string }[];
  tags?: { language?: string; title?: string };
  disposition?: { forced?: number; hearing_impaired?: number; default?: number };
}

/** 10 for yuv420p10le, 8 for yuv420p; the raw sample size when the pixel format does not say. */
export function bitDepthOf(stream: Pick<ProbeStream, "pix_fmt" | "bits_per_raw_sample">) {
  const match = /p(\d{1,2})(?:le|be)?$/.exec(stream.pix_fmt ?? "");
  if (match) return Number(match[1]);
  const raw = Number(stream.bits_per_raw_sample);
  if (Number.isInteger(raw) && raw > 0) return raw;
  return stream.pix_fmt ? 8 : null;
}

/** HDR formats a video stream carries: Dolby Vision from its side data, HDR10 or HLG from the transfer curve. */
export function hdrOf(stream: Pick<ProbeStream, "color_transfer" | "side_data_list">): HdrFormat[] {
  const formats: HdrFormat[] = [];
  if (stream.side_data_list?.some((entry) => /dovi|dolby vision/i.test(entry.side_data_type ?? ""))) formats.push("dolby_vision");
  if (stream.color_transfer === "smpte2084") formats.push("hdr10");
  if (stream.color_transfer === "arib-std-b67") formats.push("hlg");
  return formats;
}

export function videoInfoOf(video: ProbeStream | undefined, formatBitrate: string | undefined): VideoInfo {
  const bitrate = Number(formatBitrate);
  return {
    profile: video?.profile ?? null,
    level: typeof video?.level === "number" && video.level > 0 ? video.level : null,
    bitDepth: video ? bitDepthOf(video) : null,
    hdr: video ? hdrOf(video) : [],
    bitrate: Number.isFinite(bitrate) && bitrate > 0 ? Math.round(bitrate) : null,
  };
}

export async function probeFile(file: string): Promise<ProbeResult | null> {
  if (!tools.ffprobe) return null;
  try {
    const result = await run(bins.ffprobe, ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", file]);
    if (result.code !== 0) return null;
    const parsed = JSON.parse(result.stdout) as {
      format?: { duration?: string; bit_rate?: string };
      streams?: ProbeStream[];
    };
    const streams = parsed.streams ?? [];
    const video = streams.find((stream) => stream.codec_type === "video");
    const audio = streams
      .filter((stream) => stream.codec_type === "audio" && stream.codec_name)
      .map((stream) => ({
        codec: stream.codec_name ?? "unknown",
        language: languageCode(stream.tags?.language),
        channels: stream.channels ?? null,
      }));
    const subtitles = streams
      .filter((stream) => stream.codec_type === "subtitle" && stream.codec_name && stream.index != null)
      .map((stream) => ({
        streamIndex: stream.index ?? 0,
        codec: stream.codec_name ?? "unknown",
        language: languageCode(stream.tags?.language),
        forced: stream.disposition?.forced === 1,
        hearingImpaired: stream.disposition?.hearing_impaired === 1,
        isDefault: stream.disposition?.default === 1,
        textBased: TEXT_CODECS.has((stream.codec_name ?? "").toLowerCase()),
      }));
    const duration = parsed.format?.duration ? Number(parsed.format.duration) : null;
    return {
      duration: duration != null && Number.isFinite(duration) ? duration : null,
      videoCodec: video?.codec_name ?? null,
      width: video?.width ?? null,
      height: video?.height ?? null,
      audio,
      subtitles,
      info: videoInfoOf(video, parsed.format?.bit_rate),
    };
  } catch {
    return null;
  }
}
