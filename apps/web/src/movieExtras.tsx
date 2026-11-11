import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import type {
  ArtworkOption,
  ExternalRatings,
  MovieArtwork,
  MovieDetail,
  MovieEdit,
  MovieEditField,
  MovieReview,
  MovieReviews,
  OwnReview,
  TmdbCandidate,
} from "@kinora/shared";
import { api, formatDate, imageUrl, type Locale } from "@kinora/client";
import { useLocale } from "./i18n";
import { ScrollRail } from "./ui";

// ---------- Stars ----------

function Star(props: { fill: number }) {
  // fill: 0, 0.5 or 1
  return (
    <span className="star" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path className="star-outline" d={STAR_PATH} /></svg>
      {props.fill > 0 ? (
        <span className="star-fill" style={{ width: `${props.fill * 100}%` }}>
          <svg viewBox="0 0 24 24"><path d={STAR_PATH} /></svg>
        </span>
      ) : null}
    </span>
  );
}

const STAR_PATH = "M12 2.6l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.4l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z";

export function Stars(props: { value: number | null; size?: "small" | "large"; label?: string }) {
  const value = props.value ?? 0;
  return (
    <span className={`stars ${props.size ?? "small"}`} role="img" aria-label={props.label ?? `${value} / 5`}>
      {[1, 2, 3, 4, 5].map((index) => (
        <Star key={index} fill={value >= index ? 1 : value >= index - 0.5 ? 0.5 : 0} />
      ))}
    </span>
  );
}

/** Half-star picker: pointer position inside a star picks the half, arrows step by 0.5. */
function StarInput(props: { value: number | null; onChange: (value: number | null) => void; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? props.value ?? 0;
  const valueAt = (event: ReactMouseEvent<HTMLSpanElement>, index: number) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX - rect.left < rect.width / 2 ? index - 0.5 : index;
  };
  const onKey = (event: ReactKeyboardEvent) => {
    const current = props.value ?? 0;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") props.onChange(Math.min(5, current + 0.5));
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") props.onChange(current <= 0.5 ? null : current - 0.5);
    else if (event.key === "Home") props.onChange(0.5);
    else if (event.key === "End") props.onChange(5);
    else if (event.key === "Delete" || event.key === "Backspace") props.onChange(null);
    else return;
    event.preventDefault();
  };
  return (
    <div
      className="stars large star-input"
      role="slider"
      tabIndex={0}
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={5}
      aria-valuenow={props.value ?? 0}
      aria-valuetext={props.value ? `${props.value} / 5` : "—"}
      onKeyDown={onKey}
      onPointerLeave={() => setHover(null)}
    >
      {[1, 2, 3, 4, 5].map((index) => (
        <span
          key={index}
          className="star-hit"
          onPointerMove={(event) => setHover(valueAt(event, index))}
          onClick={(event) => {
            const next = valueAt(event, index);
            props.onChange(next === props.value ? null : next);
          }}
        >
          <Star fill={shown >= index ? 1 : shown >= index - 0.5 ? 0.5 : 0} />
        </span>
      ))}
    </div>
  );
}

// ---------- Dialog shell ----------

export function Dialog(props: { label: string; onClose: () => void; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose.current();
    };
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("[data-autofocus], input, textarea, button")?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previous?.focus?.();
    };
  }, []);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={props.label} onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <div ref={ref} className={`dialog ${props.className ?? ""}`}>
        {props.children}
      </div>
    </div>
  );
}

