import assert from "node:assert/strict";
import test from "node:test";
import { configuredOrigins, DEV_ORIGINS, isAllowedHost, isAllowedOrigin } from "./security.js";

test("accepts requests from the page the server itself serves", () => {
  assert.equal(isAllowedOrigin(undefined, "127.0.0.1:3001", DEV_ORIGINS), true);
  assert.equal(isAllowedOrigin("http://127.0.0.1:3001", "127.0.0.1:3001", DEV_ORIGINS), true);
  assert.equal(isAllowedOrigin("http://192.168.1.20:3001", "192.168.1.20:3001", DEV_ORIGINS), true);
});

test("accepts the Vite dev servers behind their proxies", () => {
  assert.equal(isAllowedOrigin("http://localhost:5173", "127.0.0.1:3001", DEV_ORIGINS), true);
  assert.equal(isAllowedOrigin("http://127.0.0.1:5174", "127.0.0.1:3001", DEV_ORIGINS), true);
});

test("rejects other web sites", () => {
  assert.equal(isAllowedOrigin("https://evil.example", "127.0.0.1:3001", DEV_ORIGINS), false);
  assert.equal(isAllowedOrigin("http://127.0.0.1:8080", "127.0.0.1:3001", DEV_ORIGINS), false);
  assert.equal(isAllowedOrigin("null", "127.0.0.1:3001", DEV_ORIGINS), false);
  assert.equal(isAllowedOrigin("not a url", "127.0.0.1:3001", DEV_ORIGINS), false);
});

test("reads extra trusted origins from the environment", () => {
  assert.deepEqual(configuredOrigins(" https://media.home/ , http://nas:8096"), ["https://media.home", "http://nas:8096"]);
  assert.equal(isAllowedOrigin("https://media.home", "127.0.0.1:3001", ["https://media.home"]), true);
});

test("blocks DNS rebinding while bound to loopback", () => {
  assert.equal(isAllowedHost("127.0.0.1:3001", "127.0.0.1"), true);
  assert.equal(isAllowedHost("localhost:5173", "127.0.0.1"), true);
  assert.equal(isAllowedHost("[::1]:3001", "127.0.0.1"), true);
  assert.equal(isAllowedHost("attacker.example:3001", "127.0.0.1"), false);
  assert.equal(isAllowedHost(undefined, "127.0.0.1"), false);
  assert.equal(isAllowedHost("kinora.lan:3001", "0.0.0.0"), true);
});
