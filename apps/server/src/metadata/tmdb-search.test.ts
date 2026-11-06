import assert from "node:assert/strict";
import test from "node:test";
import { withYearQuery } from "./tmdb.js";

test("appends year when missing from the query", () => {
  assert.equal(withYearQuery("Arrival", 2016), "Arrival 2016");
});

test("keeps an existing year in the query", () => {
  assert.equal(withYearQuery("Arrival 2016", 2016), "Arrival 2016");
  assert.equal(withYearQuery("Dune (2021)", 2021), "Dune (2021)");
});

test("leaves the query alone without a year", () => {
  assert.equal(withYearQuery("  Arrival  ", null), "Arrival");
});
