import {
  isPlayerReport,
  PLAYER_BRIDGE_SOURCE,
  type BridgePlayer,
  type CapabilityProfile,
  type PlayerCommand,
  type PlayerReportMessage,
} from "@kinora/shared";
import { getApiConfig } from "@kinora/client";
import type { AudioTrackInfo, PlayerAdapter, PlayerBackend, PlayerCallbacks, PlayerEvent, PlayerSource } from "./types";

/**
 * A native player that lives in the TV shell's page (AVPlay on Tizen), driven by message. The shell
 * reports state back; this side keeps the latest values so the getters answer synchronously.
 * The <video> element stays empty: the picture is on the TV's video plane under the page, and the
 * page clears its background (`avplay-active`) for as long as a source is loaded.
 */

const ACTIVE_CLASS = "avplay-active";
const CAPABILITIES_TIMEOUT = 3000;

/** Unique across adapters, so a report for an older adapter's source never reaches a newer one. */
let sessions = 0;
let requests = 0;

function send(command: PlayerCommand) {
  // The shell's page is packaged with the app (file://), so there is no origin to name.
  window.parent.postMessage({ source: PLAYER_BRIDGE_SOURCE, ...command }, "*");
}

function fromShell(event: MessageEvent): PlayerReportMessage | null {
  return event.source === window.parent && isPlayerReport(event.data) ? event.data : null;
}

/** The player runs in another page: it needs an absolute address, with the token in it (it cannot send headers). */
export function playerUrl(url: string, token: string | null) {
  const absolute = new URL(url, window.location.href).href;
  if (!token || /[?&]token=/.test(absolute)) return absolute;
  return `${absolute}${absolute.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}

function requestCapabilities(): Promise<CapabilityProfile> {
  return new Promise((resolve, reject) => {
    requests += 1;
    const request = requests;
    const timer = window.setTimeout(() => finish(null), CAPABILITIES_TIMEOUT);
    function finish(profile: CapabilityProfile | null) {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (profile) resolve(profile);
      else reject(new Error("no_capabilities"));
    }
    function onMessage(event: MessageEvent) {
      const report = fromShell(event);
      if (report?.event === "capabilities" && report.request === request) finish(report.profile);
    }
    window.addEventListener("message", onMessage);
    send({ command: "capabilities", request });
  });
}

function createBridgePlayer(_video: HTMLVideoElement, callbacks: PlayerCallbacks): PlayerAdapter {
  let session = 0;
  let time = 0;
  let duration = Number.NaN;
  let paused = true;
  let tracks: AudioTrackInfo[] = [];
  const handlers: Record<PlayerEvent, Array<() => void>> = { loadedmetadata: [], playing: [], play: [], pause: [], timeupdate: [], ended: [] };

  function emit(event: PlayerEvent) {
    for (const handler of handlers[event].slice()) handler();
  }

  function setActive(active: boolean) {
    const root = document.documentElement;
    if (active) root.classList.add(ACTIVE_CLASS);
    else root.classList.remove(ACTIVE_CLASS);
  }

  function setPaused(next: boolean) {
    if (paused === next) return;
    paused = next;
    emit(next ? "pause" : "play");
  }

  const onMessage = (event: MessageEvent) => {
    const report = fromShell(event);
    if (!report || report.event === "capabilities" || report.session !== session || session === 0) return;
    switch (report.event) {
      case "ready":
        duration = report.duration;
        emit("loadedmetadata");
        // Like <video autoplay>: play once ready, after the page had its chance to seek to the resume point.
        adapter.play();
        break;
      case "playing":
        setPaused(false);
        emit("playing");
        break;
      case "paused":
        setPaused(true);
        break;
      case "time":
        time = report.time;
        if (!Number.isNaN(report.duration)) duration = report.duration;
        emit("timeupdate");
        break;
      case "tracks":
        tracks = report.tracks;
        break;
      case "ended":
        paused = true;
        emit("ended");
        break;
      case "error":
        callbacks.onFatal();
        break;
    }
  };
  window.addEventListener("message", onMessage);

  function unload() {
    if (session === 0) return;
    send({ command: "unload", session });
    session = 0;
    paused = true;
    tracks = [];
    setActive(false);
  }

  const adapter: PlayerAdapter = {
    load(source: PlayerSource) {
      unload();
      sessions += 1;
      session = sessions;
      time = source.kind === "hls" ? source.start : 0;
      duration = Number.NaN;
      paused = true;
      setActive(true);
      send({
        command: "load",
        session,
        kind: source.kind,
        url: playerUrl(source.url, getApiConfig().token || null),
        start: source.kind === "hls" ? source.start : 0,
      });
    },
    unload,
    play() {
      if (session === 0) return;
      setPaused(false);
      send({ command: "play", session });
    },
    pause() {
      if (session === 0) return;
      setPaused(true);
      send({ command: "pause", session });
    },
    seek(seconds: number) {
      if (session === 0) return;
      // Kept right away, so a few quick presses of → add up before the shell reports back.
      time = Math.max(0, seconds);
      send({ command: "seek", session, seconds: time });
    },
    get currentTime() {
      return time;
    },
    get duration() {
      return duration;
    },
    get paused() {
      return paused;
    },
    audioTracks() {
      return tracks;
    },
    selectAudioTrack(id: string) {
      if (session === 0) return;
      send({ command: "audio", session, id });
    },
    on(event, handler) {
      handlers[event].push(handler);
      return () => {
        const list = handlers[event];
        const index = list.indexOf(handler);
        if (index >= 0) list.splice(index, 1);
      };
    },
    destroy() {
      unload();
      window.removeEventListener("message", onMessage);
    },
  };
  return adapter;
}

export function bridgeBackend(player: BridgePlayer): PlayerBackend {
  return {
    name: player,
    capabilities: requestCapabilities,
    textTracks: false,
    create: createBridgePlayer,
  };
}