function CloseButton(props: { onClick: () => void }) {
  const { t } = useLocale();
  return (
    <button className="dialog-close" type="button" aria-label={t.close} onClick={props.onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  );
}

// ---------- External ratings row ----------

function TomatoIcon(props: { rotten: boolean }) {
  return props.rotten ? (
    <svg className="rating-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#8dc63f" d="M12 3l1.6 3.6 3.9-1.4-1 3.9 3.8 1.4-3.3 2.4 2.3 3.4-4-.3-.6 4-2.7-3-2.7 3-.6-4-4 .3 2.3-3.4-3.3-2.4 3.8-1.4-1-3.9 3.9 1.4z" />
    </svg>
  ) : (
    <svg className="rating-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="13.5" r="8" fill="#e8442a" />
      <path fill="#5aa03c" d="M12 6.2c-1.3-2-3.4-2.4-4.6-1.8 1.4.3 2.3 1 2.8 1.9-1.6-.2-3 .4-3.6 1.4 1.7-.3 3.3 0 4.4.9.4-.9 1.4-1.5 2.9-1.3-.4-.6-1-1-1.9-1.1z" />
    </svg>
  );
}

function PopcornIcon(props: { rotten: boolean }) {
  return (
    <svg className="rating-icon" viewBox="0 0 24 24" aria-hidden="true">
      {props.rotten ? (
        <path fill="#8a8f98" d="M6 11h12l-1.6 10H7.6z" />
      ) : (
        <>
          <circle cx="8" cy="8.5" r="2.6" fill="#fff4d6" />
          <circle cx="12" cy="7" r="3" fill="#fff4d6" />
          <circle cx="16" cy="8.5" r="2.6" fill="#fff4d6" />
          <path fill="#e8442a" d="M5.5 10.5h13l-1.7 10.5H7.2z" />
          <path fill="#fff" d="M9 10.5h2v10.5H9.6zM13 10.5h2l-.6 10.5H13z" opacity=".85" />
        </>
      )}
    </svg>
  );
}

function RatingChip(props: { href: string | null; title: string; children: ReactNode }) {
  return props.href ? (
    <a className="rating-chip" href={props.href} target="_blank" rel="noreferrer" title={props.title}>{props.children}</a>
  ) : (
    <span className="rating-chip" title={props.title}>{props.children}</span>
  );
}

export function useExternalRatings(movie: MovieDetail | null) {
  const [ratings, setRatings] = useState<ExternalRatings | null>(null);
  const [loading, setLoading] = useState(false);
  const id = movie?.id;
  const load = (refresh: boolean) => {
    if (!id) return;
    setLoading(true);
    api<ExternalRatings>(`/api/movies/${id}/ratings${refresh ? "?refresh=1" : ""}`)
      .then(setRatings)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };
  // Re-read when the identifiers that drive the lookup change after an edit or re-match.
  useEffect(() => {
    setRatings(null);
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, movie?.imdbId, movie?.rtSlug, movie?.tmdbId]);
  return { ratings, loading, refresh: () => load(true) };
}

export function RatingsBar(props: { movie: MovieDetail; ratings: ExternalRatings | null; loading: boolean; onRefresh: () => void; actions?: ReactNode }) {
  const { t, locale } = useLocale();
  const { movie, ratings } = props;
  const number = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-US");
  const imdbUrl = movie.imdbId ? `https://www.imdb.com/title/${movie.imdbId}/` : null;
  const tmdbUrl = movie.tmdbId ? `https://www.themoviedb.org/movie/${movie.tmdbId}` : null;
  const rt = ratings?.rottenTomatoes ?? null;
  const tmdbRating = ratings?.tmdb?.rating ?? movie.rating;
  return (
    <div className="ratings-bar" aria-busy={props.loading}>
      {imdbUrl ? (
        <RatingChip href={imdbUrl} title={ratings?.imdb ? `${t.imdbRating}${ratings.imdb.votes ? ` · ${number.format(ratings.imdb.votes)} ${t.votes}` : ""}` : ratings?.omdbMissing ? t.omdbHint : "IMDb"}>
          <span className="brand-imdb">IMDb</span>
          {ratings?.imdb ? <strong>{ratings.imdb.rating.toFixed(1)}</strong> : null}
        </RatingChip>
      ) : null}
      {rt?.critics ? (
        <RatingChip href={rt.url} title={`${t.tomatometer}${rt.critics.count ? ` · ${rt.critics.count} ${t.reviewsCount}` : ""}`}>
          <TomatoIcon rotten={rt.critics.rotten} />
          <strong>{rt.critics.score}%</strong>
        </RatingChip>
      ) : null}
      {rt?.audience ? (
        <RatingChip href={rt.url} title={`${t.popcornmeter}${rt.audience.count ? ` · ${rt.audience.count}` : ""}`}>
          <PopcornIcon rotten={rt.audience.rotten} />
          <strong>{rt.audience.score}%</strong>
        </RatingChip>
      ) : null}
      {ratings?.metacritic ? (
        <RatingChip href={ratings.metacritic.url} title={t.metacritic}>
          <span className={`brand-meta ${ratings.metacritic.score >= 61 ? "good" : ratings.metacritic.score >= 40 ? "mixed" : "bad"}`}>{ratings.metacritic.score}</span>
        </RatingChip>
      ) : null}
      {tmdbUrl ? (
        <RatingChip href={tmdbUrl} title={t.tmdbRating}>
          <span className="brand-tmdb">TMDB</span>
          {tmdbRating ? <strong>{Math.round(tmdbRating * 10)}%</strong> : null}
        </RatingChip>
      ) : null}
      {ratings?.rtUnreadable ? (
        <a className="rating-warning" href={rt?.url ?? "https://www.rottentomatoes.com/"} target="_blank" rel="noreferrer" title={t.rtUnreadableHelp}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9.5 17h-19z M12 10v4.5 M12 17.5h.01" /></svg>
          {t.rtUnreadable}
        </a>
      ) : null}
      {props.loading && !ratings ? <span className="rating-chip skeleton-chip" aria-hidden="true" /> : null}
      <button className="icon-button" type="button" onClick={props.onRefresh} disabled={props.loading} title={t.ratingsRefresh} aria-label={t.ratingsRefresh}>
        <svg viewBox="0 0 24 24" aria-hidden="true" className={props.loading ? "spin" : undefined}><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4.5h-4.5" /></svg>
      </button>
      {props.actions}
    </div>
  );
}

// ---------- Reviews ----------

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1]![0] : "")).toUpperCase();
}

