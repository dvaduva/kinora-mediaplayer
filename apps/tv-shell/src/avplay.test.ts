import assert from "node:assert/strict";
import test from "node:test";
import type { PlayerReport } from "@kinora/shared";
import { isPlayerCommand, isPlayerReport, PLAYER_BRIDGE_SOURCE } from "@kinora/shared";
import { audioTrackLabel, createAvplayController, type Avplay, type AvplayListener } from "./avplay";

function fakeAvplay() {
  const calls: string[] = [];
  let state = "NONE";
  let listener: AvplayListener = {};
  let prepared: { ok: () => void; fail: (error: unknown) => void } | null = null;
  let current = 0;
  let selectedAudio = 1;
  const avplay: Avplay = {
    open: (url) => {
      calls.push(`open ${url}`);
      state = "IDLE";
    },
    close: () => {
      calls.push("close");
      state = "NONE";
    },
    stop: () => {
      calls.push("stop");
      state = "IDLE";
    },
    prepareAsync: (ok, fail) => {
      calls.push("prepare");
      prepared = { ok, fail };
    },
    play: () => {
      calls.push("play");
      state = "PLAYING";
    },
    pause: () => {
      calls.push("pause");
      state = "PAUSED";
    },
    seekTo: (ms, ok) => {
      calls.push(`seek ${ms}`);
      current = ms;
      ok?.();
    },
    getState: () => state,
    getDuration: () => 7_200_000,
    getCurrentTime: () => current,
    setListener: (next) => {
      listener = next;
    },
    setDisplayRect: (x, y, w, h) => calls.push(`rect ${x},${y},${w},${h}`),
    setDisplayMethod: () => undefined,
    getTotalTrackInfo: () => [
      { index: 0, type: "VIDEO", extra_info: "{}" },
      { index: 1, type: "AUDIO", extra_info: '{"language":"eng","fourCC":"ec-3","channels":"6"}' },
      { index: 2, type: "AUDIO", extra_info: '{"language":"rum","fourCC":"AAC","channels":"2"}' },
    ],
    getCurrentStreamInfo: () => [{ index: selectedAudio, type: "AUDIO" }],
    setSelectTrack: (type, index) => {
      calls.push(`select ${type} ${index}`);
      selectedAudio = index;
    },
    suspend: () => calls.push("suspend"),
    restore: () => calls.push("restore"),
  };
  return {
    avplay,
    calls,
    prepare: () => {
      state = "READY";
      prepared!.ok();
    },
    fail: () => prepared!.fail(new Error("PLAYER_ERROR_NOT_SUPPORTED_FILE")),
    listener: () => listener,
  };
}

function setup() {
  const fake = fakeAvplay();
  const reports: PlayerReport[] = [];
  const active: boolean[] = [];
  let clock = 0;
  const controller = createAvplayController(fake.avplay, {
    send: (report) => reports.push(report),
    onActive: (value) => active.push(value),
    now: () => clock,
  });
  return { fake, reports, active, controller, tick: (ms: number) => (clock += ms) };
}

test("opens, prepares, reports the duration and tracks, and plays once asked", () => {
  const { fake, reports, active, controller } = setup();
  controller.handle({ command: "load", session: 1, kind: "file", url: "http://tv.lan:3001/api/stream/a?token=kd_x", start: 0 });
  assert.deepEqual(fake.calls.slice(0, 3), ["open http://tv.lan:3001/api/stream/a?token=kd_x", "rect 0,0,1920,1080", "prepare"]);
  assert.deepEqual(active, [true]);
  controller.handle({ command: "play", session: 1 });
  assert.equal(fake.calls.includes("play"), false, "a play before prepare waits");
  fake.prepare();
  assert.deepEqual(reports[0], { event: "ready", session: 1, duration: 7200 });
  assert.deepEqual(reports[1], {
    event: "tracks",
    session: 1,
    tracks: [
      { id: "1", language: "eng", label: "eng · E-AC-3 5.1", enabled: true },
      { id: "2", language: "rum", label: "rum · AAC 2.0", enabled: false },
    ],
  });
  assert.deepEqual(reports[2], { event: "playing", session: 1 });
  assert.ok(fake.calls.includes("play"));
});

test("an HLS start point and an early seek are applied once prepared", () => {
  const { fake, controller } = setup();
  controller.handle({ command: "load", session: 4, kind: "hls", url: "http://tv.lan:3001/api/stream/a/index.m3u8?token=kd_x", start: 90 });
  fake.prepare();
  assert.ok(fake.calls.includes("seek 90000"));
  controller.handle({ command: "seek", session: 4, seconds: 120.5 });
  assert.ok(fake.calls.includes("seek 120500"));
});

