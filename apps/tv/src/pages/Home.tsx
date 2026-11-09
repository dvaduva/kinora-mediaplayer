import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { HomeView } from "@kinora/shared";
import { api } from "../api";
import { Focusable } from "../components/Focusable";
import { PosterCard } from "../components/Poster";
import { Rail } from "../components/Rail";
import { useLocale } from "../i18n";
import { imageUrl } from "../media";

export function HomePage() {
  const { t } = useLocale();
  const [home, setHome] = useState<HomeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api<HomeView>("/api/home")
      .then(setHome)
      .catch((reason: Error) => setError(reason.message));
  }, []);

  if (error) return <p className="state-message">{t.error}: {error}</p>;
  if (!home) return <p className="state-message">{t.loading}</p>;

  const empty = home.movies.length === 0 && home.series.length === 0 && home.albums.length === 0;
  const featuredPoster = imageUrl(home.featured?.backdropPath ?? home.featured?.posterPath ?? null, "w1280");

  return (
    <div className="page home">
      {home.featured ? (
        <section className="hero" style={featuredPoster ? { backgroundImage: `url(${featuredPoster})` } : undefined}>
          <div className="hero-fade" />
          <div className="hero-copy">
            <p className="eyebrow">{t.recommended}</p>
            <h1>
              {home.featured.title}
              {home.featured.year ? <span> {home.featured.year}</span> : null}
            </h1>
            {home.featured.overview ? <p className="lede">{home.featured.overview}</p> : null}
            <div className="hero-actions">
              {home.featured.defaultFileId ? (
                <Focusable
                  className="btn primary"
                  focusKey="home-play"
                  focusOnMount
                  onEnterPress={() => navigate(`/play/${home.featured!.defaultFileId}`)}
                >
                  {t.play}
                </Focusable>
              ) : null}
              <Focusable className="btn" focusKey="home-detail" onEnterPress={() => navigate(`/movies/${home.featured!.id}`)}>
                {t.details}
              </Focusable>
            </div>
          </div>
        </section>
      ) : null}

      {empty ? (
        <section className="empty">
          <h1>{t.empty}</h1>
          <p className="lede">{t.emptyHelp}</p>
        </section>
      ) : null}

      {home.continueWatching.length > 0 ? (
        <Rail title={t.continue} focusKey="rail-continue">
          {home.continueWatching.map((item, index) => (
            <PosterCard
              key={item.fileId}
              focusKey={`continue-${item.fileId}`}
              focusOnMount={!home.featured && index === 0}
              to={`/play/${item.fileId}`}
              title={item.title}
              meta={item.subtitle}
              src={item.posterPath}
              progress={item.duration > 0 ? item.position / item.duration : null}
            />
          ))}
        </Rail>
      ) : null}

      {home.movies.length > 0 ? (
        <Rail title={t.recentMovies} focusKey="rail-movies">
          {home.movies.map((movie, index) => (
            <PosterCard
              key={movie.id}
              focusKey={`home-movie-${movie.id}`}
              focusOnMount={!home.featured && home.continueWatching.length === 0 && index === 0}
              to={`/movies/${movie.id}`}
              title={movie.title}
              meta={movie.year ? String(movie.year) : null}
              src={movie.posterPath}
            />
          ))}
        </Rail>
      ) : null}

      {home.series.length > 0 ? (
        <Rail title={t.recentSeries} focusKey="rail-series">
          {home.series.map((show) => (
            <PosterCard
              key={show.id}
              focusKey={`home-series-${show.id}`}
              to={`/series/${show.id}`}
              title={show.title}
              meta={show.year ? String(show.year) : null}
              src={show.posterPath}
            />
          ))}
        </Rail>
      ) : null}

      {home.albums.length > 0 ? (
        <Rail title={t.recentAlbums} focusKey="rail-albums">
          {home.albums.map((album) => (
            <PosterCard
              key={album.id}
              focusKey={`home-album-${album.id}`}
              to={`/music/albums/${album.id}`}
              title={album.title}
              meta={album.artistName}
              src={album.coverPath}
            />
          ))}
        </Rail>
      ) : null}
    </div>
  );
}
