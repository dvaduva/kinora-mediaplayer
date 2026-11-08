import assert from "node:assert/strict";
import test from "node:test";
import type { LibraryType } from "@kinora/shared";
import { AUTO_GENRE_MIN_TITLES, AUTO_MUSIC_MAX_CHANNELS, AUTO_MUSIC_MIN_TRACKS, newAutoChannels, planAutoChannels } from "./auto.js";
import { deriveCategory, isMusicChannel } from "./categories.js";

const types = new Map<string, LibraryType>([
  ["films", "movie"],
  ["shows", "series"],
  ["songs", "music"],
]);
const libraryType = (id: string) => types.get(id);

test("the first genre rule names the category", () => {
  assert.equal(deriveCategory([{ type: "decade", value: "1990" }, { type: "genre", value: "Comedie" }, { type: "genre", value: "Dramă" }], libraryType), "Comedie");
});

test("rules of one kind give a kind category, mixed rules give none", () => {
  assert.equal(deriveCategory([{ type: "series", value: "a" }, { type: "library", value: "shows" }], libraryType), "@series");
  assert.equal(deriveCategory([{ type: "movie", value: "a" }, { type: "library", value: "films" }], libraryType), "@movies");
  assert.equal(deriveCategory([{ type: "artist", value: "x" }, { type: "library", value: "songs" }], libraryType), "@music");
  assert.equal(deriveCategory([{ type: "series", value: "a" }, { type: "movie", value: "b" }], libraryType), null);
  assert.equal(deriveCategory([{ type: "person", value: "Someone" }], libraryType), null);
  assert.equal(deriveCategory([], libraryType), null);
});

test("a channel is a music channel only when every rule picks music", () => {
  assert.equal(isMusicChannel([{ type: "musicGenre", value: "Rock" }, { type: "library", value: "songs" }], libraryType), true);
  assert.equal(isMusicChannel([{ type: "musicGenre", value: "Rock" }, { type: "genre", value: "Dramă" }], libraryType), false);
  assert.equal(isMusicChannel([], libraryType), false);
});

test("automatic channels follow the thresholds, genres first, then series, then music", () => {
  const plans = planAutoChannels(
    {
      genres: [
        { name: "Western", count: AUTO_GENRE_MIN_TITLES - 1 },
        { name: "Dramă", count: AUTO_GENRE_MIN_TITLES },
        { name: "Comedie", count: 40 },
      ],
      series: [
        { id: "s1", title: "Long", episodes: 60 },
        { id: "s2", title: "Short", episodes: 8 },
      ],
      musicGenres: [
        { name: "Jazz", count: AUTO_MUSIC_MIN_TRACKS },
        { name: "Polka", count: 2 },
      ],
    },
    20,
  );
  assert.deepEqual(
    plans.map((plan) => plan.key),
    ["genre:comedie", "genre:dramă", "series:s1", "music:jazz"],
  );
  assert.equal(plans.find((plan) => plan.key === "series:s1")?.orderMode, "sequential");
  assert.equal(plans.find((plan) => plan.key === "genre:comedie")?.orderMode, "shuffle");
  assert.deepEqual(plans.find((plan) => plan.key === "music:jazz")?.sources, [{ type: "musicGenre", value: "Jazz" }]);
});

test("existing and dismissed automatic channels are not created again", () => {
  const plans = planAutoChannels({ genres: [{ name: "A", count: 9 }, { name: "B", count: 9 }, { name: "C", count: 9 }], series: [], musicGenres: [] }, 20);
  const fresh = newAutoChannels(plans, new Set(["genre:a"]), new Set(["genre:b"]));
  assert.deepEqual(fresh.map((plan) => plan.key), ["genre:c"]);
});

test("only the largest real music genres get channels", () => {
  const musicGenres = [
    { name: "Other", count: 500 },
    { name: "Unknown", count: 400 },
    ...Array.from({ length: AUTO_MUSIC_MAX_CHANNELS + 3 }, (_, index) => ({ name: `G${String(index).padStart(2, "0")}`, count: 100 - index })),
  ];
  const plans = planAutoChannels({ genres: [], series: [], musicGenres }, 20);
  assert.equal(plans.length, AUTO_MUSIC_MAX_CHANNELS);
  assert.ok(plans.every((plan) => plan.name !== "Other ♪" && plan.name !== "Unknown ♪"));
  assert.ok(!plans.some((plan) => plan.name === `G${String(AUTO_MUSIC_MAX_CHANNELS).padStart(2, "0")} ♪`));
});
