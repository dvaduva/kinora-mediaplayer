import fs from "node:fs";
import type { FastifyInstance, FastifyReply } from "fastify";
import { playlistForClient } from "../playback/transcode.js";
import { profileFor } from "../devices/profile.js";
import {
  ChannelError,
  channelLogoFile,
  channelNow,
  clearChannelLogo,
  createChannel,
  deleteChannel,
  getChannel,
  guide,
  listChannels,
  liveTvSettings,
  playChannel,
  regenerateChannel,
  removeLogoFile,
  saveLiveTvSettings,
  setChannelLogo,
  setChannelOrder,
  setFavorite,
  syncAutoChannels,
  updateChannel,
  validateChannelInput,
  watchChannel,
} from "./channels.js";
import {
  createPresetSource,
  createSource,
  deleteSource,
  getSource,
  guideChannels,
  IptvError,
  listSources,
  LOGO_CONTENT_TYPES,
  refreshSource,
  setEpgChannel,
  updateSource,
  validateSourceInput,
} from "./iptv.js";
import { relayFile, relayStatus } from "./relay.js";
import { channelOptions } from "./sources.js";

const HOUR = 60 * 60 * 1000;
/** The guide answers at most this span per request. */
const MAX_GUIDE_SPAN = 4 * 24 * HOUR;

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function channelFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof ChannelError) return reply.code(error.message === "number_taken" ? 409 : 400).send({ error: error.message });
  if (error instanceof IptvError) return reply.code(error.message === "preset_exists" ? 409 : 400).send({ error: error.message });
  throw error;
}

function timeParam(value: unknown, fallback: number) {
  if (typeof value !== "string" || !/^\d{10,15}$/.test(value)) return fallback;
  return Number(value);
}

