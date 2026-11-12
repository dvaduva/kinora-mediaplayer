// Builds the LG TV package: the shell, packed into an IPK with the webOS CLI (ares).
//
//   pnpm tv:package:webos                          -> apps/tv/webos/dist/com.kinora.tv_<version>_all.ipk
//   pnpm tv:package:webos -- --install             also installs it on the TV (ares-install)
//   pnpm tv:package:webos -- --install --run       ...and starts it (ares-launch)
//   pnpm tv:package:webos -- --device <name>       picks the TV set up with `ares-setup-device` (default: the default device)
//
// Environment:
//   WEBOS_DEVICE   device name, instead of --device
//   ARES_CLI       folder holding the ares-* commands, when they are not on PATH
//
// Install the CLI once with `npm install -g @webos-tools/cli`; see docs/tv/webos.md.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webosDir = path.join(root, "apps/tv/webos");
const outDir = path.join(webosDir, "dist");
const stage = path.join(outDir, "app");
const FILES = ["appinfo.json", "icon.png", "index.html", "shell.js", "shell.css"];

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const device = option("--device") ?? process.env.WEBOS_DEVICE;
const windows = process.platform === "win32";

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

/** Runs a command, streaming its output; `.cmd` files need a shell on Windows, hence the quoting. */
function run(command, commandArgs, options = {}) {
  const quote = (value) => (/[\s"&|<>^]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value);
  const result = windows
    ? spawnSync([command, ...commandArgs].map(quote).join(" "), { stdio: "inherit", shell: true, cwd: options.cwd })
    : spawnSync(command, commandArgs, { stdio: "inherit", cwd: options.cwd });
  if (result.error) fail(`${path.basename(command)} could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${path.basename(command)} exited with code ${result.status}`);
}

function onPath(name) {
  const result = spawnSync(windows ? "where" : "which", [name], { encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

/** An ares-* command: from ARES_CLI, or on PATH. */
function ares(name) {
  const file = windows ? `${name}.cmd` : name;
  if (process.env.ARES_CLI) {
    const candidate = path.join(process.env.ARES_CLI, file);
    if (!fs.existsSync(candidate)) fail(`ARES_CLI is ${process.env.ARES_CLI}, but ${file} is not there.`);
    return candidate;
  }
  const found = onPath(file) ?? (windows ? onPath(name) : null);
  if (found) return found;
  fail(`${name} was not found. Install the webOS CLI with \`npm install -g @webos-tools/cli\`,\n  or set ARES_CLI to the folder that holds it. See docs/tv/webos.md.`);
}

const appinfo = JSON.parse(fs.readFileSync(path.join(webosDir, "appinfo.json"), "utf8"));
const ipkName = `${appinfo.id}_${appinfo.version}_all.ipk`;
const packager = ares("ares-package");

// 1. The shell, freshly built into apps/tv/webos.
console.log("› Building the TV shell");
run(windows ? "corepack.cmd" : "corepack", ["pnpm", "--filter", "@kinora/tv-shell", "build"], { cwd: root });

// 2. A clean staging folder with just the app's files.
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
for (const file of FILES) {
  const source = path.join(webosDir, file);
  if (!fs.existsSync(source)) fail(`${path.relative(root, source)} is missing.`);
  fs.copyFileSync(source, path.join(stage, file));
}

// 3. Package. --no-minify: shell.js is already minified, and ares' own minifier predates ES2015.
console.log(`› Packaging with ${packager}`);
run(packager, ["--no-minify", "--outdir", outDir, stage]);
const ipk = path.join(outDir, ipkName);
if (!fs.existsSync(ipk)) fail(`ares-package finished without producing ${ipkName}.`);
console.log(`✔ ${path.relative(root, ipk)}`);

// 4. Optionally install and start it on the TV set up with ares-setup-device.
if (flag("--install") || flag("--run")) {
  const target = device ? ["--device", device] : [];
  console.log(`› Installing on ${device ?? "the default device"}`);
  run(ares("ares-install"), [...target, ipk]);
  if (flag("--run")) run(ares("ares-launch"), [...target, appinfo.id]);
}
