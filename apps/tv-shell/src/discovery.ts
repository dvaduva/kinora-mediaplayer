import { API_VERSION, type HealthInfo } from "@kinora/shared";
import { DEFAULT_PORT, portOf } from "./servers";

export type Found = { url: string; health: HealthInfo };

export function isHealth(value: unknown): value is HealthInfo {
  if (!value || typeof value !== "object") return false;
  const health = value as Record<string, unknown>;
  return health.name === "kinora" && typeof health.apiVersion === "number" && typeof health.serverVersion === "string";
}

/** "ok", or which side needs updating when the server speaks another API version. */
export function compatibility(health: HealthInfo): "ok" | "server-too-old" | "app-too-old" {
  if (health.apiVersion === API_VERSION) return "ok";
  return health.apiVersion < API_VERSION ? "server-too-old" : "app-too-old";
}

/**
 * Addresses to probe: the /24 around the TV's own address, nearest hosts first, on each candidate port
 * (ports of servers used before, then the default). Hosts of known servers on that subnet go first.
 */
export function scanTargets(localIp: string, knownUrls: string[]): string[] {
  const parts = localIp.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !(part >= 0 && part <= 255))) return [];
  const prefix = parts.slice(0, 3).join(".");
  const self = parts[3]!;
  const ports: number[] = [];
  for (const url of knownUrls) {
    const port = portOf(url);
    if (!ports.includes(port)) ports.push(port);
  }
  if (!ports.includes(DEFAULT_PORT)) ports.push(DEFAULT_PORT);

  const hosts: number[] = [];
  for (let host = 1; host <= 254; host += 1) if (host !== self) hosts.push(host);
  // Routers and servers tend to sit near the TV or at the ends of the range; nearest first finds them sooner.
  hosts.sort((a, b) => Math.abs(a - self) - Math.abs(b - self));

  const targets: string[] = [];
  for (const url of knownUrls) {
    if (url.startsWith(`http://${prefix}.`) && !targets.includes(url)) targets.push(url);
  }
  for (const port of ports) {
    for (const host of hosts) {
      const url = `http://${prefix}.${host}:${port}`;
      if (!targets.includes(url)) targets.push(url);
    }
  }
  return targets;
}

/**
 * Probes every target's `/api/health` with a short timeout, a few dozen at a time. Typically 2–4 s for a /24.
 * `onFound` runs as each server answers; the promise resolves with all of them.
 */
export async function scan(
  targets: string[],
  probe: (url: string) => Promise<unknown>,
  options: { concurrency?: number; onFound?: (found: Found) => void; onProgress?: (done: number, total: number) => void; cancelled?: () => boolean } = {},
): Promise<Found[]> {
  const found: Found[] = [];
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < targets.length) {
      if (options.cancelled?.()) return;
      const url = targets[next]!;
      next += 1;
      const health = await probe(url);
      done += 1;
      if (isHealth(health) && !found.some((entry) => entry.url === url)) {
        const entry = { url, health };
        found.push(entry);
        options.onFound?.(entry);
      }
      options.onProgress?.(done, targets.length);
    }
  }
  const workers: Promise<void>[] = [];
  for (let index = 0; index < Math.min(options.concurrency ?? 48, targets.length); index += 1) workers.push(worker());
  await Promise.all(workers);
  return found;
}
