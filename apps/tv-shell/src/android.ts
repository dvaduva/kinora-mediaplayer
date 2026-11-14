import {
  isPlayerReport,
  PLAYER_BRIDGE_SOURCE,
  SHELL_KEYS,
  type CapabilityProfile,
  type PlayerCommand,
  type PlayerReport,
  type ShellKey,
} from "@kinora/shared";

/**
 * The Android TV app (apps/android-tv): this page runs in its WebView, and the native side adds the
 * `KinoraAndroid` interface (`addJavascriptInterface`). The interface is visible in every frame, the
 * UI's too, so each call carries the nonce MainActivity put in this page's hash: the frame, loaded from
 * another origin, cannot read it. Native answers come back through `window.kinoraNative.receive`, which
 * the activity calls with `evaluateJavascript` (main frame only).
 *
 * What travels, as JSON text:
 * - shell → native: `PlayerCommand`s for ExoPlayer, and a few synchronous questions (profile, NSD
 *   results, the device's address and name).
 * - native → shell: `PlayerReport`s (durations as seconds, null while unknown, "live" for a growing
 *   stream, since JSON has no NaN or Infinity), and `{ key }` for the media keys taken from the remote.
 */

export interface NativeInterface {
  command(nonce: string, json: string): void;
  capabilities(nonce: string): string;
  servers(nonce: string): string;
  localAddress(nonce: string): string;
  deviceName(nonce: string): string;
  exit(nonce: string): void;
}

type Host = Window & {
  KinoraAndroid?: NativeInterface;
  kinoraNative?: { receive: (json: string) => void };
};

export interface AndroidHost {
  command(command: PlayerCommand): void;
  capabilities(): CapabilityProfile | null;
  /** Kinora servers found by NSD (`_kinora._tcp`) so far, as `http://host:port`. */
  servers(): string[];
  localAddress(): string | null;
  deviceName(): string | null;
  exit(): void;
  onReport(handler: (report: PlayerReport) => void): void;
  onKey(handler: (key: ShellKey) => void): void;
}

function duration(value: unknown) {
  if (value === "live") return Number.POSITIVE_INFINITY;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : Number.NaN;
}

/** A native message as the shell uses it, or null when it is neither a report nor a known key. */
export function decodeNative(json: string): { report: PlayerReport } | { key: ShellKey } | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.key === "string") {
    const key = SHELL_KEYS.find((name) => name === record.key);
    return key ? { key } : null;
  }
  const report: Record<string, unknown> = { ...record, source: PLAYER_BRIDGE_SOURCE };
  if (record.event === "ready" || record.event === "time") report.duration = duration(record.duration);
  if (record.event === "time") report.time = typeof record.time === "number" && Number.isFinite(record.time) ? Math.max(0, record.time) : 0;
  if (!isPlayerReport(report)) return null;
  const { source: _source, ...plain } = report;
  return { report: plain as PlayerReport };
}

function parse<T>(json: string | null | undefined, check: (value: unknown) => value is T): T | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as unknown;
    return check(value) ? value : null;
  } catch {
    return null;
  }
}

const isObject = (value: unknown): value is CapabilityProfile => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isUrlList = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string" && /^https?:\/\//.test(item));

/** The native side, when this page runs in the Android TV app; null anywhere else. Reads (and drops) the nonce from the hash. */
export function createAndroidHost(): AndroidHost | null {
  const host = window as Host;
  const native = host.KinoraAndroid;
  if (!native) return null;
  const match = /[#&]nonce=([\w-]+)/.exec(window.location.hash);
  const nonce = match ? match[1]! : "";
  try {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  } catch {
    // the hash stays; nothing reads it but this page
  }
  const reports: Array<(report: PlayerReport) => void> = [];
  const keys: Array<(key: ShellKey) => void> = [];
  host.kinoraNative = {
    receive: (json) => {
      const message = decodeNative(json);
      if (!message) return;
      if ("key" in message) for (const handler of keys) handler(message.key);
      else for (const handler of reports) handler(message.report);
    },
  };
  const ask = (call: () => string) => {
    try {
      return call();
    } catch {
      return "";
    }
  };
  return {
    command: (command) => {
      try {
        native.command(nonce, JSON.stringify(command));
      } catch {
        // the activity is going away
      }
    },
    capabilities: () => parse(ask(() => native.capabilities(nonce)), isObject),
    servers: () => parse(ask(() => native.servers(nonce)), isUrlList) ?? [],
    localAddress: () => {
      const ip = ask(() => native.localAddress(nonce));
      return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : null;
    },
    deviceName: () => ask(() => native.deviceName(nonce)).trim().slice(0, 60) || null,
    exit: () => {
      try {
        native.exit(nonce);
      } catch {
        window.close();
      }
    },
    onReport: (handler) => {
      reports.push(handler);
    },
    onKey: (handler) => {
      keys.push(handler);
    },
  };
}
