import type { CapabilityProfile } from "./capabilities";

/**
 * The player bridge: the TV UI runs in a frame loaded from the server, but a platform's native player
 * (AVPlay on Tizen, ExoPlayer on Android TV) only exists in the shell's own page. The UI sends
 * commands with `postMessage`; the shell drives the player and reports its state back.
 *
 * Every `load` carries a session number that the shell echoes on each report, so reports from a
 * source the UI has already moved away from are dropped.
 */
export const PLAYER_BRIDGE_SOURCE = "kinora-player";

/**
 * Native players a shell can offer, named in the launch hash (`#…&player=avplay`). `exoplayer` is the
 * Android TV app's Media3 player, drawn under its WebView; the shell passes the commands to it.
 */
export type BridgePlayer = "avplay" | "exoplayer";

/**
 * What the launch hash may name: a bridged player, or `webos`. On webOS the frame's own <video> already
 * plays through LG's native media pipeline, so nothing is bridged except the `capabilities` request
 * (the shell asks the TV, through Luna, for its model and panel, which the frame cannot).
 */
export type LaunchPlayer = BridgePlayer | "webos";
export const LAUNCH_PLAYERS: readonly LaunchPlayer[] = ["avplay", "exoplayer", "webos"];

export interface BridgeAudioTrack {
  id: string;
  language: string | null;
  label: string;
  enabled: boolean;
}

/** UI → shell. */
export type PlayerCommand =
  | { command: "capabilities"; request: number }
  | { command: "load"; session: number; kind: "file" | "hls"; url: string; start: number }
  | { command: "play"; session: number }
  | { command: "pause"; session: number }
  | { command: "seek"; session: number; seconds: number }
  | { command: "audio"; session: number; id: string }
  | { command: "unload"; session: number };

/** Shell → UI. Times are in seconds; `duration` is NaN until known and Infinity for a growing stream. */
export type PlayerReport =
  | { event: "capabilities"; request: number; profile: CapabilityProfile | null }
  | { event: "ready"; session: number; duration: number }
  | { event: "playing"; session: number }
  | { event: "paused"; session: number }
  | { event: "time"; session: number; time: number; duration: number }
  /** The player is filling its buffer: `percent` 0..100 while loading, null once it plays on. */
  | { event: "buffering"; session: number; percent: number | null }
  | { event: "tracks"; session: number; tracks: BridgeAudioTrack[] }
  | { event: "ended"; session: number }
  | { event: "error"; session: number; code: string }
  /** What the native player did, for the server log: there is no console to read on a TV. */
  | { event: "log"; session: number; message: string };

export type PlayerCommandMessage = PlayerCommand & { source: typeof PLAYER_BRIDGE_SOURCE };
export type PlayerReportMessage = PlayerReport & { source: typeof PLAYER_BRIDGE_SOURCE };

const COMMANDS = ["capabilities", "load", "play", "pause", "seek", "audio", "unload"];
const EVENTS = ["capabilities", "ready", "playing", "paused", "time", "buffering", "tracks", "ended", "error", "log"];

function message(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return record.source === PLAYER_BRIDGE_SOURCE ? record : null;
}

const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);

/** Checks a command field by field: it arrives from a page the shell loaded from the network. */
export function isPlayerCommand(value: unknown): value is PlayerCommandMessage {
  const record = message(value);
  if (!record || !COMMANDS.includes(String(record.command))) return false;
  if (record.command === "capabilities") return finite(record.request);
  if (!finite(record.session)) return false;
  if (record.command === "load") {
    return (record.kind === "file" || record.kind === "hls") && typeof record.url === "string" && /^https?:\/\//i.test(record.url) && finite(record.start);
  }
  if (record.command === "seek") return finite(record.seconds);
  if (record.command === "audio") return typeof record.id === "string";
  return true;
}

export function isPlayerReport(value: unknown): value is PlayerReportMessage {
  const record = message(value);
  if (!record || !EVENTS.includes(String(record.event))) return false;
  return record.event === "capabilities" ? finite(record.request) : finite(record.session);
}
