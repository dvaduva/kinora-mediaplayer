import os from "node:os";
import { Bonjour } from "bonjour-service";
import { API_VERSION } from "@kinora/shared";
import { isLocalHost } from "./security.js";
import { SERVER_VERSION } from "./version.js";

/** DNS-SD type the Android TV app browses for (NSD). Tizen and webOS web apps cannot, and scan the subnet instead. */
export const MDNS_TYPE = "kinora";

let bonjour: Bonjour | null = null;

/**
 * Announces `_kinora._tcp` on the LAN while the server listens beyond localhost.
 * Failing to announce (no multicast, port 5353 taken) only costs discovery, so it is logged and ignored.
 */
export function announce(options: { bindHost: string; port: number; log: (message: string) => void }) {
  if (isLocalHost(options.bindHost) || process.env.KINORA_MDNS === "0") return;
  try {
    bonjour = new Bonjour(undefined, (error: unknown) => options.log(`mDNS announcement failed: ${String(error)}`));
    bonjour.publish({
      name: `Kinora (${os.hostname()})`,
      type: MDNS_TYPE,
      protocol: "tcp",
      port: options.port,
      txt: { apiVersion: String(API_VERSION), version: SERVER_VERSION },
    });
  } catch (error) {
    options.log(`mDNS announcement failed: ${String(error)}`);
  }
}

export function stopAnnouncing() {
  if (!bonjour) return;
  bonjour.unpublishAll();
  bonjour.destroy();
  bonjour = null;
}
