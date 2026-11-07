import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AlbumSummary, ArtistSummary, HomeView, MovieSummary, SearchHit, SeriesSummary } from "@kinora/shared";
import { api } from "../api";
import { useCached } from "../cache";
import { useLocale } from "../i18n";
import { PosterLink, ScrollRail, SkeletonGrid } from "../ui";

export function HomePage() {
  const { t } = useLocale();
  const [home] = useCached<HomeView | null>("/api/home", null);
  if (home === undefined) {
    return (
      <section className="row">
        <span className="skeleton skeleton-line title" />
        <SkeletonGrid count={6} />
      </section>
    );
  }
  if (!home) return <p className="muted">{t.home}</p>;
  const empty = home.movies.length === 0 && home.series.length === 0 && home.albums.length === 0;
  return (
    <>
      {home.featured ? (
        <section className="billboard" style={{ backgroundImage: home.featured.backdropPath ? `url(${posterPath(home.featured.backdropPath, "w1280")})` : undefined }}>
          <div className="billboard-fade" />
          <div className="billboard-copy">
            <h1>
              {home.featured.title} {home.featured.year ? <span className="year">{home.featured.year}</span> : null}
            </h1>
            {home.featured.overview ? <p className="lede">{home.featured.overview}</p> : null}
            {home.featured.defaultFileId ? (
              <div className="actions">
                <Link className="play" to={`/play/${home.featured.defaultFileId}`}>{t.play}</Link>
                <Link className="text-button" to={`/movies/${home.featured.id}`}>{home.featured.title}</Link>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
      {empty ? (
        <section className="plain">
          <h1>{t.empty}</h1>
          <p className="lede">{t.emptyHelp}</p>
          <Link className="play" to="/settings">{t.openSettings}</Link>
        </section>
      ) : null}
      {home.continueWatching.length > 0 ? (
        <section className="row">
          <div className="row-head"><h2>{t.continue}</h2></div>
          <ScrollRail className="rail">
            {home.continueWatching.map((item) => (
              <PosterLink key={item.fileId} to={`/play/${item.fileId}`} src={item.posterPath} title={item.title} meta={item.subtitle} />
            ))}
          </ScrollRail>
        </section>
      ) : null}
      <PosterRow title={t.recentMovies} items={home.movies.map((movie) => ({ id: movie.id, to: `/movies/${movie.id}`, title: movie.title, meta: movie.year ? String(movie.year) : null, src: movie.posterPath, badge: movie.matched ? null : t.unmatched }))} />
      <PosterRow title={t.recentSeries} items={home.series.map((show) => ({ id: show.id, to: `/series/${show.id}`, title: show.title, meta: show.year ? String(show.year) : null, src: show.posterPath, badge: show.matched ? null : t.unmatched }))} />
      <PosterRow title={t.recentAlbums} items={home.albums.map((album) => ({ id: album.id, to: `/music/albums/${album.id}`, title: album.title, meta: album.artistName, src: album.coverPath }))} />
    </>
  );
}

function posterPath(src: string, size: string) {
  return src.startsWith("cover:") ? `/api/covers/${encodeURIComponent(src.slice(6))}` : `/api/images?size=${size}&path=${encodeURIComponent(src)}`;
}

function PosterRow(props: { title: string; items: { id: string; to: string; title: string; meta?: string | null; src: string | null; badge?: string | null }[] }) {
  if (props.items.length === 0) return null;
  return (
    <section className="row">
      <div className="row-head"><h2>{props.title}</h2></div>
      <ScrollRail className="rail">
        {props.items.map((item) => (
          <PosterLink key={item.id} to={item.to} src={item.src} title={item.title} meta={item.meta} badge={item.badge} />
        ))}
      </ScrollRail>
    </section>
  );
}

export function MovieListPage() {
  const { t } = useLocale();
  const [movies] = useCached<MovieSummary[]>("/api/movies", []);
  return (
    <>
      <h1>{t.movies}</h1>
      {movies ? (
        <div className="grid">
          {movies.map((movie) => (
            <PosterLink key={movie.id} to={`/movies/${movie.id}`} src={movie.posterPath} title={movie.title} meta={movie.year ? String(movie.year) : null} badge={movie.matched ? null : t.unmatched} />
          ))}
        </div>
      ) : (
        <SkeletonGrid />
      )}
    </>
  );
}

export function SeriesListPage() {
  const { t } = useLocale();
  const [items] = useCached<SeriesSummary[]>("/api/series", []);
  return (
    <>
      <h1>{t.series}</h1>
      {items ? (
        <div className="grid">
          {items.map((show) => (
            <PosterLink key={show.id} to={`/series/${show.id}`} src={show.posterPath} title={show.title} meta={show.year ? String(show.year) : null} badge={show.matched ? null : t.unmatched} />
          ))}
        </div>
      ) : (
        <SkeletonGrid />
      )}
    </>
  );
}

export function MusicPage() {
  const { t } = useLocale();
  const [artists] = useCached<ArtistSummary[]>("/api/artists", []);
  const [albums] = useCached<AlbumSummary[]>("/api/albums", []);
  return (
    <>
      <h1>{t.music}</h1>
      <section className="row">
        <h2>{t.albums}</h2>
        {albums ? (
          <div className="grid">
            {albums.map((album) => (
              <PosterLink key={album.id} to={`/music/albums/${album.id}`} src={album.coverPath} title={album.title} meta={album.artistName} badge={album.matched ? null : t.unmatched} />
            ))}
          </div>
        ) : (
          <SkeletonGrid count={6} />
        )}
      </section>
      <section className="row">
        <h2>{t.artists}</h2>
        {artists ? (
          <div className="grid">
            {artists.map((artist) => (
              <Link key={artist.id} className="poster-card" to={`/music/artists/${artist.id}`}>
                <div className="cover poster empty" />
                <span>{artist.name}</span>
              </Link>
            ))}
          </div>
        ) : (
          <SkeletonGrid count={6} square />
        )}
      </section>
    </>
  );
}

export function SearchPage() {
  const { t } = useLocale();
  const [params] = useSearchParams();
  const query = params.get("q") ?? "";
  const [hits, setHits] = useState<SearchHit[]>([]);
  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    api<SearchHit[]>(`/api/search?q=${encodeURIComponent(query)}`).then(setHits).catch(() => setHits([]));
  }, [query]);
  const href = (hit: SearchHit) => {
    if (hit.kind === "movie") return `/movies/${hit.id}`;
    if (hit.kind === "series") return `/series/${hit.id}`;
    if (hit.kind === "album") return `/music/albums/${hit.id}`;
    return `/music/artists/${hit.id}`;
  };
  return (
    <>
      <h1>{query || t.search}</h1>
      {query && hits.length === 0 ? <p className="muted">{t.noResults}</p> : null}
      <div className="grid">
        {hits.map((hit) => (
          <PosterLink key={`${hit.kind}-${hit.id}`} to={href(hit)} src={hit.posterPath} title={hit.title} meta={hit.subtitle} />
        ))}
      </div>
    </>
  );
}
