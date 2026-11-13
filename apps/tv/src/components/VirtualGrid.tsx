import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

type Layout = { cols: number; stride: number; gap: number };

type Props<T> = {
  items: T[];
  className: string;
  style?: CSSProperties;
  getKey: (item: T) => string;
  renderItem: (item: T, index: number, onFocus: () => void) => ReactNode;
  /** Rows kept mounted above and below the focused row. */
  before?: number;
  after?: number;
  /** Rendered after the items; mark it with `data-vskip` so it is not measured. */
  trailing?: ReactNode;
};

const HEAD_ROWS = 1;
const TAIL_ROWS = 1;
const MEASURE_ITEMS = 40;

/**
 * A grid (or list) that keeps only the rows around the focused item mounted.
 *
 * TV browsers are slow, and spatial navigation measures every focusable sibling on each key press,
 * so a library of a few hundred titles must not be mounted all at once. Windowing follows the
 * D-pad focus, not the scroll position: the focused element scrolls itself into view, and the rows
 * past it are mounted before the user can reach them. The first and last rows stay mounted so
 * focus coming from above or below the grid lands next to where it came from.
 *
 * The rows that are not mounted are replaced by full-width spacers of the same height, so the
 * scroll height does not change. Items must be the container's direct children.
 */
export function VirtualGrid<T>(props: Props<T>) {
  const { items, before = 3, after = 4 } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [focus, setFocus] = useState(0);
  // Re-render only when focus moves to another row: the window is made of rows.
  const colsRef = useRef(1);
  colsRef.current = layout?.cols ?? 1;
  const focusItem = useCallback((index: number) => {
    setFocus((previous) => (Math.floor(previous / colsRef.current) === Math.floor(index / colsRef.current) ? previous : index));
  }, []);

  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const cells = Array.from(element.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.dataset.spacer == null && child.dataset.vskip == null,
    );
    if (cells.length === 0) return;
    const top = cells[0]!.offsetTop;
    let cols = 0;
    while (cols < cells.length && cells[cols]!.offsetTop === top) cols += 1;
    const gap = parseFloat(getComputedStyle(element).rowGap) || 0;
    const rows = Math.floor(cells.length / cols);
    const stride =
      rows >= 2 ? (cells[(rows - 1) * cols]!.offsetTop - top) / (rows - 1) : cells[0]!.offsetHeight + gap;
    if (stride > 0) setLayout({ cols: Math.max(1, cols), stride, gap });
  }, []);

  // Measure once on a contiguous first page, and again when the viewport changes.
  useLayoutEffect(() => {
    if (!layout) measure();
  }, [layout, measure, items.length]);

  useEffect(() => {
    const onResize = () => setLayout(null);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const children: ReactNode[] = [];
  const render = (index: number) => {
    const item = items[index]!;
    children.push(
      <Fragment key={props.getKey(item)}>{props.renderItem(item, index, () => focusItem(index))}</Fragment>,
    );
  };

  if (!layout) {
    for (let index = 0; index < Math.min(items.length, MEASURE_ITEMS); index += 1) render(index);
  } else {
    const { cols, stride, gap } = layout;
    const totalRows = Math.ceil(items.length / cols);
    const focusRow = Math.floor(Math.min(focus, items.length - 1) / cols);
    const ranges = [
      [0, HEAD_ROWS - 1],
      [focusRow - before, focusRow + after],
      [totalRows - TAIL_ROWS, totalRows - 1],
    ]
      .map(([start, end]) => [Math.max(0, start!), Math.min(totalRows - 1, end!)] as const)
      .filter(([start, end]) => start <= end)
      .sort((a, b) => a[0] - b[0]);

    let nextRow = 0;
    const spacer = (rows: number) => {
      if (rows <= 0) return;
      children.push(
        <div
          key={`spacer-${nextRow}`}
          data-spacer=""
          aria-hidden="true"
          style={{ gridColumn: "1 / -1", height: Math.max(0, rows * stride - gap) }}
        />,
      );
    };
    for (const [start, end] of ranges) {
      if (end < nextRow) continue;
      const from = Math.max(start, nextRow);
      spacer(from - nextRow);
      for (let index = from * cols; index < Math.min(items.length, (end + 1) * cols); index += 1) render(index);
      nextRow = end + 1;
    }
    spacer(totalRows - nextRow);
  }

  return (
    <div ref={ref} className={props.className} style={props.style}>
      {children}
      {props.trailing}
    </div>
  );
}
