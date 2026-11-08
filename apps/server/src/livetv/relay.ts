import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { TranscodeStatus } from "@kinora/shared";
import { dataDir } from "../paths.js";
import { canCopyAudio, canCopyVideo } from "../playback/plan.js";
import { consumeProgress, playlistCursor, videoEncodeArgs, videoEncoder } from "../playback/transcode.js";
import { bins, detectTools, run, tools } from "../process.js";

/**
 * IPTV streams reach browsers through one ffmpeg per channel: it reads the provider's stream once,
 * copies or converts it into a rolling HLS window, and every viewer of the channel reads that window.
 * The source address never leaves the server. A relay stops about a minute after its last request.
 */

export const relayRoot = path.join(dataDir, "cache", "iptv");
export const RELAY_IDLE_MS = 60_000;
const SEGMENT_SECONDS = 4;
/** Five minutes of picture to pause or rewind into. */
const WINDOW_SEGMENTS = 75;
/** Viewers wait for this many segments before the stream starts. */
const READY_SEGMENTS = 2;
const MAX_RESTARTS = 5;

function maxRelays(value = process.env.KINORA_IPTV_MAX_STREAMS) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 4;
}

/** Protocols ffmpeg may open while reading a stream, including what an HLS source refers to. */
const PROTOCOLS = "http,https,tcp,tls,crypto,httpproxy,rtmp,rtmps,rtmpt,rtsp,rtp,srtp,udp,mmsh,mmst";

export interface RelayCodecs {
  hasVideo: boolean;
  copyVideo: boolean;
  copyAudio: boolean;
}

interface Relay {
  channelId: string;
  url: string;
  dir: string;
  state: "starting" | "running" | "error";
  error: string | null;
  seconds: number;
  lastSeen: number;
  restarts: number;
  /** Next segment number, so a restarted ffmpeg continues the playlist's numbering. */
  nextSegment: number;
  child: ChildProcess | null;
  codecs: RelayCodecs | null;
  /** Bumped on stop, so callbacks of an old run do nothing. */
  generation: number;
}

const relays = new Map<string, Relay>();

/** ffprobe's codec names → whether each stream can be copied, as for library files. */
export function relayCodecs(streams: { codec_type?: string; codec_name?: string }[]): RelayCodecs {
  const video = streams.find((stream) => stream.codec_type === "video" && stream.codec_name !== "mjpeg" && stream.codec_name !== "png");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  return {
    hasVideo: Boolean(video),
    copyVideo: video ? canCopyVideo(video.codec_name ?? null) : false,
    copyAudio: audio ? canCopyAudio(audio.codec_name ?? null) : false,
  };
}

