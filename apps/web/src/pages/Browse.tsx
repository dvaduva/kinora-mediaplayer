import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { WATCH_STATUSES, type AlbumSummary, type ArtistSummary, type HomeView, type MovieSummary, type SearchHit, type SeriesSummary, type WatchStatus } from "@kinora/shared";
import { api } from "../api";
import { useCached } from "../cache";
import { useLocale, type Copy, type Locale } from "../i18n";
import { formatDate, formatRuntime } from "../media";
import { PosterLink, ScrollRail, SkeletonGrid, statusLabel } from "../ui";

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
      <PosterRow title={t.recentMovies} items={home.movies.map((movie) => ({ id: movie.id, to: `/movies/${movie.id}`, title: movie.title, meta: movie.year ? String(movie.year) : null, src: movie.posterPath, badge: movie.matched ? null : t.unmatched, status: movie.watchStatus }))} />
      <PosterRow title={t.recentSeries} items={home.series.map((show) => ({ id: show.id, to: `/series/${show.id}`, title: show.title, meta: show.year ? String(show.year) : null, src: show.posterPath, badge: show.matched ? null : t.unmatched }))} />
      <PosterRow title={t.recentAlbums} items={home.albums.map((album) => ({ id: album.id, to: `/music/albums/${album.id}`, title: album.title, meta: album.artistName, src: album.coverPath }))} />
    </>
  );
}

function posterPath(src: string, size: string) {
  return src.startsWith("cover:") ? `/api/covers/${encodeURIComponent(src.slice(6))}` : `/api/images?size=${size}&path=${encodeURIComponent(src)}`;
}

function PosterRow(props: { title: string; items: { id: string; to: string; title: string; meta?: string | null; src: string | null; badge?: string | null; status?: WatchStatus }[] }) {
  if (props.items.length === 0) return null;
  return (
    <section className="row">
      <div className="row-head"><h2>{props.title}</h2></div>
      <ScrollRail className="rail">
        {props.items.map((item) => (
          <PosterLink key={item.id} to={item.to} src={item.src} title={item.title} meta={item.meta} badge={item.badge} status={item.status} />
        ))}
      </ScrollRail>
    </section>
  );
}

type MovieSort = "added" | "title" | "release" | "rating" | "runtime";
type SortDirection = "asc" | "desc";
type StatusFilter = WatchStatus | "all";

const MOVIE_SORTS: readonly MovieSort[] = ["added", "title", "release", "rating", "runtime"];
/** Direction a key starts in when picked: names A→Z, everything else biggest/newest first. */
const DEFAULT_DIRECTION: Record<MovieSort, SortDirection> = { added: "desc", title: "asc", release: "desc", rating: "desc", runtime: "desc" };
const SORT_STORAGE_KEY = "kinora-movie-sort";

function sortLabel(sort: MovieSort, t: Copy) {
  return { added: t.sortAdded, title: t.sortTitle, release: t.sortRelease, rating: t.sortRating, runtime: t.sortRuntime }[sort];
}

/** Sort value for a movie; null sorts last in either direction. */
function sortValue(movie: MovieSummary, sort: MovieSort): number | string | null {
  if (sort === "added") return movie.addedAt;
  if (sort === "title") return movie.sortTitle ?? movie.title;
  if (sort === "rating") return movie.rating;
  if (sort === "runtime") return movie.runtime;
  if (movie.releaseDate) return movie.releaseDate;
  return movie.year ? `${movie.year}-00-00` : null;
}

function sortMovies(movies: MovieSummary[], sort: MovieSort, direction: SortDirection, locale: string) {
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  const sign = direction === "asc" ? 1 : -1;
  return [...movies].sort((a, b) => {
    const left = sortValue(a, sort);
    const right = sortValue(b, sort);
    if (left == null || right == null) {
      if (left !== right) return left == null ? 1 : -1;
    } else {
      const order = typeof left === "number" && typeof right === "number" ? left - right : collator.compare(String(left), String(right));
      if (order !== 0) return sign * order;
    }
    return collator.compare(a.sortTitle ?? a.title, b.sortTitle ?? b.title);
  });
}

function readStoredSort(): { sort: MovieSort; direction: SortDirection } | null {
  try {
    const stored = JSON.parse(localStorage.getItem(SORT_STORAGE_KEY) ?? "null") as { sort?: string; direction?: string } | null;
    const sort = MOVIE_SORTS.find((item) => item === stored?.sort);
    if (!sort) return null;
    return { sort, direction: stored?.direction === "asc" ? "asc" : stored?.direction === "desc" ? "desc" : DEFAULT_DIRECTION[sort] };
  } catch {
    return null;
  }
}

/** Card subtitle that shows the value the list is sorted by. */
function sortMeta(movie: MovieSummary, sort: MovieSort, locale: Locale) {
  const year = movie.year ? String(movie.year) : null;
  if (sort === "release") return formatDate(movie.releaseDate, locale) ?? year;
  if (sort === "added") return formatDate(new Date(movie.addedAt).toISOString(), locale);
  if (sort === "rating") return [year, movie.rating != null ? `★ ${movie.rating.toFixed(1)}` : null].filter(Boolean).join(" · ");
  if (sort === "runtime") return [year, formatRuntime(movie.runtime)].filter(Boolean).join(" · ");
  return year;
}

