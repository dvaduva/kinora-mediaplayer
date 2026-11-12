import { detectCapabilities } from "@kinora/client";
import type { CapabilityProfile } from "@kinora/shared";
import { requestCapabilities } from "./bridge";
import { createHtml5Player } from "./html5";
import type { PlayerAdapter, PlayerBackend, PlayerCallbacks } from "./types";

/**
 * LG webOS: the <video> element already plays through the TV's native media pipeline (MKV, HEVC, HDR,
 * AC-3/E-AC-3), frame or not, so this is the HTML5 adapter with HLS handed to the element instead of
 * hls.js: the pipeline plays MPEG-TS segments with HEVC and Dolby audio, which MSE in this browser does not.
 * Its profile comes from the shell, which knows the model and panel (Luna); an older shell that does
 * not answer leaves the HTML5 detection, a subset of what the pipeline plays.
 */

async function capabilities(): Promise<CapabilityProfile> {
  try {
    return await requestCapabilities();
  } catch {
    return detectCapabilities();
  }
}

function createWebosPlayer(video: HTMLVideoElement, callbacks: PlayerCallbacks): PlayerAdapter {
  return createHtml5Player(video, callbacks, { nativeHls: true, pauseWhenHidden: true });
}

export const webosBackend: PlayerBackend = {
  name: "webos",
  capabilities,
  textTracks: true,
  create: createWebosPlayer,
};
