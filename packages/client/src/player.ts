import { useCallback, useEffect, useRef, useState } from "react";
import Hls, { type HlsConfig } from "hls.js";
import type { PlaybackView, TranscodeStatus } from "@kinora/shared";
import { transcodePlaybackReady } from "@kinora/shared";
import { api, getApiConfig } from "./api";

/** HLS of a growing transcode: keep everything buffered and stay on the start point, not the live edge. */
export const RESUME_HLS_CONFIG: Partial<HlsConfig> = {
  backBufferLength: Number.POSITIVE_INFINITY,
  // EVENT playlists are live. A long sync window stays on the resume point instead of the transcode edge.
  liveSyncDurationCount: 1_000_000,
};

/** HLS of an IPTV relay: plays at the live edge of its rolling window. */
export const LIVE_EDGE_HLS_CONFIG: Partial<HlsConfig> = {
  backBufferLength: 300,
  liveSyncDurationCount: 3,
};

/**
 * Creates an hls.js player on `media` for `src` and starts playback once the manifest is parsed.
 * The configured API token is sent as a Bearer header; `onFatal` runs on fatal errors.
 */
export function createHls(media: HTMLMediaElement, src: string, config: Partial<HlsConfig>, onFatal: () => void) {
  const token = getApiConfig().token;
  const hls = new Hls({
    enableWorker: false,
    lowLatencyMode: false,
    maxLiveSyncPlaybackRate: 1,
    xhrSetup: token
      ? (xhr) => {
          xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        }
      : undefined,
    ...config,
  });
  hls.loadSource(src);
  hls.attachMedia(media);
  hls.on(Hls.Events.MANIFEST_PARSED, () => void media.play().catch(() => undefined));
  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (data.fatal) onFatal();
  });
  return hls;
}

export type AttachHlsOptions = {
  /** Resume point in seconds (0 from the beginning). */
  start: number;
  /** Fatal hls.js error. */
  onFatal: () => void;
  /** Neither hls.js nor native HLS is available. */
  onUnsupported: () => void;
  /** The media started playing (hls.js only). */
  onPlaying?: () => void;
  /** The hls.js player, once created (not called for native HLS), e.g. for its audio tracks. */
  onHls?: (hls: Hls) => void;
};

/**
 * Plays the HLS stream of a transcode from `start`, natively when hls.js is unsupported.
 * hls.js may jump to the edge of the growing playlist; it is brought back to the start point a few times.
 * Returns the cleanup, if any.
 */
export function attachHls(media: HTMLMediaElement, src: string, options: AttachHlsOptions): (() => void) | undefined {
  const { start } = options;
  if (!Hls.isSupported()) {
    if (media.canPlayType("application/vnd.apple.mpegurl")) {
      media.src = src;
      return;
    }
    options.onUnsupported();
    return;
  }
  const hls = createHls(media, src, { startPosition: start, ...RESUME_HLS_CONFIG }, options.onFatal);
  options.onHls?.(hls);
  let corrections = 0;
  const onSeeking = () => {
    if (corrections >= 3 || media.currentTime <= start + 8) return;
    corrections += 1;
    media.currentTime = start;
  };
  const onPlaying = () => {
    corrections = 3;
    options.onPlaying?.();
  };
  media.addEventListener("seeking", onSeeking);
  media.addEventListener("playing", onPlaying);
  return () => {
    media.removeEventListener("seeking", onSeeking);
    media.removeEventListener("playing", onPlaying);
    hls.destroy();
  };
}

/** Where a transcode starts: the resume point, or the beginning when it is within the first 5 s. */
export function resumeStart(resumeSeconds: number) {
  return resumeSeconds > 5 ? resumeSeconds : 0;
}

/** Seeks a direct file to the resume point unless it is near the beginning or the end. */
export function seekToResume(media: HTMLMediaElement, resumeSeconds: number) {
  if (resumeSeconds > 5 && (!media.duration || resumeSeconds < media.duration - 5)) {
    media.currentTime = resumeSeconds;
  }
}

