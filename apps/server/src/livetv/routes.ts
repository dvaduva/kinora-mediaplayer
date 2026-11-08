import fs from "node:fs";
import type { FastifyInstance, FastifyReply } from "fastify";
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
  playChannel,
  regenerateChannel,
  setChannelLogo,
  updateChannel,
  validateChannelInput,
} from "./channels.js";
import { channelOptions } from "./sources.js";

const HOUR = 60 * 60 * 1000;
/** The guide answers at most this span per request. */
const MAX_GUIDE_SPAN = 4 * 24 * HOUR;

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function channelFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof ChannelError) return reply.code(error.message === "number_taken" ? 409 : 400).send({ error: error.message });
  throw error;
}

function timeParam(value: unknown, fallback: number) {
  if (typeof value !== "string" || !/^\d{10,15}$/.test(value)) return fallback;
  return Number(value);
}

export function registerLiveTv(app: FastifyInstance) {
  app.get("/api/livetv/channels", async () => listChannels());
  app.get("/api/livetv/options", async () => channelOptions());

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
    const result = playChannel((request.params as { id: string }).id, typeof after === "number" && Number.isFinite(after) ? after : undefined);
    if (result === "not_found") return reply.code(404).send({ error: "not_found" });
    if (result === "empty") return reply.code(409).send({ error: "channel_empty" });
    reply.header("Cache-Control", "no-store");
    return result;
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
    if (!deleteChannel((request.params as { id: string }).id)) return reply.code(404).send({ error: "not_found" });
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
    const file = getChannel(id) ? channelLogoFile(id) : null;
    if (!file) return reply.code(404).send({ error: "not_found" });
    reply.type(file.endsWith(".png") ? "image/png" : file.endsWith(".webp") ? "image/webp" : "image/jpeg");
    // The URL carries the channel's update time, so a new logo gets a new URL.
    reply.header("Cache-Control", "private, max-age=31536000, immutable");
    reply.header("X-Content-Type-Options", "nosniff");
    return reply.send(fs.createReadStream(file));
  });
}
