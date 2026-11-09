import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

const STORAGE_KEY = "kinora.tv.locale";

const copy = {
  ro: {
    home: "Acasă",
    movies: "Filme",
    series: "Seriale",
    music: "Muzică",
    live: "TV Live",
    search: "Caută",
    identify: "Potrivire",
    settings: "Setări",
    language: "English",
    play: "Redă",
    pause: "Pauză",
    details: "Detalii",
    back: "Înapoi",
    continue: "Continuă vizionarea",
    recentMovies: "Filme recente",
    recentSeries: "Seriale recente",
    recentAlbums: "Albume recente",
    recommended: "Recomandat",
    empty: "Biblioteca e goală",
    emptyHelp: "Adaugă foldere din interfața web Kinora, apoi revino aici.",
    titles: "titluri",
    albums: "Albume",
    artists: "Artiști",
    tracks: "Piese",
    noMovies: "Niciun film în bibliotecă.",
    noSeries: "Niciun serial în bibliotecă.",
    noMusic: "Nicio muzică în bibliotecă.",
    noLive: "Niciun canal TV Live.",
    noResults: "Niciun rezultat.",
    noEpisodes: "Niciun episod redabil în acest sezon.",
    noFile: "Niciun fișier de redare.",
    loading: "Se încarcă…",
    error: "Eroare",
    movie: "Film",
    show: "Serial",
    season: "Sezon",
    scrollBack: "Înapoi",
    scrollForward: "Înainte",
    disconnect: "Deconectare",
    disconnectHelp: "Șterge adresa și cheia salvate pe acest dispozitiv.",
    settingsHelp: "Bibliotecile, scanarea și cheile API se configurează din interfața web pe calculator.",
    connection: "Conexiune",
    nothingToIdentify: "Tot ce e pe disc are un titlu.",
    unmatched: "Nepotrivit",
    openWeb: "Deschide pe web pentru potrivire detaliată",
    searchPlaceholder: "Titlu film, serial sau album…",
    channels: "Canale",
    preparing: "Se pregătește redarea…",
    playbackFailed: "Redarea a eșuat",
    liveFavorites: "Favorite",
    liveAll: "Toate",
    liveCategories: "Categorii",
    liveCategoryMovies: "Filme",
    liveCategorySeries: "Seriale",
    liveCategoryMusic: "Muzică",
    liveGuide: "Ghid",
    liveWhatsOn: "Acum la TV",
    liveToday: "Azi",
    liveTomorrow: "Mâine",
    liveNow: "Acum",
    liveNext: "Urmează",
    liveNoProgram: "Fără program",
    liveNoFavorites: "Niciun canal favorit.",
    liveNothingHere: "Niciun canal în această categorie.",
    liveTuning: "Se acordă canalul…",
    liveChannelEmpty: "Canalul nu are nimic de difuzat acum.",
    liveChannelGone: "Canalul nu mai există sau e oprit.",
    liveFillerTitle: "Urmează…",
    liveFillerAt: "la {time}",
    liveGuideFailed: "Ghidul nu a putut fi încărcat.",
    errIptvStream: "Sursa canalului nu răspunde.",
    errIptvFfmpeg: "Pentru IPTV e nevoie de ffmpeg.",
    transcodeFailed: "Conversia a eșuat.",
    subtitles: "Subtitrare",
    subtitleOff: "Oprită",
    subtitleDelay: "Decalaj subtitrare",
    subtitleDelayHelp: "Plus o arată mai târziu, minus mai devreme.",
    reset: "Resetează",
    cast: "Distribuție",
    similar: "Titluri asemănătoare",
    direction: "Regie",
    writers: "Scenariu",
    creators: "Creație",
    rating: "Notă",
    file: "Fișier",
    ratingsReviews: "Note și recenzii",
    noReviews: "Nicio recenzie încă.",
    reviewsLoading: "Se încarcă recenziile…",
    own: "Tu",
    yourRating: "Nota ta",
    absent: "Nu e în bibliotecă",
    inLibrary: "În bibliotecă",
    born: "Născut",
    died: "Deces",
    birthplace: "Locul nașterii",
    years: "ani",
  },
  en: {
    home: "Home",
    movies: "Movies",
    series: "Series",
    music: "Music",
    live: "Live TV",
    search: "Search",
    identify: "Match",
    settings: "Settings",
    language: "Română",
    play: "Play",
    pause: "Pause",
    details: "Details",
    back: "Back",
    continue: "Continue watching",
    recentMovies: "Recent movies",
    recentSeries: "Recent series",
    recentAlbums: "Recent albums",
    recommended: "Featured",
    empty: "Library is empty",
    emptyHelp: "Add folders from the Kinora web UI, then come back here.",
    titles: "titles",
    albums: "Albums",
    artists: "Artists",
    tracks: "Tracks",
    noMovies: "No movies in the library.",
    noSeries: "No series in the library.",
    noMusic: "No music in the library.",
    noLive: "No Live TV channels.",
    noResults: "No results.",
    noEpisodes: "No playable episodes in this season.",
    noFile: "No playable file.",
    loading: "Loading…",
    error: "Error",
    movie: "Movie",
    show: "Series",
    season: "Season",
    scrollBack: "Back",
    scrollForward: "Forward",
    disconnect: "Disconnect",
    disconnectHelp: "Clear the saved server address and token on this device.",
    settingsHelp: "Libraries, scanning, and API keys are configured in the web UI on your computer.",
    connection: "Connection",
    nothingToIdentify: "Everything on disk already has a title.",
    unmatched: "Unmatched",
    openWeb: "Open on web for detailed matching",
    searchPlaceholder: "Movie, series, or album title…",
    channels: "Channels",
    preparing: "Preparing playback…",
    playbackFailed: "Playback failed",
    liveFavorites: "Favorites",
    liveAll: "All",
    liveCategories: "Categories",
    liveCategoryMovies: "Movies",
    liveCategorySeries: "Series",
    liveCategoryMusic: "Music",
    liveGuide: "Guide",
    liveWhatsOn: "What's On",
    liveToday: "Today",
    liveTomorrow: "Tomorrow",
    liveNow: "Now",
    liveNext: "Next",
    liveNoProgram: "No program",
    liveNoFavorites: "No favorite channels.",
    liveNothingHere: "No channels in this category.",
    liveTuning: "Tuning in…",
    liveChannelEmpty: "This channel has nothing to air right now.",
    liveChannelGone: "This channel no longer exists or is turned off.",
    liveFillerTitle: "Up next…",
    liveFillerAt: "at {time}",
    liveGuideFailed: "The guide couldn't be loaded.",
    errIptvStream: "The channel's source does not answer.",
    errIptvFfmpeg: "IPTV needs ffmpeg.",
    transcodeFailed: "Conversion failed.",
    subtitles: "Subtitles",
    subtitleOff: "Off",
    subtitleDelay: "Subtitle delay",
    subtitleDelayHelp: "Plus shows them later, minus earlier.",
    reset: "Reset",
    cast: "Cast",
    similar: "Similar titles",
    direction: "Directed by",
    writers: "Written by",
    creators: "Created by",
    rating: "Rating",
    file: "File",
    ratingsReviews: "Ratings & reviews",
    noReviews: "No reviews yet.",
    reviewsLoading: "Loading reviews…",
    own: "You",
    yourRating: "Your rating",
    absent: "Not in library",
    inLibrary: "In library",
    born: "Born",
    died: "Died",
    birthplace: "Place of birth",
    years: "years",
  },
} as const;

export type Locale = keyof typeof copy;
export type Copy = (typeof copy)[Locale];

type LocaleContextValue = {
  locale: Locale;
  t: Copy;
  toggle: () => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function readLocale(): Locale {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "en" || value === "ro") return value;
  } catch {
    // ignore
  }
  return "ro";
}

export function LocaleProvider(props: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(readLocale);
  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      t: copy[locale],
      toggle: () =>
        setLocale((current) => {
          const next = current === "ro" ? "en" : "ro";
          try {
            localStorage.setItem(STORAGE_KEY, next);
          } catch {
            // ignore
          }
          return next;
        }),
    }),
    [locale],
  );
  return <LocaleContext.Provider value={value}>{props.children}</LocaleContext.Provider>;
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("LocaleProvider missing");
  return value;
}
