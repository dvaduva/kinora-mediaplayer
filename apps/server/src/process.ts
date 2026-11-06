import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function commandWorks(command: string) {
  try {
    const result = spawnSync(command, ["-version"], { stdio: "ignore", windowsHide: true });
    return result.status === 0;
  } catch {
    return false;
  }
}

function looksLikeTool(file: string, name: string) {
  const base = path.basename(file).toLowerCase();
  return base === name || base === `${name}.exe`;
}

function firstExisting(candidates: string[]) {
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Ignore unreadable candidates.
    }
  }
  return null;
}

function searchWingetBins(name: string) {
  if (process.platform !== "win32") return null;
  const roots = [
    path.join(os.homedir(), "AppData", "Local", "Microsoft", "WinGet", "Packages"),
    path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Packages"),
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "ffmpeg", "bin"),
    path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "ffmpeg", "bin"),
  ].filter(Boolean);

  const wanted = process.platform === "win32" ? `${name}.exe` : name;
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    if (path.basename(root).toLowerCase() === "bin") {
      const direct = firstExisting([path.join(root, wanted)]);
      if (direct) return direct;
      continue;
    }
    let packages: string[] = [];
    try {
      packages = fs.readdirSync(root).filter((entry) => /ffmpeg/i.test(entry));
    } catch {
      continue;
    }
    for (const entry of packages) {
      const packageDir = path.join(root, entry);
      const nested = firstExisting([
        path.join(packageDir, "bin", wanted),
        ...safeDirs(packageDir).flatMap((dir) => [
          path.join(dir, "bin", wanted),
          path.join(dir, wanted),
        ]),
      ]);
      if (nested) return nested;
    }
  }
  return null;
}

function safeDirs(root: string) {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

function pathCandidates(name: string) {
  const wanted = process.platform === "win32" ? [`${name}.exe`, name] : [name];
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const out: string[] = [];
  for (const dir of dirs) {
    for (const file of wanted) out.push(path.join(dir, file));
  }
  return out;
}

export function resolveTool(name: "ffmpeg" | "ffprobe") {
  if (commandWorks(name)) return name;
  if (process.platform === "win32" && commandWorks(`${name}.exe`)) return `${name}.exe`;

  const fromPath = firstExisting(pathCandidates(name));
  if (fromPath && commandWorks(fromPath)) return fromPath;

  const fromDisk = searchWingetBins(name);
  if (fromDisk && commandWorks(fromDisk)) return fromDisk;

  return null;
}

export function run(command: string, args: string[], timeoutMs = 30_000) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export const tools = {
  ffmpeg: false,
  ffprobe: false,
};

export const bins = {
  ffmpeg: "ffmpeg",
  ffprobe: "ffprobe",
};

function rememberBin(name: "ffmpeg" | "ffprobe", resolved: string | null) {
  tools[name] = Boolean(resolved);
  bins[name] = resolved ?? name;
  if (!resolved || resolved === name || resolved === `${name}.exe`) return;
  if (!looksLikeTool(resolved, name)) return;
  const dir = path.dirname(resolved);
  const parts = (process.env.PATH ?? "").split(path.delimiter);
  if (!parts.some((entry) => path.resolve(entry) === path.resolve(dir))) {
    process.env.PATH = `${dir}${path.delimiter}${process.env.PATH ?? ""}`;
  }
}

export function detectTools() {
  rememberBin("ffprobe", resolveTool("ffprobe"));
  rememberBin("ffmpeg", resolveTool("ffmpeg"));
  return tools;
}
