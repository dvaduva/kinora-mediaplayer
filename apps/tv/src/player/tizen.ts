import { detectCapabilities } from "@kinora/client";
import type { CapabilityProfile } from "@kinora/shared";
import { requestCapabilities } from "./bridge";
import { createHtml5Player } from "./html5";
import type { PlayerAdapter, PlayerBackend, PlayerCallbacks } from "./types";

/**
 * Samsung Tizen: the <video> element plays through the TV's own media pipeline (MKV, HEVC, AC-3/E-AC-3,
 * HLS with those in the segments), like LG's, so this is the HTML5 adapter with HLS handed to the element
 * instead of hls.js. It is how Jellyfin plays on Tizen. The AVPlay bridge the shell offers is not used for
 * playback: driven from a frame by message, it opened the file and never started. The shell still answers
 * what the TV decodes; an older shell that does not leaves the HTML5 detection.
 */

async function capabilities(): Promise<CapabilityProfile> {
  try {
    return await requestCapabilities();
  } catch {
    return detectCapabilities();
  }
}

function createTizenPlayer(video: HTMLVideoElement, callbacks: PlayerCallbacks): PlayerAdapter {
  return createHtml5Player(video, callbacks, { nativeHls: true, pauseWhenHidden: true });
}

export const tizenBackend: PlayerBackend = {
  name: "tizen",
  capabilities,
  textTracks: true,
  create: createTizenPlayer,
};
