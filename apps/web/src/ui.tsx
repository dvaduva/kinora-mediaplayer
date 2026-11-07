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
