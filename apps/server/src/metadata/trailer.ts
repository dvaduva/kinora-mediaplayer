import { languageRank, type MetadataLanguage } from "./language.js";

export interface TrailerCandidate {
  key: string;
  name: string;
  site: string;
  type: string;
  official: boolean;
  language: string | null;
  publishedAt: string | null;
}

export interface ChosenTrailer {
  key: string;
  name: string;
  type: string;
  language: string | null;
  official: boolean;
}

/** `preferred` is the metadata language; Romanian keeps the ranking used before the setting existed. */
export function pickTrailer(videos: TrailerCandidate[], preferred: MetadataLanguage = "ro"): ChosenTrailer | null {
  const youtube = videos.filter((video) => video.site === "YouTube" && video.key);
  const trailers = youtube.filter((video) => video.type === "Trailer");
  const pool = trailers.length > 0 ? trailers : youtube.filter((video) => video.type === "Teaser");
  pool.sort((a, b) => {
    if (a.official !== b.official) return a.official ? -1 : 1;
    const byLanguage = languageRank(preferred, a.language) - languageRank(preferred, b.language);
    if (byLanguage !== 0) return byLanguage;
    return (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "");
  });
  const winner = pool[0];
  if (!winner) return null;
  return {
    key: winner.key,
    name: winner.name,
    type: winner.type,
    language: winner.language,
    official: winner.official,
  };
}

const VIDEO_TYPES = ["Trailer", "Teaser", "Clip", "Featurette", "Behind the Scenes"];

/** Every YouTube trailer, teaser and clip worth showing, trailers first, for titles outside the library. */
export function rankVideos(videos: TrailerCandidate[], preferred: MetadataLanguage = "ro", limit = 16): ChosenTrailer[] {
  const seen = new Set<string>();
  return videos
    .filter((video) => video.site === "YouTube" && video.key && VIDEO_TYPES.includes(video.type))
    .sort((a, b) => {
      const byType = VIDEO_TYPES.indexOf(a.type) - VIDEO_TYPES.indexOf(b.type);
      if (byType !== 0) return byType;
      if (a.official !== b.official) return a.official ? -1 : 1;
      const byLanguage = languageRank(preferred, a.language) - languageRank(preferred, b.language);
      if (byLanguage !== 0) return byLanguage;
      return (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "");
    })
    .filter((video) => (seen.has(video.key) ? false : (seen.add(video.key), true)))
    .slice(0, limit)
    .map((video) => ({ key: video.key, name: video.name, type: video.type, language: video.language, official: video.official }));
}
