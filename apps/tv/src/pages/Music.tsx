import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { AlbumDetail, AlbumSummary, ArtistDetail, ArtistSummary, MusicCandidate, TrackClip } from "@kinora/shared";
import { api } from "../api";
import { useAudio } from "../audio";
import { Focusable } from "../components/Focusable";
import { PosterCard } from "../components/Poster";
import { useLocale } from "../i18n";
import { formatClock, imageUrl } from "../media";

function firstTrackTitle(tracks: { title: string }[]) {
  return tracks[0]?.title?.trim() || "";
}

function unknownArtist(name: string | null | undefined) {
  return !name || name === "Necunoscut" || name === "Unknown";
}

export function MusicPage() {
  const { t } = useLocale();
  const [albums, setAlbums] = useState<AlbumSummary[] | null>(null);
  const [artists, setArtists] = useState<ArtistSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api<AlbumSummary[]>("/api/albums"), api<ArtistSummary[]>("/api/artists")])
      .then(([albumList, artistList]) => {
        setAlbums(albumList);
        setArtists(artistList);
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  if (error) return <p className="state-message">{t.error}: {error}</p>;
  if (!albums || !artists) return <p className="state-message">{t.loading}</p>;

  return (
    <div className="page music-page">
      <header className="page-head">
        <h1>{t.music}</h1>
        <p className="count">
          {albums.length} {t.albums.toLowerCase()} · {artists.length} {t.artists.toLowerCase()}
        </p>
      </header>
      {albums.length === 0 && artists.length === 0 ? <p className="hint">{t.noMusic}</p> : null}
      {albums.length > 0 ? (
        <>
          <h2 className="section-title">{t.albums}</h2>
          <div className="grid">
            {albums.map((album, index) => (
              <PosterCard
                key={album.id}
                focusKey={`album-${album.id}`}
                focusOnMount={index === 0}
                to={`/music/albums/${album.id}`}
                title={album.title}
                meta={album.artistName}
                src={album.coverPath}
                badge={album.matched ? null : t.unmatched}
              />
            ))}
          </div>
        </>
      ) : null}
      {artists.length > 0 ? (
        <>
          <h2 className="section-title">{t.artists}</h2>
          <div className="grid">
            {artists.map((artist) => (
              <PosterCard
                key={artist.id}
                focusKey={`artist-${artist.id}`}
                to={`/music/artists/${artist.id}`}
                title={artist.name}
                meta={null}
                src={null}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function AlbumDetailPage() {
  const { id } = useParams();
  const { t } = useLocale();
  const navigate = useNavigate();
  const audio = useAudio();
  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [clips, setClips] = useState<Record<string, TrackClip>>({});
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setError(null);
      })
      .catch((reason: Error) => {
        if (live) setError(reason.message);
      });
    api<{ clips: Record<string, TrackClip> }>(`/api/albums/${id}/clips`)
      .then((result) => {
        if (live) setClips(result.clips);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id]);

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

  useEffect(() => {
    if (!album || Object.keys(clips).length === 0) return;
    const byFileId: Record<string, TrackClip | null> = {};
    for (const track of album.tracks) byFileId[track.fileId] = clips[track.id] ?? null;
    audio.attachClips(byFileId);
  }, [album, clips, audio]);

  if (error) return <p className="state-message">{t.error}: {error}</p>;
  if (!album) return <p className="state-message">{t.loading}</p>;

  const cover = imageUrl(album.coverPath, "w500");
  const facts = [album.genres.join(", "), album.rating != null ? `${album.rating.toFixed(1)} ${t.musicRating}` : null]
    .filter(Boolean)
    .join(" · ");
  const hasMeta = Boolean(album.recordLabel || album.styles.length);

  function playFrom(trackId: string) {
    const track = album!.tracks.find((entry) => entry.id === trackId) ?? album!.tracks[0];
    if (!track) return;
    const queue = album!.tracks.map((entry) => ({
      fileId: entry.fileId,
      title: entry.title,
      artist: album!.artistName,
      cover: album!.coverPath,
      clip: clips[entry.id] ?? null,
    }));
    audio.play(
      {
        fileId: track.fileId,
        title: track.title,
        artist: album!.artistName,
        cover: album!.coverPath,
        clip: clips[track.id] ?? null,
      },
      queue,
    );
  }

  return (
    <div className="page album-page">
      <article className="album-dossier">
        {cover ? <div className="album-cover-lg" style={{ backgroundImage: `url(${cover})` }} /> : <div className="album-cover-lg empty-cover" />}
        <div className="album-copy">
          <p className="eyebrow">{t.albums}</p>
          <h1>
            {album.title}
            {album.year ? <span> {album.year}</span> : null}
          </h1>
          <p className="meta">
            <Focusable className="text-link" focusKey="album-artist" onEnterPress={() => navigate(`/music/artists/${album.artistId}`)}>
              {album.artistName}
            </Focusable>
          </p>
          {facts ? <p className="detail-rating">{facts}</p> : null}
          {!album.matched ? <p className="hint">{t.unmatched}</p> : null}
          {album.overview ? (
            <div className="album-overview">
              <p className={overviewOpen ? "lede detail-overview" : "lede detail-overview overview-clamp"}>{album.overview}</p>
              {album.overview.length > 280 ? (
                <Focusable className="chip" focusKey="album-overview-toggle" onEnterPress={() => setOverviewOpen((open) => !open)}>
                  {overviewOpen ? t.showLess : t.showMore}
                </Focusable>
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
          <div className="hero-actions">
            {album.tracks[0] ? (
              <Focusable className="btn primary" focusKey="album-play" focusOnMount onEnterPress={() => playFrom(album.tracks[0]!.id)}>
                {t.play}
              </Focusable>
            ) : (
              <p className="hint">{t.noFile}</p>
            )}
            <Focusable className="btn" focusKey="album-match" onEnterPress={() => setMatchOpen((open) => !open)}>
              {t.tabMatch}
            </Focusable>
            <Focusable className="btn" focusKey="album-back" onEnterPress={() => navigate(-1)}>
              {t.back}
            </Focusable>
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
        </div>
      </article>

      <h2 className="section-title">{t.tracksCount.replace("{count}", String(album.tracks.length))}</h2>
      <div className="episode-list track-list">
        {album.tracks.map((track, index) => {
          const active = audio.current?.fileId === track.fileId;
          const clip = clips[track.id] ?? null;
          return (
            <Focusable
              key={track.id}
              className={`episode track-row${active ? " is-playing" : ""}`}
              focusKey={`track-${track.id}`}
              onEnterPress={() => playFrom(track.id)}
            >
              <strong>{track.trackNumber ?? index + 1}</strong>
              <span>
                {track.title}
                {clip?.kind === "video" ? <small className="track-clip-badge">{t.videoClip}</small> : null}
              </span>
              <em>{formatClock(track.duration)}</em>
            </Focusable>
          );
        })}
      </div>
    </div>
  );
}

function AlbumMatchPanel(props: {
  albumId: string;
  artist: string;
  title: string;
  trackHint?: string | null;
  onMatched: (album: AlbumDetail) => void;
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
    <div className="album-match">
      <p className="hint">{t.musicMatchHint}</p>
      <div className="music-match-fields">
        <label>
          <span>{t.musicMatchArtist}</span>
          <input value={artist} onChange={(event) => setArtist(event.target.value)} disabled={busy} />
        </label>
        <label>
          <span>{t.musicMatchAlbum}</span>
          <input value={albumTitle} onChange={(event) => setAlbumTitle(event.target.value)} disabled={busy} />
        </label>
        <label>
          <span>{t.musicMatchTrack}</span>
          <input value={track} onChange={(event) => setTrack(event.target.value)} disabled={busy} />
        </label>
        <Focusable className="btn" focusKey="album-match-lookup" onEnterPress={() => void lookup()}>
          {searching ? t.matching : t.lookup}
        </Focusable>
      </div>
      {error ? <p className="danger">{error}</p> : null}
      {note ? <p className="ok">{note}</p> : null}
      {!error && !searching && searched && releases.length === 0 ? <p className="hint">{t.musicMatchEmpty}</p> : null}
      <div className="episode-list match-candidates">
        {releases.map((release, index) => (
          <Focusable
            key={release.mbid}
            className="episode"
            focusKey={`match-${release.mbid}`}
            focusOnMount={index === 0}
            onEnterPress={() => void choose(release.mbid)}
          >
            <strong>{release.year ?? "—"}</strong>
            <span>
              {release.artist} — {release.title}
            </span>
            <em>{choosing === release.mbid ? t.matching : t.choose}</em>
          </Focusable>
        ))}
      </div>
    </div>
  );
}

export function ArtistDetailPage() {
  const { id } = useParams();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [artist, setArtist] = useState<ArtistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api<ArtistDetail>(`/api/artists/${id}`)
      .then(setArtist)
      .catch((reason: Error) => setError(reason.message));
  }, [id]);

  if (error) return <p className="state-message">{t.error}: {error}</p>;
  if (!artist) return <p className="state-message">{t.loading}</p>;

  return (
    <div className="page">
      <header className="page-head">
        <h1>{artist.name}</h1>
        <p className="count">
          {artist.albums.length} {t.albums.toLowerCase()}
        </p>
      </header>
      <div className="hero-actions" style={{ marginBottom: "1rem" }}>
        <Focusable className="btn" focusKey="artist-back" focusOnMount={artist.albums.length === 0} onEnterPress={() => navigate(-1)}>
          {t.back}
        </Focusable>
      </div>
      <div className="grid">
        {artist.albums.map((album, index) => (
          <PosterCard
            key={album.id}
            focusKey={`artist-album-${album.id}`}
            focusOnMount={index === 0}
            to={`/music/albums/${album.id}`}
            title={album.title}
            meta={album.year ? String(album.year) : null}
            src={album.coverPath}
            badge={album.matched ? null : t.unmatched}
          />
        ))}
      </div>
    </div>
  );
}
