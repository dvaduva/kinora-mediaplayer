// Builds the Android TV / Fire TV app: the shell, copied into the app's assets, then an APK with Gradle.
//
//   pnpm tv:package:android                         -> apps/android-tv/dist/kinora-tv-<version>-debug.apk
//   pnpm tv:package:android -- --release            signed release APK (needs the KINORA_RELEASE_* settings below)
//   pnpm tv:package:android -- --install            also installs it with adb
//   pnpm tv:package:android -- --install --run      ...and starts it
//   pnpm tv:package:android -- --target <serial>    picks the device (`adb devices`; e.g. 192.168.1.50:5555)
//
// Environment:
//   ANDROID_HOME (or ANDROID_SDK_ROOT)   the Android SDK; default %LOCALAPPDATA%\Android\Sdk on Windows, ~/Android/Sdk elsewhere
//   JAVA_HOME                            a JDK 17 or newer (Android Studio's own works: <studio>/jbr)
//   ANDROID_SERIAL                       device serial, instead of --target
//
// Release signing, in ~/.gradle/gradle.properties (or as environment variables):
//   KINORA_RELEASE_STORE_FILE            release keystore (.jks); never in git
//   KINORA_RELEASE_STORE_PASSWORD, KINORA_RELEASE_KEY_ALIAS, KINORA_RELEASE_KEY_PASSWORD (defaults to the store password)
//
// See docs/tv/android-tv.md.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(root, "apps/android-tv");
const outDir = path.join(appDir, "dist");
const APPLICATION_ID = "com.kinora.tv";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const release = flag("--release");
const target = option("--target") ?? process.env.ANDROID_SERIAL;
const windows = process.platform === "win32";

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

/** Runs a command, streaming its output; `.bat`/`.cmd` files need a shell on Windows, hence the quoting. */
function run(command, commandArgs, options = {}) {
  const quote = (value) => (/[\s"&|<>^]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value);
  const env = { ...process.env, ...options.env };
  const result = windows
    ? spawnSync([command, ...commandArgs].map(quote).join(" "), { stdio: "inherit", shell: true, cwd: options.cwd, env })
    : spawnSync(command, commandArgs, { stdio: "inherit", cwd: options.cwd, env });
  if (result.error) fail(`${path.basename(command)} could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${path.basename(command)} exited with code ${result.status}`);
}

function sdkDir() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    windows && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Android", "Sdk") : null,
    path.join(os.homedir(), process.platform === "darwin" ? "Library/Android/sdk" : "Android/Sdk"),
  ];
  return candidates.find((dir) => dir && fs.existsSync(path.join(dir, "platforms"))) ?? null;
}

/** Gradle needs a JDK 17+; the java on PATH is often an old JRE. Android Studio ships one. */
function javaHome() {
  const studio = windows ? "C:/Program Files/Android/Android Studio/jbr" : process.platform === "darwin" ? "/Applications/Android Studio.app/Contents/jbr/Contents/Home" : null;
  const candidates = [process.env.JAVA_HOME, studio];
  for (const dir of candidates) {
    if (!dir) continue;
    const release = path.join(dir, "release");
    if (!fs.existsSync(release)) continue;
    const match = /JAVA_VERSION="(\d+)/.exec(fs.readFileSync(release, "utf8"));
    if (match && Number(match[1]) >= 17) return dir;
  }
  return null;
}

const sdk = sdkDir();
if (!sdk) fail("The Android SDK was not found. Install Android Studio (or the command-line tools) and set ANDROID_HOME.");
const jdk = javaHome();
if (!jdk) fail("No JDK 17+ found. Set JAVA_HOME to one (Android Studio's <studio>/jbr works).");

// Gradle reads the SDK from local.properties; it is per machine and not in git. ':' and '\' must be escaped there.
const localProperties = path.join(appDir, "local.properties");
if (!fs.existsSync(localProperties)) {
  fs.writeFileSync(localProperties, `sdk.dir=${sdk.replace(/\\/g, "/").replace(/:/g, "\\:")}\n`);
}

/** Gradle's user-wide properties (where the release signing lives), as a map; empty when there are none. */
function gradleUserProperties() {
  const home = process.env.GRADLE_USER_HOME || path.join(os.homedir(), ".gradle");
  const file = path.join(home, "gradle.properties");
  if (!fs.existsSync(file)) return {};
  const values = {};
  // A BOM is common when the file was saved by a Windows editor; `\:` and `\\` are .properties escapes.
  for (const line of fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = /^\s*([\w.-]+)\s*[=:]\s*(.*)$/.exec(line);
    if (match) values[match[1]] = match[2].trim().replace(/\\:/g, ":").replace(/\\\\/g, "\\");
  }
  return values;
}

if (release) {
  const properties = gradleUserProperties();
  const setting = (name) => properties[name] || process.env[name];
  const missing = ["KINORA_RELEASE_STORE_FILE", "KINORA_RELEASE_STORE_PASSWORD", "KINORA_RELEASE_KEY_ALIAS"].filter((name) => !setting(name));
  if (missing.length) fail(`A release APK must be signed; set ${missing.join(", ")} in ~/.gradle/gradle.properties (or the environment). See docs/tv/android-tv.md.`);
  const keystore = setting("KINORA_RELEASE_STORE_FILE");
  if (!fs.existsSync(keystore)) fail(`KINORA_RELEASE_STORE_FILE points to ${keystore}, which does not exist.`);
}

// 1. The shell, freshly built into the app's assets.
console.log("› Building the TV shell");
run(windows ? "corepack.cmd" : "corepack", ["pnpm", "--filter", "@kinora/tv-shell", "build"], { cwd: root });

// 2. The APK.
const variant = release ? "Release" : "Debug";
console.log(`› Building the ${variant.toLowerCase()} APK with Gradle`);
run(path.join(appDir, windows ? "gradlew.bat" : "gradlew"), [`assemble${variant}`, "--console=plain"], {
  cwd: appDir,
  env: { JAVA_HOME: jdk, ANDROID_HOME: sdk },
});
const built = path.join(appDir, "app/build/outputs/apk", variant.toLowerCase(), `app-${variant.toLowerCase()}.apk`);
if (!fs.existsSync(built)) fail(`Gradle finished without producing ${path.relative(root, built)}.`);
const versionName = /kinora\.versionName=(.+)/.exec(fs.readFileSync(path.join(appDir, "gradle.properties"), "utf8"))?.[1]?.trim() ?? "0.0.0";
fs.mkdirSync(outDir, { recursive: true });
const apk = path.join(outDir, `kinora-tv-${versionName}-${variant.toLowerCase()}.apk`);
fs.copyFileSync(built, apk);
console.log(`✔ ${path.relative(root, apk)}`);

// 3. Optionally install and start it on a device adb sees (USB, or `adb connect <ip>:5555`).
if (flag("--install") || flag("--run")) {
  const adb = path.join(sdk, "platform-tools", windows ? "adb.exe" : "adb");
  if (!fs.existsSync(adb)) fail(`adb was not found in ${path.dirname(adb)}. Install "Android SDK Platform-Tools".`);
  const device = target ? ["-s", target] : [];
  console.log(`› Installing on ${target ?? "the connected device"}`);
  run(adb, [...device, "install", "-r", apk]);
  if (flag("--run")) run(adb, [...device, "shell", "am", "start", "-n", `${APPLICATION_ID}/.MainActivity`]);
}
