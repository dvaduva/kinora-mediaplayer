import { html5Backend } from "./html5";
import type { PlayerBackend } from "./types";

export type { AudioTrackInfo, PlayerAdapter, PlayerBackend, PlayerEvent, PlayerSource } from "./types";

/** The player this TV uses. Only `html5` exists so far; AVPlay (Tizen) and the ExoPlayer bridge come with their platforms. */
export const playerBackend: PlayerBackend = html5Backend;
