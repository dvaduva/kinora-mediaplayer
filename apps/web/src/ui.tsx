import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLocale } from "./i18n";
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

export function PosterLink(props: { to: string; src: string | null; title: string; meta?: string | null; badge?: string | null }) {
  return (
    <Link className="poster-card" to={props.to}>
      <Poster src={props.src} alt="" />
      <span>{props.title}</span>
      {props.meta ? <small>{props.meta}</small> : null}
      {props.badge ? <small>{props.badge}</small> : null}
    </Link>
  );
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
