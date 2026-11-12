/**
 * D-pad focus for the shell's few screens: arrows move to the nearest focusable element in that direction,
 * Enter activates it. Inputs keep Left/Right for the cursor and open the TV keyboard on Enter.
 */
const SELECTOR = "button:not([disabled]), input, [data-focusable]";

let root: HTMLElement | null = null;

export function focusRoot(element: HTMLElement) {
  root = element;
}

function candidates() {
  if (!root) return [];
  return Array.prototype.slice.call(root.querySelectorAll(SELECTOR)) as HTMLElement[];
}

export function focusFirst(preferred?: string) {
  const list = candidates();
  const target = (preferred && root?.querySelector<HTMLElement>(preferred)) || list[0];
  target?.focus();
}

function center(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function move(direction: "up" | "down" | "left" | "right") {
  const list = candidates();
  const current = document.activeElement as HTMLElement | null;
  if (!current || list.indexOf(current) < 0) {
    list[0]?.focus();
    return;
  }
  const from = center(current.getBoundingClientRect());
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const element of list) {
    if (element === current) continue;
    const to = center(element.getBoundingClientRect());
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const ahead = direction === "up" ? -dy : direction === "down" ? dy : direction === "left" ? -dx : dx;
    if (ahead <= 1) continue;
    const side = direction === "up" || direction === "down" ? Math.abs(dx) : Math.abs(dy);
    const score = ahead + side * 2;
    if (score < bestScore) {
      bestScore = score;
      best = element;
    }
  }
  best?.focus();
}

export function handleFocusKey(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  const typing = target?.tagName === "INPUT";
  const key = event.key || "";
  const code = event.keyCode;
  if (key === "ArrowUp" || code === 38) move("up");
  else if (key === "ArrowDown" || code === 40) move("down");
  else if (!typing && (key === "ArrowLeft" || code === 37)) move("left");
  else if (!typing && (key === "ArrowRight" || code === 39)) move("right");
  else return false;
  event.preventDefault();
  return true;
}
