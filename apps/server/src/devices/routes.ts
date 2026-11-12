import type { FastifyInstance } from "fastify";
import { isDevicePlatform, normalizePairCode, type DevicePlatform, type DeviceView } from "@kinora/shared";
import { PairingStore } from "./pairing.js";
import { cleanDeviceName, deleteDevice, issueDevice, listDevices, renameDevice, revokeDevice } from "./store.js";

declare module "fastify" {
  interface FastifyRequest {
    /** The paired device behind a device token; null for the shared key or an open server. */
    device: DeviceView | null;
  }
}

const DEFAULT_NAMES: Record<DevicePlatform, string> = {
  tizen: "Samsung TV",
  webos: "LG TV",
  android: "Android TV",
  browser: "Browser",
};

/** Capability profiles are small; anything larger is dropped rather than stored. */
const MAX_CAPABILITIES_JSON = 16 * 1024;

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export const pairing = new PairingStore();

export function registerDevices(app: FastifyInstance) {
  app.decorateRequest("device", null);

  app.post("/api/pair", async (request, reply) => {
    const body = asRecord(request.body);
    const platform = isDevicePlatform(body.platform) ? body.platform : "browser";
    const capabilities = body.capabilities ?? null;
    const started = pairing.start({
      name: cleanDeviceName(body.name) ?? DEFAULT_NAMES[platform],
      platform,
      capabilities: capabilities != null && JSON.stringify(capabilities).length <= MAX_CAPABILITIES_JSON ? capabilities : null,
    });
    if (!started) return reply.code(429).send({ error: "too_many_pairings" });
    return reply.code(201).send(started);
  });

  app.get("/api/pair/:code", async (request, reply) => {
    const code = normalizePairCode((request.params as { code: string }).code);
    const secret = String((request.query as { secret?: unknown }).secret ?? "");
    reply.header("Cache-Control", "no-store");
    const polled = code && secret ? pairing.poll(code, secret) : null;
    return polled ?? reply.code(404).send({ error: "not_found" });
  });

  app.get("/api/pair/:code/info", async (request, reply) => {
    const code = normalizePairCode((request.params as { code: string }).code);
    const info = code ? pairing.describe(code) : null;
    return info ?? reply.code(404).send({ error: "pair_not_found" });
  });

  app.post("/api/pair/:code/approve", async (request, reply) => {
    const code = normalizePairCode((request.params as { code: string }).code);
    const name = cleanDeviceName(asRecord(request.body).name) ?? undefined;
    const device = code ? pairing.approve(code, issueDevice, name) : null;
    return device ? { device } : reply.code(404).send({ error: "pair_not_found" });
  });

  app.get("/api/devices", async () => listDevices());

  app.get("/api/devices/me", async (request) => ({ device: request.device }));

  app.put("/api/devices/:id", async (request, reply) => {
    const name = cleanDeviceName(asRecord(request.body).name);
    if (!name) return reply.code(400).send({ error: "bad_device_name" });
    if (!renameDevice((request.params as { id: string }).id, name)) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });

  app.post("/api/devices/:id/revoke", async (request, reply) => {
    if (!revokeDevice((request.params as { id: string }).id)) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  app.delete("/api/devices/:id", async (request, reply) => {
    if (!deleteDevice((request.params as { id: string }).id)) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
