import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { parseMovieName, parseSeriesFile, titlesEqual } from "./names.js";

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
