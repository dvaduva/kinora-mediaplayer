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
  overview: string | null;
  genres: string[];
  styles: string[];
  recordLabel: string | null;
  rating: number | null;
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
  /** First track title for albums — improves MusicBrainz search with artist+song. */
  trackHint?: string | null;
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
  /** Language of TMDB titles, overviews and genres. */
  metadataLanguage: "en" | "ro";
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

/* Live TV ---------------------------------------------------------------- */

export type ChannelKind = "virtual" | "iptv";

/** Sequential plays episodes in order and rotates between series; shuffle uses the channel's seed. */
export type ChannelOrder = "sequential" | "shuffle";

export type ChannelSourceType = "genre" | "series" | "movie" | "library" | "decade" | "person" | "artist" | "album" | "musicGenre";

export const CHANNEL_SOURCE_TYPES: readonly ChannelSourceType[] = ["genre", "series", "movie", "library", "decade", "person", "artist", "album", "musicGenre"];

/** Rules that pick music tracks rather than movies and episodes. */
export const MUSIC_SOURCE_TYPES: readonly ChannelSourceType[] = ["artist", "album", "musicGenre"];

/**
 * Categories derived from a channel's rules: a genre name, or one of these tokens, which clients
 * translate. A manual override can be any text.
 */
export const CATEGORY_MOVIES = "@movies";
export const CATEGORY_SERIES = "@series";
export const CATEGORY_MUSIC = "@music";

export function isChannelSourceType(value: unknown): value is ChannelSourceType {
  return typeof value === "string" && (CHANNEL_SOURCE_TYPES as readonly string[]).includes(value);
}

/** One rule of a virtual channel; a channel plays everything any of its rules matches. */
export interface ChannelSource {
  type: ChannelSourceType;
  /**
   * Genre name, series or movie id, library id, decade start year ("1990"), person name, artist id,
   * album id or music genre.
   */
  value: string;
}

export interface LiveChannel {
  id: string;
  kind: ChannelKind;
  number: number;
  name: string;
  /** Uploaded logo; null means the client draws one from the name. */
  logoUrl: string | null;
  orderMode: ChannelOrder;
  enabled: boolean;
  sources: ChannelSource[];
  /** No program from now on: the rules match nothing playable. Such channels stay out of the guide. */
  empty: boolean;
  /** The category shown in the guide: the override when set, otherwise derived from the rules. */
  category: string | null;
  categoryOverride: string | null;
  /** Generated by the server (one per genre, per large series, per music genre). */
  auto: boolean;
  /** Plays music tracks, so the player shows a visual instead of a picture. */
  music: boolean;
  /** Per profile. */
  favorite: boolean;
  /** Set on channels imported from an IPTV playlist. */
  iptv: LiveChannelIptv | null;
  /** Programs start on this grid in minutes (30: :00 and :30; 60: the hour); 0 plays them back to back. */
  alignMinutes: ChannelAlign;
  /** What airs in the gap before an aligned start. */
  filler: ChannelFiller;
}

export const CHANNEL_ALIGNS = [0, 30, 60] as const;
export type ChannelAlign = (typeof CHANNEL_ALIGNS)[number];
/** media: trailers and music clips (with the "Up next" card over them); upnext: the card alone. */
export type ChannelFiller = "media" | "upnext";

export function isChannelAlign(value: unknown): value is ChannelAlign {
  return typeof value === "number" && (CHANNEL_ALIGNS as readonly number[]).includes(value);
}

/** How an IPTV channel found its guide: chosen by hand, by tvg-id, or by name. */
export type EpgMatchKind = "manual" | "tvg-id" | "name";

export interface LiveChannelIptv {
  sourceId: string;
  sourceName: string;
  /** group-title from the playlist; the category unless overridden. */
  group: string | null;
  tvgId: string | null;
  /** Guide channel chosen by hand; null matches automatically. */
  epgChannel: string | null;
  /** How the last refresh matched the guide; null when the channel has none. */
  epgMatch: EpgMatchKind | null;
  /** Dropped from the playlist on the last refresh. */
  missing: boolean;
}

export type IptvSourceStatus = "pending" | "refreshing" | "ok" | "error";

/** An M3U playlist with its optional XMLTV guide. */
export interface IptvSource {
  id: string;
  name: string;
  m3uUrl: string;
  xmltvUrl: string | null;
  /** Guide address the playlist announces itself, used when `xmltvUrl` is empty. */
  playlistEpgUrl: string | null;
  refreshedAt: number | null;
  status: IptvSourceStatus;
  error: string | null;
  /** The playlist loaded but its guide did not. */
  epgError: string | null;
  channelCount: number;
  /** Channels with a guide. */
  matchedCount: number;
  /** Channels the guide lists, offered for matching by hand. */
  guideChannelCount: number;
}

