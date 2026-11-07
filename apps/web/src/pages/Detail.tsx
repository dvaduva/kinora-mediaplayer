import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { MediaVersion, MovieDetail, SeriesDetail, SimilarTitle } from "@kinora/shared";
import { api } from "../api";
import { useLocale } from "../i18n";
import { codecLabel, formatBytes, formatDate, formatRuntime, imageUrl, resolutionLabel } from "../media";
import { Poster } from "../ui";

export function MoviePage() {
  const { id } = useParams();
  const { t, locale } = useLocale();
  const [movie, setMovie] = useState<MovieDetail | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [trailerOpen, setTrailerOpen] = useState(false);
  // Image load order: poster → hero → cast → stills → similar titles.
  const imageStages = useMemo(() => {
    if (!movie) return [];
    return [
      [imageUrl(movie.posterPath, "w342")],
      [imageUrl(movie.backdropPath, "w1280")],
      movie.cast.map((person) => imageUrl(person.profilePath, "w185")),
      movie.stills.map((still) => imageUrl(still, "w780")),
      movie.similar.map((item) => imageUrl(item.posterPath, "w342"))
    ];
  }, [movie]);
  const stage = useImageStages(imageStages);
  useEffect(() => {
    if (!id) return;
    api<MovieDetail>(`/api/movies/${id}`).then((data) => {
      setMovie(data);
      setVersionId(data.defaultFileId);
    }).catch(() => setMovie(null));
  }, [id]);
  if (!movie) return <p className="muted">{t.movies}</p>;
  const version = movie.versions.find((item) => item.fileId === versionId) ?? movie.versions[0];
  return (
    <article>
      <DossierHero
        title={movie.title}
        year={movie.year}
        backdrop={stage >= STAGE.hero ? movie.backdropPath : null}
        poster={movie.posterPath}
        overview={movie.overview}
        facts={[formatRuntime(movie.runtime), movie.genres.join(", "), formatDate(movie.releaseDate, locale)].filter(Boolean).join(" · ")}
        rating={movie.rating}
        directors={movie.directors}
        writers={movie.writers}
        directionLabel={t.direction}
        writersLabel={t.writers}
        imdbId={movie.imdbId}
        tmdbId={movie.tmdbId}
        playTo={version ? `/play/${version.fileId}` : null}
        playLabel={t.play}
        trailer={movie.trailer?.key ?? null}
        trailerLabel={t.trailer}
        onTrailer={() => setTrailerOpen(true)}
        version={version}
        versions={movie.versions}
        onVersion={setVersionId}
        versionsLabel={t.versions}
        fileLabel={t.file}
        locale={locale}
        unmatched={movie.matched ? null : t.unmatched}
        ratingLabel={t.rating}
      />
      <Stills stills={movie.stills} load={stage >= STAGE.stills} />
      <Cast cast={movie.cast} title={t.cast} load={stage >= STAGE.cast} />
      <Similar items={movie.similar} title={t.similar} absent={t.absent} load={stage >= STAGE.similar} />
      {trailerOpen && movie.trailer ? (
        <TrailerModal youtubeKey={movie.trailer.key} name={movie.trailer.name} closeLabel={t.close} openLabel={t.openYoutube} onClose={() => setTrailerOpen(false)} />
      ) : null}
    </article>
  );
}