export function MovieListPage() {
  const { t, locale } = useLocale();
  const [movies] = useCached<MovieSummary[]>("/api/movies", []);
  const [params, setParams] = useSearchParams();
  const stored = useMemo(readStoredSort, []);
  const sort = MOVIE_SORTS.find((item) => item === params.get("sort")) ?? stored?.sort ?? "title";
  const directionParam = params.get("dir");
  const direction: SortDirection = directionParam === "asc" || directionParam === "desc" ? directionParam : params.has("sort") ? DEFAULT_DIRECTION[sort] : stored?.direction ?? DEFAULT_DIRECTION[sort];
  const statusParam = params.get("status");
  const status: StatusFilter = statusParam === "new" || statusParam === "unwatched" || statusParam === "watched" ? statusParam : "all";

  const genre = params.get("genre") ?? "";

  const update = (next: { sort?: MovieSort; direction?: SortDirection; status?: StatusFilter; genre?: string }) => {
    const nextSort = next.sort ?? sort;
    const nextDirection = next.direction ?? (next.sort && next.sort !== sort ? DEFAULT_DIRECTION[next.sort] : direction);
    const nextStatus = next.status ?? status;
    const nextGenre = next.genre ?? genre;
    const search = new URLSearchParams();
    search.set("sort", nextSort);
    search.set("dir", nextDirection);
    if (nextStatus !== "all") search.set("status", nextStatus);
    if (nextGenre) search.set("genre", nextGenre);
    setParams(search, { replace: true });
    try {
      localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify({ sort: nextSort, direction: nextDirection }));
    } catch {
      // Storage may be unavailable (private mode); the URL still carries the choice.
    }
  };

  const genres = useMemo(() => {
    const names = new Set<string>();
    for (const movie of movies ?? []) for (const name of movie.genres) names.add(name);
    return [...names].sort((a, b) => a.localeCompare(b, locale));
  }, [movies, locale]);
  const inGenre = useMemo(() => (movies && genre ? movies.filter((movie) => movie.genres.includes(genre)) : movies), [movies, genre]);
  const counts = useMemo(() => {
    const result: Record<StatusFilter, number> = { all: 0, new: 0, unwatched: 0, watched: 0 };
    for (const movie of inGenre ?? []) {
      result.all += 1;
      result[movie.watchStatus] += 1;
    }
    return result;
  }, [inGenre]);
  const visible = useMemo(() => {
    if (!inGenre) return null;
    const filtered = status === "all" ? inGenre : inGenre.filter((movie) => movie.watchStatus === status);
    return sortMovies(filtered, sort, direction, locale);
  }, [inGenre, sort, direction, status, locale]);

  return (
    <>
      <h1>{t.movies}</h1>
      <div className="list-toolbar">
        <div className="filter-tabs" role="group" aria-label={t.filterStatus}>
          {(["all", ...WATCH_STATUSES] as StatusFilter[]).map((item) => (
            <button key={item} type="button" aria-pressed={item === status} onClick={() => update({ status: item })}>
              {item === "all" ? t.filterAll : statusLabel(item, t)}
              <small>{counts[item]}</small>
            </button>
          ))}
        </div>
        {genres.length > 0 ? (
          <label className="sort-control">
            <span className="muted">{t.filterGenre}</span>
            <select value={genres.includes(genre) ? genre : ""} onChange={(event) => update({ genre: event.target.value })}>
              <option value="">{t.allGenres}</option>
              {genres.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="sort-control">
          <span className="muted">{t.sortBy}</span>
          <select value={sort} onChange={(event) => update({ sort: event.target.value as MovieSort })}>
            {MOVIE_SORTS.map((item) => (
              <option key={item} value={item}>{sortLabel(item, t)}</option>
            ))}
          </select>
          <button
            type="button"
            className="sort-direction"
            aria-label={direction === "asc" ? t.sortAscending : t.sortDescending}
            title={direction === "asc" ? t.sortAscending : t.sortDescending}
            onClick={() => update({ direction: direction === "asc" ? "desc" : "asc" })}
          >
            {direction === "asc" ? "↑" : "↓"}
          </button>
        </label>
      </div>
      {visible ? (
        visible.length > 0 ? (
          <div className="grid">
            {visible.map((movie) => (
              <PosterLink
                key={movie.id}
                to={`/movies/${movie.id}`}
                src={movie.posterPath}
                title={movie.title}
                meta={sortMeta(movie, sort, locale)}
                badge={movie.matched ? null : t.unmatched}
                status={movie.watchStatus}
              />
            ))}
          </div>
        ) : (
          <p className="muted">{movies && movies.length > 0 ? t.nothingFiltered : t.empty}</p>
        )
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
