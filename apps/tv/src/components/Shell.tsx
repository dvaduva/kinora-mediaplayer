import { FocusContext, setFocus, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Focusable } from "./Focusable";
import { ExitDialog } from "./ExitDialog";
import { useLocale } from "../i18n";
import { remoteAction } from "../remote";

const NAV = [
  { to: "/", labelKey: "home", key: "nav-home" },
  { to: "/movies", labelKey: "movies", key: "nav-movies" },
  { to: "/series", labelKey: "series", key: "nav-series" },
  { to: "/music", labelKey: "music", key: "nav-music" },
  { to: "/live", labelKey: "live", key: "nav-live" },
  { to: "/search", labelKey: "search", key: "nav-search" },
  { to: "/settings", labelKey: "settings", key: "nav-settings" },
] as const;

function isActive(pathname: string, to: string) {
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, toggle } = useLocale();
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
          <nav className="nav">
            {NAV.map((item) => (
              <Focusable
                key={item.key}
                focusKey={item.key}
                className={`nav-item${isActive(location.pathname, item.to) ? " is-active" : ""}`}
                onEnterPress={() => {
                  navigate(item.to);
                  setFocus(item.key);
                }}
              >
                <span>{t[item.labelKey]}</span>
              </Focusable>
            ))}
            <Focusable focusKey="nav-locale" className="nav-item" onEnterPress={toggle}>
              <span>{t.language.slice(0, 2).toUpperCase()}</span>
            </Focusable>
          </nav>
        </header>
        <main className="main">
          <Outlet />
        </main>
        {exitOpen ? <ExitDialog onClose={() => setExitOpen(false)} /> : null}
      </div>
    </FocusContext.Provider>
  );
}
