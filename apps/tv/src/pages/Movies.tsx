import { useEffect, useState } from "react";
import type { MovieSummary } from "@kinora/shared";
import { api } from "../api";
import { PosterCard } from "../components/Poster";
import { VirtualGrid } from "../components/VirtualGrid";
import { useLocale } from "../i18n";

export function MoviesPage() {
  const { t } = useLocale();
  const [movies, setMovies] = useState<MovieSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<MovieSummary[]>("/api/movies")
      .then(setMovies)
      .catch((reason: Error) => setError(reason.message));
  }, []);

  if (error) return <p className="state-message">{t.error}: {error}</p>;
  if (!movies) return <p className="state-message">{t.loading}</p>;

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t.movies}</h1>
        <p className="count">
          {movies.length} {t.titles}
        </p>
      </header>
      {movies.length === 0 ? (
        <p className="hint">{t.noMovies}</p>
      ) : (
        <VirtualGrid
          className="grid"
          items={movies}
          getKey={(movie) => movie.id}
          renderItem={(movie, index, onFocus) => (
            <PosterCard
              focusKey={`movie-${movie.id}`}
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
