import { getConnection } from "./api";
import { apiUrl } from "./connection";

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
