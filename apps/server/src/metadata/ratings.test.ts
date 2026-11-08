import assert from "node:assert/strict";
import test from "node:test";
import { decodeHtml, normalizeRtSlug, parseRottenTomatoes, rtSlugGuesses } from "./ratings.js";

const page = `
<script data-json="props" type="application/json">{"criticsScore":{"certified":true,"scorePercent":"94%","sentiment":"POSITIVE"}}</script>
<script>{"criticsScore":{"averageRating":"8.1","certified":true,"reviewCount":147,"scorePercent":"94%","sentiment":"POSITIVE","title":"Tomatometer"},
"audienceScore":{"bandedRatingCount":"250+ Verified Ratings","scorePercent":"38%","sentiment":"NEGATIVE","title":"Popcornmeter"}}</script>
<script id="media-hero-json" data-json="mediaHero" type="application/json">{"content":{"title":"The Weight","metadataProps":["R","2026","1h 53m"]}}</script>
<script type="application/json" data-json="reviewsData">{"reviews":[
  {"displayName":"RKO04","rating":3.5,"review":"Great movie &amp; believable performances.","displayDate":"Nov 7, 2026","isVerified":true,"ratingId":"a1"},
  {"displayName":"Empty","rating":4,"review":"","ratingId":"a2"}
]}</script>
<div id="critics-consensus" class="consensus"><rt-text>Critics Consensus</rt-text>
<p><em>The Weight</em> is a gripping thriller. </p></div>`;

test("reads scores, consensus and audience reviews from a Rotten Tomatoes page", () => {
  const parsed = parseRottenTomatoes(page, "https://www.rottentomatoes.com/m/the_weight_2026");
  assert.equal(parsed.title, "The Weight");
  assert.equal(parsed.year, 2026);
  assert.deepEqual(parsed.critics, { score: 94, certified: true, rotten: false, count: 147 });
  assert.deepEqual(parsed.audience, { score: 38, rotten: true, count: "250+ Verified Ratings" });
  assert.equal(parsed.consensus, "The Weight is a gripping thriller.");
  assert.equal(parsed.reviews.length, 1);
  assert.equal(parsed.reviews[0]!.body, "Great movie & believable performances.");
  assert.equal(parsed.reviews[0]!.rating, 3.5);
  assert.equal(parsed.reviews[0]!.url, "https://www.rottentomatoes.com/m/the_weight_2026/reviews/all-audience");
});

test("a page without scores yields nulls", () => {
  const parsed = parseRottenTomatoes(`<script>{"criticsScore":{"scorePercent":"","sentiment":""}}</script>`, "https://www.rottentomatoes.com/m/x");
  assert.equal(parsed.critics, null);
  assert.equal(parsed.audience, null);
  assert.equal(parsed.consensus, null);
});

test("slug guesses follow Rotten Tomatoes naming", () => {
  assert.deepEqual(rtSlugGuesses("The Weight", 2026), ["m/the_weight_2026", "m/the_weight"]);
  assert.deepEqual(rtSlugGuesses("Amélie & Friends: Part II", null), ["m/amelie_and_friends_part_ii"]);
  assert.deepEqual(rtSlugGuesses("???", 2020), []);
});

test("normalizes typed Rotten Tomatoes links", () => {
  assert.equal(normalizeRtSlug("https://www.rottentomatoes.com/m/the_weight_2026/"), "m/the_weight_2026");
  assert.equal(normalizeRtSlug("m/matrix?ref=x"), "m/matrix");
  assert.equal(normalizeRtSlug("https://example.com/m/matrix"), null);
  assert.equal(normalizeRtSlug("tv/severance"), null);
});

test("decodes entities and strips tags", () => {
  assert.equal(decodeHtml("A&#39;s <em>bold</em> &hellip;"), "A's bold …");
});
