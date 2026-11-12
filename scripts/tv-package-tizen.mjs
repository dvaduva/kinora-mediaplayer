// Builds the Samsung TV package: the shell, signed with your local Tizen author certificate.
//
//   pnpm tv:package:tizen                         -> apps/tv/tizen/dist/Kinora.wgt
//   pnpm tv:package:tizen -- --install            also installs it on the connected TV (sdb)
//   pnpm tv:package:tizen -- --install --run      ...and starts it
//   pnpm tv:package:tizen -- --target <serial>    picks the TV when several are connected (see `sdb devices`)
//
// Environment:
//   TIZEN_PROFILE  security profile from Tizen Studio's Certificate Manager (default: the active one)
//   TIZEN_CLI      path to the `tizen` CLI, when it is not on PATH or in the default Tizen Studio folder
//
// The certificate never goes into git; see docs/tv/tizen.md.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tizenDir = path.join(root, "apps/tv/tizen");
const outDir = path.join(tizenDir, "dist");
const stage = path.join(outDir, "app");
const APP_ID = "KinoraTV.Kinora";
const WGT = "Kinora.wgt";
const FILES = ["config.xml", "icon.png", "index.html", "shell.js", "shell.css"];

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const target = option("--target");
const windows = process.platform === "win32";

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

/** Runs a command, streaming its output; `.bat` and `.cmd` files need a shell on Windows, hence the quoting. */
function run(command, commandArgs, options = {}) {
  const quote = (value) => (/[\s"&|<>^]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value);
  const result = windows
    ? spawnSync([command, ...commandArgs].map(quote).join(" "), { stdio: "inherit", shell: true, cwd: options.cwd })
    : spawnSync(command, commandArgs, { stdio: "inherit", cwd: options.cwd });
  if (result.error) fail(`${path.basename(command)} could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${path.basename(command)} ${commandArgs[0] ?? ""} exited with code ${result.status}`);
}

function onPath(name) {
  const result = spawnSync(windows ? "where" : "which", [name], { encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

function findTizenCli() {
  if (process.env.TIZEN_CLI) {
    if (!fs.existsSync(process.env.TIZEN_CLI)) fail(`TIZEN_CLI points to ${process.env.TIZEN_CLI}, which does not exist.`);
    return process.env.TIZEN_CLI;
  }
  const found = onPath(windows ? "tizen.bat" : "tizen") ?? (windows ? onPath("tizen") : null);
  if (found) return found;
  const binary = windows ? "tizen.bat" : "tizen";
  const candidates = [
    path.join(os.homedir(), "tizen-studio", "tools", "ide", "bin", binary),
    ...(windows ? ["C:\\tizen-studio\\tools\\ide\\bin\\tizen.bat", "D:\\tizen-studio\\tools\\ide\\bin\\tizen.bat"] : []),
  ];
  const known = candidates.find((candidate) => fs.existsSync(candidate));
  if (known) return known;
  fail(
    "The Tizen CLI was not found. Install Tizen Studio (with the TV extension and the Samsung certificate extension),\n" +
      "  then add tizen-studio/tools/ide/bin to PATH or set TIZEN_CLI. See docs/tv/tizen.md.",
  );
}

// 1. The shell, freshly built into apps/tv/tizen.
console.log("› Building the TV shell");
run(windows ? "corepack.cmd" : "corepack", ["pnpm", "--filter", "@kinora/tv-shell", "build"], { cwd: root });

// 2. A clean staging folder with just the app's files, so signing never picks up anything else.
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
for (const file of FILES) {
  const source = path.join(tizenDir, file);
  if (!fs.existsSync(source)) fail(`${path.relative(root, source)} is missing.`);
  fs.copyFileSync(source, path.join(stage, file));
}

// 3. Sign and package.
const cli = findTizenCli();
console.log(`› Packaging with ${cli}`);
const profile = process.env.TIZEN_PROFILE;
run(cli, ["package", "-t", "wgt", ...(profile ? ["-s", profile] : []), "--", stage]);
const built = fs.readdirSync(stage).find((name) => name.endsWith(".wgt"));
if (!built) fail("tizen package finished without producing a .wgt (is a security profile active?).");
const wgt = path.join(outDir, WGT);
fs.renameSync(path.join(stage, built), wgt);
console.log(`✔ ${path.relative(root, wgt)}`);

// 4. Optionally install and start it on the TV connected with sdb.
if (flag("--install") || flag("--run")) {
  console.log("› Installing on the TV");
  run(cli, ["install", "-n", WGT, ...(target ? ["-t", target] : []), "--", outDir]);
  if (flag("--run")) run(cli, ["run", "-p", APP_ID, ...(target ? ["-t", target] : [])]);
}
