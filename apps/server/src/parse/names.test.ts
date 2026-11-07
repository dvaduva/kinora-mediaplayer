import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isNetworkPath } from "../paths.js";
import { discoverExternalSubtitles, parseMovieName, parseSeriesFile, titlesEqual } from "./names.js";

test("parses a parenthetical movie title", () => {
  assert.deepEqual(parseMovieName("Dune (2021).mkv"), { title: "Dune", year: 2021 });
});

test("parses a dotted movie release name and ignores the quality tail", () => {
  assert.deepEqual(parseMovieName("Dune.2021.2160p.BluRay.x264.mkv"), { title: "Dune", year: 2021 });
});

test("keeps a leading year that belongs to the title", () => {
  assert.deepEqual(parseMovieName("2001 A Space Odyssey (1968).mkv"), {
    title: "2001 A Space Odyssey",
    year: 1968,
  });
});

test("reads a series episode from the show folder and the filename", () => {
  const root = path.join("Libraries", "Series");
  const file = path.join(root, "The Show (2019)", "Season 01", "The Show - S01E02 - Cold Open 1080p.mkv");
  assert.deepEqual(parseSeriesFile(file, root), {
    showTitle: "The Show",
    year: 2019,
    season: 1,
    episode: 2,
    episodeTitle: "Cold Open",
  });
});

test("reads dotted series names and the 1x03 pattern", () => {
  const root = path.join("Libraries", "Series");
  const dotted = path.join(root, "Show.Name.S01E02.Episode.Title.mkv");
  assert.equal(parseSeriesFile(dotted, root).episode, 2);
  assert.equal(parseSeriesFile(dotted, root).showTitle, "Show Name");
  const alt = path.join(root, "Show Name - 1x03 - Pilot.mkv");
  assert.equal(parseSeriesFile(alt, root).episode, 3);
  assert.equal(parseSeriesFile(alt, root).episodeTitle, "Pilot");
});

test("compares titles without diacritics or a leading article", () => {
  assert.equal(titlesEqual("Amélie", "Amelie"), true);
  assert.equal(titlesEqual("The Matrix", "Matrix"), true);
  assert.equal(titlesEqual("Dune", "Dune: Part Two"), false);
});

test("finds subtitles next to the video and in a Subs folder", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinora-subs-"));
  try {
    fs.writeFileSync(path.join(dir, "Movie.2020.mkv"), "");
    fs.writeFileSync(path.join(dir, "Movie.2020.ro.srt"), "");
    fs.writeFileSync(path.join(dir, "poster.jpg"), "");
    fs.mkdirSync(path.join(dir, "Subs"));
    fs.writeFileSync(path.join(dir, "Subs", "English.srt"), "");
    const found = await discoverExternalSubtitles(path.join(dir, "Movie.2020.mkv"));
    assert.deepEqual(found.map((sub) => [path.basename(sub.path), sub.language]).sort(), [
      ["English.srt", "en"],
      ["Movie.2020.ro.srt", "ro"],
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("treats UNC paths as network shares", () => {
  assert.equal(isNetworkPath("\\\\dv1\\Download\\completed"), true);
  assert.equal(isNetworkPath("//nas/media"), true);
  assert.equal(isNetworkPath("D:\\Video\\Movies"), false);
  assert.equal(isNetworkPath("/home/me/Movies"), false);
});
