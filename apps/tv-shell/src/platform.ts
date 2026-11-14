import type { DevicePlatform } from "@kinora/shared";
import type { WebosInfo } from "@kinora/client/capabilities";

type Tizen = {
  tvinputdevice?: { registerKeyBatch?: (keys: string[]) => void; registerKey?: (key: string) => void };
  application?: { getCurrentApplication?: () => { exit: () => void } };
};
type WebApis = { network?: { getIp?: () => string }; productinfo?: { getRealModel?: () => string; getModel?: () => string } };
type PalmBridge = { onservicecallback: (message: string) => void; call: (uri: string, params: string) => void };

type Host = Window & {
  tizen?: Tizen;
  webapis?: WebApis;
  PalmSystem?: unknown;
  PalmServiceBridge?: new () => PalmBridge;
  KinoraAndroid?: unknown;
  KINORA_PLATFORM?: string;
};

const host = window as Host;

export function detectPlatform(): DevicePlatform {
  if (host.tizen || host.KINORA_PLATFORM === "tizen") return "tizen";
  if (host.PalmSystem || host.PalmServiceBridge || host.KINORA_PLATFORM === "webos") return "webos";
  if (host.KinoraAndroid || host.KINORA_PLATFORM === "android") return "android";
  return "browser";
}

/** `webos`: what Luna said about the TV (see `webosInfo`), for its model name. `native`: the name the Android app gives. */
export function deviceName(platform: DevicePlatform, webos?: WebosInfo | null, native?: string | null) {
  if (platform === "tizen") {
    try {
      const model = host.webapis?.productinfo?.getRealModel?.() ?? host.webapis?.productinfo?.getModel?.();
      if (model) return `Samsung TV ${model}`;
    } catch {
      // productinfo needs its privilege; the generic name is fine
    }
    return "Samsung TV";
  }
  if (platform === "webos") return webos?.modelName ? `LG TV ${webos.modelName}` : "LG TV";
  if (platform === "android") return native || "Android TV";
  return "Browser";
}

function isIPv4(value: unknown): value is string {
  return typeof value === "string" && /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(value) && value !== "0.0.0.0";
}

function lunaCall(uri: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    if (!host.PalmServiceBridge) return resolve(null);
    const timer = window.setTimeout(() => resolve(null), 3000);
    try {
      const bridge = new host.PalmServiceBridge();
      bridge.onservicecallback = (message) => {
        window.clearTimeout(timer);
        try {
          resolve(JSON.parse(message) as Record<string, unknown>);
        } catch {
          resolve(null);
        }
      };
      bridge.call(uri, JSON.stringify(params));
    } catch {
      window.clearTimeout(timer);
      resolve(null);
    }
  });
}

/**
 * The TV's own IPv4 address, to know which /24 to scan. Web apps on Tizen and webOS cannot browse mDNS,
 * so this is how they find the server. Null in a desktop browser.
 */
export async function localAddress(platform: DevicePlatform): Promise<string | null> {
  if (platform === "tizen") {
    try {
      const ip = host.webapis?.network?.getIp?.();
      if (isIPv4(ip)) return ip;
    } catch {
      // network API missing or not allowed
    }
    return null;
  }
  if (platform === "webos") {
    for (const uri of ["luna://com.palm.connectionmanager/getStatus", "luna://com.webos.service.connectionmanager/getStatus"]) {
      const status = await lunaCall(uri);
      if (!status) continue;
      for (const kind of ["wired", "wifi"]) {
        const link = status[kind] as { state?: string; ipAddress?: string } | undefined;
        if (link?.state === "connected" && isIPv4(link.ipAddress)) return link.ipAddress;
      }
    }
    return null;
  }
  // Opened from a server in a desktop browser (development): its host is on the right subnet.
  return isIPv4(window.location.hostname) ? window.location.hostname : null;
}

/** Luna answers booleans as "true"/"false" strings on some firmware. */
function lunaFlag(value: unknown) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

function lunaText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 60) : null;
}

/**
 * The LG TV's model, webOS SDK version and whether the panel is 4K, from the system property service
 * (what webOSTV.js's `deviceInfo` asks). Every field is null when Luna does not answer, as in a browser.
 */
export async function webosInfo(): Promise<WebosInfo> {
  const reply = await lunaCall("luna://com.webos.service.tv.systemproperty/getSystemInfo", { keys: ["modelName", "sdkVersion", "UHD"] });
  const ok = reply && reply.returnValue !== false;
  return {
    modelName: ok ? lunaText(reply.modelName) : null,
    sdkVersion: ok ? lunaText(reply.sdkVersion) : null,
    uhd: ok ? lunaFlag(reply.UHD) : null,
  };
}

/** Media and channel keys reach a Tizen app only once registered; webOS sends them anyway. */
export function registerKeys() {
  const input = host.tizen?.tvinputdevice;
  if (!input) return;
  const keys = [
    "MediaPlay",
    "MediaPause",
    "MediaPlayPause",
    "MediaStop",
    "MediaFastForward",
    "MediaRewind",
    "MediaTrackNext",
    "MediaTrackPrevious",
    "ChannelUp",
    "ChannelDown",
  ];
  try {
    if (input.registerKeyBatch) input.registerKeyBatch(keys);
    else for (const key of keys) input.registerKey?.(key);
  } catch {
    // older firmware without one of these keys
  }
}

export function exitApp() {
  try {
    const app = host.tizen?.application?.getCurrentApplication?.();
    if (app) {
      app.exit();
      return;
    }
  } catch {
    // fall through
  }
  window.close();
}

/** Back on the remote: 10009 on Tizen, 461 on webOS, Escape or Backspace on a keyboard (the Android app sends Escape). */
export function isBackKey(event: KeyboardEvent) {
  if (event.keyCode === 10009 || event.keyCode === 461 || event.key === "Escape" || event.key === "GoBack") return true;
  if (event.key !== "Backspace") return false;
  const target = event.target as HTMLElement | null;
  return !(target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA"));
}