/** Loads the playback view of a file. `onLoad` runs with each loaded view (e.g. to take its subtitle choice). */
export function usePlaybackView(fileId: string | undefined, onLoad?: (view: PlaybackView) => void) {
  const [view, setView] = useState<PlaybackView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  useEffect(() => {
    if (!fileId) return;
    api<PlaybackView>(`/api/playback/${fileId}`)
      .then((data) => {
        setView(data);
        onLoadRef.current?.(data);
        setError(null);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [fileId]);

  return { view, error, setError };
}

export type TranscodeStart = {
  /** The transcode reached the start point, so the HLS stream can be attached. */
  started: boolean;
  status: TranscodeStatus | null;
  /** Converted seconds at the first status, so a progress bar can start empty. */
  from: number | null;
};

/**
 * Polls the transcode status of a remuxed or transcoded file every 500 ms until playback can start
 * (or the status is an error). `onError` receives failed requests.
 */
export function useTranscodeStart(fileId: string | undefined, view: PlaybackView | null, onError: (message: string) => void) {
  const [play, setPlay] = useState<TranscodeStart & { id: string | undefined }>({ id: undefined, started: false, status: null, from: null });
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  if (play.id !== fileId) setPlay({ id: fileId, started: false, status: null, from: null });

  const preparing = Boolean(view && view.plan.available && view.plan.mode !== "direct");

  useEffect(() => {
    if (!fileId || !view || view.fileId !== fileId || !preparing || play.started || play.status?.state === "error") return;
    let cancel = false;
    const tick = () => {
      api<TranscodeStatus>(`/api/stream/${fileId}/status`)
        .then((data) => {
          if (cancel) return;
          setPlay((current) =>
            current.id !== fileId
              ? current
              : {
                  id: fileId,
                  status: data,
                  from: current.from ?? data.seconds,
                  started: current.started || transcodePlaybackReady(data, view.resumeSeconds),
                },
          );
        })
        .catch((reason: Error) => {
          if (!cancel) onErrorRef.current(reason.message);
        });
    };
    tick();
    const timer = window.setInterval(tick, 500);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, [fileId, view, preparing, play.started, play.status?.state]);

  /** Replaces the status, e.g. with an error when the stream fails. */
  const setStatus = useCallback((status: TranscodeStatus) => setPlay((current) => ({ ...current, status })), []);

  return { preparing, started: play.started, status: play.status, from: play.from, setStatus };
}

export type ProgressSubtitles = {
  /** The viewer changed the subtitle choice; otherwise the view's choice is kept. */
  dirty: boolean;
  selected: string | null;
  delay: number;
};

/** Saves the position (and the subtitle choice and delay) of a file. */
export function reportPlaybackProgress(
  fileId: string | undefined,
  media: Pick<HTMLMediaElement, "currentTime" | "duration">,
  view: PlaybackView,
  subtitles: ProgressSubtitles,
) {
  // A native player may not know (or report) a file's length: the library's duration stands in, so the
  // position still reaches "Continue watching".
  const known = Number.isFinite(media.duration) && media.duration > 0;
  const reportedDuration = view.plan.mode === "direct" ? (known ? media.duration : view.duration) : (view.duration ?? media.duration);
  if (!fileId || !reportedDuration || !Number.isFinite(reportedDuration) || !Number.isFinite(media.currentTime)) return;
  void api("/api/playback/progress", {
    method: "POST",
    body: JSON.stringify({
      fileId,
      position: media.currentTime,
      duration: reportedDuration,
      subtitleChoice: subtitles.dirty ? subtitles.selected ?? "off" : view.selectedSubtitleId,
      subtitleDelay: subtitles.delay,
    }),
  }).catch(() => undefined);
}

/** Runs `report` every 5 s and on pause, and once more on cleanup. */
export function watchPlaybackProgress(media: HTMLMediaElement, report: () => void) {
  media.addEventListener("pause", report);
  const timer = window.setInterval(report, 5000);
  return () => {
    report();
    media.removeEventListener("pause", report);
    window.clearInterval(timer);
  };
}
