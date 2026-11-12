/** Language of titles, overviews, genres and preferred artwork fetched from TMDB. */
export type MetadataLanguage = "en" | "ro";

export function isMetadataLanguage(value: unknown): value is MetadataLanguage {
  return value === "en" || value === "ro";
}

/** TMDB `language` parameter. */
export function tmdbLocale(language: MetadataLanguage) {
  return language === "ro" ? "ro-RO" : "en-US";
}

/** TMDB `include_image_language` / `include_video_language` value. */
export function tmdbMediaLanguages(language: MetadataLanguage) {
  return language === "en" ? "en,null" : `${language},en,null`;
}

/** Region whose release date is shown, or null for the original release date. */
export function tmdbRegion(language: MetadataLanguage) {
  return language === "ro" ? "RO" : null;
}

/** Sort key for artwork and videos: the chosen language, then English, then language-free, then anything else. */
export function languageRank(preferred: MetadataLanguage, language: string | null | undefined) {
  if (language === preferred) return 0;
  if (language === "en") return 1;
  if (!language) return 2;
  return 3;
}
