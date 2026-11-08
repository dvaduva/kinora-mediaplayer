import assert from "node:assert/strict";
import test from "node:test";
import { parseSearchInput, parseTmdbRef, withYearQuery } from "./tmdb.js";

test("parseSearchInput splits Arrival 2016 style queries", () => {
  assert.deepEqual(parseSearchInput("Arrival 2016", null), { title: "Arrival", year: 2016 });
  assert.deepEqual(parseSearchInput("Dune (2021)", null), { title: "Dune", year: 2021 });
  assert.deepEqual(parseSearchInput("Dune 2021", 2021), { title: "Dune", year: 2021 });
});

test("parseSearchInput keeps an explicit year when the query has none", () => {
  assert.deepEqual(parseSearchInput("Dune", 2021), { title: "Dune", year: 2021 });
  assert.deepEqual(parseSearchInput("Spider-Man Homecoming", null), { title: "Spider-Man Homecoming", year: null });
});

test("withYearQuery still formats title plus year for display-style strings", () => {
  assert.equal(withYearQuery("Arrival", 2016), "Arrival 2016");
  assert.equal(withYearQuery("Arrival 2016", 2016), "Arrival 2016");
  assert.equal(withYearQuery("  Arrival  ", null), "Arrival");
});

test("parseTmdbRef reads movie links, tv links and bare ids", () => {
  assert.equal(parseTmdbRef("https://www.themoviedb.org/movie/81527-aurora", "movie"), 81527);
  assert.equal(parseTmdbRef("https://www.themoviedb.org/movie/81527-aurora?language=en-US", "movie"), 81527);
  assert.equal(parseTmdbRef("https://www.themoviedb.org/tv/1396-breaking-bad", "tv"), 1396);
  assert.equal(parseTmdbRef("81527", "movie"), 81527);
  assert.equal(parseTmdbRef("https://www.themoviedb.org/tv/1396", "movie"), null);
  assert.equal(parseTmdbRef("https://www.themoviedb.org/movie/81527", "tv"), null);
  assert.equal(parseTmdbRef("Metropolis 1927", "movie"), null);
});