export interface IptvSourceInput {
  name: string;
  /** http(s) address or a local file path. */
  m3uUrl: string;
  xmltvUrl: string | null;
}

/**
 * Public playlists offered with one click: iptv-org lists streams the broadcasters themselves make
 * freely available. The guide comes from iptv-epg.org, which uses the same channel ids.
 */
export interface IptvPreset {
  id: string;
  /** Country code; clients show the name in their own language. */
  country: string;
  m3uUrl: string;
  xmltvUrl: string | null;
}

export const IPTV_PRESETS: readonly IptvPreset[] = [
  { id: "ro", country: "RO", m3uUrl: "https://iptv-org.github.io/iptv/countries/ro.m3u", xmltvUrl: "https://iptv-epg.org/files/epg-ro.xml.gz" },
  // No Moldovan guide is published; many channels of the list are Romanian and match the Romanian guide.
  { id: "md", country: "MD", m3uUrl: "https://iptv-org.github.io/iptv/countries/md.m3u", xmltvUrl: "https://iptv-epg.org/files/epg-ro.xml.gz" },
];

/** A channel of a source's XMLTV guide. */
export interface GuideChannelOption {
  id: string;
  name: string;
}

export interface ChannelInput {
  name: string;
  number: number;
  orderMode: ChannelOrder;
  enabled: boolean;
  sources: ChannelSource[];
  /** Null or empty derives the category from the rules. */
  categoryOverride?: string | null;
  /** Defaults to 0 (no alignment) and "media". */
  alignMinutes?: ChannelAlign;
  filler?: ChannelFiller;
}

/** Live TV options that apply to the whole server. */
export interface LiveTvSettings {
  /** Keep one channel per genre and per large series (and per music genre). */
  autoChannels: boolean;
  /** A series needs at least this many playable episodes for a channel of its own. */
  autoSeriesMinEpisodes: number;
  /** Convert the next program of a channel someone watches a few minutes before it starts. */
  prepareNext: boolean;
}

/** filler: the gap before an aligned start on a virtual channel; it has no file. */
export type ProgramItemType = "movie" | "episode" | "track" | "external" | "filler";

export interface ChannelProgram {
  id: number;
  channelId: string;
  /** Epoch milliseconds. */
  start: number;
  end: number;
  itemType: ProgramItemType;
  itemId: string | null;
  fileId: string | null;
  title: string;
  /** e.g. "S1 · E4 · Pilot" for an episode, the year for a movie. */
  subtitle: string | null;
  description: string | null;
  /** TMDB image path or "cover:" path, as used by the rest of the library. */
  image: string | null;
  /** Library page of the title ("/movies/…", "/series/…"), when it still exists. */
  libraryPath: string | null;
}

export interface LiveGuide {
  /** Server clock, epoch milliseconds, so clients can correct their own. */
  now: number;
  from: number;
  to: number;
  channels: LiveChannel[];
  programs: ChannelProgram[];
}

export interface ChannelNow {
  now: number;
  channel: LiveChannel;
  current: ChannelProgram | null;
  next: ChannelProgram | null;
  /** Seconds into the current program. */
  offset: number;
}

/** How a client starts a channel: which stream, and where in it "live" is. */
export interface LivePlayback {
  now: number;
  channel: LiveChannel;
  /** Null only for an IPTV channel without a guide entry for now. */
  program: ChannelProgram | null;
  next: ChannelProgram | null;
  /** Seconds into the program at `now`. */
  offset: number;
  /**
   * direct: a library file; hls: a conversion of one; live: an IPTV channel relayed by the server,
   * played at its live edge and not tied to the program's timeline.
   */
  mode: "direct" | "hls" | "live" | "filler";
  /** Empty for a filler, which the client draws itself. */
  src: string;
  /** Transcode status to poll before an HLS stream can start; null for direct play. */
  statusUrl: string | null;
  /** Program time (seconds) at which the stream's own timeline starts; 0 for direct play. */
  mediaStart: number;
  /** Set in filler mode: what to show until the next program starts. */
  filler: LiveFiller | null;
}

/** YouTube clips played during a filler, in order; empty shows the "Up next" card alone. */
export interface LiveFiller {
  kind: ChannelFiller;
  videos: { key: string; title: string; kind: "trailer" | "clip" }[];
}

/** Choices offered by the channel form. */
export interface ChannelOptions {
  genres: string[];
  series: { id: string; title: string; year: number | null }[];
  movies: { id: string; title: string; year: number | null }[];
  libraries: { id: string; name: string; type: LibraryType }[];
  decades: number[];
  people: string[];
  artists: { id: string; name: string }[];
  albums: { id: string; title: string; artist: string; year: number | null }[];
  musicGenres: string[];
  /** Categories already in use, offered when overriding one. */
  categories: string[];
  nextNumber: number;
}

