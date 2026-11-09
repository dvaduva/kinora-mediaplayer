import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { MovieDetail, SeriesDetail } from "@kinora/shared";
import { api } from "../api";
import { Focusable } from "../components/Focusable";
import { useLocale } from "../i18n";
import { formatRuntime, imageUrl } from "../media";

export function MovieDetailPage() {
  const { id } = useParams();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [movie, setMovie] = useState<MovieDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api<MovieDetail>(`/api/movies/${id}`)
      .then(setMovie)
      .catch((reason: Error) => setError(reason.message));
  }, [id]);

  if (error) return <p className="state-message">{t.error}: {error}</p>;
  if (!movie) return <p className="state-message">{t.loading}</p>;

  const backdrop = imageUrl(movie.backdropPath ?? movie.posterPath, "w1280");
  const fileId = movie.defaultFileId ?? movie.versions[0]?.fileId ?? null;

  return (
    <article className="detail" style={backdrop ? { backgroundImage: `url(${backdrop})` } : undefined}>
      <div className="detail-fade" />
      <div className="detail-copy">
        <p className="eyebrow">{t.movie}</p>
        <h1>
          {movie.title}
          {movie.year ? <span> {movie.year}</span> : null}
        </h1>
        <p className="meta">
          {[formatRuntime(movie.runtime), movie.genres.slice(0, 3).join(", ")].filter(Boolean).join(" · ")}
        </p>
        {movie.overview ? <p className="lede">{movie.overview}</p> : null}
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
    </article>
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

  const backdrop = imageUrl(series.backdropPath ?? series.posterPath, "w1280");
  const first = episodes[0]?.fileId ?? null;

  return (
    <article className="detail series-detail" style={backdrop ? { backgroundImage: `url(${backdrop})` } : undefined}>
      <div className="detail-fade" />
      <div className="detail-copy">
        <p className="eyebrow">{t.show}</p>
        <h1>
          {series.title}
          {series.year ? <span> {series.year}</span> : null}
        </h1>
        {series.overview ? <p className="lede">{series.overview}</p> : null}
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

        {series.seasons.length > 1 ? (
          <div className="season-tabs">
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

        <div className="episode-list">
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
      </div>
    </article>
  );
}
