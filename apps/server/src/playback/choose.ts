import type { SubtitleTrack } from "@kinora/shared";

export function chooseSubtitle(
  tracks: SubtitleTrack[],
  preference: string,
  saved: string | null,
  audioLanguage: string | null,
) {
  const text = tracks.filter((track) => track.available && track.textBased);
  if (saved && saved !== "off") {
    const chosen = text.find((track) => track.id === saved);
    if (chosen) return chosen.id;
  }
  if (saved === "off" || preference === "off") {
    return (
      text.find((track) => track.forced && audioLanguage != null && track.language === audioLanguage)?.id ??
      text.find((track) => track.forced && track.language == null)?.id ??
      null
    );
  }
  const matches = text.filter((track) => track.language === preference && !track.forced);
  return matches.find((track) => !track.hearingImpaired)?.id ?? matches[0]?.id ?? null;
}
