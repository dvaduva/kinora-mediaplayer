import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { CastMember, MediaVersion, MovieDetail, MovieReview, MovieReviews, OwnReview, SeriesDetail, SimilarTitle } from "@kinora/shared";
import { api } from "../api";
import { Focusable } from "../components/Focusable";
import { PosterCard } from "../components/Poster";
import { Rail } from "../components/Rail";
import { useLocale } from "../i18n";
import { codecLabel, formatBytes, formatRuntime, imageUrl, resolutionLabel, type Locale } from "@kinora/client";

export function MovieDetailPage() {
  const { id } = useParams();
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const [movie, setMovie] = useState<MovieDetail | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<MovieReviews | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api<MovieDetail>(`/api/movies/${id}`)
      .then((data) => {
        setMovie(data);
        setVersionId(data.defaultFileId);
      })
      .catch((reason: Error) => setError(reason.message));
    api<MovieReviews>(`/api/movies/${id}/reviews`)
      .then(setReviews)
      .catch(() => setReviews({ own: null, reviews: [] }));
  }, [id]);

  if (error) return <p className="state-message">{t.error}: {error}</p>;
  if (!movie) return <p className="state-message">{t.loading}</p>;

  const version = movie.versions.find((item) => item.fileId === versionId) ?? movie.versions[0] ?? null;
  const fileId = version?.fileId ?? movie.defaultFileId;
  const backdrop = imageUrl(movie.backdropPath, "w1280");
  const poster = imageUrl(movie.posterPath, "w500");
  const tech = versionFacts(version, locale);

  return (
    <div className="page detail-page">
      <section className="detail-hero" style={backdrop ? { backgroundImage: `url(${backdrop})` } : undefined}>
        <div className="detail-fade" />
        <div className="detail-body">
          {poster ? <div className="detail-poster" style={{ backgroundImage: `url(${poster})` }} /> : null}
          <div className="detail-copy">
            <p className="eyebrow">{t.movie}</p>
            <h1>
              {movie.title}
              {movie.year ? <span> {movie.year}</span> : null}
            </h1>
            <p className="meta">
              {[formatRuntime(movie.runtime), movie.genres.slice(0, 4).join(", ")].filter(Boolean).join(" · ")}
            </p>
            {movie.rating != null ? (
              <p className="detail-rating">
                {t.rating}: {movie.rating.toFixed(1)}
              </p>
            ) : null}
            {movie.lists.length > 0 ? (
              // Shown only: lists are made and filled in the web app.
              <p className="detail-lists">
                <span>{t.inLists}</span>
                {movie.lists.map((list) => (
                  <span key={list.id} className="list-tag">{list.name}</span>
                ))}
              </p>
            ) : null}
            {movie.tagline ? <p className="detail-tagline">{movie.tagline}</p> : null}
            {movie.overview ? <p className="lede detail-overview">{movie.overview}</p> : null}
            <div className="detail-credits">
              {movie.directors.length > 0 ? (
                <p>
                  <strong>{t.direction}</strong> {movie.directors.join(", ")}
                </p>
              ) : null}
              {movie.writers.length > 0 ? (
                <p>
                  <strong>{t.writers}</strong> {movie.writers.join(", ")}
                </p>
              ) : null}
              {tech ? (
                <p>
                  <strong>{t.file}</strong> {tech}
                </p>
              ) : null}
              {!movie.matched ? <p className="hint">{t.unmatched}</p> : null}
            </div>
            {movie.versions.length > 1 ? (
              <div className="season-tabs">
                {movie.versions.map((item) => (
                  <Focusable
                    key={item.fileId}
                    className={item.fileId === version?.fileId ? "chip is-active" : "chip"}
                    focusKey={`version-${item.fileId}`}
                    onEnterPress={() => setVersionId(item.fileId)}
                  >
                    {item.filename}
                  </Focusable>
                ))}
              </div>
            ) : null}
            <div className="hero-actions">
              {fileId ? (
                <Focusable className="btn primary" focusKey="detail-play" focusOnMount onEnterPress={() => navigate(`/play/${fileId}`)}>
                  {t.play}
                </Focusable>
              ) : (
                <p className="hint">{t.noFile}</p>
              )}
              <Focusable className="btn" focusKey="detail-back" onEnterPress={() => navigate(-1)}>
                {t.back}
              </Focusable>
            </div>
          </div>
        </div>
      </section>

      <ReviewsBlock
        reviews={reviews}
        onOwnSaved={(own) => {
          setReviews((current) => ({ own, reviews: current?.reviews ?? [] }));
          setMovie((current) => (current ? { ...current, userRating: own?.rating ?? null } : current));
        }}
        movieId={movie.id}
      />
      <CastRail title={t.cast} people={movie.cast} />
      <SimilarRail title={t.similar} items={movie.similar} />
    </div>
  );
}

