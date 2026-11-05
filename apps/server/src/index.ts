import { buildApp } from "./app.js";
import { db } from "./db/index.js";
import { libraries } from "./db/schema.js";
import { detectTools } from "./process.js";
import { restartWatches, startScan } from "./scan.js";
import { getSetting, isLocalHost, seedProfile } from "./settings.js";

detectTools();
seedProfile();

const host = getSetting("bindHost") ?? "127.0.0.1";
if (!isLocalHost(host) && !getSetting("accessToken")) {
  console.error("Kinora will not listen beyond localhost without an access token.");
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3001);
const app = await buildApp();
await app.listen({ host, port });
await restartWatches();
for (const library of db.select().from(libraries).all()) startScan(library.id);
