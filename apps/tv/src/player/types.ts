import type { CapabilityProfile } from "@kinora/shared";

/**
 * The TV's video player behind one interface, so the UI does not care what plays the file:
 * `html5` (the <video> element, with hls.js for converted streams) today; `avplay` (Tizen) and
 * `exoplayer-bridge` (Android TV) later. Each backend reports the capabilities of its own pipeline.
 */

export type PlayerSource =
  /** The original file, played as the server sends it. */
  | { kind: "file"; url: string }
  /** The HLS stream of a remux or transcode, from `start` seconds. */
  | { kind: "hls"; url: string; start: number };

export type PlayerEvent = "loadedmetadata" | "playing" | "play" | "pause" | "timeupdate" | "ended";

export interface AudioTrackInfo {
  id: string;
  language: string | null;
  label: string;
  enabled: boolean;
}

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
  name: "html5" | "avplay" | "exoplayer-bridge";
  /** What this backend decodes on this device, as sent to the server. */
  capabilities(): CapabilityProfile;
  create(video: HTMLVideoElement, callbacks: PlayerCallbacks): PlayerAdapter;
}
