import { FocusContext, setFocus, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Focusable } from "./Focusable";
import { ExitDialog } from "./ExitDialog";
import { useAudio } from "../audio";
import { useLocale } from "../i18n";
import { remoteAction } from "../remote";

const NAV = [
  { to: "/", labelKey: "home", key: "nav-home" },
  { to: "/movies", labelKey: "movies", key: "nav-movies" },
  { to: "/lists", labelKey: "lists", key: "nav-lists" },
  { to: "/series", labelKey: "series", key: "nav-series" },
  { to: "/music", labelKey: "music", key: "nav-music" },
  { to: "/live", labelKey: "live", key: "nav-live" },
  { to: "/search", labelKey: "search", key: "nav-search", icon: "search" },
  { to: "/settings", labelKey: "settings", key: "nav-settings", icon: "settings" },
] as const;

const ICONS = {
  search: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 21 21" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {/* The same gear as the web app's (apps/web/src/ui.tsx). */}
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  music: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </svg>
  ),
};

function isActive(pathname: string, to: string) {
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(`${to}/`);
}

/**
 * The menu is its own focus container: moving up into it lands on the page you are on (not on Home,
 * the first item), whichever item you left it from.
 */
function NavBar({ pathname }: { pathname: string }) {
  const navigate = useNavigate();
  const { t, toggle } = useLocale();
  const audio = useAudio();
  const active = NAV.find((item) => isActive(pathname, item.to))?.key ?? "nav-home";
  const { ref, focusKey } = useFocusable({
    focusKey: "nav",
    preferredChildFocusKey: active,
    saveLastFocusedChild: false,
  });
  return (
    <FocusContext.Provider value={focusKey}>
      <nav className="nav" ref={ref}>
        {NAV.map((item) => {
          const icon = "icon" in item ? ICONS[item.icon] : null;
          return (
            <Focusable
              key={item.key}
              focusKey={item.key}
              className={`nav-item${icon ? " nav-icon" : ""}${item.key === active ? " is-active" : ""}`}
              label={icon ? t[item.labelKey] : undefined}
              onEnterPress={() => {
                navigate(item.to);
                setFocus(item.key);
              }}
            >
              {icon ?? <span>{t[item.labelKey]}</span>}
            </Focusable>
          );
        })}
        {audio.active && audio.current ? (
          // While music plays: Up from any page, then OK, opens the full-screen player (Minimize / Close there).
          <Focusable focusKey="nav-now" className="nav-item nav-now" onEnterPress={audio.expand}>
            {ICONS.music}
            <span>{t.nowPlaying}</span>
          </Focusable>
        ) : null}
        <Focusable focusKey="nav-locale" className="nav-item" onEnterPress={toggle}>
          <span>{t.language.slice(0, 2).toUpperCase()}</span>
        </Focusable>
      </nav>
    </FocusContext.Provider>
  );
}

export function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { ref, focusKey } = useFocusable({
    focusKey: "shell",
    trackChildren: true,
  });

  const [exitOpen, setExitOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (exitOpen || remoteAction(event) !== "back") return;
      event.preventDefault();
      if (location.pathname !== "/") {
        // A page opened directly (no history inside the app) goes Home instead of leaving the app.
        const index = (window.history.state as { idx?: number } | null)?.idx ?? 0;
        if (index > 0) navigate(-1);
        else navigate("/", { replace: true });
        return;
      }
      // Back on Home is the only way out, and it asks first.
      setExitOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [location.pathname, navigate, exitOpen]);

  return (
    <FocusContext.Provider value={focusKey}>
      <div className="shell" ref={ref}>
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" />
            <strong>Kinora</strong>
          </div>
          <NavBar pathname={location.pathname} />
        </header>
        <main className="main">
          <Outlet />
        </main>
        {exitOpen ? <ExitDialog onClose={() => setExitOpen(false)} /> : null}
      </div>
    </FocusContext.Provider>
  );
}
