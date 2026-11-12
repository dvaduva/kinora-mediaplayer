import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function readVersion() {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(here, "../package.json"), "utf8")) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** The server package version, reported by `/api/health` and the mDNS announcement. */
export const SERVER_VERSION = readVersion();
