import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { PersonDetail } from "@kinora/shared";
import { api } from "../api";
import { Focusable } from "../components/Focusable";
import { PosterCard } from "../components/Poster";
import { useLocale } from "../i18n";
import { imageUrl } from "../media";

function formatDate(value: string | null, locale: "ro" | "en") {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function ageAt(birthday: string | null, until: string | null) {
  if (!birthday) return null;
  const from = new Date(birthday);
  const to = until ? new Date(until) : new Date();
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  let age = to.getFullYear() - from.getFullYear();
  if (to.getMonth() < from.getMonth() || (to.getMonth() === from.getMonth() && to.getDate() < from.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

export function PersonPage() {
  const { id } = useParams();
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setPerson(null);
    setError(null);
    api<PersonDetail>(`/api/people/${id}`)
      .then(setPerson)
      .catch((reason: Error) => setError(reason.message));
  }, [id]);

  if (error) return <p className="state-message">{t.error}: {error}</p>;
  if (!person) return <p className="state-message">{t.loading}</p>;

  const photo = imageUrl(person.profilePath, "h632");
  const born = formatDate(person.birthday, locale);
  const died = formatDate(person.deathday, locale);
  const age = ageAt(person.birthday, person.deathday);

  return (
    <div className="page person-page">
      <div className="detail-body person-body">
        <div className="detail-poster person-photo" style={photo ? { backgroundImage: `url(${photo})` } : undefined}>
          {!photo ? <span>{person.name.slice(0, 1)}</span> : null}
        </div>
        <div className="detail-copy">
          <p className="eyebrow">{t.cast}</p>
          <h1>{person.name}</h1>
          <div className="detail-credits">
            {born ? (
              <p>
                <strong>{t.born}</strong> {born}
                {age != null && !died ? ` (${age} ${t.years})` : ""}
              </p>
            ) : null}
            {died ? (
              <p>
                <strong>{t.died}</strong> {died}
                {age != null ? ` (${age} ${t.years})` : ""}
              </p>
            ) : null}
            {person.placeOfBirth ? (
              <p>
                <strong>{t.birthplace}</strong> {person.placeOfBirth}
              </p>
            ) : null}
          </div>
          {person.biography ? <p className="lede detail-overview">{person.biography}</p> : null}
          <div className="hero-actions">
            <Focusable className="btn" focusKey="person-back" focusOnMount onEnterPress={() => navigate(-1)}>
              {t.back}
            </Focusable>
          </div>
        </div>
      </div>

      {person.credits.length > 0 ? (
        <>
          <h2 className="section-title">{t.inLibrary}</h2>
          <div className="grid">
            {person.credits.map((credit, index) => (
              <PosterCard
                key={`${credit.kind}-${credit.id}`}
                focusKey={`credit-${credit.kind}-${credit.id}`}
                focusOnMount={index === 0}
                to={credit.kind === "series" ? `/series/${credit.id}` : `/movies/${credit.id}`}
                title={credit.title}
                meta={[credit.year, credit.character].filter(Boolean).join(" · ") || null}
                src={credit.posterPath}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
