import { apiUrl } from "./api";

export function imageUrl(src: string | null, size = "w342") {
  if (!src) return null;
  if (src.startsWith("cover:")) return apiUrl(`/api/covers/${encodeURIComponent(src.slice(6))}`);
  return apiUrl(`/api/images?size=${encodeURIComponent(size)}&path=${encodeURIComponent(src)}`);
}

export function streamUrl(fileId: string) {
  return apiUrl(`/api/stream/${fileId}`);
}

export function hlsUrl(fileId: string) {
  return apiUrl(`/api/stream/${fileId}/index.m3u8`);
}

export function subtitleUrl(fileId: string, subtitleId: string) {
  return apiUrl(`/api/subtitles/${fileId}/${subtitleId}`);
}
