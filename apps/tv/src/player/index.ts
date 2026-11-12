import { readShellLaunch } from "../host";
import { bridgeBackend } from "./bridge";
import { html5Backend } from "./html5";
import { webosBackend } from "./webos";
import type { PlayerBackend } from "./types";

export type { AudioTrackInfo, PlayerAdapter, PlayerBackend, PlayerEvent, PlayerSource } from "./types";

let backend: PlayerBackend | null = null;

/**
 * The player this TV uses: the shell's native one when it offers it (AVPlay in the Tizen package),
 * the <video> on LG's native pipeline in the webOS package, otherwise the HTML5 <video> with hls.js.
 * Fixed for the life of the page.
 */
export function playerBackend(): PlayerBackend {
  if (!backend) {
    const offered = readShellLaunch().player;
    backend = offered === "webos" ? webosBackend : offered ? bridgeBackend(offered) : html5Backend;
  }
  return backend;
}
