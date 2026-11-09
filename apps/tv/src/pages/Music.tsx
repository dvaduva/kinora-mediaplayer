import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { AlbumDetail, AlbumSummary, ArtistSummary } from "@kinora/shared";
import { api } from "../api";
import { Focusable } from "../components/Focusable";
import { PosterCard } from "../components/Poster";
import { useLocale } from "../i18n";
import { formatClock, imageUrl } from "../media";

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
    <div className="page">
      <header className="page-head">
        <h1>{t.music}</h1>
        <p className="count">
          {albums.length} {t.albums.toLowerCase()}
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
  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api<AlbumDetail>(`/api/albums/${id}`)
      .then(setAlbum)
      .catch((reason: Error) => setError(reason.message));
  }, [id]);

  if (error) return <p className="state-message">{t.error}: {error}</p>;
  if (!album) return <p className="state-message">{t.loading}</p>;

  const cover = imageUrl(album.coverPath, "w500");
  const first = album.tracks[0]?.fileId ?? null;

  return (
    <article className="detail album-detail">
      <div className="detail-copy">
        {cover ? <div className="album-cover" style={{ backgroundImage: `url(${cover})` }} /> : null}
        <p className="eyebrow">{t.albums}</p>
        <h1>{album.title}</h1>
        <p className="meta">{album.artistName}</p>
        <div className="hero-actions">
          {first ? (
            <Focusable className="btn primary" focusKey="album-play" focusOnMount onEnterPress={() => navigate(`/play/${first}`)}>
              {t.play}
            </Focusable>
          ) : null}
          <Focusable className="btn" focusKey="album-back" onEnterPress={() => navigate(-1)}>
            {t.back}
          </Focusable>
        </div>
        <div className="episode-list">
          {album.tracks.map((track, index) => (
            <Focusable
              key={track.id}
              className="episode"
              focusKey={`track-${track.id}`}
              focusOnMount={!first && index === 0}
              onEnterPress={() => navigate(`/play/${track.fileId}`)}
            >
              <strong>{track.trackNumber ?? index + 1}</strong>
              <span>{track.title}</span>
              <em>{formatClock(track.duration)}</em>
            </Focusable>
          ))}
        </div>
      </div>
    </article>
  );
}

export function ArtistDetailPage() {
  const { id } = useParams();
  const { t } = useLocale();
  const [albums, setAlbums] = useState<AlbumSummary[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api<{ name: string; albums: AlbumSummary[] }>(`/api/artists/${id}`)
      .then((data) => {
        setName(data.name);
        setAlbums(data.albums);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [id]);

  if (error) return <p className="state-message">{t.error}: {error}</p>;
  if (!albums) return <p className="state-message">{t.loading}</p>;

  return (
    <div className="page">
      <header className="page-head">
        <h1>{name}</h1>
        <p className="count">
          {albums.length} {t.albums.toLowerCase()}
        </p>
      </header>
      <div className="grid">
        {albums.map((album, index) => (
          <PosterCard
            key={album.id}
            focusKey={`artist-album-${album.id}`}
            focusOnMount={index === 0}
            to={`/music/albums/${album.id}`}
            title={album.title}
            meta={album.year ? String(album.year) : null}
            src={album.coverPath}
          />
        ))}
      </div>
    </div>
  );
}
