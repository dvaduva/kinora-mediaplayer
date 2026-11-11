const STORAGE_KEY = "kinora.tv.connection";

export type Connection = {
  /** Empty means same origin (hosted `/tv` or Vite proxy). */
  baseUrl: string;
  token: string;
};

export function loadConnection(): Connection {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { baseUrl: "", token: "" };
    const parsed = JSON.parse(raw) as Partial<Connection>;
    return {
      baseUrl: typeof parsed.baseUrl === "string" ? normalizeBaseUrl(parsed.baseUrl) : "",
      token: typeof parsed.token === "string" ? parsed.token : "",
    };
  } catch {
    return { baseUrl: "", token: "" };
  }
}

export function saveConnection(connection: Connection) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      baseUrl: normalizeBaseUrl(connection.baseUrl),
      token: connection.token.trim(),
    }),
  );
}

export function clearConnection() {
  localStorage.removeItem(STORAGE_KEY);
}

export function normalizeBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}
