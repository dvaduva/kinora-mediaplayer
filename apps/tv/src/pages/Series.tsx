import { useEffect, useState } from "react";
import type { SeriesSummary } from "@kinora/shared";
import { api } from "../api";
import { PosterCard } from "../components/Poster";
import { useLocale } from "../i18n";

export function SeriesPage() {
  const { t } = useLocale();
  const [series, setSeries] = useState<SeriesSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SeriesSummary[]>("/api/series")
      .then(setSeries)
      .catch((reason: Error) => setError(reason.message));
  }, []);

  if (error) return <p className="state-message">{t.error}: {error}</p>;
  if (!series) return <p className="state-message">{t.loading}</p>;

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t.series}</h1>
        <p className="count">
          {series.length} {t.titles}
        </p>
      </header>
      {series.length === 0 ? (
        <p className="hint">{t.noSeries}</p>
      ) : (
        <div className="grid">
          {series.map((show, index) => (
            <PosterCard
              key={show.id}
              focusKey={`series-${show.id}`}
              focusOnMount={index === 0}
              to={`/series/${show.id}`}
              title={show.title}
              meta={show.year ? String(show.year) : null}
              src={show.posterPath}
            />
          ))}
        </div>
      )}
    </div>
  );
}
