import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale } from "../i18n";

/** Horizontal rail without a scrollbar, paged with [ ‹ ] … [ › ] buttons. */
export function ScrollRail(props: { className?: string; children: ReactNode }) {
  const { t } = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({
      start: el.scrollLeft <= 1,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
    });
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
        <button className="rail-arrow" type="button" aria-label={t.scrollBack} disabled={edges.start} onClick={() => page(-1)}>
          ‹
        </button>
      ) : null}
      <div ref={ref} className={`rail-track no-scrollbar ${props.className ?? ""}`.trim()} onScroll={update}>
        {props.children}
      </div>
      {overflow ? (
        <button className="rail-arrow" type="button" aria-label={t.scrollForward} disabled={edges.end} onClick={() => page(1)}>
          ›
        </button>
      ) : null}
    </div>
  );
}