const AVATAR_COLORS = ["#9b4d4d", "#4d7a9b", "#6d9b4d", "#8a4d9b", "#9b7a4d", "#4d9b8a", "#b0606f"];

function Avatar(props: { name: string; url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (props.url && !failed) return <img className="avatar" src={imageUrl(props.url, "w45") ?? ""} alt="" onError={() => setFailed(true)} />;
  const hash = [...props.name].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
  return <span className="avatar" style={{ background: AVATAR_COLORS[hash % AVATAR_COLORS.length] }} aria-hidden="true">{initialsOf(props.name)}</span>;
}

function SourceMark(props: { source: MovieReview["source"] }) {
  if (props.source === "rottentomatoes") return <span className="review-source rt">RT</span>;
  if (props.source === "tmdb") return <span className="review-source tmdb">TMDB</span>;
  return null;
}

function reviewDate(value: string | null, locale: Locale) {
  if (!value) return null;
  // RT sends display dates ("Mar 31, 2026"); TMDB sends ISO timestamps.
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? formatDate(value, locale) : value;
}

function ReviewCard(props: { review: MovieReview; onOpen: () => void }) {
  const { t, locale } = useLocale();
  const { review } = props;
  return (
    <button type="button" className={`review-card${review.source === "own" ? " own" : ""}`} onClick={props.onOpen}>
      <span className="review-head">
        <Avatar name={review.author} url={review.avatarUrl} />
        <span className="review-who">
          <span className="review-author">{review.author}</span>
          <small>{[reviewDate(review.date, locale), review.verified ? t.verified : null].filter(Boolean).join(" · ")}</small>
        </span>
        <SourceMark source={review.source} />
      </span>
      {review.rating != null ? <Stars value={review.rating} /> : null}
      {review.body ? <span className="review-body">{review.body}</span> : null}
    </button>
  );
}

function ReviewDetail(props: { review: MovieReview; onClose: () => void; onEdit?: () => void }) {
  const { t, locale } = useLocale();
  const { review } = props;
  return (
    <Dialog label={review.author} onClose={props.onClose} className="review-dialog">
      <CloseButton onClick={props.onClose} />
      <div className="review-head">
        <Avatar name={review.author} url={review.avatarUrl} />
        <span className="review-who">
          <span className="review-author">{review.author}</span>
          <small>{reviewDate(review.date, locale)}</small>
        </span>
      </div>
      {review.rating != null ? <Stars value={review.rating} size="large" /> : null}
      <div className="review-full">{review.body.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
      <div className="dialog-actions">
        {props.onEdit ? <button className="text-button" type="button" onClick={props.onEdit}>{t.edit}</button> : null}
        {review.url ? <a className="text-button" href={review.url} target="_blank" rel="noreferrer">{t.openSource}</a> : null}
      </div>
    </Dialog>
  );
}

export function ReviewsSection(props: {
  movie: MovieDetail;
  ratings: ExternalRatings | null;
  reviews: MovieReviews | null;
  onWrite: () => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState<MovieReview | null>(null);
  const own = props.reviews?.own;
  const items: MovieReview[] = [
    ...(own && (own.rating != null || own.body)
      ? [{ id: "own", source: "own" as const, author: t.own, avatarUrl: null, rating: own.rating, body: own.body ?? "", date: new Date(own.updatedAt).toISOString(), url: null }]
      : []),
    ...(props.reviews?.reviews ?? []),
  ];
  const consensus = props.ratings?.rottenTomatoes?.consensus;
  return (
    <section className="section reviews-section">
      <div className="row-head">
        <h2>{t.ratingsReviews}</h2>
      </div>
      {consensus ? (
        <blockquote className="consensus">
          <small>{t.criticsConsensus}</small>
          {consensus}
        </blockquote>
      ) : null}
      {props.reviews == null ? (
        <p className="muted">{t.reviewsLoading}</p>
      ) : items.length === 0 ? (
        <p className="muted">
          {t.noReviews} <button className="text-button inline" type="button" onClick={props.onWrite}>{t.rateReview}</button>
        </p>
      ) : (
        <ScrollRail className="review-rail">
          {items.map((review) => <ReviewCard key={review.id} review={review} onOpen={() => setOpen(review)} />)}
        </ScrollRail>
      )}
      {open ? (
        <ReviewDetail
          review={open}
          onClose={() => setOpen(null)}
          onEdit={open.source === "own" ? () => { setOpen(null); props.onWrite(); } : undefined}
        />
      ) : null}
    </section>
  );
}

export function useMovieReviews(movieId: string | undefined, reloadKey = "") {
  const [reviews, setReviews] = useState<MovieReviews | null>(null);
  const shownFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    // Keep the current list on screen while the same movie's reviews are re-read.
    if (shownFor.current !== movieId) setReviews(null);
    shownFor.current = movieId;
    if (!movieId) return;
    api<MovieReviews>(`/api/movies/${movieId}/reviews`).then(setReviews).catch(() => setReviews({ own: null, reviews: [] }));
  }, [movieId, reloadKey]);
  const setOwn = (own: OwnReview | null) => setReviews((current) => ({ own, reviews: current?.reviews ?? [] }));
  return { reviews, setOwn };
}

// ---------- Rate & review dialog ----------

export function ReviewDialog(props: { movie: MovieDetail; own: OwnReview | null; onClose: () => void; onSaved: (own: OwnReview | null) => void }) {
  const { t } = useLocale();
  const [rating, setRating] = useState<number | null>(props.own?.rating ?? null);
  const [body, setBody] = useState(props.own?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const save = async (next: { rating: number | null; body: string | null }) => {
    setSaving(true);
    setFailed(false);
    try {
      const saved = await api<OwnReview>(`/api/movies/${props.movie.id}/review`, { method: "PUT", body: JSON.stringify(next) });
      props.onSaved(saved.rating == null && !saved.body ? null : saved);
      props.onClose();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };
  const exists = Boolean(props.own && (props.own.rating != null || props.own.body));
  return (
    <Dialog label={props.movie.title} onClose={props.onClose} className="rate-dialog">
      <CloseButton onClick={props.onClose} />
      <h2 className="dialog-title">{props.movie.title}</h2>
      <h3>{t.yourRating}</h3>
      <div className="rate-stars">
        <StarInput value={rating} onChange={setRating} label={t.yourRating} />
        {rating != null ? <button className="text-button small" type="button" onClick={() => setRating(null)}>{t.clearRating}</button> : null}
      </div>
      <hr />
      <h3>{t.yourReview}</h3>
      <textarea className="review-input" value={body} onChange={(event) => setBody(event.target.value)} placeholder={t.reviewPlaceholder} maxLength={8000} rows={5} />
      {failed ? <p className="danger">{t.reviewSaveFailed}</p> : null}
      <div className="dialog-actions">
        {exists ? <button className="text-button danger" type="button" disabled={saving} onClick={() => void save({ rating: null, body: null })}>{t.deleteReview}</button> : null}
        <span className="spacer" />
        <button className="text-button" type="button" onClick={props.onClose}>{t.cancel}</button>
        <button className="play" type="button" disabled={saving} onClick={() => void save({ rating, body: body.trim() || null })}>{saving ? t.saving : t.save}</button>
      </div>
    </Dialog>
  );
}

// ---------- Plex-style edit dialog ----------

type EditTab = "general" | "tags" | "poster" | "background" | "info" | "match";

function matchQuery(movie: MovieDetail) {
  return movie.year ? `${movie.title} ${movie.year}` : movie.title;
}

function tmdbError(reason: unknown, t: { tmdbMissing: string; tmdbUnreachable: string }) {
  const code = reason instanceof Error ? reason.message : "error";
  if (code === "tmdb_not_configured") return t.tmdbMissing;
  if (code === "tmdb_unreachable" || code === "tmdb_failed") return t.tmdbUnreachable;
  return code;
}

interface Draft {
  title: string;
  sortTitle: string;
  originalTitle: string;
  edition: string;
  year: string;
  releaseDate: string;
  tagline: string;
  overview: string;
  genres: string[];
  directors: string[];
  writers: string[];
  posterPath: string | null;
  backdropPath: string | null;
  imdbId: string;
  rtSlug: string;
}

function draftOf(movie: MovieDetail): Draft {
  return {
    title: movie.title,
    sortTitle: movie.sortTitle ?? "",
    originalTitle: movie.originalTitle ?? "",
    edition: movie.edition ?? "",
    year: movie.year ? String(movie.year) : "",
    releaseDate: movie.releaseDate ?? "",
    tagline: movie.tagline ?? "",
    overview: movie.overview ?? "",
    genres: movie.genres,
    directors: movie.directors,
    writers: movie.writers,
    posterPath: movie.posterPath,
    backdropPath: movie.backdropPath,
    imdbId: movie.imdbId ?? "",
    rtSlug: movie.rtSlug ?? "",
  };
}

function nullable(value: string) {
  return value.trim() || null;
}

/** Only the fields that differ from the movie, in the API's shape. */
export function editPayload(movie: MovieDetail, draft: Draft, locked: Set<MovieEditField>): MovieEdit {
  const before = draftOf(movie);
  const edit: MovieEdit = {};
  const same = <K extends keyof Draft>(key: K) => JSON.stringify(before[key]) === JSON.stringify(draft[key]);
  if (!same("title")) edit.title = draft.title.trim();
  if (!same("sortTitle")) edit.sortTitle = nullable(draft.sortTitle);
  if (!same("originalTitle")) edit.originalTitle = nullable(draft.originalTitle);
  if (!same("edition")) edit.edition = nullable(draft.edition);
  if (!same("year")) edit.year = draft.year.trim() ? Number(draft.year) : null;
  if (!same("releaseDate")) edit.releaseDate = nullable(draft.releaseDate);
  if (!same("tagline")) edit.tagline = nullable(draft.tagline);
  if (!same("overview")) edit.overview = nullable(draft.overview);
  if (!same("genres")) edit.genres = draft.genres;
  if (!same("directors")) edit.directors = draft.directors;
  if (!same("writers")) edit.writers = draft.writers;
  if (!same("posterPath")) edit.posterPath = draft.posterPath;
  if (!same("backdropPath")) edit.backdropPath = draft.backdropPath;
  if (!same("imdbId")) edit.imdbId = nullable(draft.imdbId);
  if (!same("rtSlug")) edit.rtSlug = nullable(draft.rtSlug);
  const lockList = [...locked].sort();
  if (JSON.stringify(lockList) !== JSON.stringify([...movie.locked].sort())) edit.locked = lockList;
  return edit;
}

function LockButton(props: { locked: boolean; onToggle: () => void }) {
  const { t } = useLocale();
  return (
    <button
      type="button"
      className={`lock-button${props.locked ? " locked" : ""}`}
      aria-pressed={props.locked}
      title={props.locked ? t.unlockField : t.lockField}
      aria-label={props.locked ? t.unlockField : t.lockField}
      onClick={props.onToggle}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d={props.locked ? "M8 11V8a4 4 0 0 1 8 0v3" : "M8 11V8a4 4 0 0 1 7.5-2"} />
      </svg>
    </button>
  );
}

function EditRow(props: { label: string; field: MovieEditField; locked: Set<MovieEditField>; onLock: (field: MovieEditField) => void; help?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="edit-row">
      <label htmlFor={id}>{props.label}</label>
      <div className="edit-control">
        <LockButton locked={props.locked.has(props.field)} onToggle={() => props.onLock(props.field)} />
        {props.children(id)}
      </div>
      {props.help ? <small className="muted">{props.help}</small> : null}
    </div>
  );
}

function TagInput(props: { id: string; values: string[]; onChange: (values: string[]) => void }) {
  const { t } = useLocale();
  const [text, setText] = useState("");
  const add = () => {
    const parts = text.split(",").map((item) => item.trim()).filter(Boolean);
    if (parts.length) props.onChange([...new Set([...props.values, ...parts])]);
    setText("");
  };
  return (
    <div className="tag-input">
      {props.values.map((value) => (
        <span className="tag" key={value}>
          {value}
          <button type="button" aria-label={`${t.tagRemove} ${value}`} onClick={() => props.onChange(props.values.filter((item) => item !== value))}>×</button>
        </span>
      ))}
      <input
        id={props.id}
        value={text}
        placeholder={t.tagAdd}
        onChange={(event) => setText(event.target.value)}
        onBlur={add}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            add();
          } else if (event.key === "Backspace" && !text && props.values.length) {
            props.onChange(props.values.slice(0, -1));
          }
        }}
      />
    </div>
  );
}

