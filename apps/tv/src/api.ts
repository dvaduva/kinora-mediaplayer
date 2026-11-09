import { apiUrl, loadConnection, type Connection } from "./connection";

let connection: Connection = loadConnection();
let onUnauthorized = () => {};

export function setConnection(next: Connection) {
  connection = next;
}

export function getConnection() {
  return connection;
}

export function setUnauthorized(handler: () => void) {
  onUnauthorized = handler;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("Content-Type", "application/json");
  if (connection.token) headers.set("Authorization", `Bearer ${connection.token}`);
  const response = await fetch(apiUrl(connection.baseUrl, path), {
    ...init,
    headers,
    credentials: connection.baseUrl ? "omit" : "include",
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
  const response = await fetch(apiUrl(connection.baseUrl, "/api/session"), {
    method: "POST",
    headers,
    credentials: connection.baseUrl ? "omit" : "include",
    body: JSON.stringify({ token }),
  });
  if (!response.ok) throw new Error("unauthorized");
}
