import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import type { ReactNode } from "react";
import { ScrollRail } from "./ScrollRail";

export function Rail(props: { title: string; focusKey: string; children: ReactNode }) {
  const { ref, focusKey, focusSelf } = useFocusable({
    focusKey: props.focusKey,
    trackChildren: true,
    isFocusBoundary: false,
  });

  return (
    <FocusContext.Provider value={focusKey}>
      <section className="rail" ref={ref} onMouseEnter={() => focusSelf()}>
        <h2>{props.title}</h2>
        <ScrollRail>{props.children}</ScrollRail>
      </section>
    </FocusContext.Provider>
  );
}
