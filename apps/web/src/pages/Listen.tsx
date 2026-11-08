import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { AlbumDetail, ArtistDetail, TrackClip, IdentifyItem, MusicCandidate, TmdbCandidate } from "@kinora/shared";
import { api } from "../api";
import { useCached } from "../cache";
import { useLocale } from "../i18n";
import { formatClock, imageUrl } from "../media";
import { PosterLink, SkeletonBlocks } from "../ui";
import { useAudio } from "../audio";

function firstTrackTitle(tracks: { title: string }[]) {
  return tracks[0]?.title?.trim() || "";
}

function unknownArtist(name: string | null | undefined) {
  return !name || name === "Necunoscut" || name === "Unknown";
}

export function AlbumPage() {
  const { id } = useParams();
  const { t } = useLocale();
  const audio = useAudio();
  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [clips, setClips] = useState<Record<string, TrackClip>>({});
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  useEffect(() => {
    if (!id) return;
    setClips({});
    setOverviewOpen(false);
    setMatchOpen(false);
    let live = true;
    api<AlbumDetail>(`/api/albums/${id}`)
      .then((data) => {
        if (!live) return;
        setAlbum(data);
        setMatchOpen(!data.matched);
      })
      .catch(() => {
        if (live) setAlbum(null);
      });
    // Clips come from MusicBrainz and can take a few seconds the first time; the list works without them.
    api<{ clips: Record<string, TrackClip> }>(`/api/albums/${id}/clips`)
      .then((result) => {
        if (live) setClips(result.clips);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id]);
  // Metadata enrichment runs in the background on first open; refresh once it has had time to land.
  useEffect(() => {
    if (!id || !album?.matched) return;
    if (album.overview || album.genres.length > 0 || album.recordLabel || album.styles.length > 0) return;
    let live = true;
    const timer = window.setTimeout(() => {
      api<AlbumDetail>(`/api/albums/${id}`)
        .then((data) => {
          if (live) setAlbum(data);
        })
        .catch(() => undefined);
    }, 3500);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [id, album]);
  // If the user started a track before MusicBrainz clips arrived, attach them for the Spotify-style film.
  useEffect(() => {
    if (!album || Object.keys(clips).length === 0) return;
    const byFileId: Record<string, TrackClip | null> = {};
    for (const track of album.tracks) byFileId[track.fileId] = clips[track.id] ?? null;
    audio.attachClips(byFileId);
  }, [album, clips, audio]);
  if (!album) return <p className="muted">{t.albums}</p>;
  const facts = [
    album.genres.join(", "),
    album.rating != null ? `${album.rating.toFixed(1)} ${t.musicRating}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const hasMeta = Boolean(album.recordLabel || album.styles.length);
  return (
    <article className="dossier-grid album-dossier">
      {album.coverPath ? <img className="cover" src={imageUrl(album.coverPath, "w342") ?? ""} alt="" /> : <div className="cover poster empty" />}
      <div>
        <p className="crumb"><Link to={`/music/artists/${album.artistId}`}>{album.artistName}</Link></p>
        <h1>{album.title} {album.year ? <span className="year">{album.year}</span> : null}</h1>
        <div className="actions">
          {!album.matched ? <p className="muted" style={{ margin: 0 }}>{t.unmatched}</p> : null}
          <button className="text-button" type="button" onClick={() => setMatchOpen((open) => !open)}>
            {t.tabMatch}
          </button>
        </div>
        {matchOpen ? (
          <AlbumMatchPanel
            albumId={album.id}
            artist={album.artistName}
            title={album.title}
            trackHint={firstTrackTitle(album.tracks)}
            onMatched={(updated) => {
              setAlbum(updated);
              setMatchOpen(false);
              setClips({});
              api<{ clips: Record<string, TrackClip> }>(`/api/albums/${updated.id}/clips`)
                .then((result) => setClips(result.clips))
                .catch(() => undefined);
            }}
          />
        ) : null}
        {facts ? <p className="facts">{facts}</p> : null}
        {album.overview ? (
          <div className="album-overview">
            <p className={overviewOpen ? "overview" : "overview overview-clamp"}>{album.overview}</p>
            {album.overview.length > 280 ? (
              <button className="text-button" type="button" onClick={() => setOverviewOpen((open) => !open)}>
                {overviewOpen ? t.showLess : t.showMore}
              </button>
            ) : null}
          </div>
        ) : null}
        {hasMeta ? (
          <dl className="album-meta">
            {album.recordLabel ? (
              <div>
                <dt>{t.recordLabel}</dt>
                <dd>{album.recordLabel}</dd>
              </div>
            ) : null}
            {album.styles.length > 0 ? (
              <div>
                <dt>{t.style}</dt>
                <dd>{album.styles.join(", ")}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        <h2 className="track-list-heading">{t.tracksCount.replace("{count}", String(album.tracks.length))}</h2>
        <ol className="track-list">
          {album.tracks.map((track) => {
            const clip = clips[track.id] ?? null;
            return (
              <li key={track.id}>
                <span className="muted">{track.trackNumber ?? ""}</span>
                <button
                  type="button"
                  onClick={() => {
                    const queue = album.tracks.map((entry) => ({
                      fileId: entry.fileId,
                      title: entry.title,
                      artist: album.artistName,
                      cover: album.coverPath,
                      clip: clips[entry.id] ?? null,
                    }));
                    audio.play({ fileId: track.fileId, title: track.title, artist: album.artistName, cover: album.coverPath, clip }, queue);
                  }}
                >
                  {track.title}
                </button>
                <span className="muted">{formatClock(track.duration)}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </article>
  );
}

export function ArtistPage() {
  const { id } = useParams();
  const [artist, setArtist] = useState<ArtistDetail | null>(null);
  useEffect(() => {
    if (!id) return;
    api<ArtistDetail>(`/api/artists/${id}`).then(setArtist).catch(() => setArtist(null));
  }, [id]);
  if (!artist) return null;
  return (
    <>
      <h1>{artist.name}</h1>
      <div className="grid">
        {artist.albums.map((album) => (
          <PosterLink key={album.id} to={`/music/albums/${album.id}`} src={album.coverPath} title={album.title} meta={album.year ? String(album.year) : null} />
        ))}
      </div>
    </>
  );
}

export function IdentifyPage() {
  const { t } = useLocale();
  const [items, setItems] = useCached<IdentifyItem[]>("/api/identify", []);
  return (
    <>
      <h1>{t.identify}</h1>
      <p className="lede">{t.identifyHint}</p>
      {items === undefined ? <SkeletonBlocks /> : null}
      {items?.length === 0 ? <p className="muted">{t.nothingToIdentify}</p> : null}
      {items?.map((item) => (
        <IdentifyRow key={`${item.kind}-${item.id}`} item={item} onDone={(id) => setItems((current) => current.filter((entry) => entry.id !== id))} />
      ))}
    </>
  );
}

function identifyQuery(item: IdentifyItem) {
  return item.year ? `${item.title} ${item.year}` : item.title;
}

function tmdbError(reason: unknown, t: { tmdbMissing: string; tmdbUnreachable: string }) {
  const code = reason instanceof Error ? reason.message : "error";
  if (code === "tmdb_not_configured") return t.tmdbMissing;
  if (code === "tmdb_unreachable" || code === "tmdb_failed") return t.tmdbUnreachable;
  return code;
}

function AlbumMatchPanel(props: {
  albumId: string;
  artist: string;
  title: string;
  trackHint?: string | null;
  onMatched: (album: AlbumDetail) => void;
  /** When true, hide the applied-note chrome used on the album page. */
  compact?: boolean;
}) {
  const { t } = useLocale();
  const [artist, setArtist] = useState(() => (unknownArtist(props.artist) ? "" : props.artist));
  const [albumTitle, setAlbumTitle] = useState(props.title);
  const [track, setTrack] = useState(props.trackHint ?? "");
  const [releases, setReleases] = useState<MusicCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [choosing, setChoosing] = useState<string | null>(null);

  useEffect(() => {
    setArtist(unknownArtist(props.artist) ? "" : props.artist);
    setAlbumTitle(props.title);
    setTrack(props.trackHint ?? "");
    setReleases([]);
    setError(null);
    setNote(null);
    setSearched(false);
  }, [props.albumId, props.artist, props.title, props.trackHint]);

  const busy = searching || choosing != null;
  const canSearch = artist.trim() && (albumTitle.trim() || track.trim());

  async function lookup() {
    if (!canSearch) return;
    setError(null);
    setNote(null);
    setSearching(true);
    setSearched(false);
    try {
      const result = await api<{ results: MusicCandidate[] }>("/api/musicbrainz/search", {
        method: "POST",
        body: JSON.stringify({ artist: artist.trim(), album: albumTitle.trim(), track: track.trim() }),
      });
      setReleases(result.results);
      setSearched(true);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "error";
      setError(code === "musicbrainz_failed" ? t.matchFailed : code);
      setReleases([]);
    } finally {
      setSearching(false);
    }
  }

  async function choose(mbid: string) {
    if (choosing != null) return;
    setError(null);
    setNote(null);
    setChoosing(mbid);
    try {
      const updated = await api<AlbumDetail>(`/api/albums/${props.albumId}/match`, {
        method: "POST",
        body: JSON.stringify({ mbid }),
      });
      setNote(t.musicMatchApplied);
      props.onMatched(updated);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "error";
      setError(`${t.matchFailed}: ${code}`);
      setChoosing(null);
    }
  }

  return (
    <div className="edit-match album-match">
      <p className="muted">{t.musicMatchHint}</p>
      <div className="music-match-fields">
        <label>
          <span>{t.musicMatchArtist}</span>
          <input
            value={artist}
            onChange={(event) => setArtist(event.target.value)}
            disabled={busy}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void lookup();
              }
            }}
          />
        </label>
        <label>
          <span>{t.musicMatchAlbum}</span>
          <input
            value={albumTitle}
            onChange={(event) => setAlbumTitle(event.target.value)}
            disabled={busy}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void lookup();
              }
            }}
          />
        </label>
        <label>
          <span>{t.musicMatchTrack}</span>
          <input
            value={track}
            onChange={(event) => setTrack(event.target.value)}
            disabled={busy}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void lookup();
              }
            }}
          />
        </label>
        <button className="text-button" type="button" onClick={() => void lookup()} disabled={busy || !canSearch}>
          {searching ? t.matching : t.lookup}
        </button>
      </div>
      {error ? <p className="danger">{error}</p> : null}
      {note && !props.compact ? <p className="ok">{note}</p> : null}
      {!error && !searching && searched && releases.length === 0 ? <p className="muted">{t.musicMatchEmpty}</p> : null}
      <div className="candidates">
        {releases.map((release) => (
          <button
            className="candidate"
            type="button"
            key={release.mbid}
            disabled={busy}
            onClick={() => void choose(release.mbid)}
          >
            <span />
            <span>
              {release.artist} — {release.title} {release.year ? `(${release.year})` : ""}
            </span>
            <span>{choosing === release.mbid ? t.matching : t.choose}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function IdentifyRow(props: { item: IdentifyItem; onDone: (id: string) => void }) {
  const { t } = useLocale();
  const [query, setQuery] = useState(() => identifyQuery(props.item));
  const [movies, setMovies] = useState<TmdbCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [choosing, setChoosing] = useState<number | null>(null);

  if (props.item.kind === "album") {
    return (
      <section className="library-block">
        <h2>{props.item.title} {props.item.year ? <span className="year">{props.item.year}</span> : null}</h2>
        {props.item.hint ? <p className="muted">{props.item.hint}</p> : null}
        <AlbumMatchPanel
          albumId={props.item.id}
          artist={props.item.hint ?? ""}
          title={props.item.title}
          trackHint={props.item.trackHint ?? null}
          compact
          onMatched={() => props.onDone(props.item.id)}
        />
      </section>
    );
  }

  async function lookup() {
    setError(null);
    setSearching(true);
    try {
      const result = await api<{ results: TmdbCandidate[] }>("/api/tmdb/search", {
        method: "POST",
        body: JSON.stringify({ kind: props.item.kind, query, year: props.item.year }),
      });
      setMovies(result.results);
    } catch (reason) {
      setError(tmdbError(reason, t));
    } finally {
      setSearching(false);
    }
  }
  async function chooseMovie(tmdbId: number) {
    if (choosing != null) return;
    setError(null);
    setChoosing(tmdbId);
    try {
      const path = props.item.kind === "series" ? `/api/series/${props.item.id}/match` : `/api/movies/${props.item.id}/match`;
      await api(path, { method: "POST", body: JSON.stringify({ tmdbId }) });
      props.onDone(props.item.id);
    } catch (reason) {
      setError(tmdbError(reason, t));
      setChoosing(null);
    }
  }
  return (
    <section className="library-block">
      <h2>{props.item.title} {props.item.year ? <span className="year">{props.item.year}</span> : null}</h2>
      {props.item.hint ? <p className="muted">{props.item.hint}</p> : null}
      <div className="inline-form">
        <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t.lookup} disabled={searching || choosing != null} />
        <button className="text-button" type="button" onClick={() => void lookup()} disabled={searching || choosing != null}>
          {searching ? t.matching : t.lookup}
        </button>
      </div>
      {error ? <p className="danger">{error}</p> : null}
      <div className="candidates">
        {movies.map((movie) => (
          <button
            className="candidate"
            type="button"
            key={movie.tmdbId}
            disabled={choosing != null}
            onClick={() => void chooseMovie(movie.tmdbId)}
          >
            {movie.posterPath ? <img src={imageUrl(movie.posterPath, "w185") ?? ""} alt="" loading="lazy" /> : <span />}
            <span>{movie.title} {movie.year ? `(${movie.year})` : ""}</span>
            <span>{choosing === movie.tmdbId ? t.matching : t.choose}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
