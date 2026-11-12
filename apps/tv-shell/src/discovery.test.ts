import assert from "node:assert/strict";
import test from "node:test";
import { API_VERSION } from "@kinora/shared";
import { compatibility, scan, scanTargets } from "./discovery";
import { normalizeServerUrl } from "./servers";

test("server addresses are typed loosely and stored one way", () => {
  assert.equal(normalizeServerUrl("192.168.1.20"), "http://192.168.1.20:3001");
  assert.equal(normalizeServerUrl(" 192.168.1.20:8080/ "), "http://192.168.1.20:8080");
  assert.equal(normalizeServerUrl("http://Kinora.LAN:3001/tv/"), "http://kinora.lan:3001");
  assert.equal(normalizeServerUrl("https://media.home"), "https://media.home");
  assert.equal(normalizeServerUrl("192.168.1.20:99999"), null);
  assert.equal(normalizeServerUrl("http://host/other/path"), null);
  assert.equal(normalizeServerUrl(""), null);
});

test("the scan covers the TV's /24, known servers and their ports first", () => {
  const targets = scanTargets("192.168.1.50", ["http://192.168.1.7:8080", "http://10.0.0.2:3001"]);
  assert.equal(targets[0], "http://192.168.1.7:8080");
  assert.equal(targets[1], "http://192.168.1.49:8080", "nearest hosts next, on the known port");
  assert.ok(targets.includes("http://192.168.1.254:3001"));
  assert.ok(!targets.includes("http://192.168.1.50:3001"), "not the TV itself");
  assert.ok(!targets.some((url) => url.startsWith("http://10.")), "other subnets are only reachable when typed");
  assert.equal(targets.length, 253 * 2);
  assert.deepEqual(scanTargets("not an ip", []), []);
});

test("the scan keeps only Kinora servers", async () => {
  const answers: Record<string, unknown> = {
    "http://a": { name: "kinora", apiVersion: API_VERSION, serverVersion: "1.0.0" },
    "http://b": { name: "jellyfin" },
    "http://c": null,
  };
  const seen: string[] = [];
  const found = await scan(Object.keys(answers), async (url) => answers[url], { concurrency: 2, onFound: (entry) => seen.push(entry.url) });
  assert.deepEqual(found.map((entry) => entry.url), ["http://a"]);
  assert.deepEqual(seen, ["http://a"]);
});

test("an unknown API version names the side to update", () => {
  assert.equal(compatibility({ name: "kinora", apiVersion: API_VERSION, serverVersion: "x" }), "ok");
  assert.equal(compatibility({ name: "kinora", apiVersion: API_VERSION - 1, serverVersion: "x" }), "server-too-old");
  assert.equal(compatibility({ name: "kinora", apiVersion: API_VERSION + 1, serverVersion: "x" }), "app-too-old");
});
