import iconv from "iconv-lite";

export function srtToVtt(text: string) {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const timed = normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return `WEBVTT\n\n${timed}\n`;
}

function strictUtf8(buffer: Buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

export function decodeSubtitle(buffer: Buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return iconv.decode(buffer, "utf16-le");
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return iconv.decode(buffer, "utf16-be");
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return strictUtf8(buffer.subarray(3)) ?? buffer.toString("utf8");
  }
  // Romanian subtitle files are usually UTF-8 or Windows-1250. Generic charset
  // detectors miss Windows-1250, so anything that is not valid UTF-8 uses it.
  return strictUtf8(buffer) ?? iconv.decode(buffer, "win1250");
}

export function romanianOrthography(text: string) {
  return text
    .replaceAll("\u015f", "\u0219")
    .replaceAll("\u0163", "\u021b")
    .replaceAll("\u015e", "\u0218")
    .replaceAll("\u0162", "\u021a");
}

export function ensureVtt(text: string) {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (trimmed.startsWith("WEBVTT")) return `${trimmed}\n`;
  return srtToVtt(trimmed);
}