export function SeriesPage() {
  const { id } = useParams();
  const { t, locale } = useLocale();
  const [show, setShow] = useState<SeriesDetail | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [trailerOpen, setTrailerOpen] = useState(false);
  useEffect(() => {
    if (!id) return;
    api<SeriesDetail>(`/api/series/${id}`).then((data) => {
      setShow(data);
      setSeason(data.seasons[0]?.seasonNumber ?? null);
    }).catch(() => setShow(null));
  }, [id]);
  if (!show) return <p className="muted">{t.series}</p>;
  const current = show.seasons.find((item) => item.seasonNumber === season) ?? show.seasons[0];
  return (
    <article>
      <header className="dossier-hero" style={{ backgroundImage: show.backdropPath ? `url(${imageUrl(show.backdropPath, "w1280")})` : undefined }}>
        <div className="billboard-fade" />
      </header>
      <div className="dossier-grid">
        <Poster src={show.posterPath} alt="" />
        <div>
          <h1>
            {show.title} {show.year ? <span className="year">{show.year}</span> : null}
          </h1>
          <p className="facts">{show.genres.join(", ")}</p>
          {show.overview ? <p className="overview">{show.overview}</p> : null}
          {show.trailer ? <button className="text-button" type="button" onClick={() => setTrailerOpen(true)}>{t.trailer}</button> : null}
          {!show.matched ? <p className="muted">{t.unmatched}</p> : null}
        </div>
        <aside>
          {show.rating ? <p className="score">{show.rating.toFixed(1)}</p> : null}
          <People label={t.creators} names={show.creators} />
          {show.imdbId ? <p><a href={`https://www.imdb.com/title/${show.imdbId}`} target="_blank" rel="noreferrer">{t.imdb}</a></p> : null}
          {show.tmdbId ? <p><a href={`https://www.themoviedb.org/tv/${show.tmdbId}`} target="_blank" rel="noreferrer">{t.tmdbLink}</a></p> : null}
        </aside>
      </div>
      <div className="season-list section">
        {show.seasons.map((item) => (
          <button key={item.seasonNumber} type="button" aria-pressed={item.seasonNumber === current?.seasonNumber} onClick={() => setSeason(item.seasonNumber)}>
            {item.seasonNumber === 0 ? t.unnumbered : `${t.season} ${item.seasonNumber}`}
          </button>
        ))}
      </div>
      <div>
        {current?.episodes.map((episode) => (
          <article className="episode" key={episode.id}>
            {episode.stillPath ? <img className="still" src={imageUrl(episode.stillPath, "w780") ?? ""} alt="" /> : <div className="still" />}
            <div>
              <strong>{episode.episodeNumber > 0 ? `${episode.episodeNumber}. ${episode.title}` : episode.title}</strong>
              {episode.overview ? <p className="muted">{episode.overview}</p> : null}
              <small>{[formatRuntime(episode.runtime), formatDate(episode.airDate, locale)].filter(Boolean).join(" · ")}</small>
            </div>
            {episode.fileId ? <Link className="play" to={`/play/${episode.fileId}`}>{t.play}</Link> : null}
          </article>
        ))}
      </div>
      <Cast cast={show.cast} title={t.cast} />
      <Similar items={show.similar} title={t.similar} absent={t.absent} />
      {trailerOpen && show.trailer ? (
        <TrailerModal youtubeKey={show.trailer.key} name={show.trailer.name} closeLabel={t.close} openLabel={t.openYoutube} onClose={() => setTrailerOpen(false)} />
      ) : null}
    </article>
  );
}

const STAGE = { poster: 0, hero: 1, cast: 2, stills: 3, similar: 4 } as const;
const STAGE_TIMEOUT_MS = 8000;

function preloadImage(url: string) {
  return new Promise<void>((resolve) => {
    const img = new Image();
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, STAGE_TIMEOUT_MS);
    img.onload = done;
    img.onerror = done;
    img.src = url;
  });
}

/**
 * Loads image groups one after another. Returns the index of the stage currently allowed
 * to render: stage N's images are requested only after every image in stage N-1 settled
 * (loaded, failed, or timed out), so earlier sections never compete for bandwidth.
 */
