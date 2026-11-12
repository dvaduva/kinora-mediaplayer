import type { DevicePlatform } from "@kinora/shared";

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
  KINORA_PLATFORM?: string;
};

const host = window as Host;

export function detectPlatform(): DevicePlatform {
  if (host.tizen || host.KINORA_PLATFORM === "tizen") return "tizen";
  if (host.PalmSystem || host.PalmServiceBridge || host.KINORA_PLATFORM === "webos") return "webos";
  return "browser";
}

export function deviceName(platform: DevicePlatform) {
  if (platform === "tizen") {
    try {
      const model = host.webapis?.productinfo?.getRealModel?.() ?? host.webapis?.productinfo?.getModel?.();
      if (model) return `Samsung TV ${model}`;
    } catch {
      // productinfo needs its privilege; the generic name is fine
    }
    return "Samsung TV";
  }
  if (platform === "webos") return "LG TV";
  return "Browser";
}

function isIPv4(value: unknown): value is string {
  return typeof value === "string" && /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(value) && value !== "0.0.0.0";
}

function lunaCall(uri: string): Promise<Record<string, unknown> | null> {
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
      bridge.call(uri, "{}");
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

/** Back on the remote: 10009 on Tizen, 461 on webOS, Escape or Backspace on a keyboard. */
export function isBackKey(event: KeyboardEvent) {
  if (event.keyCode === 10009 || event.keyCode === 461 || event.key === "Escape" || event.key === "GoBack") return true;
  if (event.key !== "Backspace") return false;
  const target = event.target as HTMLElement | null;
  return !(target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA"));
}
