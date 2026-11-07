import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { PersonDetail } from "@kinora/shared";
import { api } from "../api";
import { useLocale } from "../i18n";
import { formatDate, imageUrl } from "../media";
import { PosterLink } from "../ui";

const LONG_BIOGRAPHY = 700;

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
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!id) return;
    setPerson(null);
    setFailed(false);
    setExpanded(false);
    api<PersonDetail>(`/api/people/${id}`).then(setPerson).catch(() => setFailed(true));
  }, [id]);
  if (failed) return <p className="muted">{t.cast}</p>;
  if (!person) return <p className="muted">…</p>;

  const age = ageAt(person.birthday, person.deathday);
  const born = formatDate(person.birthday, locale);
  const died = formatDate(person.deathday, locale);
  const bio = person.biography ?? "";
  const long = bio.length > LONG_BIOGRAPHY;
  const photo = imageUrl(person.profilePath, "h632");
  return (
    <article className="person-page">
      <div className="person-grid">
        {photo ? <img className="person-photo" src={photo} alt="" /> : <div className="person-photo empty" />}
        <div>
          <h1>{person.name}</h1>
          <dl className="person-facts">
            {born ? (
              <div>
                <dt>{t.born}</dt>
                <dd>{born}{age != null && !died ? ` (${age} ${t.years})` : ""}</dd>
              </div>
            ) : null}
            {died ? (
              <div>
                <dt>{t.died}</dt>
                <dd>{died}{age != null ? ` (${age} ${t.years})` : ""}</dd>
              </div>
            ) : null}
            {person.placeOfBirth ? (
              <div>
                <dt>{t.birthplace}</dt>
                <dd>{person.placeOfBirth}</dd>
              </div>
            ) : null}
          </dl>
          {bio ? (
            <div className={`person-bio${long && !expanded ? " clamped" : ""}`}>
              {bio.split(/\n+/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
            </div>
          ) : null}
          {long ? (
            <button className="text-button" type="button" onClick={() => setExpanded((value) => !value)}>
              {expanded ? t.showLess : t.showMore}
            </button>
          ) : null}
          {!person.profileLoaded ? <p className="muted">{t.profileUnavailable}</p> : null}
          <p className="person-links">
            {person.imdbId ? <a href={`https://www.imdb.com/name/${person.imdbId}`} target="_blank" rel="noreferrer">IMDb</a> : null}
            <a href={`https://www.themoviedb.org/person/${person.tmdbId}`} target="_blank" rel="noreferrer">TMDB</a>
          </p>
        </div>
      </div>
      {person.credits.length > 0 ? (
        <section className="section">
          <h2>{t.inLibrary}</h2>
          <div className="grid">
            {person.credits.map((credit) => (
              <PosterLink
                key={`${credit.kind}-${credit.id}`}
                to={credit.kind === "series" ? `/series/${credit.id}` : `/movies/${credit.id}`}
                src={credit.posterPath}
                title={credit.title}
                meta={[credit.year, credit.kind === "series" ? t.seriesBadge : null].filter(Boolean).join(" · ") || null}
                badge={credit.character}
              />
            ))}
          </div>
        </section>
      ) : null}
    </article>
  );
}
