import { LANGUAGE_NAMES, type SubtitleTrack } from "@kinora/shared";
import { getConnection } from "./api";
import { apiUrl } from "./connection";
import type { Locale } from "./i18n";

export function imageUrl(src: string | null, size = "w342") {
  if (!src) return null;
  const { baseUrl } = getConnection();
  if (src.startsWith("cover:")) return apiUrl(baseUrl, `/api/covers/${encodeURIComponent(src.slice(6))}`);
  return apiUrl(baseUrl, `/api/images?size=${encodeURIComponent(size)}&path=${encodeURIComponent(src)}`);
}

export function streamUrl(fileId: string) {
  const { baseUrl } = getConnection();
  return apiUrl(baseUrl, `/api/stream/${fileId}`);
}

export function hlsUrl(fileId: string) {
  const { baseUrl } = getConnection();
  return apiUrl(baseUrl, `/api/stream/${fileId}/index.m3u8`);
}

export function formatClock(seconds: number | null) {
  if (!seconds || !Number.isFinite(seconds)) return "0:00";
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function formatRuntime(minutes: number | null) {
  if (!minutes) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours} h ${rest} min` : `${rest} min`;
}

export function formatBytes(size: number, locale: Locale) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const number = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB", { maximumFractionDigits: 1 }).format(value);
  return `${number} ${units[index]}`;
}

export function resolutionLabel(width: number | null, height: number | null) {
  if (!width && !height) return null;
  if ((width ?? 0) >= 3000 || (height ?? 0) >= 1600) return "4K";
  if ((height ?? 0) >= 900) return "1080p";
  if ((height ?? 0) >= 700) return "720p";
  return height ? `${height}p` : null;
}

const CODECS: Record<string, string> = {
  h264: "H.264",
  hevc: "HEVC",
  av1: "AV1",
  aac: "AAC",
  ac3: "AC-3",
  eac3: "E-AC-3",
  dts: "DTS",
  truehd: "TrueHD",
  flac: "FLAC",
  opus: "Opus",
  mp3: "MP3",
  vorbis: "Vorbis",
  vp9: "VP9",
};

export function codecLabel(codec: string | null) {
  if (!codec) return null;
  return CODECS[codec.toLowerCase()] ?? codec.toUpperCase();
}

export function subtitleLabel(track: SubtitleTrack, locale: Locale) {
  const language = track.language ? (LANGUAGE_NAMES[track.language]?.[locale] ?? track.language) : locale === "ro" ? "Necunoscută" : "Unknown";
  const notes = [
    language,
    track.hearingImpaired ? "SDH" : null,
    track.forced ? (locale === "ro" ? "forțată" : "forced") : null,
    track.origin === "embedded" ? (locale === "ro" ? "în fișier" : "embedded") : locale === "ro" ? "externă" : "external",
  ];
  const reason = !track.available
    ? track.unavailableReason === "bitmap"
      ? locale === "ro"
        ? "imagine, după transcodare"
        : "image, after transcode"
      : locale === "ro"
        ? "necesită ffmpeg"
        : "needs ffmpeg"
    : null;
  return [...notes, reason].filter(Boolean).join(", ");
}

export function subtitleUrl(fileId: string, subtitleId: string) {
  const { baseUrl } = getConnection();
  return apiUrl(baseUrl, `/api/subtitles/${fileId}/${subtitleId}`);
}
