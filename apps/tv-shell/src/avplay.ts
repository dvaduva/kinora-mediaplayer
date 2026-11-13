import type { BridgeAudioTrack, PlayerCommand, PlayerReport } from "@kinora/shared";

/**
 * Samsung's native player, driven for the TV UI in the frame (see `PlayerCommand` in @kinora/shared).
 * AVPlay draws the picture on a video plane under the web page: wherever the page is transparent the
 * video shows, so the shell and the UI clear their backgrounds while it plays (`onActive`).
 *
 * The AVPlay object is passed in, so tests run it against a fake.
 */

type TrackInfo = { index: number; type: string; extra_info?: string };

export interface AvplayListener {
  onbufferingstart?: () => void;
  onbufferingprogress?: (percent: number) => void;
  onbufferingcomplete?: () => void;
  oncurrentplaytime?: (milliseconds: number) => void;
  onstreamcompleted?: () => void;
  onevent?: (type: string, data: string) => void;
  onerror?: (type: string) => void;
}

export interface Avplay {
  open(url: string): void;
  close(): void;
  stop(): void;
  prepareAsync(success: () => void, failure: (error: unknown) => void): void;
  play(): void;
  pause(): void;
  seekTo(milliseconds: number, success?: () => void, failure?: (error: unknown) => void): void;
  /** NONE, IDLE, READY, PLAYING, PAUSED. */
  getState(): string;
  getDuration(): number;
  getCurrentTime(): number;
  setListener(listener: AvplayListener): void;
  setDisplayRect(x: number, y: number, width: number, height: number): void;
  setDisplayMethod(method: string): void;
  getTotalTrackInfo(): TrackInfo[];
  getCurrentStreamInfo(): TrackInfo[];
  setSelectTrack(type: string, index: number): void;
  suspend?(): void;
  restore?(): void;
  /** How much AVPlay buffers before it starts ("PLAYER_BUFFER_FOR_PLAY") or resumes after a stall; IDLE state only. */
  setBufferingParam?(type: string, unit: string, amount: number): void;
}

export interface AvplayOptions {
  send: (report: PlayerReport) => void;
  /** True while a source is open: the shell and the UI must let the video plane show through. */
  onActive?: (active: boolean) => void;
  now?: () => number;
}

/** AVPlay's display rectangle is in a 1920×1080 space whatever the page's resolution. */
const SCREEN = { width: 1920, height: 1080 };
const TIME_REPORT_MS = 250;
/**
 * Seconds of picture AVPlay holds before it starts and after a stall. Its default fills a large byte buffer
 * first, which for a high-bitrate file from a network share is a long black screen.
 */
const START_BUFFER_SECONDS = 3;
const RESUME_BUFFER_SECONDS = 6;
/** Some firmware never answers a seek (before the first play, on a file without an index): carry on without it. */
const SEEK_TIMEOUT_MS = 5000;
/** While a source has not started, AVPlay's state is logged this often. */
const WATCH_MS = 3000;

function describe(error: unknown) {
  if (error && typeof error === "object") {
    const record = error as { name?: unknown; message?: unknown; code?: unknown };
    return [record.name, record.code, record.message].filter((part) => part != null && part !== "").join(" ") || String(error);
  }
  return String(error);
}

function seconds(milliseconds: number) {
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds / 1000 : 0;
}

