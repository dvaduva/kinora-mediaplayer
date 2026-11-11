export type ApiConfig = {
  /** Empty means same origin (served by the server itself or through the Vite proxy). */
  baseUrl: string;
  /** Sent as a Bearer token when set. */
  token: string;
};

let config: ApiConfig = { baseUrl: "", token: "" };
let onUnauthorized = () => {};

/** Points the client at a server. Fields left out keep their current value. */
export function configureApi(next: Partial<ApiConfig>) {
  config = {
    baseUrl: next.baseUrl ?? config.baseUrl,
    token: next.token ?? config.token,
  };
}

export function getApiConfig(): ApiConfig {
  return { ...config };
}

export function setUnauthorized(handler: () => void) {
  onUnauthorized = handler;
}

/** Absolute URL for a server path, prefixed with the configured base URL. */
export function apiUrl(path: string) {
  return `${config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function credentials(): RequestCredentials {
  return config.baseUrl ? "omit" : "include";
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("Content-Type", "application/json");
  if (config.token) headers.set("Authorization", `Bearer ${config.token}`);
  const response = await fetch(apiUrl(path), {
    ...init,
    headers,
    credentials: credentials(),
  });
  if (response.status === 401) {
    onUnauthorized();
    throw new Error("unauthorized");
  }
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error || response.statusText);
  return body as T;
}

/** Establish a session cookie when served same-origin so `<video src>` works with a token. */
export async function createSession(token: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(apiUrl("/api/session"), {
    method: "POST",
    headers,
    credentials: credentials(),
    body: JSON.stringify({ token }),
  });
  if (!response.ok) throw new Error("unauthorized");
}
