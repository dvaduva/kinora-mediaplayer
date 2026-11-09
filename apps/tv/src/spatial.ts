import { init } from "@noriginmedia/norigin-spatial-navigation";

let ready = false;

export function ensureSpatial() {
  if (ready) return;
  init({
    debug: false,
    visualDebug: false,
    shouldFocusDOMNode: true,
    domNodeFocusOptions: { preventScroll: false },
  });
  ready = true;
}
