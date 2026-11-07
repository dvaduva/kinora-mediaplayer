import fs from "node:fs";
import path from "node:path";

export const VIDEO_EXTENSIONS = new Set(["mkv", "mp4", "m4v", "avi", "mov", "webm", "wmv", "ts", "m2ts", "mpg", "mpeg"]);
export const AUDIO_EXTENSIONS = new Set(["mp3", "flac", "m4a", "ogg", "opus", "wav", "aac", "oga", "aiff"]);
export const SUBTITLE_EXTENSIONS = new Set(["srt", "vtt", "ass", "ssa", "idx", "sub"]);

const SKIP_DIRS = new Set([
  "featurettes",
  "extras",
  "extrafanart",
  "behind the scenes",
  "behind-the-scenes",
  "deleted scenes",
  "interviews",
  "trailers",
  "sample",
  "samples",
  "scenes",
]);

const JUNK = new Set([
  "2160p",
  "1080p",
  "720p",
  "576p",
  "480p",
  "4k",
  "uhd",
  "bluray",
  "blu-ray",
  "bdrip",
  "brrip",
  "webrip",
  "web-dl",
  "webdl",
  "hdtv",
  "hdrip",
  "dvdrip",
  "remux",
  "hdr",
  "hdr10",
  "sdr",
  "x264",
  "x265",
  "h264",
  "h265",
  "hevc",
  "av1",
  "aac",
  "ac3",
  "eac3",
  "dts",
  "truehd",
  "atmos",
  "flac",
  "proper",
  "repack",
  "extended",
  "remastered",
  "10bit",
  "8bit",
  "amzn",
  "nf",
  "dsnp",
  "atvp",
  "hmax",
]);

const LANGUAGE_ALIASES: Record<string, string> = {
  ro: "ro",
  rum: "ro",
  ron: "ro",
  romanian: "ro",
  romana: "ro",
  en: "en",
  eng: "en",
  english: "en",
  engleza: "en",
  fr: "fr",
  fre: "fr",
  fra: "fr",
  french: "fr",
  de: "de",
  ger: "de",
  deu: "de",
  german: "de",
  es: "es",
  spa: "es",
  spanish: "es",
  it: "it",
  ita: "it",
  italian: "it",
  hu: "hu",
  hun: "hu",
  hungarian: "hu",
  pl: "pl",
  pol: "pl",
  polish: "pl",
};

export function extensionOf(file: string) {
  return path.extname(file).slice(1).toLowerCase();
}

export function stripKnownExt(filename: string) {
  const ext = extensionOf(filename);
  if (VIDEO_EXTENSIONS.has(ext) || AUDIO_EXTENSIONS.has(ext) || SUBTITLE_EXTENSIONS.has(ext)) {
    return filename.slice(0, -(ext.length + 1));
  }
  return filename;
}

export function foldTitle(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(the|a|an|un|o)\s+/, "");
}

export function titlesEqual(a: string, b: string) {
  const left = foldTitle(a);
  const right = foldTitle(b);
  return left.length > 0 && left === right;
}

export function normalizeKey(value: string) {
  return foldTitle(value);
}

function clean(value: string) {
  return value.replace(/[-\s]+$/g, "").replace(/^[\s-]+/g, "").replace(/\s+/g, " ").trim();
}

function stripJunk(value: string) {
  const kept = value
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !JUNK.has(token.toLowerCase().replace(/[^\w+-]/g, "")));
  return clean(kept.join(" "));
}

export function parseMovieName(filename: string): { title: string; year: number | null } {
  const spaced = stripKnownExt(filename).replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  const paren = spaced.match(/^(.*?)\(((?:19|20)\d{2})\)\s*(.*)$/);
  if (paren?.[1] && paren[2] && clean(paren[1])) {
    return { title: clean(paren[1]), year: Number(paren[2]) };
  }
  const tokens = spaced.split(" ");
  for (let index = tokens.length - 1; index >= 1; index -= 1) {
    const token = tokens[index] ?? "";
    if (/^(19|20)\d{2}$/.test(token)) {
      const title = clean(tokens.slice(0, index).join(" "));
      if (title) return { title, year: Number(token) };
    }
  }
  return { title: clean(spaced), year: null };
}

export function seasonFromFolder(name: string): number | null {
  const match = name.match(/^season[\s._-]*(\d{1,2})$/i) || name.match(/^s(\d{1,2})$/i);
  return match?.[1] ? Number(match[1]) : null;
}

export interface SeriesParse {
  showTitle: string;
  year: number | null;
  season: number;
  episode: number;
  episodeTitle: string | null;
}

function parseMarker(spaced: string) {
  const patterns = [/\bs(\d{1,2})\s*e(\d{1,3})\b/i, /\b(\d{1,2})x(\d{1,3})\b/i];
  for (const pattern of patterns) {
    const match = pattern.exec(spaced);
    if (match?.[1] && match[2] && match.index !== undefined) {
      return {
        season: Number(match[1]),
        episode: Number(match[2]),
        start: match.index,
        end: match.index + match[0].length,
      };
    }
  }
  return null;
}

