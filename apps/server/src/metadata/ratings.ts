import type { ExternalRatings, MovieReview } from "@kinora/shared";
import { getSetting } from "../settings.js";
import { createQueue } from "./gate.js";

const USER_AGENT = "Kinora/0.1 (personal media server)";
const RT_BASE = "https://www.rottentomatoes.com";

// Rotten Tomatoes and Wikidata are asked one page at a time, like TMDB.
const enqueue = createQueue();

function record(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function fetchPage(url: string, accept = "text/html") {
  return enqueue(async () => {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, accept }, signal: AbortSignal.timeout(20_000), redirect: "follow" });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`http_${response.status}`);
    return { url: response.url, body: await response.text() };
  });
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", bull: "•", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–" };

export function decodeHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/[ \t]+/g, " ")
    .trim();
}

function percent(value: unknown) {
  const digits = typeof value === "string" ? value.replace("%", "").trim() : "";
  const raw = typeof value === "number" ? value : digits ? Number(digits) : Number.NaN;
  return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? Math.round(raw) : null;
}

/** Every flat JSON object that follows `"key":` in the page; the scorecard appears several times with different detail. */
function flatObjects(html: string, key: string) {
  const found: Record<string, unknown>[] = [];
  const pattern = new RegExp(`"${key}":(\\{[^{}]*\\})`, "g");
  for (const match of html.matchAll(pattern)) {
    try {
      const parsed = record(JSON.parse(match[1]!));
      if (parsed) found.push(parsed);
    } catch {
      // Not JSON (e.g. inside an attribute); skip.
    }
  }
  return found.sort((a, b) => Object.keys(b).length - Object.keys(a).length);
}

function jsonScript(html: string, name: string) {
  const match = new RegExp(`<script[^>]*data-json="${name}"[^>]*>([\\s\\S]*?)</script>`).exec(html);
  if (!match) return null;
  try {
    return record(JSON.parse(match[1]!));
  } catch {
    return null;
  }
}

export interface RottenTomatoesPage {
  title: string | null;
  year: number | null;
  critics: NonNullable<ExternalRatings["rottenTomatoes"]>["critics"];
  audience: NonNullable<ExternalRatings["rottenTomatoes"]>["audience"];
  consensus: string | null;
  reviews: MovieReview[];
}

/** Reads the scorecard, critics consensus and the audience reviews shown on a Rotten Tomatoes movie page. */
export function parseRottenTomatoes(html: string, pageUrl: string): RottenTomatoesPage {
  const critics = flatObjects(html, "criticsScore").find((item) => percent(item.scorePercent) != null) ?? null;
  const audience = flatObjects(html, "audienceScore").find((item) => percent(item.scorePercent) != null) ?? null;
  const consensusMatch = /id="critics-consensus"[\s\S]*?<p>([\s\S]*?)<\/p>/.exec(html);
  const hero = record(jsonScript(html, "mediaHero")?.content);
  const props = Array.isArray(hero?.metadataProps) ? hero.metadataProps : [];
  const yearProp = props.map((item) => (typeof item === "string" ? /^(19|20)\d{2}$/.exec(item.trim())?.[0] : null)).find(Boolean);
  const reviewsData = jsonScript(html, "reviewsData");
  const reviews = (Array.isArray(reviewsData?.reviews) ? reviewsData.reviews : [])
    .map(record)
    .map((item, index): MovieReview | null => {
      const body = text(item?.review);
      if (!item || !body) return null;
      const rating = typeof item.rating === "number" && item.rating > 0 ? Math.round(item.rating * 2) / 2 : null;
      return {
        id: `rt-${text(item.ratingId) ?? index}`,
        source: "rottentomatoes",
        author: text(item.displayName) ?? text(record(item.user)?.displayName) ?? "Rotten Tomatoes",
        avatarUrl: null,
        rating,
        body: decodeHtml(body),
        date: text(item.displayDate),
        url: `${pageUrl.replace(/\/$/, "")}/reviews/all-audience`,
        verified: item.isVerified === true,
      };
    })
    .filter((item): item is MovieReview => item != null);
  const criticsScore = critics ? percent(critics.scorePercent) : null;
  const audienceScore = audience ? percent(audience.scorePercent) : null;
  return {
    title: text(hero?.title),
    year: yearProp ? Number(yearProp) : null,
    critics:
      critics && criticsScore != null
        ? {
            score: criticsScore,
            certified: critics.certified === true,
            rotten: critics.sentiment === "NEGATIVE",
            count: typeof critics.reviewCount === "number" ? critics.reviewCount : typeof critics.ratingCount === "number" ? critics.ratingCount : null,
          }
        : null,
    audience:
      audience && audienceScore != null
        ? { score: audienceScore, rotten: audience.sentiment === "NEGATIVE", count: text(audience.bandedRatingCount) }
        : null,
    consensus: consensusMatch ? decodeHtml(consensusMatch[1]!) || null : null,
    reviews,
  };
}