function ArtworkPicker(props: { kind: "poster" | "backdrop"; options: ArtworkOption[] | null; failed: boolean; current: string | null; onPick: (path: string) => void }) {
  const { t } = useLocale();
  if (props.failed) return <p className="muted">{t.artworkFailed}</p>;
  if (!props.options) return <p className="muted">{t.artworkLoading}</p>;
  const options = props.current && !props.options.some((item) => item.path === props.current)
    ? [{ path: props.current, language: null, width: 0, height: 0, votes: 0 }, ...props.options]
    : props.options;
  if (options.length === 0) return <p className="muted">{t.artworkNone}</p>;
  return (
    <div className={`artwork-grid ${props.kind}`} role="radiogroup">
      {options.map((item) => (
        <button
          key={item.path}
          type="button"
          role="radio"
          aria-checked={item.path === props.current}
          className="artwork-option"
          onClick={() => props.onPick(item.path)}
        >
          <img src={imageUrl(item.path, props.kind === "poster" ? "w185" : "w300") ?? ""} alt="" loading="lazy" decoding="async" />
          <small>{item.path === props.current ? t.artworkCurrent : [item.language?.toUpperCase(), item.width ? `${item.width}×${item.height}` : null].filter(Boolean).join(" · ")}</small>
        </button>
      ))}
    </div>
  );
}

