import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { PAIR_CODE_ALPHABET, PAIR_CODE_LENGTH, type DevicePlatform, type DeviceView, type PairPoll, type PairStart } from "@kinora/shared";

export const PAIR_TTL_MS = 5 * 60 * 1000;
/** Pending codes at once; a flood of `POST /api/pair` cannot grow memory past this. */
export const MAX_PENDING = 32;

export type PairRequest = {
  name: string;
  platform: DevicePlatform;
  capabilities: unknown;
};

type Entry = PairRequest & {
  code: string;
  secret: string;
  expiresAt: number;
  issued: { token: string; device: DeviceView } | null;
};

export type Issue = (request: PairRequest) => { token: string; device: DeviceView };

export function randomPairCode() {
  let code = "";
  for (let index = 0; index < PAIR_CODE_LENGTH; index += 1) code += PAIR_CODE_ALPHABET[randomInt(PAIR_CODE_ALPHABET.length)];
  return code;
}

function sameSecret(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Pairing codes live in memory only: a restart drops them and the TV simply asks for a new one.
 * The TV creates a code, the signed-in user approves it, and the TV collects its token once with the secret.
 */
export class PairingStore {
  private entries = new Map<string, Entry>();

  constructor(
    private options: { now?: () => number; ttlMs?: number; maxPending?: number; code?: () => string } = {},
  ) {}

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  private sweep() {
    const now = this.now();
    for (const [code, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(code);
  }

  start(request: PairRequest): PairStart | null {
    this.sweep();
    if (this.entries.size >= (this.options.maxPending ?? MAX_PENDING)) return null;
    let code = "";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      code = (this.options.code ?? randomPairCode)();
      if (!this.entries.has(code)) break;
    }
    if (this.entries.has(code)) return null;
    const entry: Entry = {
      ...request,
      code,
      secret: randomBytes(24).toString("base64url"),
      expiresAt: this.now() + (this.options.ttlMs ?? PAIR_TTL_MS),
      issued: null,
    };
    this.entries.set(code, entry);
    return { code, secret: entry.secret, expiresAt: entry.expiresAt };
  }

  /** null when the code is unknown or the secret is wrong (the two look the same to a guesser). */
  poll(code: string, secret: string): PairPoll | null {
    const entry = this.entries.get(code);
    if (!entry || !sameSecret(secret, entry.secret)) return null;
    if (entry.issued) {
      // Handed out once; a second poll with the same secret finds nothing.
      this.entries.delete(code);
      return { status: "approved", token: entry.issued.token, device: entry.issued.device };
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(code);
      return { status: "expired" };
    }
    return { status: "pending", expiresAt: entry.expiresAt };
  }

  /** What the approver is about to let in; null for an unknown or expired code. */
  describe(code: string) {
    const entry = this.entries.get(code);
    if (!entry || entry.issued || entry.expiresAt <= this.now()) return null;
    return { name: entry.name, platform: entry.platform, expiresAt: entry.expiresAt };
  }

  /** Creates the device; the TV gets the token on its next poll. The approver may rename it first. */
  approve(code: string, issue: Issue, name?: string): DeviceView | null {
    const entry = this.entries.get(code);
    if (!entry || entry.issued || entry.expiresAt <= this.now()) return null;
    // The TV has a minute after approval to pick up its token, even if the code was about to expire.
    entry.expiresAt = Math.max(entry.expiresAt, this.now() + 60_000);
    entry.issued = issue({ ...entry, name: name ?? entry.name });
    return entry.issued.device;
  }
}