function parseExtra(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const CODEC_NAMES: Record<string, string> = { "ac-3": "AC-3", ac3: "AC-3", "ec-3": "E-AC-3", eac3: "E-AC-3", aac: "AAC", mp3: "MP3", mpga: "MP3", opus: "Opus", vorbis: "Vorbis", dts: "DTS", pcm: "PCM" };

/** "eng · AC-3 5.1", from AVPlay's extra_info ({ language, fourCC, channels, … }). */
export function audioTrackLabel(extra: Record<string, unknown>, position: number) {
  const language = typeof extra.language === "string" && extra.language && extra.language !== "und" ? extra.language : null;
  const fourCC = typeof extra.fourCC === "string" ? extra.fourCC.trim().toLowerCase() : "";
  const codec = fourCC ? CODEC_NAMES[fourCC] ?? fourCC.toUpperCase() : null;
  const count = Number(extra.channels);
  const channels = count === 6 ? "5.1" : count === 8 ? "7.1" : count === 2 ? "2.0" : count === 1 ? "1.0" : null;
  const detail = [codec, channels].filter(Boolean).join(" ");
  const parts = [language, detail].filter(Boolean);
  return parts.length ? parts.join(" · ") : String(position);
}

export function createAvplayController(avplay: Avplay, options: AvplayOptions) {
  const now = options.now ?? (() => Date.now());
  let session = -1;
  let open = false;
  let prepared = false;
  let pendingSeek: number | null = null;
  let pendingPlay = false;
  let lastTime = 0;
  let suspended = false;
  /** A seek AVPlay has not answered yet; AVPlay refuses a second seek, or play(), meanwhile. */
  let seeking = false;
  let queuedSeek: number | null = null;
  let watch: ReturnType<typeof setInterval> | null = null;
  let opened = 0;

  function log(message: string) {
    options.send({ event: "log", session, message: `[${((now() - opened) / 1000).toFixed(1)}s] ${message}` });
  }

  function stopWatch() {
    if (watch != null) clearInterval(watch);
    watch = null;
  }

  function state() {
    try {
      return avplay.getState();
    } catch {
      return "NONE";
    }
  }

  function duration() {
    let value = 0;
    try {
      value = avplay.getDuration();
    } catch {
      value = 0;
    }
    return value > 0 ? value / 1000 : Number.NaN;
  }

  function audioTracks(): BridgeAudioTrack[] {
    let all: TrackInfo[] = [];
    let current: TrackInfo[] = [];
    try {
      all = avplay.getTotalTrackInfo() || [];
      current = avplay.getCurrentStreamInfo() || [];
    } catch {
      return [];
    }
    const selected = current.find((track) => track.type === "AUDIO");
    return all
      .filter((track) => track.type === "AUDIO")
      .map((track, position) => {
        const extra = parseExtra(track.extra_info);
        return {
          id: String(track.index),
          language: typeof extra.language === "string" && extra.language && extra.language !== "und" ? extra.language : null,
          label: audioTrackLabel(extra, position + 1),
          enabled: selected ? selected.index === track.index : position === 0,
        };
      });
  }

  function setActive(active: boolean) {
    options.onActive?.(active);
  }

  function close() {
    if (!open) return;
    open = false;
    stopWatch();
    log("close");
    prepared = false;
    pendingSeek = null;
    pendingPlay = false;
    seeking = false;
    queuedSeek = null;
    try {
      avplay.stop();
    } catch {
      // already stopped
    }
    try {
      avplay.close();
    } catch {
      // already closed
    }
    setActive(false);
  }

  /**
   * A refused seek is not fatal: HLS of a growing transcode refuses seeks past the encoded part, and playback goes on.
   * One seek at a time: presses of → while one runs are folded into the last target, sent when it is done.
   */
  function seekNow(milliseconds: number) {
    if (seeking) {
      queuedSeek = milliseconds;
      return;
    }
    const at = session;
    seeking = true;
    let answered = false;
    log(`seek ${Math.round(milliseconds)}ms`);
    const timer = setTimeout(() => done("timeout"), SEEK_TIMEOUT_MS);
    function done(how: string) {
      if (answered) return;
      answered = true;
      log(`seek ${how}, state ${state()}`);
      clearTimeout(timer);
      if (at !== session || !open) return;
      seeking = false;
      if (queuedSeek != null) {
        const next = queuedSeek;
        queuedSeek = null;
        seekNow(next);
        return;
      }
      options.send({ event: "time", session: at, time: seconds(safeTime()), duration: duration() });
      if (pendingPlay) {
        pendingPlay = false;
        playNow();
      }
    }
    try {
      avplay.seekTo(
        Math.max(0, Math.round(milliseconds)),
        () => done("done"),
        (error) => done(`failed ${describe(error)}`),
      );
    } catch (error) {
      done(`threw ${describe(error)}`);
    }
  }

  function safeTime() {
    try {
      return avplay.getCurrentTime();
    } catch {
      return 0;
    }
  }

  function playNow() {
    try {
      avplay.play();
      log(`play, state ${state()}`);
      options.send({ event: "playing", session });
    } catch (error) {
      log(`play threw ${describe(error)}, state ${state()}`);
      options.send({ event: "error", session, code: "play_failed" });
    }
  }

  function load(command: Extract<PlayerCommand, { command: "load" }>) {
    close();
    session = command.session;
    const at = session;
    lastTime = 0;
    pendingSeek = command.start > 0 ? command.start * 1000 : null;
    opened = now();
    log(`open ${command.kind} ${command.url.replace(/token=[^&]+/, "token=…")}`);
    try {
      avplay.open(command.url);
      open = true;
      setActive(true);
      avplay.setDisplayMethod("PLAYER_DISPLAY_MODE_LETTER_BOX");
      avplay.setDisplayRect(0, 0, SCREEN.width, SCREEN.height);
      try {
        avplay.setBufferingParam?.("PLAYER_BUFFER_FOR_PLAY", "PLAYER_BUFFER_SIZE_IN_SECOND", START_BUFFER_SECONDS);
        avplay.setBufferingParam?.("PLAYER_BUFFER_FOR_RESUME", "PLAYER_BUFFER_SIZE_IN_SECOND", RESUME_BUFFER_SECONDS);
      } catch (error) {
        // Older firmware: AVPlay's own buffer sizes.
        log(`setBufferingParam threw ${describe(error)}`);
      }
      avplay.setListener({
        oncurrentplaytime: (milliseconds) => {
          if (at !== session) return;
          stopWatch();
          const time = now();
          if (time - lastTime < TIME_REPORT_MS) return;
          lastTime = time;
          options.send({ event: "time", session: at, time: seconds(milliseconds), duration: duration() });
        },
        onbufferingstart: () => {
          if (at === session) log("buffering start");
          if (at === session) options.send({ event: "buffering", session: at, percent: 0 });
        },
        onbufferingprogress: (percent) => {
          if (at === session) options.send({ event: "buffering", session: at, percent: Number(percent) || 0 });
        },
        onbufferingcomplete: () => {
          if (at !== session) return;
          log(`buffering complete, state ${state()}`);
          options.send({ event: "buffering", session: at, percent: null });
          if (state() === "PLAYING") options.send({ event: "playing", session: at });
        },
        onstreamcompleted: () => {
          if (at !== session) return;
          options.send({ event: "ended", session: at });
          close();
        },
        onevent: (type, data) => {
          if (at === session) log(`event ${type} ${data ?? ""}`);
        },
        onerror: (type) => {
          if (at === session) log(`error ${type}`);
          if (at === session) options.send({ event: "error", session: at, code: String(type || "player_error") });
        },
      });
    } catch (error) {
      log(`open threw ${describe(error)}`);
      close();
      options.send({ event: "error", session: at, code: "open_failed" });
      return;
    }
    watch = setInterval(() => {
      if (at === session && open) log(`waiting, state ${state()}, prepared ${prepared}, seeking ${seeking}, play ${pendingPlay}, time ${safeTime()}`);
    }, WATCH_MS);
    // Only a diagnostic: it must not keep a test process (Node) alive.
    (watch as { unref?: () => void }).unref?.();
    log("prepareAsync");
    avplay.prepareAsync(
      () => {
        if (at !== session || !open) return;
        prepared = true;
        log(`prepared, state ${state()}, duration ${duration()}s, play ${pendingPlay}`);
        if (pendingSeek != null) {
          seekNow(pendingSeek);
          pendingSeek = null;
        }
        options.send({ event: "ready", session: at, duration: duration() });
        options.send({ event: "tracks", session: at, tracks: audioTracks() });
        // While the start seek runs, play() waits for it (seekNow plays when it is done).
        if (pendingPlay && !seeking) {
          pendingPlay = false;
          playNow();
        }
      },
      (error) => {
        if (at !== session) return;
        log(`prepare failed ${describe(error)}`);
        close();
        options.send({ event: "error", session: at, code: `unsupported ${describe(error)}`.trim() });
      },
    );
  }

  function handle(command: PlayerCommand) {
    if (command.command === "capabilities") return;
    if (command.command === "load") return load(command);
    // A command for a source that has since been replaced does nothing.
    if (command.session !== session || !open) return;
    if (command.command === "unload") return close();
    if (command.command === "play") {
      log(`play asked, prepared ${prepared}, seeking ${seeking}, state ${state()}`);
      if (!prepared || seeking) {
        pendingPlay = true;
        return;
      }
      if (state() !== "PLAYING") playNow();
      return;
    }
    if (command.command === "pause") {
      pendingPlay = false;
      if (!prepared) return;
      try {
        avplay.pause();
        options.send({ event: "paused", session });
      } catch {
        // not playing yet
      }
      return;
    }
    if (command.command === "seek") {
      if (!prepared) {
        pendingSeek = command.seconds * 1000;
        return;
      }
      return seekNow(command.seconds * 1000);
    }
    if (command.command === "audio") {
      const index = Number(command.id);
      if (!Number.isInteger(index)) return;
      try {
        avplay.setSelectTrack("AUDIO", index);
      } catch {
        // the track went away
      }
      options.send({ event: "tracks", session, tracks: audioTracks() });
    }
  }

  /** The TV app went to the background (Home, another source) and back; AVPlay must let go of the decoder meanwhile. */
  function visibility(hidden: boolean) {
    if (!open) return;
    try {
      if (hidden && !suspended) {
        avplay.suspend?.();
        suspended = true;
      } else if (!hidden && suspended) {
        avplay.restore?.();
        suspended = false;
      }
    } catch {
      suspended = false;
    }
  }

  return {
    handle,
    visibility,
    /** Stops whatever is playing: the shell is leaving the UI (offline, pairing, server list). */
    stop: close,
    get active() {
      return open;
    },
  };
}

export type AvplayController = ReturnType<typeof createAvplayController>;
