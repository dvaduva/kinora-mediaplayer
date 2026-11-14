import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { WATCH_STATUSES, type CastMember, type ExternalTitleDetail, type MediaVersion, type MovieDetail, type SeriesDetail, type SimilarTitle, type Trailer, type WatchStatus } from "@kinora/shared";
import { api, codecLabel, formatBytes, formatDate, formatRuntime, imageUrl, resolutionLabel, type Locale } from "@kinora/client";
import { useLocale } from "../i18n";
import { Poster, ScrollRail, statusLabel } from "../ui";
import { MovieListsDialog } from "../lists";
import { EditMovieDialog, RatingsBar, ReviewDialog, ReviewsSection, Stars, useExternalRatings, useMovieReviews } from "../movieExtras";

export function MoviePage() {
  const { id } = useParams();
  const { t, locale } = useLocale();
  const [movie, setMovie] = useState<MovieDetail | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [listsOpen, setListsOpen] = useState(false);
  const external = useExternalRatings(movie);
  // Rotten Tomatoes audience reviews arrive with the ratings lookup, so reload the list when it finishes.
  const { reviews, setOwn } = useMovieReviews(movie?.id, String(external.ratings?.fetchedAt ?? ""));
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
  const ownRating = reviews ? reviews.own?.rating ?? null : movie.userRating;
  return (
    <article>
      <DossierHero
        title={movie.title}
        edition={movie.edition}
        tagline={movie.tagline}
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
        status={
          <>
            <WatchStatusControl movie={movie} onChange={(next) => setMovie((current) => (current ? { ...current, ...next } : current))} />
            {movie.lists.length > 0 ? (
              <p className="movie-lists">
                <span className="muted">{t.inLists}</span>
                {movie.lists.map((list) => (
                  <Link key={list.id} className="list-chip" to={`/lists/${list.id}`}>{list.name}</Link>
                ))}
              </p>
            ) : null}
          </>
        }
        ratingsBar={
          <RatingsBar
            movie={movie}
            ratings={external.ratings}
            loading={external.loading}
            onRefresh={external.refresh}
            actions={
              <>
                <button className="pill-button" type="button" onClick={() => setReviewOpen(true)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" /></svg>
                  {ownRating != null ? <Stars value={ownRating} label={`${t.yourRating}: ${ownRating}/5`} /> : t.rateReview}
                </button>
                <button className="pill-button" type="button" onClick={() => setEditOpen(true)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z M14 6l4 4" /></svg>
                  {t.edit}
                </button>
                <button className="pill-button" type="button" onClick={() => setListsOpen(true)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="1.5" /><path d="M6.5 5h11M9 2.5h6" /></svg>
                  {t.lists}
                </button>
              </>
            }
          />
        }
      />
      <Stills stills={movie.stills} load={stage >= STAGE.stills} />
      <Cast cast={movie.cast} title={t.cast} load={stage >= STAGE.cast} />
      <ReviewsSection movie={movie} ratings={external.ratings} reviews={reviews} onWrite={() => setReviewOpen(true)} />
      <Similar items={movie.similar} title={t.similar} absent={t.absent} load={stage >= STAGE.similar} />
      {trailerOpen && movie.trailer ? (
        <TrailerModal youtubeKey={movie.trailer.key} name={movie.trailer.name} closeLabel={t.close} openLabel={t.openYoutube} onClose={() => setTrailerOpen(false)} />
      ) : null}
      {reviewOpen ? (
        <ReviewDialog
          movie={movie}
          own={reviews?.own ?? null}
          onClose={() => setReviewOpen(false)}
          onSaved={(own) => {
            setOwn(own);
            setMovie((current) => (current ? { ...current, userRating: own?.rating ?? null } : current));
          }}
        />
      ) : null}
      {listsOpen ? (
        <MovieListsDialog
          movieId={movie.id}
          title={movie.title}
          current={movie.lists}
          onClose={() => setListsOpen(false)}
          onChange={(lists) => setMovie((current) => (current ? { ...current, lists } : current))}
        />
      ) : null}
      {editOpen ? <EditMovieDialog movie={movie} onClose={() => setEditOpen(false)} onSaved={setMovie} /> : null}
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

/** Detail page for a TMDB title that is not in the library: facts, cast and every trailer, fetched live. */
export function ExternalTitlePage() {
  const { kind, id } = useParams();
  const { t, locale } = useLocale();
  const [title, setTitle] = useState<ExternalTitleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<Trailer | null>(null);
  useEffect(() => {
    if (!kind || !id) return;
    setTitle(null);
    setError(null);
    setPlaying(null);
    api<ExternalTitleDetail>(`/api/tmdb/${kind}/${id}`).then(setTitle).catch((reason: Error) => setError(reason.message));
  }, [kind, id]);
  if (title?.localId) return <Navigate replace to={title.mediaType === "tv" ? `/series/${title.localId}` : `/movies/${title.localId}`} />;
  if (error) return <p className="muted">{error === "tmdb_not_configured" ? t.externalNoTmdb : t.externalFailed}</p>;
  if (!title) return <p className="muted">…</p>;
  const facts = [formatRuntime(title.runtime), title.genres.join(", "), formatDate(title.releaseDate, locale)].filter(Boolean).join(" · ");
  const main = title.videos[0] ?? null;
  return (
    <article>
      <header className="dossier-hero" style={{ backgroundImage: title.backdropPath ? `url(${imageUrl(title.backdropPath, "w1280")})` : undefined }}>
        <div className="billboard-fade" />
      </header>
      <div className="dossier-grid">
        <Poster src={title.posterPath} alt="" />
        <div>
          <p className="edition">{title.mediaType === "tv" ? `${t.seriesBadge} · ${t.absent}` : t.absent}</p>
          <h1>
            {title.title} {title.year ? <span className="year">{title.year}</span> : null}
          </h1>
          {title.originalTitle && title.originalTitle !== title.title ? <p className="muted">{title.originalTitle}</p> : null}
          {facts ? <p className="facts">{facts}</p> : null}
          {title.tagline ? <p className="tagline">{title.tagline}</p> : null}
          {title.overview ? <p className="overview">{title.overview}</p> : null}
          <div className="actions">
            {main ? <button className="play" type="button" onClick={() => setPlaying(main)}>{t.trailer}</button> : null}
            {title.imdbId ? <a className="text-button" href={`https://www.imdb.com/title/${title.imdbId}`} target="_blank" rel="noreferrer">{t.imdb}</a> : null}
            <a className="text-button" href={`https://www.themoviedb.org/${title.mediaType}/${title.tmdbId}`} target="_blank" rel="noreferrer">{t.tmdbLink}</a>
          </div>
        </div>
        <aside>
          {title.rating ? (
            <p className="score">
              {title.rating.toFixed(1)} <small className="muted">{t.rating}</small>
            </p>
          ) : null}
          <People label={t.direction} names={title.directors} />
          <People label={t.writers} names={title.writers} />
          <People label={t.creators} names={title.creators} />
        </aside>
      </div>
      <Videos videos={title.videos} title={t.videos} types={{ Trailer: t.trailer, Teaser: t.videoTeaser, Clip: t.videoClip, Featurette: t.videoFeaturette, "Behind the Scenes": t.videoBehind }} onPlay={setPlaying} />
      <Stills stills={title.stills} />
      <Cast cast={title.cast} title={t.cast} />
      <Similar items={title.similar} title={t.similar} absent={t.absent} />
      {playing ? <TrailerModal youtubeKey={playing.key} name={playing.name} closeLabel={t.close} openLabel={t.openYoutube} onClose={() => setPlaying(null)} /> : null}
    </article>
  );
}

function Videos(props: { videos: Trailer[]; title: string; types: Record<string, string>; onPlay: (video: Trailer) => void }) {
  if (props.videos.length === 0) return null;
  return (
    <section className="section">
      <h2>{props.title}</h2>
      <ScrollRail className="rail video-rail">
        {props.videos.map((video) => (
          <button className="video-card" type="button" key={video.key} onClick={() => props.onPlay(video)}>
            <span className="video-thumb">
              <img className="still" src={`https://i.ytimg.com/vi/${video.key}/hqdefault.jpg`} alt="" loading="lazy" decoding="async" />
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
            </span>
            <span>{video.name}</span>
            <small>{[props.types[video.type] ?? video.type, video.language?.toUpperCase()].filter(Boolean).join(" · ")}</small>
          </button>
        ))}
      </ScrollRail>
    </section>
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
  edition?: string | null;
  tagline?: string | null;
  ratingsBar?: ReactNode;
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
  locale: Locale;
  unmatched: string | null;
  ratingLabel: string;
  status?: ReactNode;
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
          {props.edition ? <p className="edition">{props.edition}</p> : null}
          {props.facts ? <p className="facts">{props.facts}</p> : null}
          {props.ratingsBar}
          {props.tagline ? <p className="tagline">{props.tagline}</p> : null}
          {props.overview ? <p className="overview">{props.overview}</p> : null}
          <div className="actions">
            {props.playTo ? <Link className="play" to={props.playTo}>{props.playLabel}</Link> : null}
            {props.trailer ? <button className="text-button" type="button" onClick={props.onTrailer}>{props.trailerLabel}</button> : null}
          </div>
          {props.status}
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
        </aside>
      </div>
    </>
  );
}

/**
 * New / Unwatched / Watched toggle. Without a manual mark the derived status is shown as "automatic";
 * picking the current manual status again, or "Back to automatic", clears the mark.
 */
function WatchStatusControl(props: { movie: MovieDetail; onChange: (next: Pick<MovieDetail, "watchStatus" | "watchStatusManual">) => void }) {
  const { t } = useLocale();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const save = async (status: WatchStatus | null) => {
    const previous = { watchStatus: props.movie.watchStatus, watchStatusManual: props.movie.watchStatusManual };
    setSaving(true);
    setFailed(false);
    if (status) props.onChange({ watchStatus: status, watchStatusManual: true });
    try {
      await api(`/api/movies/${props.movie.id}/status`, { method: "PUT", body: JSON.stringify({ status }) });
      if (!status) {
        // The automatic status depends on playback history the client does not have.
        const fresh = await api<MovieDetail>(`/api/movies/${props.movie.id}`);
        props.onChange({ watchStatus: fresh.watchStatus, watchStatusManual: fresh.watchStatusManual });
      }
    } catch {
      props.onChange(previous);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="watch-status">
      <span className="muted">{t.statusLabel}</span>
      <div className="filter-tabs" role="group" aria-label={t.statusLabel} aria-busy={saving}>
        {WATCH_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            aria-pressed={props.movie.watchStatus === status}
            disabled={saving}
            onClick={() => void save(props.movie.watchStatusManual && props.movie.watchStatus === status ? null : status)}
          >
            {statusLabel(status, t)}
          </button>
        ))}
      </div>
      {props.movie.watchStatusManual ? (
        <button className="text-button small" type="button" disabled={saving} onClick={() => void save(null)}>{t.statusReset}</button>
      ) : (
        <small className="muted">{t.statusAuto}</small>
      )}
      {failed ? <small className="danger">{t.statusFailed}</small> : null}
    </div>
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
    <section className="section">
      <ScrollRail className="still-rail">
        {props.stills.map((still) =>
          load ? <img key={still} className="still" src={imageUrl(still, "w780") ?? ""} alt="" /> : <div key={still} className="still" />
        )}
      </ScrollRail>
    </section>
  );
}

function Cast(props: { cast: CastMember[]; title: string; load?: boolean }) {
  if (props.cast.length === 0) return null;
  const load = props.load ?? true;
  return (
    <section className="section">
      <h2>{props.title}</h2>
      <ScrollRail className="cast-rail">
        {props.cast.map((person) => {
          const body = (
            <>
              {person.profilePath && load ? <img src={imageUrl(person.profilePath, "w185") ?? ""} alt="" /> : <div className="face" />}
              <span>{person.name}</span>
              {person.character ? <small>{person.character}</small> : null}
            </>
          );
          const key = `${person.name}-${person.character}`;
          return person.tmdbPersonId ? (
            <Link className="cast-card linked" to={`/people/${person.tmdbPersonId}`} key={key}>{body}</Link>
          ) : (
            <article className="cast-card" key={key}>{body}</article>
          );
        })}
      </ScrollRail>
    </section>
  );
}

function Similar(props: { items: SimilarTitle[]; title: string; absent: string; load?: boolean }) {
  if (props.items.length === 0) return null;
  const load = props.load ?? true;
  return (
    <section className="section">
      <h2>{props.title}</h2>
      <ScrollRail className="rail">
        {props.items.map((item) => {
          const body = (
            <>
              <Poster src={load ? item.posterPath : null} alt="" />
              <span>{item.title}</span>
              <small>{item.inLibrary ? item.year : props.absent}</small>
            </>
          );
          if (!item.inLibrary || !item.localId) {
            return <Link className="poster-card dim" to={`/discover/${item.mediaType}/${item.tmdbId}`} key={item.tmdbId}>{body}</Link>;
          }
          const to = item.mediaType === "tv" ? `/series/${item.localId}` : `/movies/${item.localId}`;
          return <Link className="poster-card" to={to} key={item.tmdbId}>{body}</Link>;
        })}
      </ScrollRail>
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
