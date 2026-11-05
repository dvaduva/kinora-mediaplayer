import assert from "node:assert/strict";
import test from "node:test";
import { pickTrailer } from "./trailer.js";

test("prefers an official Romanian trailer over a newer English one", () => {
  const chosen = pickTrailer([
    {
      key: "english",
      name: "Official trailer",
      site: "YouTube",
      type: "Trailer",
      official: true,
      language: "en",
      publishedAt: "2024-01-01",
    },
    {
      key: "romanian",
      name: "Trailer oficial",
      site: "YouTube",
      type: "Trailer",
      official: true,
      language: "ro",
      publishedAt: "2020-01-01",
    },
    {
      key: "clip",
      name: "Clip",
      site: "YouTube",
      type: "Clip",
      official: true,
      language: "ro",
      publishedAt: "2025-01-01",
    },
  ]);
  assert.equal(chosen?.key, "romanian");
});

test("falls back to a teaser when no trailer exists", () => {
  const chosen = pickTrailer([
    {
      key: "teaser",
      name: "Teaser",
      site: "YouTube",
      type: "Teaser",
      official: false,
      language: "en",
      publishedAt: "2019-05-01",
    },
  ]);
  assert.equal(chosen?.key, "teaser");
});

test("returns nothing when TMDB has no YouTube trailer or teaser", () => {
  assert.equal(pickTrailer([]), null);
});
