import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_DEVICE_OVERRIDES, normalizePairCode, PAIR_CODE_ALPHABET, type DeviceView } from "@kinora/shared";
import { PairingStore, randomPairCode, type PairRequest } from "./pairing.js";

const request: PairRequest = { name: "Samsung TV", platform: "tizen", capabilities: null };

function issuer() {
  const issued: PairRequest[] = [];
  const issue = (input: PairRequest) => {
    issued.push(input);
    const device: DeviceView = { id: `d${issued.length}`, name: input.name, platform: input.platform, createdAt: 1, lastSeenAt: null, revokedAt: null, capabilities: null, overrides: DEFAULT_DEVICE_OVERRIDES, lastPlayback: null };
    return { token: `kd_token${issued.length}`, device };
  };
  return { issued, issue };
}

test("codes use the unambiguous alphabet and normalize from typed input", () => {
  for (let index = 0; index < 50; index += 1) {
    const code = randomPairCode();
    assert.equal(code.length, 6);
    for (const char of code) assert.ok(PAIR_CODE_ALPHABET.includes(char));
  }
  assert.equal(normalizePairCode(" abc-def "), "ABCDEF");
  assert.equal(normalizePairCode("abc 2de"), "ABC2DE");
  assert.equal(normalizePairCode("ABCDE0"), null, "0 is not in the alphabet");
  assert.equal(normalizePairCode("ABCDE"), null);
  assert.equal(normalizePairCode(42), null);
});

test("the TV collects its token once, only with its secret, after approval", () => {
  const store = new PairingStore({ now: () => 1000, code: () => "ABCDEF" });
  const { issued, issue } = issuer();
  const started = store.start(request)!;
  assert.equal(started.code, "ABCDEF");
  assert.equal(started.expiresAt, 1000 + 5 * 60 * 1000);

  assert.deepEqual(store.poll("ABCDEF", started.secret), { status: "pending", expiresAt: started.expiresAt });
  assert.equal(store.poll("ABCDEF", "wrong"), null, "a guesser without the secret learns nothing");
  assert.deepEqual(store.describe("ABCDEF"), { name: "Samsung TV", platform: "tizen", expiresAt: started.expiresAt });

  const device = store.approve("ABCDEF", issue, "Living room");
  assert.equal(device?.name, "Living room");
  assert.equal(issued.length, 1);
  assert.equal(store.approve("ABCDEF", issue), null, "a code is approved once");
  assert.equal(store.describe("ABCDEF"), null);

  assert.equal(store.poll("ABCDEF", "wrong"), null);
  const polled = store.poll("ABCDEF", started.secret);
  assert.equal(polled?.status, "approved");
  assert.equal(polled?.status === "approved" ? polled.token : null, "kd_token1");
  assert.equal(store.poll("ABCDEF", started.secret), null, "the token is handed out once");
});

test("codes expire after five minutes", () => {
  let now = 0;
  const store = new PairingStore({ now: () => now, code: () => "ABCDEF" });
  const started = store.start(request)!;
  now = 5 * 60 * 1000;
  assert.equal(store.approve("ABCDEF", issuer().issue), null);
  assert.deepEqual(store.poll("ABCDEF", started.secret), { status: "expired" });
  assert.equal(store.poll("ABCDEF", started.secret), null);
});

test("an approved code waits for the TV a little past its expiry", () => {
  let now = 0;
  const store = new PairingStore({ now: () => now, code: () => "ABCDEF" });
  const started = store.start(request)!;
  now = 5 * 60 * 1000 - 1;
  assert.ok(store.approve("ABCDEF", issuer().issue));
  now += 30_000;
  assert.equal(store.poll("ABCDEF", started.secret)?.status, "approved");
});

test("pending codes are capped, and expired ones make room", () => {
  let now = 0;
  let next = 0;
  const store = new PairingStore({ now: () => now, maxPending: 2, code: () => `CODE${(next++).toString().padStart(2, "2")}` });
  assert.ok(store.start(request));
  assert.ok(store.start(request));
  assert.equal(store.start(request), null);
  now = 10 * 60 * 1000;
  assert.ok(store.start(request));
});
