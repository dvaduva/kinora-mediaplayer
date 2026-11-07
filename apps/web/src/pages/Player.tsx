import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Link, useParams } from "react-router-dom";
import Hls from "hls.js";
import type { PlaybackView, TranscodeStatus } from "@kinora/shared";
import { SUBTITLE_DELAY_LIMIT, transcodePlaybackReady } from "@kinora/shared";
import { api } from "../api";
import { embeddedTextTrack, useEmbeddedSubtitles } from "../embeddedSubtitles";
import { useLocale } from "../i18n";
import { codecLabel, formatClock, subtitleLabel } from "../media";
import { cueStyleSheet, formatDelay, setSubtitleDelay, shiftCues } from "../subtitleTiming";

const DELAY_STEPS = [-0.5, -0.1, 0.1, 0.5];

export function PlayerPage() {
  const { fileId } = useParams();
  const { t, locale } = useLocale();
  const [view, setView] = useState<PlaybackView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // `from` is where the conversion stood at the first status, so the bar starts empty and fills toward the start point.
  const [play, setPlay] = useState<{ id: string | undefined; started: boolean; status: TranscodeStatus | null; from: number | null }>({
    id: undefined,
    started: false,
    status: null,
    from: null,
  });
  const [captions, setCaptions] = useState(false);
  const [delay, setDelay] = useState(0);
  const delayRef = useRef(0);
  delayRef.current = delay;
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const videoRef = useCallback((element: HTMLVideoElement | null) => {
    mediaRef.current = element;
    setVideo(element);
  }, []);
  const resumed = useRef(false);
  const subtitleDirty = useRef(false);
  const copyRef = useRef(t);
  copyRef.current = t;
  if (play.id !== fileId) setPlay({ id: fileId, started: false, status: null, from: null });

  useEffect(() => {
    if (!fileId) return;
    resumed.current = false;
    subtitleDirty.current = false;
    setCaptions(false);
    api<PlaybackView>(`/api/playback/${fileId}`)
      .then((data) => {
        setView(data);
        setSelected(data.selectedSubtitleId);
        setDelay(data.subtitleDelay);
        setError(null);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [fileId]);

  const selectedTrack = view && view.fileId === fileId ? (view.subtitles.find((track) => track.id === selected && track.textBased) ?? null) : null;
  const embeddedState = useEmbeddedSubtitles(video, fileId, selectedTrack, selectedTrack ? subtitleLabel(selectedTrack, locale) : "");

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
          if (!cancel) setError(reason.message);
        });
    };
    tick();
    const timer = window.setInterval(tick, 500);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, [fileId, view, preparing, play.started, play.status?.state]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media || !view || view.fileId !== fileId) return;
    const apply = () => {
      if (!(media instanceof HTMLVideoElement)) return;
      // External subtitles are <track> elements with the subtitle id; embedded ones are added by script.
      const embedded = selected ? embeddedTextTrack(media, selected) : undefined;
      for (const track of Array.from(media.textTracks)) {
        track.mode = selected && (track === embedded || track.id === selected) ? "showing" : "disabled";
      }
    };
    const resume = () => {
      if (resumed.current || view.plan.mode !== "direct") return;
      resumed.current = true;
      if (view.resumeSeconds > 5 && (!media.duration || view.resumeSeconds < media.duration - 5)) {
        media.currentTime = view.resumeSeconds;
      }
      apply();
    };
    const send = () => {
      const reportedDuration = view.plan.mode === "direct" ? media.duration : (view.duration ?? media.duration);
      if (!fileId || !reportedDuration || !Number.isFinite(reportedDuration) || !Number.isFinite(media.currentTime)) return;
      void api("/api/playback/progress", {
        method: "POST",
        body: JSON.stringify({
          fileId,
          position: media.currentTime,
          duration: reportedDuration,
          subtitleChoice: subtitleDirty.current ? selected ?? "off" : view.selectedSubtitleId,
          subtitleDelay: delayRef.current,
        }),
      }).catch(() => undefined);
    };
    media.addEventListener("loadedmetadata", resume);
    media.addEventListener("pause", send);
    const timer = window.setInterval(send, 5000);
    apply();
    return () => {
      send();
      media.removeEventListener("loadedmetadata", resume);
      media.removeEventListener("pause", send);
      window.clearInterval(timer);
    };
  }, [view, selected, fileId, play.started, captions, embeddedState]);

  useEffect(() => {
    if (!play.started || !fileId || !view || view.fileId !== fileId || view.plan.mode === "direct") return;
    const media = mediaRef.current;
    if (!(media instanceof HTMLVideoElement)) return;
    const src = `/api/stream/${fileId}/index.m3u8`;
    const start = view.resumeSeconds > 5 ? view.resumeSeconds : 0;
    if (!Hls.isSupported()) {
      if (media.canPlayType("application/vnd.apple.mpegurl")) {
        media.src = src;
        return;
      }
      setError(copyRef.current.playbackFailed);
      return;
    }
    const hls = new Hls({
      enableWorker: false,
      startPosition: start,
      lowLatencyMode: false,
      maxLiveSyncPlaybackRate: 1,
      backBufferLength: Number.POSITIVE_INFINITY,
      // EVENT playlists are live. A long sync window stays on the resume point instead of the transcode edge.
      liveSyncDurationCount: 1_000_000,
    });
    hls.loadSource(src);
    hls.attachMedia(media);
    let corrections = 0;
    const onSeeking = () => {
      if (corrections >= 3 || media.currentTime <= start + 8) return;
      corrections += 1;
      media.currentTime = start;
    };
    const onPlaying = () => {
      corrections = 3;
      setCaptions(true);
    };
    const onParsed = () => {
      void media.play().catch(() => undefined);
    };
    media.addEventListener("seeking", onSeeking);
    media.addEventListener("playing", onPlaying);
    hls.on(Hls.Events.MANIFEST_PARSED, onParsed);
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      setPlay((current) => ({
        ...current,
        status: {
          state: "error",
          seconds: 0,
          duration: view.duration,
          progress: null,
          playlist: true,
          error: copyRef.current.playbackFailed,
        },
      }));
    });
    return () => {
      media.removeEventListener("seeking", onSeeking);
      media.removeEventListener("playing", onPlaying);
      hls.destroy();
    };
  }, [play.started, fileId, view]);

  // Cues of a <track> arrive after it loads, those of embedded subtitles chunk by chunk (shifted by the loader).
  useEffect(() => {
    if (!video) return;
    setSubtitleDelay(video, delay);
    const elements = Array.from(video.querySelectorAll("track"));
    const onLoad = (event: Event) => shiftCues((event.currentTarget as HTMLTrackElement).track, delayRef.current);
    for (const element of elements) element.addEventListener("load", onLoad);
    return () => {
      for (const element of elements) element.removeEventListener("load", onLoad);
    };
  }, [video, delay, selected, captions, play.started]);

  const hasCaption = Boolean(view && view.subtitles.some((track) => track.id === selected && track.textBased));
  const changeDelay = useCallback((step: number | null) => {
    setDelay((current) => {
      if (step === null) return 0;
      const next = Math.round((current + step) * 10) / 10;
      return Math.max(-SUBTITLE_DELAY_LIMIT, Math.min(SUBTITLE_DELAY_LIMIT, next));
    });
  }, []);

  // G and H move the captions earlier and later, as in VLC.
  useEffect(() => {
    if (!hasCaption) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const key = event.key.toLowerCase();
      if (key === "g") changeDelay(-0.1);
      else if (key === "h") changeDelay(0.1);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasCaption, changeDelay]);

  if (error) return <p className="danger">{error}</p>;
  if (!view) {
    return (
      <div className="prepare">
        <p className="muted">{t.play}</p>
        <progress />
      </div>
    );
  }
  const reason = reasonText(view, t.remux, t.transcode, t.missing);
  const textTracks = view.subtitles.filter((track) => track.textBased);
  const caption = textTracks.find((track) => track.id === selected);
  const showCaption = Boolean(caption && caption.origin !== "embedded" && (!preparing || captions));
  const showMedia = !preparing || play.started;
  const startAt = startTarget(view.resumeSeconds);
  const waited = startProgress(play.status, play.from, startAt);
  const percent = waited == null ? "" : `${Math.round(waited * 100)}%`;
  const convertedClock = play.status && play.status.seconds > 0 ? formatClock(play.status.seconds) : null;
  return (
    <article className="player-stage">
      <style>{cueStyleSheet("video.player-video", view.subtitleStyle)}</style>
      <p className="crumb"><Link to="/">{t.home}</Link></p>
      <h1>{view.title}</h1>
      {view.subtitle ? <p className="muted">{view.subtitle}</p> : null}
      {view.plan.available ? (
        view.kind === "track" ? (
          <audio ref={mediaRef as RefObject<HTMLAudioElement>} src={`/api/stream/${view.fileId}`} controls autoPlay />
        ) : (
          <>
            {preparing && !play.started && play.status?.state !== "error" ? (
              <div className="prepare">
                <p>{t.preparing.replace("{progress}", percent).trim()}</p>
                {/* Without a value the bar is indeterminate and still shows that work is going on. */}
                {waited == null ? <progress /> : <progress value={waited} max={1} />}
                {convertedClock ? (
                  <p className="muted">
                    {t.preparingDetail.replace("{at}", convertedClock).replace("{target}", formatClock(startAt) ?? "0:04")}
                  </p>
                ) : null}
              </div>
            ) : null}
            {play.status?.state === "error" ? <p className="danger">{play.status.error || t.transcodeFailed}</p> : null}
            {showMedia ? (
              <video
                className="player-video"
                ref={videoRef}
                src={preparing ? undefined : `/api/stream/${view.fileId}`}
                controls
                autoPlay={!preparing}
                playsInline
                crossOrigin="anonymous"
              >
                {showCaption && caption ? (
                  <track key={caption.id} id={caption.id} kind="subtitles" src={`/api/subtitles/${view.fileId}/${caption.id}`} srcLang={caption.language ?? undefined} label={subtitleLabel(caption, locale)} default />
                ) : null}
              </video>
            ) : null}
          </>
        )
      ) : (
        <div className="unsupported">
          <p>{reason}</p>
        </div>
      )}
      {view.kind !== "track" ? (
        <label className="sub-select">
          {t.subtitles}
          <select
            value={selected ?? "off"}
            onChange={(event) => {
              subtitleDirty.current = true;
              setSelected(event.target.value === "off" ? null : event.target.value);
            }}
          >
            <option value="off">{t.off}</option>
            {view.subtitles.map((track) => (
              <option key={track.id} value={track.id} disabled={!track.available}>
                {subtitleLabel(track, locale)}
              </option>
            ))}
          </select>
          {embeddedState === "loading" ? <span className="muted">{t.loadingSubtitles}</span> : null}
          {embeddedState === "error" ? <span className="danger">{t.subtitlesFailed}</span> : null}
        </label>
      ) : null}
      {view.kind !== "track" && hasCaption ? (
        <div className="sub-delay" role="group" aria-label={t.subtitleDelay}>
          <span>{t.subtitleDelay}</span>
          <div className="sub-delay-controls">
            {DELAY_STEPS.slice(0, 2).map((step) => (
              <button key={step} className="delay-step" type="button" onClick={() => changeDelay(step)}>
                {formatDelay(step, locale)}
              </button>
            ))}
            <output aria-live="polite">{formatDelay(delay, locale)}</output>
            {DELAY_STEPS.slice(2).map((step) => (
              <button key={step} className="delay-step" type="button" onClick={() => changeDelay(step)}>
                {formatDelay(step, locale)}
              </button>
            ))}
            <button className="text-button small" type="button" onClick={() => changeDelay(null)} disabled={delay === 0}>
              {t.reset}
            </button>
          </div>
          <span className="muted">{t.subtitleDelayHelp}</span>
        </div>
      ) : null}
    </article>
  );
}

// Mirrors transcodePlaybackReady: playback starts once the conversion is 4 s past the resume point,
// or with the first segment when starting from the beginning.
function startTarget(resumeSeconds: number) {
  return resumeSeconds > 5 ? resumeSeconds + 4 : 4;
}

function startProgress(status: TranscodeStatus | null, from: number | null, target: number) {
  if (!status || status.state === "error") return null;
  if (status.state === "ready") return 1;
  const base = from ?? 0;
  if (target <= base) return status.playlist ? 1 : null;
  return Math.max(0, Math.min(1, (status.seconds - base) / (target - base)));
}

function reasonText(view: PlaybackView, remux: string, transcode: string, missing: string) {
  const video = codecLabel(view.plan.videoCodec) ?? view.plan.videoCodec ?? "—";
  const audio = codecLabel(view.plan.audioCodec) ?? view.plan.audioCodec ?? "—";
  const container = (view.plan.container ?? "file").toUpperCase();
  const template = view.plan.reasonCode === "remux_required" ? remux : view.plan.reasonCode === "missing" ? missing : transcode;
  return template.replace("{container}", container).replace("{video}", video).replace("{audio}", audio);
}
