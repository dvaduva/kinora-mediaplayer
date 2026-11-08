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

/** A TMDB title that is not (necessarily) in the library, fetched live for its detail page. */
export interface ExternalTitleDetail {
  mediaType: "movie" | "tv";
  tmdbId: number;
  imdbId: string | null;
  /** Set when the library has this title; the client then opens the library page instead. */
  localId: string | null;
  title: string;
  originalTitle: string | null;
  tagline: string | null;
  overview: string | null;
  year: number | null;
  releaseDate: string | null;
  runtime: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  rating: number | null;
  genres: string[];
  directors: string[];
  writers: string[];
  creators: string[];
  cast: CastMember[];
  stills: string[];
  similar: SimilarTitle[];
  /** Trailers first, then teasers and clips. */
  videos: Trailer[];
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
  genres: string[];
  /** Hand-set sort title; null sorts by the title. */
  sortTitle: string | null;
  /** The profile's own star rating (0.5–5), if any. */
  userRating: number | null;
  watchStatus: WatchStatus;
  /** True when the status was set by hand rather than derived from playback. */
  watchStatusManual: boolean;
}

/** Movie fields the edit dialog can change; each can be locked against TMDB re-matching. */
export const MOVIE_EDIT_FIELDS = [
  "title",
  "sortTitle",
  "originalTitle",
  "edition",
  "year",
  "releaseDate",
  "tagline",
  "overview",
  "genres",
  "directors",
  "writers",
  "posterPath",
  "backdropPath",
  "imdbId",
  "rtSlug",
] as const;

export type MovieEditField = (typeof MOVIE_EDIT_FIELDS)[number];

export interface MovieEdit {
  title?: string;
  sortTitle?: string | null;
  originalTitle?: string | null;
  edition?: string | null;
  year?: number | null;
  releaseDate?: string | null;
  tagline?: string | null;
  overview?: string | null;
  genres?: string[];
  directors?: string[];
  writers?: string[];
  posterPath?: string | null;
  backdropPath?: string | null;
  imdbId?: string | null;
  rtSlug?: string | null;
  /** Replaces the whole lock list when present. */
  locked?: MovieEditField[];
}

export function isMovieEditField(value: unknown): value is MovieEditField {
  return typeof value === "string" && (MOVIE_EDIT_FIELDS as readonly string[]).includes(value);
}

/** Lock list stored as JSON; unknown or malformed entries are dropped. */
export function parseLockedFields(json: string | null | undefined): MovieEditField[] {
  try {
    const value: unknown = JSON.parse(json || "[]");
    return Array.isArray(value) ? value.filter(isMovieEditField) : [];
  } catch {
    return [];
  }
}

/** Posters and backdrops TMDB offers for a movie, for the edit dialog. */
export interface MovieArtwork {
  posters: ArtworkOption[];
  backdrops: ArtworkOption[];
}

export interface ArtworkOption {
  path: string;
  language: string | null;
  width: number;
  height: number;
  votes: number;
}

export interface ExternalRatings {
  imdb: { rating: number; votes: number | null; url: string } | null;
  rottenTomatoes: {
    url: string;
    /** Tomatometer, percent of positive critic reviews. */
    critics: { score: number; certified: boolean; rotten: boolean; count: number | null } | null;
    /** Popcornmeter, percent of positive audience ratings. */
    audience: { score: number; rotten: boolean; count: string | null } | null;
    consensus: string | null;
  } | null;
  metacritic: { score: number; url: string | null } | null;
  tmdb: { rating: number; url: string } | null;
  /** Epoch milliseconds of the last successful lookup; null when nothing was fetched yet. */
  fetchedAt: number | null;
  /** True when no OMDb key is configured, so IMDb and Metacritic scores cannot be looked up. */
  omdbMissing: boolean;
  /**
   * True when the Rotten Tomatoes page was found but holds no scorecard Kinora recognizes,
   * which usually means the site changed its layout. The last good scores are kept.
   */
  rtUnreadable: boolean;
}

export type ReviewSource = "own" | "rottentomatoes" | "tmdb";

export interface MovieReview {
  id: string;
  source: ReviewSource;
  author: string;
  avatarUrl: string | null;
  /** Stars out of 5, half steps. */
  rating: number | null;
  body: string;
  /** ISO date or a display date from the source. */
  date: string | null;
  url: string | null;
  verified?: boolean;
}

export interface OwnReview {
  rating: number | null;
  body: string | null;
  updatedAt: number;
}

export interface MovieReviews {
  own: OwnReview | null;
  reviews: MovieReview[];
}

export function isStarRating(value: unknown): value is number {
  return typeof value === "number" && value >= 0.5 && value <= 5 && Number.isInteger(value * 2);
}

export interface MovieDetail extends MovieSummary {
  sortTitle: string | null;
  edition: string | null;
  rtSlug: string | null;
  locked: MovieEditField[];
  originalTitle: string | null;
  overview: string | null;
  tagline: string | null;
  backdropPath: string | null;
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

/** A YouTube link for a track: an official music video, or the track's own upload. */
export interface TrackClip {
  key: string;
  kind: "video" | "audio";
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
  subtitleStyle: SubtitleStyle;
  /** Seconds the captions are shifted for this file; positive shows them later. */
  subtitleDelay: number;
}

export interface SubtitleStyle {
  /** Percentage of the player's default caption size. */
  size: number;
  /** Hex color, #rrggbb. */
  color: string;
}

export const SUBTITLE_SIZES = [75, 100, 125, 150, 175, 200] as const;
export const SUBTITLE_DELAY_LIMIT = 600;

export function isSubtitleColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export function isSubtitleSize(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 50 && value <= 300;
}

export interface AppSetup {
  tokenRequired: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
}

export interface AppSettings {
  tmdbConfigured: boolean;
  tmdbHint: string | null;
  omdbConfigured: boolean;
  omdbHint: string | null;
  bindHost: string;
  tokenRequired: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
  subtitleLanguage: string;
  subtitleStyle: SubtitleStyle;
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

/** One level of the server's file system, for picking library folders. */
export interface DirectoryListing {
  /** The folder shown, or null for the top level (drives on Windows, "/" elsewhere). */
  path: string | null;
  /** The folder one level up; null at the top level, and "" when the parent is the top level itself. */
  parent: string | null;
  entries: { name: string; path: string }[];
}
