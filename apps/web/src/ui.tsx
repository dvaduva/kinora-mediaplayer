import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { WatchStatus } from "@kinora/shared";
import { useLocale, type Copy } from "./i18n";
import { imageUrl } from "./media";

/** Horizontal rail without a scrollbar, paged with [ ‹ ] … [ › ] buttons. */
export function ScrollRail(props: { className: string; children: ReactNode }) {
  const { t } = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 1, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 });
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [update, props.children]);
  const page = (direction: 1 | -1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: "smooth" });
  };
  const overflow = !(edges.start && edges.end);
  return (
    <div className={`scroll-rail${overflow ? " has-overflow" : ""}`}>
      {overflow ? (
        <button className="rail-arrow" type="button" aria-label={t.scrollBack} disabled={edges.start} onClick={() => page(-1)}>‹</button>
      ) : null}
      <div ref={ref} className={`${props.className} no-scrollbar`} onScroll={update}>
        {props.children}
      </div>
      {overflow ? (
        <button className="rail-arrow" type="button" aria-label={t.scrollForward} disabled={edges.end} onClick={() => page(1)}>›</button>
      ) : null}
    </div>
  );
}

export function Mark() {
  return (
    <svg className="reel" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="12" fill="none" stroke="#d2ae62" strokeWidth="1.6" />
      <circle cx="16" cy="16" r="3" fill="#d2ae62" />
    </svg>
  );
}

const ICONS = {
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  home: <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />,
  /* A strip of film with sprocket holes. */
  movies: (
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="1.5" />
      <path d="M8 3.5v17M16 3.5v17M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4" />
    </>
  ),
  series: (
    <>
      <rect x="3" y="6.5" width="18" height="12" rx="1.5" />
      <path d="m8.5 3 3.5 3.5L15.5 3M8 21h8" />
    </>
  ),
  music: (
    <>
      <path d="M9 17.5V5.5l11-2v12" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <circle cx="17.5" cy="15.5" r="2.5" />
    </>
  ),
  language: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5s1.1-6.1 3.4-8.5z" />
    </>
  ),
  /* A frame with a question mark: titles still waiting to be matched. */
  identify: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <path d="M9.6 10a2.4 2.4 0 1 1 3.4 2.2c-.6.3-1 .8-1 1.5v.4" />
      <circle cx="12" cy="16.6" r=".4" fill="currentColor" />
    </>
  ),
  folder: <path d="M3.5 6.5a1 1 0 0 1 1-1h4.6l2 2.2h8.4a1 1 0 0 1 1 1v9.8a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" />,
  /* A screen with two subtitle lines. */
  captions: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <path d="M7 12.5h5M14 12.5h3M7 15.5h3M12 15.5h5" />
    </>
  ),
  tag: (
    <>
      <path d="M3.5 12.6V4.5a1 1 0 0 1 1-1h8.1l8 8a1 1 0 0 1 0 1.4l-7.7 7.7a1 1 0 0 1-1.4 0z" />
      <circle cx="8" cy="8" r="1.4" />
    </>
  ),
  network: (
    <>
      <rect x="9" y="3.5" width="6" height="5" rx="1" />
      <rect x="3" y="15.5" width="6" height="5" rx="1" />
      <rect x="15" y="15.5" width="6" height="5" rx="1" />
      <path d="M12 8.5v3.5M6 15.5V12h12v3.5" />
    </>
  ),
  storage: (
    <>
      <ellipse cx="12" cy="6" rx="7.5" ry="2.5" />
      <path d="M4.5 6v12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5V6M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5" />
    </>
  ),
  system: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
      <path d="m7 10 3 2.5L7 15M12.5 15H17" />
    </>
  ),
  /* A point broadcasting waves to both sides. */
  live: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8" />
    </>
  ),
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  pause: <path d="M8.5 5.5v13M15.5 5.5v13" />,
  volume: <path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />,
  muted: <path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3zM16 9.5l5 5M21 9.5l-5 5" />,
  fullscreen: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  up: <path d="m6 15 6-6 6 6" />,
  star: <path d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.7l-5.1 2.7 1-5.6-4.1-4 5.7-.8z" />,
  /* Rows of a program guide. */
  guide: <path d="M4 6h3M10 6h10M4 12h3M10 12h6M4 18h3M10 18h8" />,
  down: <path d="m6 9 6 6 6-6" />,
  rewind: <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4.5v4h4" />,
  forward: <path d="M20 12a8 8 0 1 1-2.4-5.7M20 4.5v4h-4" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  back: <path d="m15 5-7 7 7 7" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
};

export function Icon(props: { name: keyof typeof ICONS }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[props.name]}
    </svg>
  );
}

export function Poster(props: { src: string | null; alt: string; size?: string }) {
  const url = imageUrl(props.src, props.size ?? "w342");
  if (!url) return <div className="poster empty" />;
  return <img className="poster" src={url} alt={props.alt} loading="lazy" decoding="async" />;
}

export function PosterLink(props: { to: string; src: string | null; title: string; meta?: string | null; badge?: string | null; status?: WatchStatus }) {
  return (
    <Link className={`poster-card${props.status === "watched" ? " is-watched" : ""}`} to={props.to}>
      <div className="poster-frame">
        <Poster src={props.src} alt="" />
        {props.status ? <StatusFlag status={props.status} /> : null}
      </div>
      <span>{props.title}</span>
      {props.meta ? <small>{props.meta}</small> : null}
      {props.badge ? <small>{props.badge}</small> : null}
    </Link>
  );
}

export function statusLabel(status: WatchStatus, t: Copy) {
  if (status === "new") return t.statusNew;
  if (status === "watched") return t.statusWatched;
  return t.statusUnwatched;
}

/** Corner mark on a poster: a "New" tab, or a check for watched. Unwatched posters stay plain. */
function StatusFlag(props: { status: WatchStatus }) {
  const { t } = useLocale();
  if (props.status === "new") return <span className="status-flag new">{t.statusNew}</span>;
  if (props.status === "watched") {
    return (
      <span className="status-flag watched" title={t.statusWatched} aria-label={t.statusWatched}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
    );
  }
  return null;
}

/** Placeholder cards shown while a grid's first response is on its way. */
export function SkeletonGrid(props: { count?: number; square?: boolean }) {
  return (
    <div className="grid" aria-busy="true" aria-hidden="true">
      {Array.from({ length: props.count ?? 12 }, (_, index) => (
        <div className="poster-card" key={index}>
          <div className={`skeleton ${props.square ? "cover" : "poster"}`} />
          <span className="skeleton skeleton-line" />
          <small className="skeleton skeleton-line short" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonBlocks(props: { count?: number }) {
  return (
    <div aria-busy="true" aria-hidden="true">
      {Array.from({ length: props.count ?? 4 }, (_, index) => (
        <section className="library-block" key={index}>
          <span className="skeleton skeleton-line title" />
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-field" />
        </section>
      ))}
    </div>
  );
}