/** Rotten Tomatoes path ("m/the_matrix") from Wikidata, keyed by the IMDb id. */
async function rtSlugFromWikidata(imdbId: string) {
  const query = `SELECT ?rt WHERE { ?item wdt:P345 "${imdbId}"; wdt:P1258 ?rt } LIMIT 1`;
  const page = await fetchPage(`https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}`, "application/sparql-results+json");
  if (!page) return null;
  const bindings = record(JSON.parse(page.body))?.results;
  const first = record(Array.isArray(record(bindings)?.bindings) ? (record(bindings)!.bindings as unknown[])[0] : null);
  const slug = text(record(first?.rt)?.value);
  return slug && /^m\/[\w-]+$/.test(slug) ? slug : null;
}

export function rtSlugGuesses(title: string, year: number | null) {
  const base = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!base) return [];
  const guesses = year ? [`m/${base}_${year}`, `m/${base}`] : [`m/${base}`];
  return [...new Set(guesses)];
}

/** Normalizes what a user types in the edit dialog: a full RT URL or a bare "m/…" path. */
export function normalizeRtSlug(value: string) {
  const trimmed = value.trim().replace(/^https?:\/\/(www\.)?rottentomatoes\.com\//i, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  return /^m\/[\w-]+$/.test(trimmed) ? trimmed : null;
}

async function loadRtPage(slug: string) {
  const page = await fetchPage(`${RT_BASE}/${slug}`);
  if (!page) return null;
  return { url: `${RT_BASE}/${slug}`, parsed: parseRottenTomatoes(page.body, `${RT_BASE}/${slug}`) };
}

interface RtLookup {
  slugOverride: string | null;
  knownSlug: string | null;
  imdbId: string | null;
  titles: string[];
  year: number | null;
}

async function findRottenTomatoes(input: RtLookup) {
  if (input.slugOverride) return loadRtPage(input.slugOverride);
  if (input.knownSlug) {
    const known = await loadRtPage(input.knownSlug);
    if (known) return known;
  }
  if (input.imdbId) {
    const slug = await rtSlugFromWikidata(input.imdbId).catch(() => null);
    if (slug) {
      const page = await loadRtPage(slug);
      if (page) return page;
    }
  }
  // New releases are often missing from Wikidata; try the usual slug shapes and keep the one whose year agrees.
  const tried = new Set<string>();
  for (const title of input.titles) {
    for (const slug of rtSlugGuesses(title, input.year)) {
      if (tried.has(slug) || tried.size >= 4) continue;
      tried.add(slug);
      const page = await loadRtPage(slug);
      if (!page) continue;
      const pageYear = page.parsed.year;
      if (input.year == null || pageYear == null || Math.abs(pageYear - input.year) <= 1) return page;
    }
  }
  return null;
}

interface OmdbResult {
  imdbRating: number | null;
  imdbVotes: number | null;
  metascore: number | null;
  rtCritics: number | null;
}

async function fetchOmdb(imdbId: string, key: string): Promise<OmdbResult | null> {
  const response = await fetch(`https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(key)}`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  const body = record(await response.json().catch(() => null));
  if (!body || body.Response !== "True") return null;
  const number = (value: unknown) => {
    const parsed = typeof value === "string" ? Number(value.replace(/,/g, "")) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : null;
  };
  const ratings = (Array.isArray(body.Ratings) ? body.Ratings : []).map(record);
  const rt = ratings.find((item) => item?.Source === "Rotten Tomatoes");
  return {
    imdbRating: number(body.imdbRating),
    imdbVotes: number(body.imdbVotes),
    metascore: number(body.Metascore),
    rtCritics: rt ? percent(rt.Value) : null,
  };
}

export interface RatingsInput {
  imdbId: string | null;
  tmdbId: number | null;
  tmdbRating: number | null;
  title: string;
  originalTitle: string | null;
  year: number | null;
  rtSlugOverride: string | null;
  previous: ExternalRatings | null;
}

export interface RatingsResult {
  ratings: ExternalRatings;
  rtReviews: MovieReview[];
}

function slugFromUrl(url: string | null | undefined) {
  if (!url?.startsWith(RT_BASE)) return null;
  return normalizeRtSlug(url);
}

/** Looks up every external score; a source that fails keeps its previous value. */
export async function fetchExternalRatings(input: RatingsInput): Promise<RatingsResult> {
  const key = getSetting("omdbApiKey");
  const previous = input.previous;
  const [omdb, rt] = await Promise.all([
    key && input.imdbId ? fetchOmdb(input.imdbId, key).catch(() => undefined) : Promise.resolve(null),
    findRottenTomatoes({
      slugOverride: input.rtSlugOverride,
      knownSlug: slugFromUrl(previous?.rottenTomatoes?.url),
      imdbId: input.imdbId,
      titles: [input.title, ...(input.originalTitle && input.originalTitle !== input.title ? [input.originalTitle] : [])],
      year: input.year,
    }).catch(() => undefined),
  ]);
  const imdbUrl = input.imdbId ? `https://www.imdb.com/title/${input.imdbId}/` : null;
  const imdb =
    omdb === undefined
      ? previous?.imdb ?? null
      : omdb?.imdbRating != null && imdbUrl
        ? { rating: omdb.imdbRating, votes: omdb.imdbVotes, url: imdbUrl }
        : null;
  let rottenTomatoes: ExternalRatings["rottenTomatoes"];
  if (rt === undefined) {
    rottenTomatoes = previous?.rottenTomatoes ?? null;
  } else if (rt) {
    rottenTomatoes = { url: rt.url, critics: rt.parsed.critics, audience: rt.parsed.audience, consensus: rt.parsed.consensus };
  } else if (omdb?.rtCritics != null) {
    rottenTomatoes = {
      url: `${RT_BASE}/search?search=${encodeURIComponent(input.title)}`,
      critics: { score: omdb.rtCritics, certified: false, rotten: omdb.rtCritics < 60, count: null },
      audience: null,
      consensus: null,
    };
  } else {
    rottenTomatoes = null;
  }
  const metacritic =
    omdb === undefined
      ? previous?.metacritic ?? null
      : omdb?.metascore != null
        ? { score: omdb.metascore, url: `https://www.metacritic.com/search/${encodeURIComponent(input.title)}/` }
        : null;
  return {
    ratings: {
      imdb,
      rottenTomatoes,
      metacritic,
      tmdb: input.tmdbId && input.tmdbRating ? { rating: input.tmdbRating, url: `https://www.themoviedb.org/movie/${input.tmdbId}` } : null,
      fetchedAt: Date.now(),
      omdbMissing: !key,
    },
    rtReviews: rt ? rt.parsed.reviews : [],
  };
}
