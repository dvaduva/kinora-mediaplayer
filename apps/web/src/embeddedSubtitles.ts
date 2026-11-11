import { useEffect, useState } from "react";
import type { SubtitleChunk, SubtitleTrack } from "@kinora/shared";
import { api, shiftCues, subtitleDelay } from "@kinora/client";

/** Must match CHUNK_SECONDS on the server. */
const CHUNK_SECONDS = 60;
// A chunk the conversion has not finished yet is asked for again after this long.
const PARTIAL_RETRY_MS = 4000;
const ERROR_RETRY_MS = 10_000;

interface LoadedTrack {
  track: TextTrack;
  seen: Set<string>;
  done: Set<number>;
  retryAt: Map<number, number>;
  inflight: Map<number, AbortController>;
}

// Tracks added with addTextTrack cannot be removed, so each video element keeps one per subtitle.
const loaded = new WeakMap<HTMLMediaElement, Map<string, LoadedTrack>>();

function loadedTrack(media: HTMLMediaElement, id: string, label: string, language: string) {
  let byId = loaded.get(media);
  if (!byId) {
    byId = new Map();
    loaded.set(media, byId);
  }
  let entry = byId.get(id);
  if (!entry) {
    entry = { track: media.addTextTrack("subtitles", label, language), seen: new Set(), done: new Set(), retryAt: new Map(), inflight: new Map() };
    byId.set(id, entry);
  }
  return entry;
}

/** The TextTrack that holds an embedded subtitle's cues on this element, once it has one. */
export function embeddedTextTrack(media: HTMLMediaElement, id: string) {
  return loaded.get(media)?.get(id)?.track;
}

export type EmbeddedState = "idle" | "loading" | "ready" | "error";

/**
 * Feeds an embedded subtitle into the video one window at a time: the window being watched
 * and the next one, asked for again as playback moves or seeks.
 */
export function useEmbeddedSubtitles(media: HTMLVideoElement | null, fileId: string | undefined, caption: SubtitleTrack | null, label: string) {
  const [state, setState] = useState<{ id: string | null; value: EmbeddedState }>({ id: null, value: "idle" });
  const id = caption?.origin === "embedded" && caption.textBased ? caption.id : null;
  const language = caption?.language ?? "";

  useEffect(() => {
    if (!media || !fileId || !id) return;
    const entry = loadedTrack(media, id, label, language);
    entry.track.mode = "showing";
    let cancel = false;
    let cuesShown = entry.seen.size > 0;
    setState({ id, value: entry.done.size > 0 ? "ready" : "loading" });

    const load = (index: number) => {
      if (index < 0 || entry.done.has(index) || entry.inflight.has(index)) return;
      if ((entry.retryAt.get(index) ?? 0) > Date.now()) return;
      if (Number.isFinite(media.duration) && index * CHUNK_SECONDS > media.duration + 1) return;
      const controller = new AbortController();
      entry.inflight.set(index, controller);
      api<SubtitleChunk>(`/api/subtitles/${fileId}/${id}/chunk/${index}`, { signal: controller.signal })
        .then((chunk) => {
          for (const cue of chunk.cues) {
            const key = `${cue.start}|${cue.text}`;
            if (entry.seen.has(key)) continue;
            entry.seen.add(key);
            entry.track.addCue(new VTTCue(cue.start, cue.end, cue.text));
          }
          shiftCues(entry.track, subtitleDelay(media));
          if (chunk.complete) entry.done.add(index);
          else entry.retryAt.set(index, Date.now() + PARTIAL_RETRY_MS);
          cuesShown = true;
          if (!cancel) setState({ id, value: "ready" });
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          entry.retryAt.set(index, Date.now() + ERROR_RETRY_MS);
          if (!cancel && !cuesShown) setState({ id, value: "error" });
        })
        .finally(() => entry.inflight.delete(index));
    };
    const want = () => {
      // With a delay the cues on screen come from earlier or later in the file.
      const index = Math.max(0, Math.floor(((media.currentTime || 0) - subtitleDelay(media)) / CHUNK_SECONDS));
      // Windows away from the playhead are no longer needed; the server stops reading them.
      for (const [other, controller] of entry.inflight) {
        if (other !== index && other !== index + 1) controller.abort();
      }
      load(index);
      // The next window is read only once the current one is in, so it never delays it.
      if (entry.done.has(index)) load(index + 1);
    };
    want();
    media.addEventListener("timeupdate", want);
    media.addEventListener("seeking", want);
    // Partial chunks are retried even while paused.
    const timer = window.setInterval(want, 2000);
    return () => {
      cancel = true;
      for (const controller of entry.inflight.values()) controller.abort();
      entry.track.mode = "disabled";
      media.removeEventListener("timeupdate", want);
      media.removeEventListener("seeking", want);
      window.clearInterval(timer);
    };
  }, [media, fileId, id, label, language]);

  return state.id === id ? state.value : "idle";
}
