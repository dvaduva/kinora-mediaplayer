// One version number for the whole project: the root package.json holds it, and this script copies it
// into every package, the Tizen and webOS manifests and the Android app.
//
//   node scripts/version.mjs                    prints the version
//   node scripts/version.mjs check              fails when a file disagrees with the root package.json
//   node scripts/version.mjs check --tag v1.2.3 ...or when the tag does not match it (used by the release workflow)
//   node scripts/version.mjs set 1.2.3          writes 1.2.3 everywhere (pnpm version:set 1.2.3)
//
// Versions are plain MAJOR.MINOR.PATCH: Tizen and webOS accept nothing else. The Android versionCode is
// derived from it (MAJOR * 1 000 000 + MINOR * 1 000 + PATCH), so every release installs over the last.
//
// `apiVersion` (API_VERSION in packages/shared) is separate: bump it only on a breaking API change.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function parse(version) {
  const match = SEMVER.exec(version);
  if (!match) fail(`"${version}" is not MAJOR.MINOR.PATCH (Tizen and webOS accept nothing else).`);
  const [major, minor, patch] = match.slice(1).map(Number);
  // Tizen caps each part (255.255.65535); the Android versionCode needs MINOR and PATCH under 1000.
  if (major > 255 || minor > 255 || patch > 999) fail(`"${version}" is out of range (at most 255.255.999).`);
  return { major, minor, patch };
}

function versionCode(version) {
  const { major, minor, patch } = parse(version);
  return major * 1_000_000 + minor * 1_000 + patch;
}

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const write = (file, text) => fs.writeFileSync(path.join(root, file), text);

function workspacePackages() {
  return ["apps", "packages"].flatMap((dir) =>
    fs
      .readdirSync(path.join(root, dir))
      .map((name) => `${dir}/${name}/package.json`)
      .filter((file) => fs.existsSync(path.join(root, file))),
  );
}

/** Each place that carries the version: how to read it and how to write it, keeping the file's formatting. */
function targets() {
  const json = (file) => ({
    file,
    get: () => JSON.parse(read(file)).version,
    set: (version) => write(file, read(file).replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`)),
  });
  const pattern = (file, regex, render) => ({
    file,
    // The regex captures what precedes the value, then the value itself.
    get: () => regex.exec(read(file))?.[2],
    set: (version) => write(file, read(file).replace(regex, (_whole, before) => before + render(version))),
  });
  return [
    json("package.json"),
    ...workspacePackages().map(json),
    json("apps/tv/webos/appinfo.json"),
    pattern("apps/tv/tizen/config.xml", /(<widget\b[^>]*\sversion=")([^"]*)/, (version) => version),
    pattern("apps/android-tv/gradle.properties", /^(kinora\.versionName=)(.*)$/m, (version) => version),
    {
      ...pattern("apps/android-tv/gradle.properties", /^(kinora\.versionCode=)(.*)$/m, (version) => String(versionCode(version))),
      expected: (version) => String(versionCode(version)),
      label: "versionCode",
    },
  ];
}

function rootVersion() {
  const version = JSON.parse(read("package.json")).version;
  if (typeof version !== "string") fail("The root package.json has no version.");
  parse(version);
  return version;
}

const [command, ...rest] = process.argv.slice(2);

if (!command) {
  console.log(rootVersion());
} else if (command === "check") {
  const version = rootVersion();
  const at = rest.indexOf("--tag");
  const tag = at >= 0 ? rest[at + 1] : undefined;
  const problems = [];
  if (tag !== undefined && tag.replace(/^refs\/tags\//, "").replace(/^v/, "") !== version) {
    problems.push(`the tag ${tag} does not match the version ${version}`);
  }
  for (const target of targets()) {
    const want = target.expected ? target.expected(version) : version;
    const have = target.get();
    if (have !== want) problems.push(`${target.file}${target.label ? ` (${target.label})` : ""} has ${have ?? "no version"}, expected ${want}`);
  }
  if (problems.length) fail(`Versions disagree:\n  - ${problems.join("\n  - ")}\nRun \`pnpm version:set ${version}\` to align them.`);
  console.log(`✔ ${version} everywhere`);
} else if (command === "set") {
  const version = rest[0];
  if (!version) fail("Usage: node scripts/version.mjs set MAJOR.MINOR.PATCH");
  parse(version);
  const written = new Set();
  for (const target of targets()) {
    target.set(version);
    if (target.get() === undefined) fail(`Could not find the version in ${target.file}.`);
    written.add(target.file);
  }
  console.log(`✔ ${version} (Android versionCode ${versionCode(version)}) written to:\n  ${[...written].join("\n  ")}`);
} else {
  fail(`Unknown command "${command}". Use check, set, or nothing to print the version.`);
}
