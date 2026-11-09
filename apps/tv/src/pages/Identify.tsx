import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { IdentifyItem } from "@kinora/shared";
import { api } from "../api";
import { Focusable } from "../components/Focusable";
import { useLocale } from "../i18n";

export function IdentifyPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [items, setItems] = useState<IdentifyItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<IdentifyItem[]>("/api/identify")
      .then(setItems)
      .catch((reason: Error) => setError(reason.message));
  }, []);

  if (error) return <p className="state-message">{t.error}: {error}</p>;
  if (!items) return <p className="state-message">{t.loading}</p>;

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t.identify}</h1>
        <p className="count">{items.length}</p>
      </header>
      <p className="hint">{t.openWeb}</p>
      {items.length === 0 ? <p className="hint">{t.nothingToIdentify}</p> : null}
      <div className="episode-list">
        {items.map((item, index) => {
          const to =
            item.kind === "movie" ? `/movies/${item.id}` : item.kind === "series" ? `/series/${item.id}` : `/music/albums/${item.id}`;
          return (
            <Focusable
              key={`${item.kind}-${item.id}`}
              className="episode"
              focusKey={`identify-${item.kind}-${item.id}`}
              focusOnMount={index === 0}
              onEnterPress={() => navigate(to)}
            >
              <strong>{item.kind}</strong>
              <span>
                {item.title}
                {item.year ? ` (${item.year})` : ""}
              </span>
              <em>{item.hint || t.unmatched}</em>
            </Focusable>
          );
        })}
      </div>
    </div>
  );
}
