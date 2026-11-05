import { useEffect, useState, type FormEvent } from "react";
import { BrowserRouter, Link, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import type { AppSetup } from "@kinora/shared";
import { api, setUnauthorized } from "./api";
import { AudioProvider } from "./audio";
import { LocaleProvider, useLocale } from "./i18n";
import { HomePage, MovieListPage, MusicPage, SearchPage, SeriesListPage } from "./pages/Browse";
import { MoviePage, SeriesPage } from "./pages/Detail";
import { AlbumPage, ArtistPage, IdentifyPage } from "./pages/Listen";
import { PlayerPage } from "./pages/Player";
import { SettingsPage } from "./pages/Settings";
import { Mark } from "./ui";

export function App() {
  const [setup, setSetup] = useState<AppSetup | null>(null);
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    setUnauthorized(() => setAuthed(false));
    api<AppSetup>("/api/setup")
      .then((data) => {
        setSetup(data);
        setAuthed(!data.tokenRequired);
      })
      .catch(() => setSetup({ tokenRequired: false, ffmpeg: false, ffprobe: false }));
  }, []);
  if (!setup) return null;
  if (setup.tokenRequired && !authed) return <Gate onSuccess={() => setAuthed(true)} />;
  return (
    <BrowserRouter>
      <LocaleProvider>
        <AudioProvider>
          <Shell ffprobe={setup.ffprobe} />
        </AudioProvider>
      </LocaleProvider>
    </BrowserRouter>
  );
}

function Gate(props: { onSuccess: () => void }) {
  const [token, setToken] = useState("");
  const [failed, setFailed] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token }),
    });
    if (!response.ok) {
      setFailed(true);
      return;
    }
    props.onSuccess();
  }
  return (
    <main className="gate">
      <form onSubmit={(event) => void submit(event)}>
        <h1>Kinora</h1>
        <input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoFocus />
        <button className="play" type="submit">Kinora</button>
        {failed ? <p className="danger">Cheie greșită</p> : null}
      </form>
    </main>
  );
}

function Shell(props: { ffprobe: boolean }) {
  const { t, toggle } = useLocale();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link className="brand" to="/">
          <Mark />
          <strong>Kinora</strong>
        </Link>
        <nav className="nav">
          <NavLink to="/" end>{t.home}</NavLink>
          <NavLink to="/movies">{t.movies}</NavLink>
          <NavLink to="/series">{t.series}</NavLink>
          <NavLink to="/music">{t.music}</NavLink>
          <NavLink to="/identify">{t.identify}</NavLink>
          <NavLink to="/settings">{t.settings}</NavLink>
        </nav>
        <form
          className="search"
          onSubmit={(event) => {
            event.preventDefault();
            navigate(`/search?q=${encodeURIComponent(query)}`);
          }}
        >
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.search} aria-label={t.search} />
        </form>
        <button className="locale" type="button" onClick={toggle}>{t.language}</button>
      </aside>
      <main className="main">
        {props.ffprobe ? null : <p className="banner">{t.ffprobeMissing}</p>}
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/movies" element={<MovieListPage />} />
          <Route path="/movies/:id" element={<MoviePage />} />
          <Route path="/series" element={<SeriesListPage />} />
          <Route path="/series/:id" element={<SeriesPage />} />
          <Route path="/music" element={<MusicPage />} />
          <Route path="/music/albums/:id" element={<AlbumPage />} />
          <Route path="/music/artists/:id" element={<ArtistPage />} />
          <Route path="/play/:fileId" element={<PlayerPage />} />
          <Route path="/identify" element={<IdentifyPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/search" element={<SearchPage />} />
        </Routes>
      </main>
    </div>
  );
}
