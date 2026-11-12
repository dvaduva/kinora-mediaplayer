import { createHash, randomBytes, randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import {
  DEFAULT_DEVICE_OVERRIDES,
  isDevicePlatform,
  sanitizeCapabilities,
  sanitizeOverrides,
  type CapabilityProfile,
  type DeviceOverrides,
  type DevicePlayback,
  type DeviceView,
} from "@kinora/shared";
import { db, parseJson } from "../db/index.js";
import { devices } from "../db/schema.js";
import type { PairRequest } from "./pairing.js";

/** Device tokens carry a prefix, so the auth check can tell them from the shared access key. */
export const DEVICE_TOKEN_PREFIX = "kd_";

export function isDeviceToken(token: string) {
  return token.startsWith(DEVICE_TOKEN_PREFIX);
}

export function newDeviceToken() {
  return `${DEVICE_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export const MAX_DEVICE_NAME = 60;

/** Trimmed, single-line, at most 60 characters; null when nothing is left. */
export function cleanDeviceName(value: unknown) {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim().slice(0, MAX_DEVICE_NAME);
  return name || null;
}

type DeviceRow = typeof devices.$inferSelect;

/** How each device played its last file; kept in memory, so it starts empty after a restart. */
const lastPlayback = new Map<string, DevicePlayback>();

export function recordPlayback(deviceId: string, playback: DevicePlayback) {
  lastPlayback.set(deviceId, playback);
}

function view(row: DeviceRow): DeviceView {
  return {
    id: row.id,
    name: row.name,
    platform: isDevicePlatform(row.platform) ? row.platform : "browser",
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt,
    capabilities: sanitizeCapabilities(parseJson<unknown>(row.capabilitiesJson, null)),
    overrides: row.overridesJson ? sanitizeOverrides(parseJson<unknown>(row.overridesJson, null)) : DEFAULT_DEVICE_OVERRIDES,
    lastPlayback: lastPlayback.get(row.id) ?? null,
  };
}

function capabilitiesJson(value: unknown) {
  const profile = sanitizeCapabilities(value);
  return profile ? JSON.stringify(profile) : null;
}

/** The device's own report of what it decodes, sent at pairing and again each time the TV app starts. */
export function updateCapabilities(id: string, capabilities: CapabilityProfile) {
  return db.update(devices).set({ capabilitiesJson: JSON.stringify(capabilities) }).where(eq(devices.id, id)).run().changes > 0;
}

export function setOverrides(id: string, overrides: DeviceOverrides) {
  return db.update(devices).set({ overridesJson: JSON.stringify(overrides) }).where(eq(devices.id, id)).run().changes > 0;
}

export function issueDevice(request: PairRequest) {
  const token = newDeviceToken();
  const row: DeviceRow = {
    id: randomUUID(),
    name: request.name,
    platform: request.platform,
    tokenHash: hashToken(token),
    capabilitiesJson: capabilitiesJson(request.capabilities),
    overridesJson: null,
    createdAt: Date.now(),
    lastSeenAt: null,
    revokedAt: null,
  };
  db.insert(devices).values(row).run();
  return { token, device: view(row) };
}

/** Last-seen is written at most once a minute per device, not on every segment request. */
const SEEN_EVERY_MS = 60_000;
const lastWrite = new Map<string, number>();

/** The active device holding this token, or null (unknown or revoked). Marks it as seen. */
export function deviceForToken(token: string): DeviceView | null {
  const row = db.select().from(devices).where(eq(devices.tokenHash, hashToken(token))).get();
  if (!row || row.revokedAt != null) return null;
  const now = Date.now();
  if (now - (lastWrite.get(row.id) ?? 0) >= SEEN_EVERY_MS) {
    lastWrite.set(row.id, now);
    db.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, row.id)).run();
    row.lastSeenAt = now;
  }
  return view(row);
}

export function listDevices(): DeviceView[] {
  return db.select().from(devices).orderBy(desc(devices.createdAt)).all().map(view);
}

export function renameDevice(id: string, name: string) {
  return db.update(devices).set({ name }).where(eq(devices.id, id)).run().changes > 0;
}

/** Revoked devices stay listed (so the owner sees what was cut off) until deleted. */
export function revokeDevice(id: string) {
  const row = db.select().from(devices).where(eq(devices.id, id)).get();
  if (!row) return false;
  if (row.revokedAt == null) db.update(devices).set({ revokedAt: Date.now() }).where(eq(devices.id, id)).run();
  return true;
}

export function deleteDevice(id: string) {
  lastWrite.delete(id);
  lastPlayback.delete(id);
  return db.delete(devices).where(eq(devices.id, id)).run().changes > 0;
}
