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
