import { useEffect, useState } from "react";
import type { SearchHit } from "@kinora/shared";
import { api } from "../api";
import { PosterCard } from "../components/Poster";
import { useLocale } from "../i18n";

export function SearchPage() {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setError(null);
      return;
    }
    const timer = window.setTimeout(() => {
      api<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`)
        .then(setHits)
        .catch((reason: Error) => setError(reason.message));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  function href(hit: SearchHit) {
    if (hit.kind === "movie") return `/movies/${hit.id}`;
    if (hit.kind === "series") return `/series/${hit.id}`;
    if (hit.kind === "album") return `/music/albums/${hit.id}`;
    return `/music/artists/${hit.id}`;
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t.search}</h1>
      </header>
      <label className="search-field">
        <span className="sr-only">{t.search}</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.searchPlaceholder} autoFocus />
      </label>
      {error ? <p className="hint">{t.error}: {error}</p> : null}
      {query.trim().length >= 2 && hits.length === 0 && !error ? <p className="hint">{t.noResults}</p> : null}
      <div className="grid">
        {hits.map((hit, index) => (
          <PosterCard
            key={`${hit.kind}-${hit.id}`}
            focusKey={`search-${hit.kind}-${hit.id}`}
            focusOnMount={index === 0}
            to={href(hit)}
            title={hit.title}
            meta={hit.subtitle}
            src={hit.posterPath}
          />
        ))}
      </div>
    </div>
  );
}