export function parseSeriesFile(filePath: string, libraryRoot: string): SeriesParse {
  const relative = path.relative(libraryRoot, filePath);
  const parts = relative.split(path.sep).filter(Boolean);
  const base = parts.at(-1) ?? path.basename(filePath);
  const folders = parts.slice(0, -1);
  let seasonDir: number | null = null;
  let showFolder: string | null = null;
  const seasonIndex = folders.findIndex((part) => seasonFromFolder(part) != null);
  if (seasonIndex >= 0) {
    seasonDir = seasonFromFolder(folders[seasonIndex] ?? "");
    showFolder = seasonIndex > 0 ? (folders[seasonIndex - 1] ?? null) : null;
  } else if (folders.length > 0) {
    showFolder = folders[0] ?? null;
  }

  const spaced = stripKnownExt(base).replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  const marker = parseMarker(spaced);
  const folderTitle = showFolder ? parseMovieName(showFolder) : null;
  let showTitle = folderTitle?.title ?? "";
  let year = folderTitle?.year ?? null;
  let episodeTitle: string | null = null;
  let season = seasonDir ?? 0;
  let episode = 0;

  if (marker) {
    season = marker.season;
    episode = marker.episode;
    const before = clean(spaced.slice(0, marker.start));
    episodeTitle = stripJunk(spaced.slice(marker.end)) || null;
    if (!showTitle && before) {
      const parsedBefore = parseMovieName(before);
      showTitle = parsedBefore.title;
      year = year ?? parsedBefore.year;
    }
  }

  if (!showTitle) showTitle = parseMovieName(base).title || stripKnownExt(base);
  return { showTitle, year, season, episode, episodeTitle };
}

export function parseTrackFilename(filename: string) {
  const spaced = stripKnownExt(filename).replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  const match = spaced.match(/^(?:\d{1,2}\s+)?(\d{1,3})\s+[-–—]?\s*(.+)$/);
  if (match?.[1] && match[2] && !/^\d+$/.test(match[2])) {
    return { trackNumber: Number(match[1]), title: clean(match[2]) };
  }
  return { trackNumber: null as number | null, title: clean(spaced) };
}

export function parseMusicPath(filePath: string, libraryRoot: string) {
  const relative = path.relative(libraryRoot, filePath);
  const parts = relative.split(path.sep).filter(Boolean);
  const base = parts.at(-1) ?? path.basename(filePath);
  const track = parseTrackFilename(base);
  let artist: string | null = null;
  let album: string | null = null;
  if (parts.length >= 3) {
    artist = parts[parts.length - 3] ?? null;
    album = parts[parts.length - 2] ?? null;
  } else if (parts.length === 2) {
    artist = parts[0] ?? null;
  }
  return { artist, album, ...track };
}

export function languageCode(token: string | null | undefined) {
  if (!token) return null;
  const key = token
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z]/g, "");
  return LANGUAGE_ALIASES[key] ?? (key.length === 2 ? key : null);
}

export function isSampleName(name: string) {
  return /(?:^|[\s._-])sample(?:[\s._-]|$)/i.test(name);
}

export function shouldSkipDir(name: string) {
  return SKIP_DIRS.has(name.toLowerCase());
}

export interface ExternalSubtitle {
  path: string;
  format: string;
  language: string | null;
  forced: boolean;
  hearingImpaired: boolean;
  textBased: boolean;
}

async function readDir(folder: string) {
  try {
    return await fs.promises.readdir(folder, { withFileTypes: true });
  } catch {
    return [];
  }
}

const SUBTITLE_DIRS = new Set(["subs", "subtitles"]);

/** Async on purpose: on network shares every listing is a round trip, and a sync call would stall the whole server. */
export async function discoverExternalSubtitles(videoPath: string): Promise<ExternalSubtitle[]> {
  const dir = path.dirname(videoPath);
  const videoStem = stripKnownExt(path.basename(videoPath));
  const files: string[] = [];
  const collect = (folder: string, entries: fs.Dirent[]) => {
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = extensionOf(entry.name);
      if (!SUBTITLE_EXTENSIONS.has(ext) || ext === "sub") continue;
      files.push(path.join(folder, entry.name));
    }
  };
  // The folder is listed once; subtitle subfolders are only opened when that listing shows them.
  const entries = await readDir(dir);
  collect(dir, entries);
  for (const entry of entries) {
    if (!entry.isDirectory() || !SUBTITLE_DIRS.has(entry.name.toLowerCase())) continue;
    const folder = path.join(dir, entry.name);
    collect(folder, await readDir(folder));
  }

  let videoCount = 0;
  for (const entry of entries) {
    if (entry.isFile() && VIDEO_EXTENSIONS.has(extensionOf(entry.name)) && !isSampleName(entry.name)) videoCount += 1;
  }

  const found: ExternalSubtitle[] = [];
  for (const file of files) {
    const stem = stripKnownExt(path.basename(file));
    const lowerStem = stem.toLowerCase();
    const lowerVideo = videoStem.toLowerCase();
    const sameStem =
      lowerStem === lowerVideo ||
      lowerStem.startsWith(`${lowerVideo}.`) ||
      lowerStem.startsWith(`${lowerVideo} `) ||
      lowerStem.startsWith(`${lowerVideo}-`);
    if (!sameStem && videoCount !== 1) continue;
    const suffix = sameStem && lowerStem !== lowerVideo ? stem.slice(videoStem.length) : sameStem ? "" : stem;
    const tokens = suffix.toLowerCase().split(/[\s._-]+/).filter(Boolean);
    let language: string | null = null;
    let forced = false;
    let hearingImpaired = false;
    for (const token of tokens) {
      if (token === "forced") forced = true;
      else if (token === "sdh" || token === "hi" || token === "cc") hearingImpaired = true;
      else {
        const code = languageCode(token);
        if (code) language = code;
      }
    }
    const format = extensionOf(file);
    found.push({
      path: file,
      format,
      language,
      forced,
      hearingImpaired,
      textBased: format === "srt" || format === "vtt" || format === "ass" || format === "ssa",
    });
  }
  return found;
}

export async function* walkFiles(root: string): AsyncGenerator<string> {
  const visit = async function* (dir: string): AsyncGenerator<string> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) continue;
        yield* visit(full);
      } else if (entry.isFile()) {
        if (isSampleName(entry.name)) continue;
        yield full;
      }
    }
  };
  yield* visit(root);
}
