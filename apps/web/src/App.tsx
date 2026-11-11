import { useEffect, useRef, useState, type FormEvent } from "react";
import { createBrowserRouter, Link, NavLink, Route, RouterProvider, Routes, useLocation, useNavigate } from "react-router-dom";
import type { AppSetup } from "@kinora/shared";
import { api, setUnauthorized } from "@kinora/client";
import { prefetch } from "./cache";
import { AudioProvider } from "./audio";
import { LocaleProvider, useLocale } from "./i18n";
import { HomePage, MovieListPage, MusicPage, SearchPage, SeriesListPage } from "./pages/Browse";
import { ExternalTitlePage, MoviePage, SeriesPage } from "./pages/Detail";
import { PersonPage } from "./pages/Person";
import { AlbumPage, ArtistPage, IdentifyPage } from "./pages/Listen";
import { PlayerPage } from "./pages/Player";
import { LiveTvPage } from "./pages/LiveTv";
import { LivePlayerPage } from "./pages/LivePlayer";
import { SettingsPage } from "./pages/Settings";
import { Icon, Mark } from "./ui";

export function App() {
  const [setup, setSetup] = useState<AppSetup | null>(null);
  const [serverDown, setServerDown] = useState(false);
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    setUnauthorized(() => setAuthed(false));
    api<AppSetup>("/api/setup")
      .then((data) => {
        setServerDown(false);
        setSetup(data);
        setAuthed(!data.tokenRequired);
      })
      .catch(() => setServerDown(true));
  }, []);
  if (serverDown) {
    return (
      <LocaleProvider>
        <main className="gate">
          <ServerDown />
        </main>
      </LocaleProvider>
    );
  }
  if (!setup) return null;
  if (setup.tokenRequired && !authed) return <Gate onSuccess={() => setAuthed(true)} />;
  return <Routed ffprobe={setup.ffprobe} />;
}

/**
 * A data router, so pages can hold navigation back (Settings asks before dropping unsaved edits).
 * The routes themselves stay as <Routes> inside Shell; this only wraps them.
 */
function Routed(props: { ffprobe: boolean }) {
  const [router] = useState(() =>
    createBrowserRouter([
      {
        path: "*",
        element: (
          <LocaleProvider>
            <AudioProvider>
              <Shell ffprobe={props.ffprobe} />
            </AudioProvider>
          </LocaleProvider>
        ),
      },
    ]),
  );
  return <RouterProvider router={router} />;
}

