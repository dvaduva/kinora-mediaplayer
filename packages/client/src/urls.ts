import { apiUrl, getApiConfig } from "./api";

/**
 * URL for an element that cannot send headers (`<img>`, `<video>`, `<track>`). With a configured token
 * (a paired TV, or a TV pointed at another origin) it goes in the query, since cookies may not reach the server.
 */
export function mediaUrl(path: string) {
  const url = apiUrl(path);
  const { token } = getApiConfig();
  if (!token) return url;
  return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}

export function imageUrl(src: string | null, size = "w342") {
  if (!src) return null;
  if (src.startsWith("cover:")) return mediaUrl(`/api/covers/${encodeURIComponent(src.slice(6))}`);
  return mediaUrl(`/api/images?size=${encodeURIComponent(size)}&path=${encodeURIComponent(src)}`);
}

export function streamUrl(fileId: string) {
  return mediaUrl(`/api/stream/${fileId}`);
}

export function hlsUrl(fileId: string) {
  return apiUrl(`/api/stream/${fileId}/index.m3u8`);
}

export function subtitleUrl(fileId: string, subtitleId: string) {
  return mediaUrl(`/api/subtitles/${fileId}/${subtitleId}`);
}
