import fs from "node:fs";
import path from "node:path";
import type { DirectoryListing } from "@kinora/shared";

/** Folders that never hold media and only clutter the picker. */
const SKIPPED = new Set(["$recycle.bin", "system volume information", "$windows.~bt", "$windows.~ws", "recovery", "config.msi"]);

export class BrowseError extends Error {}

function windowsDrives() {
  const drives: { name: string; path: string }[] = [];
  for (let code = 65; code <= 90; code += 1) {
    const root = `${String.fromCharCode(code)}:\\`;
    try {
      fs.accessSync(root);
      drives.push({ name: root, path: root });
    } catch {
      // No such drive, or not ready (empty card reader).
    }
  }
  return drives;
}

function subfolders(dir: string) {
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new BrowseError(code === "ENOENT" || code === "ENOTDIR" ? "folder_not_found" : "folder_unreadable");
  }
  return dirents
    .filter((entry) => {
      if (entry.name.startsWith(".") || SKIPPED.has(entry.name.toLowerCase())) return false;
      if (entry.isDirectory()) return true;
      if (!entry.isSymbolicLink()) return false;
      try {
        return fs.statSync(path.join(dir, entry.name)).isDirectory();
      } catch {
        return false;
      }
    })
    .map((entry) => ({ name: entry.name, path: path.join(dir, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

/** Lists the subfolders of `requested`, or the top level when it is empty. Only folder names are exposed. */
export function browse(requested: string): DirectoryListing {
  const trimmed = requested.trim();
  if (!trimmed) {
    if (process.platform === "win32") return { path: null, parent: null, entries: windowsDrives() };
    return { path: "/", parent: null, entries: subfolders("/") };
  }
  // "D:" alone means the drive's current directory on Windows; treat it as the drive root.
  const typed = process.platform === "win32" && /^[a-z]:$/i.test(trimmed) ? `${trimmed}\\` : trimmed;
  if (!path.isAbsolute(typed)) throw new BrowseError("folder_not_absolute");
  const dir = path.resolve(typed);
  const entries = subfolders(dir);
  const up = path.dirname(dir);
  const parent = up === dir ? (process.platform === "win32" ? "" : null) : up;
  return { path: dir, parent, entries };
}
