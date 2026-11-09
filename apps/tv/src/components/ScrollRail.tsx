import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocale } from "../i18n";

/** Horizontal rail without a scrollbar, paged with [ ‹ ] … [ › ] buttons. */
export function ScrollRail(props: { className?: string; children: ReactNode }) {
  const { t } = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const [overflow, setOverflow] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const start = el.scrollLeft <= 1;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    // Use a small tolerance: subpixel rounding can hide a real overflow.
    const hasOverflow = el.scrollWidth > el.clientWidth + 2;
    setEdges({ start, end });
    setOverflow(hasOverflow);
  }, []);

  useLayoutEffect(() => {
    update();
  }, [update, props.children]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const frame = window.requestAnimationFrame(update);
    const timer = window.setTimeout(update, 100);
    const observer = new ResizeObserver(update);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [update, props.children]);

  const page = (direction: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(el.clientWidth * 0.85, 200), behavior: "smooth" });
    window.setTimeout(update, 320);
  };

  return (
    <div className={`scroll-rail${overflow ? " has-overflow" : ""}`}>
      <button
        className="rail-arrow"
        type="button"
        aria-label={t.scrollBack}
        disabled={!overflow || edges.start}
        onClick={() => page(-1)}
      >
        ‹
      </button>
      <div ref={ref} className={`rail-track no-scrollbar ${props.className ?? ""}`.trim()} onScroll={update}>
        {props.children}
      </div>
      <button
        className="rail-arrow"
        type="button"
        aria-label={t.scrollForward}
        disabled={!overflow || edges.end}
        onClick={() => page(1)}
      >
        ›
      </button>
    </div>
  );
}
