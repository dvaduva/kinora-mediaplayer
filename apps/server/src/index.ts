import dns from "node:dns";
import { Agent, setGlobalDispatcher } from "undici";
import { buildApp } from "./app.js";
import { db } from "./db/index.js";
import { libraries } from "./db/schema.js";
import { detectTools } from "./process.js";
import { gigabytes } from "./playback/cache.js";
import { pruneTranscodes, setTranscodeCacheLimit, stopOrphanEncoders } from "./playback/transcode.js";
import { restartWatches, startScan } from "./scan.js";
import { getSetting, isLocalHost, seedProfile, transcodeCacheGb } from "./settings.js";

// Windows often tries IPv6 first; TMDB connects hang until undici's default 10s timeout.
dns.setDefaultResultOrder("ipv4first");
setGlobalDispatcher(
  new Agent({
    connect: { timeout: 30_000, family: 4 },
    connections: 4,
  }),
);

detectTools();
stopOrphanEncoders();
seedProfile();

setTranscodeCacheLimit(gigabytes(transcodeCacheGb()));
pruneTranscodes();
setInterval(() => pruneTranscodes(), 60 * 60 * 1000).unref();

const host = getSetting("bindHost") ?? "127.0.0.1";
if (!isLocalHost(host) && !getSetting("accessToken")) {
  console.error("Kinora will not listen beyond localhost without an access token.");
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3001);
const app = await buildApp({ bindHost: host });
await app.listen({ host, port });
await restartWatches();
for (const library of db.select().from(libraries).all()) startScan(library.id);
