import dns from "node:dns";
import { Agent, setGlobalDispatcher } from "undici";
import { buildApp } from "./app.js";
import { db } from "./db/index.js";
import { libraries } from "./db/schema.js";
import { detectTools } from "./process.js";
import { gigabytes } from "./playback/cache.js";
import { pruneTranscodes, setTranscodeCacheLimit, stopOrphanEncoders } from "./playback/transcode.js";
import { onScanFinished, restartWatches, startScan } from "./scan.js";
import { prepareUpcoming, repairMissing, syncAutoChannels, topUpChannels } from "./livetv/channels.js";
import { refreshDueSources } from "./livetv/iptv.js";
import { clearRelayCache, stopAllRelays, sweepRelays } from "./livetv/relay.js";
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
// Live TV keeps 72h of program ahead; the job also replaces programs whose files went away.
const runLiveTvJob = () => {
  try {
    syncAutoChannels();
    topUpChannels();
  } catch (error) {
    app.log.error(error);
  }
};
runLiveTvJob();
setInterval(runLiveTvJob, 60 * 60 * 1000).unref();
// IPTV playlists and guides are read again every 12 hours (checked hourly); idle relays stop after a minute.
clearRelayCache();
const runIptvJob = () => void refreshDueSources().catch((error: unknown) => app.log.error(error));
runIptvJob();
setInterval(runIptvJob, 60 * 60 * 1000).unref();
setInterval(() => sweepRelays(), 15_000).unref();
// The next program of a watched channel is converted a few minutes before it starts.
setInterval(() => {
  try {
    prepareUpcoming();
  } catch (error) {
    app.log.error(error);
  }
}, 15_000).unref();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopAllRelays();
    process.exit(0);
  });
}
onScanFinished(() => {
  try {
    repairMissing();
    // New genres or a series that grew past the threshold get their channels.
    syncAutoChannels();
  } catch (error) {
    app.log.error(error);
  }
});
await restartWatches();
for (const library of db.select().from(libraries).all()) startScan(library.id);