function useImageStages(stages: (string | null)[][]) {
  const [ready, setReady] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setReady(0);
    void (async () => {
      for (let index = 0; index < stages.length; index += 1) {
        const urls = stages[index].filter((url): url is string => Boolean(url));
        await Promise.all(urls.map(preloadImage));
        if (cancelled) return;
        setReady(index + 1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stages]);
  return ready;
}

function DossierHero(props: {
  title: string;
  year: number | null;
  backdrop: string | null;
  poster: string | null;
  overview: string | null;
  facts: string;
  rating: number | null;
  directors: string[];
  writers: string[];
  directionLabel: string;
  writersLabel: string;
  imdbId: string | null;
  tmdbId: number | null;
  playTo: string | null;
  playLabel: string;
  trailer: string | null;
  trailerLabel: string;
  onTrailer: () => void;
  version: MediaVersion | undefined;
  versions: MediaVersion[];
  onVersion: (id: string) => void;
  versionsLabel: string;
  fileLabel: string;
  locale: "ro" | "en";
  unmatched: string | null;
  ratingLabel: string;
}) {
  const tech = props.version
    ? [resolutionLabel(props.version.width, props.version.height), codecLabel(props.version.videoCodec), codecLabel(props.version.audio[0]?.codec ?? null), formatBytes(props.version.size, props.locale)].filter(Boolean).join(" · ")
    : "";
  return (
    <>
      <header className="dossier-hero" style={{ backgroundImage: props.backdrop ? `url(${imageUrl(props.backdrop, "w1280")})` : undefined }}>
        <div className="billboard-fade" />
      </header>
      <div className="dossier-grid">
        <Poster src={props.poster} alt="" />
        <div>
          <h1>
            {props.title} {props.year ? <span className="year">{props.year}</span> : null}
          </h1>
          {props.facts ? <p className="facts">{props.facts}</p> : null}
          {props.overview ? <p className="overview">{props.overview}</p> : null}
          <div className="actions">
            {props.playTo ? <Link className="play" to={props.playTo}>{props.playLabel}</Link> : null}
            {props.trailer ? <button className="text-button" type="button" onClick={props.onTrailer}>{props.trailerLabel}</button> : null}
          </div>
          {tech ? <p className="tech">{tech}</p> : null}
          {props.versions.length > 1 ? (
            <div className="version-list" aria-label={props.versionsLabel}>
              {props.versions.map((item) => (
                <button key={item.fileId} className="text-button" type="button" onClick={() => props.onVersion(item.fileId)}>
                  {resolutionLabel(item.width, item.height) ?? item.filename}
                </button>
              ))}
            </div>
          ) : null}
          {props.version ? (
            <details className="file-disclosure">
              <summary>{props.fileLabel}</summary>
              <p>{props.version.filename}</p>
              <p>{props.version.path}</p>
            </details>
          ) : null}
          {props.unmatched ? <p className="muted">{props.unmatched}</p> : null}
        </div>
        <aside>
          {props.rating != null ? (
            <p className="score">
              {props.rating.toFixed(1)} <small className="muted">{props.ratingLabel}</small>
            </p>
          ) : null}
          <People label={props.directionLabel} names={props.directors} />
          <People label={props.writersLabel} names={props.writers} />
          {props.imdbId ? <p><a href={`https://www.imdb.com/title/${props.imdbId}`} target="_blank" rel="noreferrer">IMDb</a></p> : null}
          {props.tmdbId ? <p><a href={`https://www.themoviedb.org/movie/${props.tmdbId}`} target="_blank" rel="noreferrer">TMDB</a></p> : null}
        </aside>
      </div>
    </>
  );
}

function People(props: { label: string; names: string[] }) {
  if (props.names.length === 0) return null;
  return (
    <p>
      <span className="muted">{props.label}</span>
      <br />
      {props.names.join(", ")}
    </p>
  );
}

function Stills(props: { stills: string[]; load?: boolean }) {
  if (props.stills.length === 0) return null;
  const load = props.load ?? true;
  return (
    <section className="section still-rail">
      {props.stills.map((still) =>
        load ? <img key={still} className="still" src={imageUrl(still, "w780") ?? ""} alt="" /> : <div key={still} className="still" />
      )}
    </section>
  );
}

function Cast(props: { cast: { name: string; character: string | null; profilePath: string | null }[]; title: string; load?: boolean }) {
  if (props.cast.length === 0) return null;
  const load = props.load ?? true;
  return (
    <section className="section">
      <h2>{props.title}</h2>
      <div className="cast-rail">
        {props.cast.map((person) => (
          <article className="cast-card" key={`${person.name}-${person.character}`}>
            {person.profilePath && load ? <img src={imageUrl(person.profilePath, "w185") ?? ""} alt="" /> : <div className="face" />}
            <span>{person.name}</span>
            {person.character ? <small>{person.character}</small> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function Similar(props: { items: SimilarTitle[]; title: string; absent: string; load?: boolean }) {
  if (props.items.length === 0) return null;
  const load = props.load ?? true;
  return (
    <section className="section">
      <h2>{props.title}</h2>
      <div className="rail">
        {props.items.map((item) => {
          const body = (
            <>
              <Poster src={load ? item.posterPath : null} alt="" />
              <span>{item.title}</span>
              <small>{item.inLibrary ? item.year : props.absent}</small>
            </>
          );
          if (!item.inLibrary || !item.localId) return <div className="poster-card dim" key={item.tmdbId}>{body}</div>;
          const to = item.mediaType === "tv" ? `/series/${item.localId}` : `/movies/${item.localId}`;
          return <Link className="poster-card" to={to} key={item.tmdbId}>{body}</Link>;
        })}
      </div>
    </section>
  );
}

export function TrailerModal(props: { youtubeKey: string; name: string; closeLabel: string; openLabel: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={props.name} onClick={props.onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${props.youtubeKey}`}
          title={props.name}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
        <div className="actions">
          <button className="text-button" type="button" onClick={props.onClose}>{props.closeLabel}</button>
          <a className="text-button" href={`https://www.youtube.com/watch?v=${props.youtubeKey}`} target="_blank" rel="noreferrer">{props.openLabel}</a>
        </div>
      </div>
    </div>
  );
}