function inputArgs(url: string) {
  const http = /^https?:\/\//i.test(url);
  return [
    "-protocol_whitelist",
    PROTOCOLS,
    ...(http ? ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_on_network_error", "1", "-reconnect_delay_max", "10", "-user_agent", "Kinora/1.0"] : []),
    "-rw_timeout",
    "20000000",
  ];
}

export function relayArgs(url: string, directory: string, codecs: RelayCodecs, startNumber = 0, encoder = videoEncoder()) {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-nostats",
    "-progress",
    "pipe:1",
    "-y",
    ...inputArgs(url),
    "-fflags",
    "+genpts+discardcorrupt",
    "-i",
    url,
    ...(codecs.hasVideo ? ["-map", "0:v:0"] : []),
    "-map",
    "0:a:0?",
    "-sn",
    "-dn",
    ...(codecs.hasVideo ? (codecs.copyVideo ? ["-c:v", "copy"] : videoEncodeArgs(encoder)) : []),
    ...(codecs.copyAudio ? ["-c:a", "copy"] : ["-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "192k"]),
    "-f",
    "hls",
    "-hls_time",
    String(SEGMENT_SECONDS),
    "-hls_list_size",
    String(WINDOW_SEGMENTS),
    "-hls_delete_threshold",
    "4",
    "-hls_flags",
    // A restarted run marks the break, so players reset their timing instead of stalling.
    `delete_segments+independent_segments+temp_file${startNumber > 0 ? "+discont_start" : ""}`,
    ...(startNumber > 0 ? ["-start_number", String(startNumber)] : []),
    "-hls_segment_filename",
    path.join(directory, "seg%05d.ts"),
    path.join(directory, "index.m3u8"),
  ];
}

async function probe(url: string): Promise<RelayCodecs> {
  if (!tools.ffprobe) return { hasVideo: true, copyVideo: false, copyAudio: false };
  const result = await run(
    bins.ffprobe,
    ["-v", "error", "-protocol_whitelist", PROTOCOLS, "-rw_timeout", "15000000", "-show_entries", "stream=codec_type,codec_name", "-of", "json", url],
    25_000,
  ).catch(() => null);
  if (!result || result.code !== 0) {
    const reason = result?.stderr.trim().split(/\r?\n/).pop() ?? "";
    throw new Error(reason.slice(0, 300) || "stream_unreachable");
  }
  try {
    const parsed = JSON.parse(result.stdout) as { streams?: { codec_type?: string; codec_name?: string }[] };
    const codecs = relayCodecs(parsed.streams ?? []);
    if (!codecs.hasVideo && !(parsed.streams ?? []).some((stream) => stream.codec_type === "audio")) throw new Error("no_streams");
    return codecs;
  } catch (error) {
    throw error instanceof Error && error.message === "no_streams" ? error : new Error("stream_unreadable");
  }
}

/**
 * ffmpeg names the address it failed on; status replies go to browsers, and stream addresses often
 * carry account credentials, so every address is cut out.
 */
export function relayErrorText(message: string, url: string) {
  const text = message
    .split(url)
    .join("stream")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "stream")
    .trim();
  return text.slice(0, 300) || "ffmpeg failed";
}

function readPlaylist(dir: string) {
  try {
    return fs.readFileSync(path.join(dir, "index.m3u8"), "utf8");
  } catch {
    return "";
  }
}

function launch(relay: Relay) {
  const generation = relay.generation;
  const current = () => relays.get(relay.channelId) === relay && relay.generation === generation;
  const fail = (message: string) => {
    if (!current()) return;
    relay.state = "error";
    relay.error = relayErrorText(message, relay.url);
    relay.child = null;
  };
  void (async () => {
    try {
      relay.codecs ??= await probe(relay.url);
    } catch (error) {
      fail(error instanceof Error ? error.message : "stream_unreachable");
      return;
    }
    if (!current()) return;
    fs.mkdirSync(relay.dir, { recursive: true });
    const child = spawn(bins.ffmpeg, relayArgs(relay.url, relay.dir, relay.codecs, relay.nextSegment), { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    relay.child = child;
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const parsed = consumeProgress(stdout, chunk.toString());
      stdout = parsed.rest;
      if (parsed.seconds != null && current()) relay.seconds = parsed.seconds;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.on("error", (error) => fail(error.message));
    child.on("close", (code) => {
      if (!current()) return;
      relay.child = null;
      const watched = Date.now() - relay.lastSeen < RELAY_IDLE_MS;
      // Live sources drop now and then; while someone watches, pick the stream up again.
      if (watched && relay.restarts < MAX_RESTARTS) {
        relay.restarts += 1;
        relay.nextSegment = Math.max(relay.nextSegment, playlistCursor(readPlaylist(relay.dir)).nextNumber);
        setTimeout(() => {
          if (current()) launch(relay);
        }, 2000).unref();
        return;
      }
      const line = stderr.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
      fail(line || `ffmpeg exited with ${code ?? "no code"}`);
    });
  })();
}

function removeDir(dir: string) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ffmpeg may still hold a segment for a moment; the next start clears it.
  }
}

export function stopRelay(channelId: string) {
  const relay = relays.get(channelId);
  if (!relay) return;
  relays.delete(channelId);
  relay.generation += 1;
  relay.child?.kill();
  setTimeout(() => removeDir(relay.dir), 1500).unref();
}

/** Starts the channel's relay, or joins the one running; a failed relay is retried. */
export function startRelay(channelId: string, url: string) {
  if (!tools.ffmpeg || !tools.ffprobe) detectTools();
  const existing = relays.get(channelId);
  if (existing && existing.url === url && existing.state !== "error") {
    existing.lastSeen = Date.now();
    return existing;
  }
  if (existing) stopRelay(channelId);
  // Too many channels at once: the one watched least recently gives way.
  const open = [...relays.values()].sort((a, b) => a.lastSeen - b.lastSeen);
  while (open.length >= maxRelays()) stopRelay(open.shift()!.channelId);
  const dir = path.join(relayRoot, channelId.replace(/[^\w-]/g, "_"));
  removeDir(dir);
  const relay: Relay = {
    channelId,
    url,
    dir,
    state: tools.ffmpeg ? "starting" : "error",
    error: tools.ffmpeg ? null : "ffmpeg_missing",
    seconds: 0,
    lastSeen: Date.now(),
    restarts: 0,
    nextSegment: 0,
    child: null,
    codecs: null,
    generation: 0,
  };
  relays.set(channelId, relay);
  if (tools.ffmpeg) launch(relay);
  return relay;
}

export function touchRelay(channelId: string) {
  const relay = relays.get(channelId);
  if (relay) relay.lastSeen = Date.now();
  return relay ?? null;
}

export function relayStatus(channelId: string): TranscodeStatus | null {
  const relay = touchRelay(channelId);
  if (!relay) return null;
  if (relay.state === "error") return { state: "error", seconds: relay.seconds, duration: null, progress: null, playlist: false, error: relay.error };
  const segments = playlistCursor(readPlaylist(relay.dir)).count;
  if (segments >= READY_SEGMENTS) relay.state = "running";
  return { state: "running", seconds: relay.seconds, duration: null, progress: null, playlist: segments >= READY_SEGMENTS, error: null };
}

/** The playlist or a segment of a running relay; null when the name is not one of its files. */
export function relayFile(channelId: string, name: string) {
  if (name !== "index.m3u8" && !/^seg\d+\.ts$/.test(name)) return null;
  const relay = touchRelay(channelId);
  if (!relay) return null;
  const file = path.join(relay.dir, name);
  return fs.existsSync(file) ? file : null;
}

/** Stops relays nobody asked for in the last minute. */
export function sweepRelays(now = Date.now()) {
  for (const relay of [...relays.values()]) if (now - relay.lastSeen > RELAY_IDLE_MS) stopRelay(relay.channelId);
}

export function stopAllRelays() {
  for (const channelId of [...relays.keys()]) stopRelay(channelId);
}

/** Leftovers of a previous run of the server. */
export function clearRelayCache() {
  removeDir(relayRoot);
}
