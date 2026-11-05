import { spawn, spawnSync } from "node:child_process";

export function commandWorks(command: string) {
  try {
    const result = spawnSync(command, ["-version"], { stdio: "ignore", windowsHide: true });
    return result.status === 0;
  } catch {
    return false;
  }
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

export function detectTools() {
  tools.ffprobe = commandWorks("ffprobe");
  tools.ffmpeg = commandWorks("ffmpeg");
  return tools;
}
