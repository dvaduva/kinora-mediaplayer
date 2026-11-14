import { readShellLaunch } from "../host";
import { bridgeBackend } from "./bridge";
import { html5Backend } from "./html5";
import { tizenBackend } from "./tizen";
import { webosBackend } from "./webos";
import type { PlayerBackend } from "./types";

export type { AudioTrackInfo, PlayerAdapter, PlayerBackend, PlayerEvent, PlayerSource } from "./types";

let backend: PlayerBackend | null = null;

/**
 * The player this TV uses: the <video> on the TV's native pipeline in the Tizen and webOS packages
 * (on Tizen the shell offers AVPlay, but playback stays in the <video>, as in Jellyfin; see ./tizen),
 * ExoPlayer through the bridge in the Android TV app (`player=exoplayer`), otherwise the HTML5 <video>
 * with hls.js. Fixed for the life of the page.
 */
export function playerBackend(): PlayerBackend {
  if (!backend) {
    const offered = readShellLaunch().player;
    backend = offered === "webos" ? webosBackend : offered === "avplay" ? tizenBackend : offered ? bridgeBackend(offered) : html5Backend;
  }
  return backend;
}
