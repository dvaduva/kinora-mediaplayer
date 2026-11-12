import type { BridgeAudioTrack, CapabilityProfile } from "@kinora/shared";

/**
 * The TV's video player behind one interface, so the UI does not care what plays the file:
 * `html5` (the <video> element, with hls.js for converted streams), `avplay` (Samsung's native player,
 * run by the Tizen shell outside this frame), `webos` (the <video> on LG's native pipeline, HLS included)
 * and later `exoplayer-bridge` (Android TV). Each backend
 * reports the capabilities of its own pipeline.
 */

export type PlayerSource =
  /** The original file, played as the server sends it. */
  | { kind: "file"; url: string }
  /** The HLS stream of a remux or transcode, from `start` seconds. */
  | { kind: "hls"; url: string; start: number };

export type PlayerEvent = "loadedmetadata" | "playing" | "play" | "pause" | "timeupdate" | "ended";

export type AudioTrackInfo = BridgeAudioTrack;

export interface PlayerCallbacks {
  /** The stream cannot play (decoder or network error). */
  onFatal: () => void;
  /** This backend cannot play the source at all (no HLS support). */
  onUnsupported: () => void;
}

export interface PlayerAdapter {
  load(source: PlayerSource): void;
  /** Stops and drops the current source; the adapter can load another one. */
  unload(): void;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  readonly currentTime: number;
  /** Seconds; NaN until known, Infinity for a growing stream. */
  readonly duration: number;
  readonly paused: boolean;
  audioTracks(): AudioTrackInfo[];
  selectAudioTrack(id: string): void;
  /** Returns the unsubscribe function. */
  on(event: PlayerEvent, handler: () => void): () => void;
  destroy(): void;
}

export interface PlayerBackend {
  name: "html5" | "avplay" | "webos" | "exoplayer-bridge";
  /** What this backend decodes on this device, as sent to the server. A bridge asks the shell, hence the promise. */
  capabilities(): CapabilityProfile | Promise<CapabilityProfile>;
  /**
   * The picture is drawn in the <video> element, so its text tracks show the captions. A native player
   * draws outside the page: Kinora's subtitle overlay draws them instead.
   */
  textTracks: boolean;
  create(video: HTMLVideoElement, callbacks: PlayerCallbacks): PlayerAdapter;
}