/** Stable color for a generated channel logo, derived from its name. */
export function channelColor(name: string) {
  let hash = 0;
  for (const char of name.trim().toLowerCase()) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return `hsl(${hash % 360} 45% 34%)`;
}

/** Up to three letters for a generated channel logo: initials of the words, or the start of a single word. */
export function channelInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "TV";
  if (words.length === 1) return words[0]!.slice(0, 3).toUpperCase();
  return words
    .slice(0, 3)
    .map((word) => [...word][0] ?? "")
    .join("")
    .toUpperCase();
}


/**
 * The category a channel's rules suggest: the first genre rule; music for channels made only of
 * music rules (or music libraries); series or movies when every rule points at one kind; otherwise
 * none, and the channel shows only under "All".
 */
export function deriveCategory(sources: ChannelSource[], libraryType: (id: string) => LibraryType | undefined): string | null {
  if (sources.length === 0) return null;
  const genre = sources.find((source) => source.type === "genre");
  if (genre) return genre.value;
  const kinds = new Set(
    sources.map((source) => {
      if (MUSIC_SOURCE_TYPES.includes(source.type)) return CATEGORY_MUSIC;
      if (source.type === "series") return CATEGORY_SERIES;
      if (source.type === "movie") return CATEGORY_MOVIES;
      if (source.type === "library") {
        const type = libraryType(source.value);
        return type === "music" ? CATEGORY_MUSIC : type === "series" ? CATEGORY_SERIES : type === "movie" ? CATEGORY_MOVIES : null;
      }
      return null;
    }),
  );
  if (kinds.size !== 1) return null;
  return [...kinds][0] ?? null;
}

/** Whether a channel's rules pick music only: music rules and music libraries. */
export function isMusicChannel(sources: ChannelSource[], libraryType: (id: string) => LibraryType | undefined) {
  return (
    sources.length > 0 &&
    sources.every((source) => MUSIC_SOURCE_TYPES.includes(source.type) || (source.type === "library" && libraryType(source.value) === "music"))
  );
}

/**
 * Version of the HTTP API the TV shells and apps talk to. Bumped only on breaking changes;
 * a shell refuses a server whose `apiVersion` it does not know.
 */
export const API_VERSION = 1;

/** `GET /api/health`: open to anyone on the network, so it carries nothing sensitive. */
export interface HealthInfo {
  name: "kinora";
  apiVersion: number;
  serverVersion: string;
}

export const DEVICE_PLATFORMS = ["tizen", "webos", "android", "browser"] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export function isDevicePlatform(value: unknown): value is DevicePlatform {
  return typeof value === "string" && (DEVICE_PLATFORMS as readonly string[]).includes(value);
}

/** A paired device as Settings → Devices shows it. */
export interface DeviceView {
  id: string;
  name: string;
  platform: DevicePlatform;
  createdAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
}

/** `POST /api/pair`: the code the TV shows, and the secret only it knows, needed to collect the token. */
export interface PairStart {
  code: string;
  secret: string;
  expiresAt: number;
}

/** `GET /api/pair/:code?secret=…`: the TV polls until the code is approved; the token is handed out once. */
export type PairPoll =
  | { status: "pending"; expiresAt: number }
  | { status: "approved"; token: string; device: DeviceView }
  | { status: "expired" };

/** Six characters without look-alikes (no 0/O, 1/I/L), shown on the TV and typed on the phone. */
export const PAIR_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const PAIR_CODE_LENGTH = 6;

/** Upper-cases a typed code and drops spaces and dashes; null when it cannot be a pairing code. */
export function normalizePairCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.toUpperCase().replace(/[\s-]+/g, "");
  if (code.length !== PAIR_CODE_LENGTH) return null;
  for (const char of code) if (!PAIR_CODE_ALPHABET.includes(char)) return null;
  return code;
}

/** Romanian for `ro-*` (and `mo`), English otherwise. The manual choice, when saved, wins over this. */
export function detectLocale(language: string | null | undefined): "ro" | "en" {
  return /^(ro|mo)\b/i.test(language ?? "") ? "ro" : "en";
}

/**
 * The TV shell loads the UI as `<server>/tv/#shell=1&token=…` in a frame. The UI tells the shell,
 * through `postMessage`, what only the shell can do: leave the app, or go back to pairing and the server list.
 */
export const SHELL_MESSAGE_SOURCE = "kinora-tv";
export type ShellMessageType = "ready" | "exit" | "unauthorized" | "change-server";
export interface ShellMessage {
  source: typeof SHELL_MESSAGE_SOURCE;
  type: ShellMessageType;
}

export function isShellMessage(value: unknown): value is ShellMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return message.source === SHELL_MESSAGE_SOURCE && ["ready", "exit", "unauthorized", "change-server"].includes(String(message.type));
}
