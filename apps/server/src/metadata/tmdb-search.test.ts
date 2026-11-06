import assert from "node:assert/strict";
import test from "node:test";
import { parseSearchInput, withYearQuery } from "./tmdb.js";

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
