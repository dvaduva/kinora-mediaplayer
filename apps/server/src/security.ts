export function isLocalHost(host: string) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/** Origins of the Vite dev servers, which proxy /api to this process. */
export const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://[::1]:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  "http://[::1]:5174",
];

/** Extra trusted origins, comma separated (e.g. a reverse proxy on another port). */
export function configuredOrigins(value = process.env.KINORA_ALLOWED_ORIGINS) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

export function trustedOrigins() {
  return [...DEV_ORIGINS, ...configuredOrigins()];
}

function hostnameOf(hostHeader: string) {
  try {
    return new URL(`http://${hostHeader}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * A browser request is accepted when it comes from the page this server serves (same host)
 * or from an explicitly trusted origin. Requests without an Origin header (same-origin GETs,
 * media elements, curl) are left to the token check.
 */
export function isAllowedOrigin(origin: string | undefined, hostHeader: string | undefined, trusted = trustedOrigins()) {
  if (!origin) return true;
  if (origin === "null") return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (trusted.includes(parsed.origin)) return true;
  return Boolean(hostHeader) && parsed.host.toLowerCase() === hostHeader!.toLowerCase();
}

/**
 * While bound to loopback only, the Host header must name loopback too. A page on
 * attacker.example that rebinds its DNS to 127.0.0.1 still sends Host: attacker.example.
 */
export function isAllowedHost(hostHeader: string | undefined, bindHost: string) {
  if (!isLocalHost(bindHost)) return true;
  if (!hostHeader) return false;
  const name = hostnameOf(hostHeader);
  return name != null && isLocalHost(name);
}

export type RouteAccess = {
  /** Answered without any token. */
  open: boolean;
  /**
   * Reachable from any origin, without cookies. The TV shells run from a packaged page (file:// or app://),
   * so their requests carry an origin the server does not serve. Nothing here relies on ambient credentials.
   */
  anyOrigin: boolean;
};

const PAIR_POLL = /^\/api\/pair\/[^/]+$/;

export function routeAccess(method: string, pathname: string): RouteAccess {
  if (pathname === "/api/health") return { open: true, anyOrigin: true };
  if (pathname === "/api/pair" && method === "POST") return { open: true, anyOrigin: true };
  if (PAIR_POLL.test(pathname) && method === "GET") return { open: true, anyOrigin: true };
  // The shell's heartbeat: tells "server down" from "this device was revoked".
  if (pathname === "/api/devices/me" && method === "GET") return { open: false, anyOrigin: true };
  if (pathname === "/api/setup" || pathname === "/api/session") return { open: true, anyOrigin: false };
  return { open: false, anyOrigin: false };
}

/**
 * Device tokens can browse, play and match titles, but not manage the server:
 * no other devices, no pairing approvals, no settings, libraries, folders or caches.
 */
export function isDeviceForbidden(method: string, pathname: string) {
  if (pathname === "/api/devices/me") return false;
  if (pathname === "/api/devices" || pathname.startsWith("/api/devices/")) return true;
  if (pathname.startsWith("/api/pair/") && !PAIR_POLL.test(pathname)) return true;
  if (pathname === "/api/settings" && method !== "GET") return true;
  if (pathname === "/api/folders" || pathname.startsWith("/api/cache/")) return true;
  if ((pathname === "/api/libraries" || pathname.startsWith("/api/libraries/")) && method !== "GET") return true;
  return false;
}

/**
 * Tokens a request presents, most explicit first. The query form (`?token=`) is for media elements,
 * which cannot send headers, and is only read on GET and HEAD.
 */
export function presentedTokens(input: { method: string; authorization?: string; query?: unknown; cookie?: string }) {
  const tokens: string[] = [];
  const header = input.authorization ?? "";
  if (header.startsWith("Bearer ") && header.length > 7) tokens.push(header.slice(7));
  if (input.method === "GET" || input.method === "HEAD") {
    const query = input.query && typeof input.query === "object" ? (input.query as Record<string, unknown>).token : undefined;
    if (typeof query === "string" && query) tokens.push(query);
  }
  if (input.cookie) tokens.push(input.cookie);
  return tokens;
}

/** Query parameters that carry credentials: the media token and the pairing secret. */
const SECRET_PARAMS = /([?&](?:token|secret)=)[^&#]*/gi;

/** The URL as it may be written to a log: credential values replaced, so log files never hold a working key. */
export function redactUrl(url: string) {
  return url.replace(SECRET_PARAMS, "$1[redacted]");
}