export function SeriesDetailPage() {
  const { id } = useParams();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [seasonIndex, setSeasonIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api<SeriesDetail>(`/api/series/${id}`)
      .then((data) => {
        setSeries(data);
        setSeasonIndex(0);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [id]);

  const season = series?.seasons[seasonIndex] ?? null;
  const episodes = useMemo(() => season?.episodes.filter((episode) => episode.playable && episode.fileId) ?? [], [season]);

  if (error) return <p className="state-message">{t.error}: {error}</p>;
  if (!series) return <p className="state-message">{t.loading}</p>;

  const backdrop = imageUrl(series.backdropPath, "w1280");
  const poster = imageUrl(series.posterPath, "w500");
  const first = episodes[0]?.fileId ?? null;

  return (
    <div className="page detail-page">
      <section className="detail-hero" style={backdrop ? { backgroundImage: `url(${backdrop})` } : undefined}>
        <div className="detail-fade" />
        <div className="detail-body">
          {poster ? <div className="detail-poster" style={{ backgroundImage: `url(${poster})` }} /> : null}
          <div className="detail-copy">
            <p className="eyebrow">{t.show}</p>
            <h1>
              {series.title}
              {series.year ? <span> {series.year}</span> : null}
            </h1>
            <p className="meta">{series.genres.slice(0, 4).join(", ")}</p>
            {series.rating != null ? (
              <p className="detail-rating">
                {t.rating}: {series.rating.toFixed(1)}
              </p>
            ) : null}
            {series.overview ? <p className="lede detail-overview">{series.overview}</p> : null}
            <div className="detail-credits">
              {series.creators.length > 0 ? (
                <p>
                  <strong>{t.creators}</strong> {series.creators.join(", ")}
                </p>
              ) : null}
              {!series.matched ? <p className="hint">{t.unmatched}</p> : null}
            </div>
            <div className="hero-actions">
              {first ? (
                <Focusable className="btn primary" focusKey="series-play" focusOnMount onEnterPress={() => navigate(`/play/${first}`)}>
                  {t.play}
                </Focusable>
              ) : null}
              <Focusable className="btn" focusKey="series-back" onEnterPress={() => navigate(-1)}>
                {t.back}
              </Focusable>
            </div>
          </div>
        </div>
      </section>

      {series.seasons.length > 1 ? (
        <div className="season-tabs detail-seasons">
          {series.seasons.map((item, index) => (
            <Focusable
              key={item.seasonNumber}
              className={index === seasonIndex ? "chip is-active" : "chip"}
              focusKey={`season-${item.seasonNumber}`}
              onEnterPress={() => setSeasonIndex(index)}
            >
              {item.name || `${t.season} ${item.seasonNumber}`}
            </Focusable>
          ))}
        </div>
      ) : null}

      <div className="episode-list detail-episodes">
        {episodes.map((episode, index) => (
          <Focusable
            key={episode.id}
            className="episode"
            focusKey={`episode-${episode.id}`}
            focusOnMount={!first && index === 0}
            onEnterPress={() => episode.fileId && navigate(`/play/${episode.fileId}`)}
          >
            <strong>
              S{episode.seasonNumber}E{episode.episodeNumber}
            </strong>
            <span>{episode.title}</span>
            {episode.runtime ? <em>{formatRuntime(episode.runtime)}</em> : null}
          </Focusable>
        ))}
        {episodes.length === 0 ? <p className="hint">{t.noEpisodes}</p> : null}
      </div>

      <CastRail title={t.cast} people={series.cast} />
      <SimilarRail title={t.similar} items={series.similar} />
    </div>
  );
}

function ReviewsBlock(props: {
  movieId: string;
  reviews: MovieReviews | null;
  onOwnSaved: (own: OwnReview | null) => void;
}) {
  const { t } = useLocale();
  const [saving, setSaving] = useState(false);
  const own = props.reviews?.own ?? null;
  const items: MovieReview[] = [
    ...(own && (own.rating != null || own.body)
      ? [
          {
            id: "own",
            source: "own" as const,
            author: t.own,
            avatarUrl: null,
            rating: own.rating,
            body: own.body ?? "",
            date: new Date(own.updatedAt).toISOString(),
            url: null,
          },
        ]
      : []),
    ...(props.reviews?.reviews ?? []),
  ];

  async function rate(stars: number) {
    setSaving(true);
    try {
      const saved = await api<OwnReview>(`/api/movies/${props.movieId}/review`, {
        method: "PUT",
        body: JSON.stringify({ rating: stars, body: own?.body ?? null }),
      });
      props.onOwnSaved(saved);
    } catch {
      // keep previous
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="reviews-block">
      <div className="rate-row">
        <span className="hint">{t.yourRating}</span>
        {[1, 2, 3, 4, 5].map((stars) => (
          <Focusable
            key={stars}
            className={own?.rating != null && own.rating >= stars ? "chip is-active" : "chip"}
            focusKey={`rate-${stars}`}
            onEnterPress={() => {
              if (!saving) void rate(stars);
            }}
          >
            {stars}★
          </Focusable>
        ))}
      </div>
      {props.reviews == null ? (
        <p className="hint">{t.reviewsLoading}</p>
      ) : items.length === 0 ? (
        <p className="hint">{t.noReviews}</p>
      ) : (
        <Rail title={t.ratingsReviews} focusKey="rail-reviews" trackClassName="reviews-track">
          {items.map((review) => (
            <Focusable key={review.id} className="review-tile" focusKey={`review-${review.id}`}>
              <header>
                <strong>{review.author}</strong>
                {review.rating != null ? <span>{review.rating}/5</span> : null}
              </header>
              {review.body ? <p>{review.body}</p> : <p className="hint">—</p>}
            </Focusable>
          ))}
        </Rail>
      )}
    </section>
  );
}

function CastRail(props: { title: string; people: CastMember[] }) {
  const navigate = useNavigate();
  if (props.people.length === 0) return null;
  return (
    <Rail title={props.title} focusKey="rail-cast" trackClassName="cast-track">
      {props.people.slice(0, 16).map((person, index) => {
        const photo = imageUrl(person.profilePath, "w185");
        const canOpen = Boolean(person.tmdbPersonId);
        return (
          <Focusable
            key={`${person.tmdbPersonId ?? person.name}-${person.character ?? index}`}
            className="cast-card"
            focusKey={`cast-${person.tmdbPersonId ?? index}`}
            onEnterPress={() => {
              if (person.tmdbPersonId) navigate(`/people/${person.tmdbPersonId}`);
            }}
          >
            <div className="cast-photo" style={photo ? { backgroundImage: `url(${photo})` } : undefined}>
              {!photo ? <span>{person.name.slice(0, 1)}</span> : null}
            </div>
            <strong>{person.name}</strong>
            {person.character ? <span>{person.character}</span> : null}
            {!canOpen ? <span className="hint">—</span> : null}
          </Focusable>
        );
      })}
    </Rail>
  );
}

function SimilarRail(props: { title: string; items: SimilarTitle[] }) {
  const { t } = useLocale();
  if (props.items.length === 0) return null;
  return (
    <Rail title={props.title} focusKey="rail-similar">
      {props.items.map((item) => {
        const inLibrary = item.inLibrary && item.localId;
        const to = inLibrary ? (item.mediaType === "movie" ? `/movies/${item.localId}` : `/series/${item.localId}`) : null;
        if (to) {
          return (
            <PosterCard
              key={`${item.mediaType}-${item.tmdbId}`}
              focusKey={`similar-${item.tmdbId}`}
              to={to}
              title={item.title}
              meta={item.year ? String(item.year) : null}
              src={item.posterPath}
            />
          );
        }
        return (
          <div key={`${item.mediaType}-${item.tmdbId}`} className="poster is-dim">
            <div
              className="poster-art"
              style={item.posterPath ? { backgroundImage: `url(${imageUrl(item.posterPath, "w342")})` } : undefined}
            >
              {!item.posterPath ? <span className="poster-fallback">{item.title.slice(0, 1)}</span> : null}
            </div>
            <div className="poster-copy">
              <strong>{item.title}</strong>
              <span>{t.absent}</span>
            </div>
          </div>
        );
      })}
    </Rail>
  );
}

function versionFacts(version: MediaVersion | null, locale: Locale) {
  if (!version) return null;
  return [
    resolutionLabel(version.width, version.height),
    codecLabel(version.videoCodec),
    codecLabel(version.audio[0]?.codec ?? null),
    version.size ? formatBytes(version.size, locale) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