test("time reports are throttled and carry the session", () => {
  const { fake, reports, controller, tick } = setup();
  controller.handle({ command: "load", session: 2, kind: "file", url: "http://tv.lan/a", start: 0 });
  fake.prepare();
  reports.length = 0;
  tick(1000);
  fake.listener().oncurrentplaytime?.(5000);
  fake.listener().oncurrentplaytime?.(5100);
  tick(300);
  fake.listener().oncurrentplaytime?.(5300);
  assert.deepEqual(reports, [
    { event: "time", session: 2, time: 5, duration: 7200 },
    { event: "time", session: 2, time: 5.3, duration: 7200 },
  ]);
});

test("commands for an older session do nothing, and a new load replaces the old source", () => {
  const { fake, reports, active, controller } = setup();
  controller.handle({ command: "load", session: 1, kind: "file", url: "http://tv.lan/a", start: 0 });
  fake.prepare();
  controller.handle({ command: "load", session: 2, kind: "file", url: "http://tv.lan/b", start: 0 });
  assert.deepEqual(active, [true, false, true]);
  const before = fake.calls.length;
  controller.handle({ command: "pause", session: 1 });
  controller.handle({ command: "unload", session: 1 });
  assert.equal(fake.calls.length, before);
  reports.length = 0;
  fake.listener().onerror?.("PLAYER_ERROR_CONNECTION_FAILED");
  assert.deepEqual(reports, [{ event: "error", session: 2, code: "PLAYER_ERROR_CONNECTION_FAILED" }]);
});

test("pause, audio selection, end of stream and unload", () => {
  const { fake, reports, active, controller } = setup();
  controller.handle({ command: "load", session: 3, kind: "file", url: "http://tv.lan/a", start: 0 });
  fake.prepare();
  controller.handle({ command: "play", session: 3 });
  controller.handle({ command: "pause", session: 3 });
  assert.deepEqual(reports.at(-1), { event: "paused", session: 3 });
  controller.handle({ command: "audio", session: 3, id: "2" });
  assert.ok(fake.calls.includes("select AUDIO 2"));
  const tracks = reports.at(-1);
  assert.equal(tracks?.event, "tracks");
  assert.equal(tracks?.event === "tracks" && tracks.tracks[1]!.enabled, true);
  fake.listener().onstreamcompleted?.();
  assert.deepEqual(reports.at(-1), { event: "ended", session: 3 });
  assert.equal(controller.active, false);
  assert.deepEqual(active, [true, false]);
});

test("a file AVPlay cannot open is reported, and the plane is released", () => {
  const { fake, reports, active, controller } = setup();
  controller.handle({ command: "load", session: 5, kind: "file", url: "http://tv.lan/a", start: 0 });
  fake.fail();
  assert.deepEqual(reports, [{ event: "error", session: 5, code: "unsupported" }]);
  assert.deepEqual(active, [true, false]);
});

test("suspends in the background and restores in the foreground", () => {
  const { fake, controller } = setup();
  controller.visibility(true);
  assert.equal(fake.calls.includes("suspend"), false, "nothing to suspend without a source");
  controller.handle({ command: "load", session: 6, kind: "file", url: "http://tv.lan/a", start: 0 });
  controller.visibility(true);
  controller.visibility(true);
  controller.visibility(false);
  assert.deepEqual(fake.calls.filter((call) => call === "suspend" || call === "restore"), ["suspend", "restore"]);
});

test("audio track labels read AVPlay's extra info", () => {
  assert.equal(audioTrackLabel({ language: "und", fourCC: "ac-3", channels: "6" }, 1), "AC-3 5.1");
  assert.equal(audioTrackLabel({}, 3), "3");
});

test("bridge messages are checked before the shell acts on them", () => {
  const source = PLAYER_BRIDGE_SOURCE;
  assert.equal(isPlayerCommand({ source, command: "load", session: 1, kind: "file", url: "http://a/b", start: 0 }), true);
  assert.equal(isPlayerCommand({ source, command: "load", session: 1, kind: "file", url: "file:///etc/passwd", start: 0 }), false);
  assert.equal(isPlayerCommand({ source, command: "load", session: 1, kind: "dash", url: "http://a/b", start: 0 }), false);
  assert.equal(isPlayerCommand({ source, command: "seek", session: 1, seconds: Number.NaN }), false);
  assert.equal(isPlayerCommand({ source: "kinora-tv", command: "play", session: 1 }), false);
  assert.equal(isPlayerCommand({ source, command: "capabilities", request: 2 }), true);
  assert.equal(isPlayerReport({ source, event: "time", session: 1, time: 3, duration: 9 }), true);
  assert.equal(isPlayerReport({ source, event: "bogus", session: 1 }), false);
});
