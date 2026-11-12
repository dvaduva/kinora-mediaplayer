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
    prepared = false;
    pendingSeek = null;
    pendingPlay = false;
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

  /** A refused seek is not fatal: HLS of a growing transcode refuses seeks past the encoded part, and playback goes on. */
  function seekNow(milliseconds: number) {
    const at = session;
    const report = () => {
      if (at === session && open) options.send({ event: "time", session: at, time: seconds(safeTime()), duration: duration() });
    };
    try {
      avplay.seekTo(Math.max(0, Math.round(milliseconds)), report, report);
    } catch {
      report();
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
      options.send({ event: "playing", session });
    } catch {
      options.send({ event: "error", session, code: "play_failed" });
    }
  }

  function load(command: Extract<PlayerCommand, { command: "load" }>) {
    close();
    session = command.session;
    const at = session;
    lastTime = 0;
    pendingSeek = command.start > 0 ? command.start * 1000 : null;
    try {
      avplay.open(command.url);
      open = true;
      setActive(true);
      avplay.setDisplayMethod("PLAYER_DISPLAY_MODE_LETTER_BOX");
      avplay.setDisplayRect(0, 0, SCREEN.width, SCREEN.height);
      avplay.setListener({
        oncurrentplaytime: (milliseconds) => {
          if (at !== session) return;
          const time = now();
          if (time - lastTime < TIME_REPORT_MS) return;
          lastTime = time;
          options.send({ event: "time", session: at, time: seconds(milliseconds), duration: duration() });
        },
        onbufferingcomplete: () => {
          if (at === session && state() === "PLAYING") options.send({ event: "playing", session: at });
        },
        onstreamcompleted: () => {
          if (at !== session) return;
          options.send({ event: "ended", session: at });
          close();
        },
        onerror: (type) => {
          if (at === session) options.send({ event: "error", session: at, code: String(type || "player_error") });
        },
      });
    } catch {
      close();
      options.send({ event: "error", session: at, code: "open_failed" });
      return;
    }
    avplay.prepareAsync(
      () => {
        if (at !== session || !open) return;
        prepared = true;
        if (pendingSeek != null) {
          seekNow(pendingSeek);
          pendingSeek = null;
        }
        options.send({ event: "ready", session: at, duration: duration() });
        options.send({ event: "tracks", session: at, tracks: audioTracks() });
        if (pendingPlay) {
          pendingPlay = false;
          playNow();
        }
      },
      () => {
        if (at !== session) return;
        close();
        options.send({ event: "error", session: at, code: "unsupported" });
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
      if (!prepared) {
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