export function registerLiveTv(app: FastifyInstance) {
  app.get("/api/livetv/channels", async () => listChannels());
  app.get("/api/livetv/options", async () => channelOptions());

  app.get("/api/livetv/settings", async () => liveTvSettings());
  app.put("/api/livetv/settings", async (request, reply) => {
    try {
      const before = liveTvSettings();
      const saved = saveLiveTvSettings(asRecord(request.body));
      // Turning automatic channels on, or lowering the series threshold, adds channels right away.
      const sync = saved.autoChannels && (!before.autoChannels || saved.autoSeriesMinEpisodes !== before.autoSeriesMinEpisodes) ? syncAutoChannels() : { created: 0 };
      return { settings: saved, ...sync };
    } catch (error) {
      return channelFailure(reply, error);
    }
  });
  /** "Generate now": runs the sync even while automatic channels are off; `restore` brings deleted ones back. */
  app.post("/api/livetv/auto/sync", async (request) => {
    return syncAutoChannels({ force: true, restoreDismissed: asRecord(request.body).restore === true });
  });

  app.put("/api/livetv/order", async (request, reply) => {
    try {
      return setChannelOrder(asRecord(request.body).ids);
    } catch (error) {
      return channelFailure(reply, error);
    }
  });

  app.put("/api/livetv/channels/:id/favorite", async (request, reply) => {
    const favorite = asRecord(request.body).favorite;
    if (typeof favorite !== "boolean") return reply.code(400).send({ error: "bad_favorite" });
    return setFavorite((request.params as { id: string }).id, favorite) ?? reply.code(404).send({ error: "not_found" });
  });

  app.get("/api/livetv/guide", async (request, reply) => {
    const query = request.query as { from?: string; to?: string };
    const now = Date.now();
    const from = timeParam(query.from, now - HOUR / 2);
    const to = timeParam(query.to, from + 3 * HOUR);
    if (to <= from || to - from > MAX_GUIDE_SPAN) return reply.code(400).send({ error: "bad_range" });
    return guide(from, to);
  });

  app.get("/api/livetv/channels/:id/now", async (request, reply) => {
    return channelNow((request.params as { id: string }).id) ?? reply.code(404).send({ error: "not_found" });
  });

  app.post("/api/livetv/channels/:id/play", async (request, reply) => {
    const after = asRecord(request.body).after;
    const result = playChannel(
      (request.params as { id: string }).id,
      typeof after === "number" && Number.isFinite(after) ? after : undefined,
      profileFor(request.device),
    );
    if (result === "not_found") return reply.code(404).send({ error: "not_found" });
    if (result === "empty") return reply.code(409).send({ error: "channel_empty" });
    reply.header("Cache-Control", "no-store");
    return result;
  });

  /** Sent by the player every half minute; the next program of a watched channel is prepared ahead. */
  app.post("/api/livetv/channels/:id/watching", async (request, reply) => {
    if (!watchChannel((request.params as { id: string }).id)) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  app.post("/api/livetv/channels", async (request, reply) => {
    try {
      return reply.code(201).send(createChannel(validateChannelInput(asRecord(request.body))));
    } catch (error) {
      return channelFailure(reply, error);
    }
  });

  app.put("/api/livetv/channels/:id", async (request, reply) => {
    try {
      return updateChannel((request.params as { id: string }).id, validateChannelInput(asRecord(request.body))) ?? reply.code(404).send({ error: "not_found" });
    } catch (error) {
      return channelFailure(reply, error);
    }
  });

  app.delete("/api/livetv/channels/:id", async (request, reply) => {
    try {
      if (!deleteChannel((request.params as { id: string }).id)) return reply.code(404).send({ error: "not_found" });
    } catch (error) {
      return channelFailure(reply, error);
    }
    return reply.code(204).send();
  });

  app.post("/api/livetv/channels/:id/regenerate", async (request, reply) => {
    return regenerateChannel((request.params as { id: string }).id) ?? reply.code(404).send({ error: "not_found" });
  });

  // The logo travels as a data URL in JSON; 1 MB of image is about 1.4 MB of base64.
  app.post("/api/livetv/channels/:id/logo", { bodyLimit: 2 * 1024 * 1024 }, async (request, reply) => {
    try {
      return setChannelLogo((request.params as { id: string }).id, asRecord(request.body).data) ?? reply.code(404).send({ error: "not_found" });
    } catch (error) {
      return channelFailure(reply, error);
    }
  });

  app.delete("/api/livetv/channels/:id/logo", async (request, reply) => {
    return clearChannelLogo((request.params as { id: string }).id) ?? reply.code(404).send({ error: "not_found" });
  });

  app.get("/api/livetv/channels/:id/logo", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const file = getChannel(id) ? await channelLogoFile(id) : null;
    if (!file) return reply.code(404).send({ error: "not_found" });
    const extension = file.slice(file.lastIndexOf(".") + 1);
    reply.type(LOGO_CONTENT_TYPES[extension] ?? "image/jpeg");
    // The URL carries the channel's update time, so a new logo gets a new URL.
    reply.header("Cache-Control", "private, max-age=31536000, immutable");
    reply.header("X-Content-Type-Options", "nosniff");
    return reply.send(fs.createReadStream(file));
  });

  /* IPTV sources ---------------------------------------------------------- */

  app.get("/api/livetv/sources", async () => listSources());

  app.post("/api/livetv/sources", async (request, reply) => {
    try {
      return reply.code(201).send(createSource(validateSourceInput(asRecord(request.body))));
    } catch (error) {
      return channelFailure(reply, error);
    }
  });

  /** One of the public playlists (IPTV_PRESETS). */
  app.post("/api/livetv/sources/preset", async (request, reply) => {
    try {
      const body = asRecord(request.body);
      return reply.code(201).send(createPresetSource(body.id, body.name));
    } catch (error) {
      return channelFailure(reply, error);
    }
  });

  app.put("/api/livetv/sources/:id", async (request, reply) => {
    try {
      return updateSource((request.params as { id: string }).id, validateSourceInput(asRecord(request.body))) ?? reply.code(404).send({ error: "not_found" });
    } catch (error) {
      return channelFailure(reply, error);
    }
  });

  app.delete("/api/livetv/sources/:id", async (request, reply) => {
    if (!deleteSource((request.params as { id: string }).id, removeLogoFile)) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  /** Starts a refresh and answers at once; clients poll the source list for the outcome. */
  app.post("/api/livetv/sources/:id/refresh", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    if (!getSource(id)) return reply.code(404).send({ error: "not_found" });
    void refreshSource(id).catch(() => undefined);
    return reply.code(202).send(getSource(id));
  });

  app.get("/api/livetv/sources/:id/guide-channels", async (request, reply) => {
    return guideChannels((request.params as { id: string }).id) ?? reply.code(404).send({ error: "not_found" });
  });

  /** Matches an IPTV channel to a guide channel by hand; null goes back to automatic matching. */
  app.put("/api/livetv/channels/:id/epg", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    try {
      if (!(await setEpgChannel(id, asRecord(request.body).epgChannel ?? null))) return reply.code(404).send({ error: "not_found" });
    } catch (error) {
      return channelFailure(reply, error);
    }
    return getChannel(id);
  });

  /* IPTV streams: the shared relay of a channel, started by POST /play. */

  app.get("/api/livetv/channels/:id/stream/status", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return relayStatus((request.params as { id: string }).id) ?? reply.code(404).send({ error: "not_found" });
  });

  app.get("/api/livetv/channels/:id/stream/:file", async (request, reply) => {
    const params = request.params as { id: string; file: string };
    const file = relayFile(params.id, params.file);
    if (!file) return reply.code(404).send({ error: "not_found" });
    if (params.file === "index.m3u8") {
      reply.type("application/vnd.apple.mpegurl");
      reply.header("Cache-Control", "no-cache");
      return reply.send(playlistForClient(await fs.promises.readFile(file, "utf8").catch(() => "")));
    }
    // Segments can be dropped from the rolling window between the check and the read.
    const bytes = await fs.promises.readFile(file).catch(() => null);
    if (!bytes) return reply.code(404).send({ error: "not_found" });
    reply.type("video/mp2t");
    reply.header("Cache-Control", "private, max-age=600");
    return reply.send(bytes);
  });
}
