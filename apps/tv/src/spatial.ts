import { init } from "@noriginmedia/norigin-spatial-navigation";

let ready = false;

export function ensureSpatial() {
  if (ready) return;
  init({
    debug: false,
    visualDebug: false,
    // A held D-pad key repeats faster than a TV can lay out the next focus; drop the backlog.
    throttle: 90,
    throttleKeypresses: true,
    shouldFocusDOMNode: true,
    domNodeFocusOptions: { preventScroll: false },
  });
  ready = true;
}
