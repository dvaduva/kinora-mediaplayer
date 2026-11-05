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

function languageRank(language: string | null) {
  if (language === "ro") return 0;
  if (language === "en") return 1;
  if (!language) return 2;
  return 3;
}

export function pickTrailer(videos: TrailerCandidate[]): ChosenTrailer | null {
  const youtube = videos.filter((video) => video.site === "YouTube" && video.key);
  const trailers = youtube.filter((video) => video.type === "Trailer");
  const pool = trailers.length > 0 ? trailers : youtube.filter((video) => video.type === "Teaser");
  pool.sort((a, b) => {
    if (a.official !== b.official) return a.official ? -1 : 1;
    const byLanguage = languageRank(a.language) - languageRank(b.language);
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