export function EditMovieDialog(props: { movie: MovieDetail; onClose: () => void; onSaved: (movie: MovieDetail) => void }) {
  const { t } = useLocale();
  const [movie, setMovie] = useState(props.movie);
  const [tab, setTab] = useState<EditTab>("general");
  const [draft, setDraft] = useState<Draft>(() => draftOf(props.movie));
  const [locked, setLocked] = useState<Set<MovieEditField>>(() => new Set(props.movie.locked));
  const [artwork, setArtwork] = useState<MovieArtwork | null>(null);
  const [artworkFailed, setArtworkFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(() => matchQuery(props.movie));
  const [candidates, setCandidates] = useState<TmdbCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [choosing, setChoosing] = useState<number | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [matchNote, setMatchNote] = useState<string | null>(null);

  useEffect(() => {
    if ((tab !== "poster" && tab !== "background") || artwork || artworkFailed) return;
    api<MovieArtwork>(`/api/movies/${movie.id}/artwork`).then(setArtwork).catch(() => setArtworkFailed(true));
  }, [tab, artwork, artworkFailed, movie.id]);

  // Like Plex: changing a field locks it so a later re-match does not undo the edit.
  const set = <K extends keyof Draft & MovieEditField>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setLocked((current) => new Set(current).add(key));
  };
  const toggleLock = (field: MovieEditField) =>
    setLocked((current) => {
      const next = new Set(current);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });

  const applyMatched = (updated: MovieDetail) => {
    setMovie(updated);
    setDraft(draftOf(updated));
    setLocked(new Set(updated.locked));
    setArtwork(null);
    setArtworkFailed(false);
    setCandidates([]);
    setSearched(false);
    setQuery(matchQuery(updated));
    setMatchNote(t.matchApplied);
    props.onSaved(updated);
  };

  const lookup = async () => {
    setMatchError(null);
    setMatchNote(null);
    setSearching(true);
    setSearched(false);
    try {
      const year = draft.year.trim() ? Number(draft.year) : movie.year;
      const result = await api<{ results: TmdbCandidate[] }>("/api/tmdb/search", {
        method: "POST",
        body: JSON.stringify({ kind: "movie", query, year }),
      });
      setCandidates(result.results);
      setSearched(true);
    } catch (reason) {
      setMatchError(tmdbError(reason, t));
      setCandidates([]);
    } finally {
      setSearching(false);
    }
  };

  const choose = async (tmdbId: number) => {
    if (choosing != null) return;
    setMatchError(null);
    setMatchNote(null);
    setChoosing(tmdbId);
    try {
      const updated = await api<MovieDetail>(`/api/movies/${movie.id}/match`, {
        method: "POST",
        body: JSON.stringify({ tmdbId }),
      });
      applyMatched(updated);
      setTab("general");
    } catch (reason) {
      setMatchError(tmdbError(reason, t));
    } finally {
      setChoosing(null);
    }
  };

  const save = async () => {
    const payload = editPayload(movie, draft, locked);
    if (Object.keys(payload).length === 0) {
      props.onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await api<MovieDetail>(`/api/movies/${movie.id}`, { method: "PUT", body: JSON.stringify(payload) });
      props.onSaved(updated);
      props.onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "error");
    } finally {
      setSaving(false);
    }
  };

  const busy = searching || choosing != null;
  const row = { locked, onLock: toggleLock };
  const tabs: { id: EditTab; label: string; icon: string }[] = [
    { id: "general", label: t.tabGeneral, icon: "M4 6h16M4 12h16M4 18h10" },
    { id: "tags", label: t.tabTags, icon: "M3 12V4h8l10 10-8 8z M7.5 7.5h.01" },
    { id: "poster", label: t.tabPoster, icon: "M5 3h14v18H5z M5 16l4-4 3 3 3-3 4 4" },
    { id: "background", label: t.tabBackground, icon: "M3 5h18v14H3z M3 15l5-5 4 4 3-3 6 6" },
    { id: "info", label: t.tabInfo, icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 11v6 M12 7.5h.01" },
    { id: "match", label: t.tabMatch, icon: "M11 5a6 6 0 1 1 0 12 6 6 0 0 1 0-12z M16.5 16.5L21 21" },
  ];

  return (
    <Dialog label={`${t.editTitle} ${movie.title}`} onClose={props.onClose} className="edit-dialog">
      <header className="edit-header">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z M14 6l4 4" /></svg>
        <h2>{t.editTitle} {movie.title}</h2>
        <CloseButton onClick={props.onClose} />
      </header>
      <div className="edit-body">
        <nav className="edit-tabs" role="tablist" aria-orientation="vertical">
          {tabs.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={item.icon} /></svg>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="edit-panel" role="tabpanel">
          {tab === "general" ? (
            <>
              <EditRow label={t.fieldTitle} field="title" {...row}>{(id) => <input id={id} value={draft.title} onChange={(event) => set("title", event.target.value)} required />}</EditRow>
              <EditRow label={t.fieldSortTitle} field="sortTitle" {...row}>{(id) => <input id={id} value={draft.sortTitle} placeholder={draft.title} onChange={(event) => set("sortTitle", event.target.value)} />}</EditRow>
              <EditRow label={t.fieldOriginalTitle} field="originalTitle" {...row}>{(id) => <input id={id} value={draft.originalTitle} onChange={(event) => set("originalTitle", event.target.value)} />}</EditRow>
              <EditRow label={t.fieldEdition} field="edition" help={t.fieldEditionHelp} {...row}>{(id) => <input id={id} value={draft.edition} onChange={(event) => set("edition", event.target.value)} />}</EditRow>
              <div className="edit-pair">
                <EditRow label={t.fieldYear} field="year" {...row}>{(id) => <input id={id} inputMode="numeric" pattern="\d{4}" maxLength={4} value={draft.year} onChange={(event) => set("year", event.target.value.replace(/\D/g, ""))} />}</EditRow>
                <EditRow label={t.fieldReleaseDate} field="releaseDate" {...row}>{(id) => <input id={id} type="date" value={draft.releaseDate} onChange={(event) => set("releaseDate", event.target.value)} />}</EditRow>
              </div>
              <EditRow label={t.fieldTagline} field="tagline" {...row}>{(id) => <input id={id} value={draft.tagline} onChange={(event) => set("tagline", event.target.value)} />}</EditRow>
              <EditRow label={t.fieldOverview} field="overview" {...row}>{(id) => <textarea id={id} rows={6} value={draft.overview} onChange={(event) => set("overview", event.target.value)} />}</EditRow>
            </>
          ) : null}
          {tab === "tags" ? (
            <>
              <EditRow label={t.fieldGenres} field="genres" {...row}>{(id) => <TagInput id={id} values={draft.genres} onChange={(values) => set("genres", values)} />}</EditRow>
              <EditRow label={t.fieldDirectors} field="directors" {...row}>{(id) => <TagInput id={id} values={draft.directors} onChange={(values) => set("directors", values)} />}</EditRow>
              <EditRow label={t.fieldWriters} field="writers" {...row}>{(id) => <TagInput id={id} values={draft.writers} onChange={(values) => set("writers", values)} />}</EditRow>
            </>
          ) : null}
          {tab === "poster" ? (
            <div className="edit-artwork">
              <div className="edit-control">
                <LockButton locked={locked.has("posterPath")} onToggle={() => toggleLock("posterPath")} />
                <span className="muted">{t.lockHelp}</span>
              </div>
              <ArtworkPicker kind="poster" options={artwork?.posters ?? null} failed={artworkFailed} current={draft.posterPath} onPick={(value) => set("posterPath", value)} />
            </div>
          ) : null}
          {tab === "background" ? (
            <div className="edit-artwork">
              <div className="edit-control">
                <LockButton locked={locked.has("backdropPath")} onToggle={() => toggleLock("backdropPath")} />
                <span className="muted">{t.lockHelp}</span>
              </div>
              <ArtworkPicker kind="backdrop" options={artwork?.backdrops ?? null} failed={artworkFailed} current={draft.backdropPath} onPick={(value) => set("backdropPath", value)} />
            </div>
          ) : null}
          {tab === "info" ? (
            <>
              <EditRow label={t.fieldImdb} field="imdbId" {...row}>{(id) => <input id={id} value={draft.imdbId} placeholder="tt1234567" onChange={(event) => set("imdbId", event.target.value.trim())} />}</EditRow>
              <EditRow label={t.fieldRt} field="rtSlug" help={t.fieldRtHelp} {...row}>{(id) => <input id={id} value={draft.rtSlug} placeholder="https://www.rottentomatoes.com/m/…" onChange={(event) => set("rtSlug", event.target.value)} />}</EditRow>
              <div className="edit-row">
                <span>{t.fieldTmdb}</span>
                <div className="edit-control readonly">{movie.tmdbId ?? "—"}</div>
              </div>
              <p className="muted small-print">{t.lockHelp}</p>
            </>
          ) : null}
          {tab === "match" ? (
            <div className="edit-match">
              <p className="muted">{t.matchHint}</p>
              <div className="inline-form">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label={t.lookup}
                  placeholder={t.matchPlaceholder}
                  disabled={busy}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void lookup();
                    }
                  }}
                />
                <button className="text-button" type="button" onClick={() => void lookup()} disabled={busy || !query.trim()}>
                  {searching ? t.matching : t.lookup}
                </button>
              </div>
              {matchError ? <p className="danger">{t.matchFailed}: {matchError}</p> : null}
              {matchNote ? <p className="ok">{matchNote}</p> : null}
              {!matchError && !searching && searched && candidates.length === 0 ? <p className="muted">{t.matchEmpty}</p> : null}
              <div className="candidates">
                {candidates.map((candidate) => (
                  <button
                    className="candidate"
                    type="button"
                    key={candidate.tmdbId}
                    disabled={busy}
                    onClick={() => void choose(candidate.tmdbId)}
                  >
                    {candidate.posterPath ? <img src={imageUrl(candidate.posterPath, "w185") ?? ""} alt="" loading="lazy" /> : <span />}
                    <span>{candidate.title} {candidate.year ? `(${candidate.year})` : ""}</span>
                    <span>{choosing === candidate.tmdbId ? t.matching : t.choose}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <footer className="edit-footer">
        {error ? <span className="danger">{t.editFailed}: {error}</span> : null}
        <span className="spacer" />
        <button className="secondary-button" type="button" onClick={props.onClose}>{t.cancel}</button>
        {tab === "match" ? null : (
          <button className="play" type="button" disabled={saving || !draft.title.trim()} onClick={() => void save()}>{saving ? t.saving : t.saveChanges}</button>
        )}
      </footer>
    </Dialog>
  );
}