function ServerDown() {
  const { t } = useLocale();
  return (
    <>
      <h1>Kinora</h1>
      <p className="banner">{t.serverDown}</p>
    </>
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

/** API data behind each menu entry, fetched ahead of the click. */
const MENU_DATA = {
  "/": ["/api/home"],
  "/movies": ["/api/movies"],
  "/series": ["/api/series"],
  "/music": ["/api/albums", "/api/artists"],
  "/identify": ["/api/identify"],
} as const;

function warm(to: keyof typeof MENU_DATA) {
  const go = () => prefetch(...MENU_DATA[to]);
  return { onPointerEnter: go, onFocus: go };
}

const NARROW = "(max-width: 980px)";
const MENU_KEY = "kinora.menuOpen";
/** Live search: wait this long after the last keystroke, and for at least this many characters. */
const SEARCH_DELAY = 300;
const SEARCH_MIN = 2;

/** Sidebar visibility: remembered on wide screens, closed by default on narrow ones (where it overlays the page). */
function useMenu() {
  const [open, setOpen] = useState(() => {
    if (window.matchMedia(NARROW).matches) return false;
    try {
      return localStorage.getItem(MENU_KEY) !== "0";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle("menu-collapsed", !open);
    if (window.matchMedia(NARROW).matches) return;
    try {
      localStorage.setItem(MENU_KEY, open ? "1" : "0");
    } catch {
      // Storage unavailable: the choice just lasts for this visit.
    }
  }, [open]);
  return [open, setOpen] as const;
}

function Shell(props: { ffprobe: boolean }) {
  const { t, toggle } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useMenu();
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Once the shell has painted, load every menu page so the first click renders from memory.
    const timer = window.setTimeout(() => prefetch(...Object.values(MENU_DATA).flat()), 400);
    return () => window.clearTimeout(timer);
  }, []);
  // Search as you type: `typed` marks edits made in the field, `sent` is the last query this shell put in the URL.
  const typed = useRef(false);
  const sent = useRef<string | null>(null);
  const onSearch = useRef(false);
  onSearch.current = location.pathname === "/search";
  const runSearch = (value: string) => {
    sent.current = value;
    // Typing refines one results page instead of stacking history entries; the first search keeps Back to the previous page.
    navigate(value ? `/search?q=${encodeURIComponent(value)}` : "/search", { replace: onSearch.current });
  };
  useEffect(() => {
    if (!typed.current) return;
    const value = query.trim();
    if (value === sent.current || (value.length < SEARCH_MIN && !(value === "" && onSearch.current))) return;
    const timer = window.setTimeout(() => {
      if (value !== sent.current) runSearch(value);
    }, SEARCH_DELAY);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  useEffect(() => {
    // On narrow screens the menu covers the page, so close it after each navigation.
    if (window.matchMedia(NARROW).matches) setMenuOpen(false);
    if (location.pathname !== "/search") return;
    const fromUrl = new URLSearchParams(location.search).get("q") ?? "";
    // Leave the field alone when the URL only echoes what is being typed, so keystrokes in flight are kept.
    if (fromUrl === sent.current) return;
    typed.current = false;
    sent.current = fromUrl;
    setQuery(fromUrl);
  }, [location.pathname, location.search, setMenuOpen]);
  const editQuery = (value: string) => {
    typed.current = true;
    setQuery(value);
  };
  return (
    <div className="shell">
      <header className="topbar">
        <button
          className="bar-button"
          type="button"
          onClick={() => setMenuOpen((value) => !value)}
          aria-label={t.menu}
          aria-expanded={menuOpen}
          title={t.menu}
        >
          <Icon name="menu" />
        </button>
        <Link className="brand" to="/">
          <Mark />
          <strong>Kinora</strong>
        </Link>
        <form
          className="search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            const value = query.trim();
            if (value && (value !== sent.current || !onSearch.current)) runSearch(value);
          }}
        >
          <Icon name="search" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => editQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") editQuery("");
            }}
            placeholder={t.search}
            aria-label={t.search}
          />
          {query ? (
            <button
              className="search-clear"
              type="button"
              aria-label={t.clearSearch}
              title={t.clearSearch}
              onClick={() => {
                editQuery("");
                searchRef.current?.focus();
              }}
            >
              <Icon name="close" />
            </button>
          ) : null}
        </form>
        <div className="topbar-actions">
          <NavLink className="bar-button" to="/identify" aria-label={t.identify} title={t.identify} {...warm("/identify")}>
            <Icon name="identify" />
          </NavLink>
          <NavLink className="bar-button" to="/settings" aria-label={t.settings} title={t.settings}>
            <Icon name="settings" />
          </NavLink>
          <button className="bar-button locale" type="button" onClick={toggle} aria-label={t.language} title={t.language}>
            <Icon name="language" />
            <span>{t.language.slice(0, 2).toUpperCase()}</span>
          </button>
        </div>
      </header>
      <aside className="sidebar">
        <nav className="nav">
          <NavLink to="/" end title={t.home} {...warm("/")}>
            <Icon name="home" />
            <span>{t.home}</span>
          </NavLink>
          <NavLink to="/movies" title={t.movies} {...warm("/movies")}>
            <Icon name="movies" />
            <span>{t.movies}</span>
          </NavLink>
          <NavLink to="/series" title={t.series} {...warm("/series")}>
            <Icon name="series" />
            <span>{t.series}</span>
          </NavLink>
          <NavLink to="/music" title={t.music} {...warm("/music")}>
            <Icon name="music" />
            <span>{t.music}</span>
          </NavLink>
          <NavLink to="/live" title={t.liveTv}>
            <Icon name="live" />
            <span>{t.liveTv}</span>
          </NavLink>
        </nav>
      </aside>
      {menuOpen ? <div className="sidebar-scrim" onClick={() => setMenuOpen(false)} /> : null}
      <main className="main">
        {props.ffprobe ? null : <p className="banner">{t.ffprobeMissing}</p>}
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/movies" element={<MovieListPage />} />
          <Route path="/movies/:id" element={<MoviePage />} />
          <Route path="/series" element={<SeriesListPage />} />
          <Route path="/series/:id" element={<SeriesPage />} />
          <Route path="/people/:id" element={<PersonPage />} />
          <Route path="/discover/:kind/:id" element={<ExternalTitlePage />} />
          <Route path="/music" element={<MusicPage />} />
          <Route path="/music/albums/:id" element={<AlbumPage />} />
          <Route path="/music/artists/:id" element={<ArtistPage />} />
          <Route path="/play/:fileId" element={<PlayerPage />} />
          <Route path="/live" element={<LiveTvPage />} />
          <Route path="/live/:channelId" element={<LivePlayerPage />} />
          <Route path="/identify" element={<IdentifyPage />} />
          <Route path="/settings/:section?" element={<SettingsPage />} />
          <Route path="/search" element={<SearchPage />} />
        </Routes>
      </main>
    </div>
  );
}
