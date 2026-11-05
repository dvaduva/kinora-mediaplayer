import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { AlbumDetail, ArtistDetail, IdentifyItem, MusicCandidate, TmdbCandidate } from "@kinora/shared";
import { api } from "../api";
import { useLocale } from "../i18n";
import { formatClock, imageUrl } from "../media";
import { PosterLink } from "../ui";
import { useAudio } from "../audio";

export function AlbumPage() {
  const { id } = useParams();
  const { t } = useLocale();
  const audio = useAudio();
  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  useEffect(() => {
    if (!id) return;
    api<AlbumDetail>(`/api/albums/${id}`).then(setAlbum).catch(() => setAlbum(null));
  }, [id]);
  if (!album) return <p className="muted">{t.albums}</p>;
  return (
    <article className="dossier-grid">
      {album.coverPath ? <img className="cover" src={imageUrl(album.coverPath, "w342") ?? ""} alt="" /> : <div className="cover poster empty" />}
      <div>
        <p className="crumb"><Link to={`/music/artists/${album.artistId}`}>{album.artistName}</Link></p>
        <h1>{album.title} {album.year ? <span className="year">{album.year}</span> : null}</h1>
        {!album.matched ? <p className="muted">{t.unmatched}</p> : null}
        <ol className="track-list">
          {album.tracks.map((track) => (
            <li key={track.id}>
              <span className="muted">{track.trackNumber ?? ""}</span>
              <button
                type="button"
                onClick={() => audio.play({ fileId: track.fileId, title: track.title, artist: album.artistName, cover: album.coverPath })}
              >
                {track.title}
              </button>
              <span className="muted">{formatClock(track.duration)}</span>
            </li>
          ))}
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
  const [items, setItems] = useState<IdentifyItem[]>([]);
  useEffect(() => {
    api<IdentifyItem[]>("/api/identify").then(setItems).catch(() => setItems([]));
  }, []);
  return (
    <>
      <h1>{t.identify}</h1>
      <p className="lede">{t.identifyHint}</p>
      {items.length === 0 ? <p className="muted">{t.nothingToIdentify}</p> : null}
      {items.map((item) => (
        <IdentifyRow key={`${item.kind}-${item.id}`} item={item} onDone={(id) => setItems((current) => current.filter((entry) => entry.id !== id))} />
      ))}
    </>
  );
}

function IdentifyRow(props: { item: IdentifyItem; onDone: (id: string) => void }) {
  const { t } = useLocale();
  const [query, setQuery] = useState(props.item.title);
  const [movies, setMovies] = useState<TmdbCandidate[]>([]);
  const [releases, setReleases] = useState<MusicCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  async function lookup() {
    setError(null);
    try {
      if (props.item.kind === "album") {
        const artist = props.item.hint && props.item.hint !== "Necunoscut" ? props.item.hint : query;
        const result = await api<{ results: MusicCandidate[] }>("/api/musicbrainz/search", {
          method: "POST",
          body: JSON.stringify({ artist, album: query }),
        });
        setReleases(result.results);
        setMovies([]);
      } else {
        const result = await api<{ results: TmdbCandidate[] }>("/api/tmdb/search", {
          method: "POST",
          body: JSON.stringify({ kind: props.item.kind, query, year: props.item.year }),
        });
        setMovies(result.results);
        setReleases([]);
      }
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "error";
      setError(code === "tmdb_not_configured" ? t.tmdbMissing : code);
    }
  }
  async function chooseMovie(tmdbId: number) {
    const path = props.item.kind === "series" ? `/api/series/${props.item.id}/match` : `/api/movies/${props.item.id}/match`;
    await api(path, { method: "POST", body: JSON.stringify({ tmdbId }) });
    props.onDone(props.item.id);
  }
  async function chooseAlbum(mbid: string) {
    await api(`/api/albums/${props.item.id}/match`, { method: "POST", body: JSON.stringify({ mbid }) });
    props.onDone(props.item.id);
  }
  return (
    <section className="library-block">
      <h2>{props.item.title} {props.item.year ? <span className="year">{props.item.year}</span> : null}</h2>
      {props.item.hint ? <p className="muted">{props.item.hint}</p> : null}
      <div className="inline-form">
        <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t.lookup} />
        <button className="text-button" type="button" onClick={() => void lookup()}>{t.lookup}</button>
      </div>
      {error ? <p className="danger">{error}</p> : null}
      <div className="candidates">
        {movies.map((movie) => (
          <button className="candidate" type="button" key={movie.tmdbId} onClick={() => void chooseMovie(movie.tmdbId)}>
            {movie.posterPath ? <img src={imageUrl(movie.posterPath, "w185") ?? ""} alt="" /> : <span />}
            <span>{movie.title} {movie.year ? `(${movie.year})` : ""}</span>
            <span>{t.choose}</span>
          </button>
        ))}
        {releases.map((release) => (
          <button className="candidate" type="button" key={release.mbid} onClick={() => void chooseAlbum(release.mbid)}>
            <span />
            <span>{release.artist} — {release.title}</span>
            <span>{t.choose}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
