import assert from "node:assert/strict";
import test from "node:test";
import { configuredOrigins, DEV_ORIGINS, isAllowedHost, isAllowedOrigin, isDeviceForbidden, presentedTokens, redactUrl, routeAccess } from "./security.js";

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

test("only health, pairing and the device heartbeat answer any origin", () => {
  assert.deepEqual(routeAccess("GET", "/api/health"), { open: true, anyOrigin: true });
  assert.deepEqual(routeAccess("POST", "/api/pair"), { open: true, anyOrigin: true });
  assert.deepEqual(routeAccess("GET", "/api/pair/ABCDEF"), { open: true, anyOrigin: true });
  assert.deepEqual(routeAccess("POST", "/api/pair/ABCDEF/approve"), { open: false, anyOrigin: false });
  assert.deepEqual(routeAccess("GET", "/api/pair/ABCDEF/info"), { open: false, anyOrigin: false });
  assert.deepEqual(routeAccess("GET", "/api/devices/me"), { open: false, anyOrigin: true });
  assert.deepEqual(routeAccess("GET", "/api/devices"), { open: false, anyOrigin: false });
  assert.deepEqual(routeAccess("POST", "/api/session"), { open: true, anyOrigin: false });
  assert.deepEqual(routeAccess("GET", "/api/home"), { open: false, anyOrigin: false });
});

test("device tokens cannot manage the server", () => {
  assert.equal(isDeviceForbidden("GET", "/api/home"), false);
  assert.equal(isDeviceForbidden("GET", "/api/settings"), false);
  assert.equal(isDeviceForbidden("POST", "/api/movies/m1/match"), false);
  assert.equal(isDeviceForbidden("GET", "/api/libraries"), false);
  assert.equal(isDeviceForbidden("GET", "/api/devices/me"), false);
  assert.equal(isDeviceForbidden("GET", "/api/devices"), true);
  assert.equal(isDeviceForbidden("POST", "/api/devices/d1/revoke"), true);
  assert.equal(isDeviceForbidden("POST", "/api/pair/ABCDEF/approve"), true);
  assert.equal(isDeviceForbidden("PUT", "/api/settings"), true);
  assert.equal(isDeviceForbidden("POST", "/api/libraries"), true);
  assert.equal(isDeviceForbidden("DELETE", "/api/libraries/l1"), true);
  assert.equal(isDeviceForbidden("GET", "/api/folders"), true);
  assert.equal(isDeviceForbidden("POST", "/api/cache/transcode/clear"), true);
});

test("the query token is read only on GET and HEAD", () => {
  assert.deepEqual(presentedTokens({ method: "GET", authorization: "Bearer a", query: { token: "b" }, cookie: "c" }), ["a", "b", "c"]);
  assert.deepEqual(presentedTokens({ method: "POST", query: { token: "b" } }), []);
  assert.deepEqual(presentedTokens({ method: "GET", authorization: "Basic x", query: {} }), []);
});

test("logged URLs never hold the token or the pairing secret", () => {
  assert.equal(redactUrl("/api/images?size=w342&token=kd_abc&path=%2Fx.jpg"), "/api/images?size=w342&token=[redacted]&path=%2Fx.jpg");
  assert.equal(redactUrl("/api/stream/f1?token=key"), "/api/stream/f1?token=[redacted]");
  assert.equal(redactUrl("/api/pair/ABCDEF?secret=s3cr3t"), "/api/pair/ABCDEF?secret=[redacted]");
  assert.equal(redactUrl("/api/search?q=tokens"), "/api/search?q=tokens");
});
