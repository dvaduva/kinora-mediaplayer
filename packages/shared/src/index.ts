export type LibraryType = "movie" | "series" | "music";

export type PlaybackMode = "direct" | "remux" | "transcode";

export type PlaybackReason = "ok" | "remux_required" | "transcode_required" | "missing";

export interface PlaybackPlan {
  mode: PlaybackMode;
  available: boolean;
  reasonCode: PlaybackReason;
  container: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
}

export interface AudioStream {
  codec: string;
  language: string | null;
  channels: number | null;
}

export interface SubtitleTrack {
  id: string;
  language: string | null;
  forced: boolean;
  hearingImpaired: boolean;
  origin: "external" | "embedded";
  textBased: boolean;
  available: boolean;
  unavailableReason: "bitmap" | "needs_ffmpeg" | null;
}

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

/** Embedded subtitles reach the player in windows of media time; `complete: false` means ask again later. */
export interface SubtitleChunk {
  cues: SubtitleCue[];
  complete: boolean;
}

export interface MediaVersion {
  fileId: string;
  filename: string;
  path: string;
  size: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audio: AudioStream[];
  container: string | null;
  playable: boolean;
  plan: PlaybackPlan;
  subtitles: SubtitleTrack[];
}

export interface CastMember {
  tmdbPersonId?: number | null;
  name: string;
  character: string | null;
  profilePath: string | null;
}

export interface PersonCredit {
  kind: "movie" | "series";
  id: string;
  title: string;
  year: number | null;
  posterPath: string | null;
  character: string | null;
}

export interface PersonDetail {
  tmdbId: number;
  name: string;
  biography: string | null;
  birthday: string | null;
  deathday: string | null;
  placeOfBirth: string | null;
  profilePath: string | null;
  knownFor: string | null;
  imdbId: string | null;
  /** False when TMDB is not configured or unreachable — only library data is shown. */
  profileLoaded: boolean;
  credits: PersonCredit[];
}

export interface SimilarTitle {
  tmdbId: number;
  title: string;
  year: number | null;
  posterPath: string | null;
  mediaType: "movie" | "tv";
  inLibrary: boolean;
  localId: string | null;
}

export interface Trailer {
  key: string;
  name: string;
  type: string;
  language: string | null;
  official: boolean;
}

export type WatchStatus = "new" | "unwatched" | "watched";

export const WATCH_STATUSES: readonly WatchStatus[] = ["new", "unwatched", "watched"];

export interface MovieSummary {
  id: string;
  title: string;
  year: number | null;
  posterPath: string | null;
  rating: number | null;
  matched: boolean;
  runtime: number | null;
  releaseDate: string | null;
  /** Epoch milliseconds when the scan first saw the movie. */
  addedAt: number;
  watchStatus: WatchStatus;
  /** True when the status was set by hand rather than derived from playback. */
  watchStatusManual: boolean;
}

export interface MovieDetail extends MovieSummary {
  originalTitle: string | null;
  overview: string | null;
  tagline: string | null;
  backdropPath: string | null;
  genres: string[];
  directors: string[];
  writers: string[];
  cast: CastMember[];
  stills: string[];
  similar: SimilarTitle[];
  trailer: Trailer | null;
  imdbId: string | null;
  tmdbId: number | null;
  versions: MediaVersion[];
  defaultFileId: string | null;
}

export interface EpisodeSummary {
  id: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  overview: string | null;
  stillPath: string | null;
  runtime: number | null;
  airDate: string | null;
  fileId: string | null;
  playable: boolean;
}

export interface SeriesSummary {
  id: string;
  title: string;
  year: number | null;
  posterPath: string | null;
  rating: number | null;
  matched: boolean;
}

export interface SeriesDetail extends SeriesSummary {
  originalTitle: string | null;
  overview: string | null;
  backdropPath: string | null;
  genres: string[];
  creators: string[];
  cast: CastMember[];
  similar: SimilarTitle[];
  trailer: Trailer | null;
  tmdbId: number | null;
  imdbId: string | null;
  seasons: { seasonNumber: number; name: string | null; episodes: EpisodeSummary[] }[];
}

export interface AlbumSummary {
  id: string;
  title: string;
  year: number | null;
  coverPath: string | null;
  artistName: string;
  artistId: string;
  matched: boolean;
}

export interface TrackSummary {
  id: string;
  fileId: string;
  title: string;
  trackNumber: number | null;
  discNumber: number | null;
  duration: number | null;
  artistName: string | null;
}

export interface AlbumDetail extends AlbumSummary {
  tracks: TrackSummary[];
}

export interface ArtistSummary {
  id: string;
  name: string;
}

export interface ArtistDetail extends ArtistSummary {
  albums: AlbumSummary[];
}

export interface ContinueItem {
  fileId: string;
  title: string;
  subtitle: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  position: number;
  duration: number;
  kind: "movie" | "episode" | "track";
}

export interface HomeView {
  continueWatching: ContinueItem[];
  featured: MovieDetail | null;
  movies: MovieSummary[];
  series: SeriesSummary[];
  albums: AlbumSummary[];
}

export interface ScanState {
  libraryId: string;
  status: "idle" | "running" | "done" | "error";
  scanned: number;
  matched: number;
  message: string | null;
}

export interface LibraryView {
  id: string;
  name: string;
  type: LibraryType;
  roots: string[];
  createdAt: number;
  scan: ScanState;
}

export interface IdentifyItem {
  kind: "movie" | "series" | "album";
  id: string;
  title: string;
  year: number | null;
  hint: string | null;
}

export interface SearchHit {
  kind: "movie" | "series" | "album" | "artist";
  id: string;
  title: string;
  subtitle: string | null;
  posterPath: string | null;
}

export interface TmdbCandidate {
  tmdbId: number;
  title: string;
  year: number | null;
  overview: string | null;
  posterPath: string | null;
}

export interface MusicCandidate {
  mbid: string;
  title: string;
  artist: string;
  year: number | null;
}

export interface TranscodeStatus {
  state: "running" | "ready" | "error";
  seconds: number;
  duration: number | null;
  progress: number | null;
  playlist: boolean;
  error: string | null;
}

export function transcodePlaybackReady(
  status: Pick<TranscodeStatus, "state" | "seconds" | "playlist">,
  resumeSeconds: number,
) {
  if (!status.playlist || status.state === "error") return false;
  if (status.state === "ready") return true;
  if (resumeSeconds <= 5) return true;
  return status.seconds >= resumeSeconds + 4;
}

export interface PlaybackView {
  fileId: string;
  title: string;
  subtitle: string | null;
  backdropPath: string | null;
  kind: "movie" | "episode" | "track";
  plan: PlaybackPlan;
  subtitles: SubtitleTrack[];
  selectedSubtitleId: string | null;
  resumeSeconds: number;
  duration: number | null;
}

export interface AppSetup {
  tokenRequired: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
}

export interface AppSettings {
  tmdbConfigured: boolean;
  tmdbHint: string | null;
  bindHost: string;
  tokenRequired: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
  subtitleLanguage: string;
  transcodeCacheGb: number;
  transcodeCacheBytes: number;
}

export const LANGUAGE_NAMES: Record<string, { ro: string; en: string }> = {
  ro: { ro: "Română", en: "Romanian" },
  en: { ro: "Engleză", en: "English" },
  fr: { ro: "Franceză", en: "French" },
  de: { ro: "Germană", en: "German" },
  es: { ro: "Spaniolă", en: "Spanish" },
  it: { ro: "Italiană", en: "Italian" },
  hu: { ro: "Maghiară", en: "Hungarian" },
  pl: { ro: "Poloneză", en: "Polish" },
};
