import assert from "node:assert/strict";
import test from "node:test";
import { isMetadataLanguage, languageRank, tmdbLocale, tmdbMediaLanguages, tmdbRegion } from "./language.js";
import { pickTrailer, rankVideos } from "./trailer.js";

test("maps each metadata language to TMDB parameters", () => {
  assert.equal(tmdbLocale("en"), "en-US");
  assert.equal(tmdbLocale("ro"), "ro-RO");
  assert.equal(tmdbMediaLanguages("en"), "en,null");
  assert.equal(tmdbMediaLanguages("ro"), "ro,en,null");
  assert.equal(tmdbRegion("en"), null);
  assert.equal(tmdbRegion("ro"), "RO");
});

test("accepts only known metadata languages", () => {
  assert.equal(isMetadataLanguage("en"), true);
  assert.equal(isMetadataLanguage("ro"), true);
  assert.equal(isMetadataLanguage("fr"), false);
  assert.equal(isMetadataLanguage(null), false);
});

test("ranks the chosen language first, then English, then language-free", () => {
  assert.deepEqual(
    ["de", null, "en", "ro"].sort((a, b) => languageRank("ro", a) - languageRank("ro", b)),
    ["ro", "en", null, "de"],
  );
  assert.deepEqual(
    ["de", null, "ro", "en"].sort((a, b) => languageRank("en", a) - languageRank("en", b)),
    ["en", null, "de", "ro"],
  );
});

const trailer = (key: string, language: string) => ({
  key,
  name: key,
  site: "YouTube",
  type: "Trailer",
  official: true,
  language,
  publishedAt: null,
});

test("trailers follow the metadata language", () => {
  const videos = [trailer("ro-trailer", "ro"), trailer("en-trailer", "en")];
  assert.equal(pickTrailer(videos, "en")?.key, "en-trailer");
  assert.equal(pickTrailer(videos, "ro")?.key, "ro-trailer");
  assert.deepEqual(rankVideos(videos, "en").map((video) => video.key), ["en-trailer", "ro-trailer"]);
});
