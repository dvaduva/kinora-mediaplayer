import { createHash } from "node:crypto";

export function stableId(prefix: string, key: string) {
  return `${prefix}_${createHash("sha1").update(key).digest("hex").slice(0, 20)}`;
}
