import type { AudioStream } from "@kinora/shared";
import { languageCode } from "./parse/names.js";
import { bins, run, tools } from "./process.js";

export interface ProbeResult {
  duration: number | null;
  videoCodec: string | null;
  width: number | null;
  height: number | null;
  audio: AudioStream[];
  subtitles: EmbeddedSubtitle[];
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
  tags?: { language?: string; title?: string };
  disposition?: { forced?: number; hearing_impaired?: number; default?: number };
}

export async function probeFile(file: string): Promise<ProbeResult | null> {
  if (!tools.ffprobe) return null;
  try {
    const result = await run(bins.ffprobe, ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", file]);
    if (result.code !== 0) return null;
    const parsed = JSON.parse(result.stdout) as {
      format?: { duration?: string };
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
    };
  } catch {
    return null;
  }
}
