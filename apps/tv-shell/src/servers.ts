/** Default port of a Kinora server; tried after the ports of servers seen before. */
export const DEFAULT_PORT = 3001;

export type KnownServer = {
  /** `http://host:port`, no trailing slash. */
  url: string;
  /** Last reported version, shown in the list. */
  version: string | null;
  /** Device token (or the access key, as a fallback); null until paired. */
  token: string | null;
  lastUsed: number;
};

type Saved = { servers: KnownServer[]; current: string | null };

const STORAGE_KEY = "kinora.shell";

/** `192.168.1.20`, `192.168.1.20:3001` or a full URL, as `http://host:port`; null when it cannot be one. */
export function normalizeServerUrl(value: string): string | null {
  let text = value.trim().replace(/\/+$/, "");
  if (!text) return null;
  if (!/^https?:\/\//i.test(text)) text = `http://${text}`;
  const match = /^(https?):\/\/([^/:?#\s]+|\[[0-9a-f:]+\])(?::(\d{1,5}))?(\/.*)?$/i.exec(text);
  if (!match) return null;
  const [, scheme, hostname, port, rest] = match;
  if (rest && rest !== "/" && rest !== "/tv" && rest !== "/tv/") return null;
  const number = port ? Number(port) : scheme!.toLowerCase() === "https" ? 443 : DEFAULT_PORT;
  if (!(number > 0 && number < 65536)) return null;
  const portText = (scheme!.toLowerCase() === "https" && number === 443) ? "" : `:${number}`;
  return `${scheme!.toLowerCase()}://${hostname!.toLowerCase()}${portText}`;
}

export function hostOf(url: string) {
  return url.replace(/^https?:\/\//, "");
}

export function portOf(url: string) {
  const match = /:(\d+)$/.exec(url);
  return match ? Number(match[1]) : url.startsWith("https:") ? 443 : 80;
}

function read(): Saved {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Saved> | null;
    const servers = Array.isArray(parsed?.servers)
      ? parsed!.servers.filter((server): server is KnownServer => typeof server?.url === "string")
      : [];
    return { servers, current: typeof parsed?.current === "string" ? parsed.current : null };
  } catch {
    return { servers: [], current: null };
  }
}

function write(saved: Saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // storage full or unavailable: the TV pairs again next time
  }
}

export function knownServers() {
  return read().servers.slice().sort((a, b) => b.lastUsed - a.lastUsed);
}

export function currentServer(): KnownServer | null {
  const saved = read();
  return saved.servers.find((server) => server.url === saved.current) ?? null;
}

/** Adds or updates a server and makes it the one opened on the next start. */
export function rememberServer(url: string, change: Partial<Omit<KnownServer, "url">> = {}): KnownServer {
  const saved = read();
  const existing = saved.servers.find((server) => server.url === url);
  const next: KnownServer = { url, version: null, token: null, ...existing, ...change, lastUsed: Date.now() };
  saved.servers = [next, ...saved.servers.filter((server) => server.url !== url)].slice(0, 10);
  saved.current = url;
  write(saved);
  return next;
}

export function setToken(url: string, token: string | null) {
  const saved = read();
  const server = saved.servers.find((entry) => entry.url === url);
  if (!server) return;
  server.token = token;
  write(saved);
}

export function clearCurrent() {
  const saved = read();
  saved.current = null;
  write(saved);
}
