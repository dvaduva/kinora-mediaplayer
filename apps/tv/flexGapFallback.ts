// Minimal PostCSS shapes: postcss is Vite's dependency, not this app's, so its types are not importable here.
type Decl = { type: "decl"; prop: string; value: string };
type Rule = {
  selector: string;
  selectors: string[];
  each(callback: (node: Decl | { type: string }) => void): void;
  after(node: unknown): void;
};
type Helpers = { postcss: { rule(props: { selector: string }): { append(decl: { prop: string; value: string }): unknown } } };
type Plugin = { postcssPlugin: string; Once(root: { walkRules(callback: (rule: Rule) => void): void }, helpers: Helpers): void };

/**
 * Chromium 76 (Samsung 2021, Tizen 6.0) ignores `gap` on flex containers; that arrived in Chromium 84.
 * For every rule that declares both `display: flex` and a gap, this emits margins under
 * `.no-flex-gap`, a class main.tsx puts on <html> only when the browser lacks flex gap.
 *
 * Rows get `margin-left` between siblings and columns `margin-top`, which matches `gap` exactly
 * while the items fit on one line. A wrapped row loses its row gap, which TV layouts rarely hit.
 */
export function flexGapFallback(): Plugin {
  return {
    postcssPlugin: "kinora-flex-gap-fallback",
    Once(root, { postcss }) {
      root.walkRules((rule: Rule) => {
        if (rule.selector.includes(".no-flex-gap")) return;
        const found: { flex: boolean; direction: string; row?: string; column?: string } = { flex: false, direction: "row" };
        rule.each((child) => {
          if (child.type !== "decl") return;
          const node = child as Decl;
          const value = node.value.trim();
          if (node.prop === "display") found.flex = /^(inline-)?flex$/.test(value);
          else if (node.prop === "flex-direction") found.direction = value;
          else if (node.prop === "gap") [found.row, found.column] = splitTopLevel(value);
          else if (node.prop === "row-gap") found.row = value;
          else if (node.prop === "column-gap") found.column = value;
        });
        if (!found.flex) return;
        const vertical = found.direction.startsWith("column");
        const size = vertical ? found.row : (found.column ?? found.row);
        if (!size) return;
        const selector = rule.selectors.map((selector) => `.no-flex-gap ${selector} > * + *`).join(",\n");
        rule.after(postcss.rule({ selector }).append({ prop: vertical ? "margin-top" : "margin-left", value: size }));
      });
    },
  };
}
flexGapFallback.postcss = true;

/** `gap: <row> <column>` where either part may be a calc() containing spaces. */
function splitTopLevel(value: string): [string, string] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (/\s/.test(char) && depth === 0) {
      if (current) parts.push(current);
      current = "";
    } else current += char;
  }
  if (current) parts.push(current);
  return [parts[0]!, parts[1] ?? parts[0]!];
}
