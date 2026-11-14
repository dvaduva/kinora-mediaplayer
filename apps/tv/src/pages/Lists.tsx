import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { MovieListDetail, MovieListSummary } from "@kinora/shared";
import { api } from "../api";
import { Focusable } from "../components/Focusable";
import { PosterCard } from "../components/Poster";
import { Rail } from "../components/Rail";
import { VirtualGrid } from "../components/VirtualGrid";
import { useLocale, type Copy } from "../i18n";

function countLabel(count: number, t: Copy) {
  return count === 1 ? t.listCountOne : t.listCount.replace("{count}", String(count));
}

/** "All | Lists" chips at the top of the Movies and Lists pages; Up from the grid reaches them. */
export function MovieTabs() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const onLists = pathname === "/lists" || pathname.startsWith("/lists/");
  return (
    <div className="season-tabs movie-tabs">
      <Focusable className={onLists ? "chip" : "chip is-active"} focusKey="tab-all-movies" onEnterPress={() => navigate("/movies", { replace: true })}>
        {t.allMovies}
      </Focusable>
      <Focusable className={onLists ? "chip is-active" : "chip"} focusKey="tab-lists" onEnterPress={() => navigate("/lists", { replace: true })}>
        {t.lists}
      </Focusable>
    </div>
  );
}

/**
 * One rail per list that has movies on disk: the first ones by title and, when there are more,
 * a "See all" card that opens the whole list. Lists are made and filled in the web app.
 */
export function ListsPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [lists, setLists] = useState<MovieListSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<MovieListSummary[]>("/api/lists?preview=1")
      .then((all) => setLists(all.filter((list) => list.count > 0)))
      .catch((reason: Error) => setError(reason.message));
  }, []);

  if (error) return <p className="state-message">{t.error}: {error}</p>;
  if (!lists) return <p className="state-message">{t.loading}</p>;

  return (
    <div className="page lists-page">
      <header className="page-head">
        <h1>{t.lists}</h1>
      </header>
      <MovieTabs />
      {lists.length === 0 ? (
        <section className="empty">
          <p className="lede">{t.listsEmpty}</p>
          <p className="hint">{t.listsWebHint}</p>
        </section>
      ) : (
        lists.map((list, listIndex) => {
          const preview = list.preview ?? [];
          return (
            <Rail key={list.id} title={`${list.name} · ${countLabel(list.count, t)}`} focusKey={`rail-list-${list.id}`}>
              {preview.map((movie, index) => (
                <PosterCard
                  key={movie.id}
                  focusKey={`list-${list.id}-${movie.id}`}
                  focusOnMount={listIndex === 0 && index === 0}
                  to={`/movies/${movie.id}`}
                  title={movie.title}
                  meta={movie.year ? String(movie.year) : null}
                  src={movie.posterPath}
                />
              ))}
              {list.count > preview.length ? (
                <Focusable className="poster see-all" focusKey={`list-${list.id}-all`} onEnterPress={() => navigate(`/lists/${list.id}`)}>
                  <div className="poster-art">
                    <span className="see-all-label">{t.seeAll.replace("{count}", String(list.count))}</span>
                  </div>
                  <div className="poster-copy">
                    <strong>{list.name}</strong>
                  </div>
                </Focusable>
              ) : null}
            </Rail>
          );
        })
      )}
    </div>
  );
}

/** A whole list as a grid, by title. */
export function ListPage() {
  const { id } = useParams();
  const { t } = useLocale();
  const [list, setList] = useState<MovieListDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api<MovieListDetail>(`/api/lists/${id}`)
      .then(setList)
      .catch((reason: Error) => setError(reason.message));
  }, [id]);

  if (error) return <p className="state-message">{t.error}: {error}</p>;
  if (!list) return <p className="state-message">{t.loading}</p>;

  return (
    <div className="page">
      <header className="page-head">
        <h1>{list.name}</h1>
        <p className="count">{countLabel(list.movies.length, t)}</p>
      </header>
      {list.movies.length === 0 ? (
        <p className="hint">{t.listEmpty}</p>
      ) : (
        <VirtualGrid
          className="grid"
          items={list.movies}
          getKey={(movie) => movie.id}
          renderItem={(movie, index, onFocus) => (
            <PosterCard
              focusKey={`list-movie-${movie.id}`}
              focusOnMount={index === 0}
              onFocus={onFocus}
              to={`/movies/${movie.id}`}
              title={movie.title}
              meta={movie.year ? String(movie.year) : null}
              src={movie.posterPath}
            />
          )}
        />
      )}
    </div>
  );
}
