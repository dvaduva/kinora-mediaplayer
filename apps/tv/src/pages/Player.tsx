import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Hls from "hls.js";
import type { PlaybackView, TranscodeStatus } from "@kinora/shared";
import { transcodePlaybackReady } from "@kinora/shared";
import { api, getConnection } from "../api";
import { Focusable } from "../components/Focusable";
import { useLocale } from "../i18n";
import { formatClock, hlsUrl, streamUrl } from "../media";

const SEEK_STEP = 10;

export function PlayerPage() {
  const { fileId } = useParams();
  const { t } = useLocale();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [view, setView] = useState<PlaybackView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [play, setPlay] = useState<{ id: string | undefined; started: boolean; status: TranscodeStatus | null }>({
    id: undefined,
    started: false,
    status: null,
  });
  const [paused, setPaused] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [chromeVisible, setChromeVisible] = useState(true);
  const resumed = useRef(false);
  const hideTimer = useRef(0);

  if (play.id !== fileId) setPlay({ id: fileId, started: false, status: null });

  useEffect(() => {
    if (!fileId) return;
    resumed.current = false;
    api<PlaybackView>(`/api/playback/${fileId}`)
      .then((data) => {
        setView(data);
        setError(null);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [fileId]);

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
    const media = videoRef.current;
    if (!media || !view || view.fileId !== fileId) return;

    const send = () => {
      const reportedDuration = view.plan.mode === "direct" ? media.duration : (view.duration ?? media.duration);
      if (!fileId || !reportedDuration || !Number.isFinite(reportedDuration) || !Number.isFinite(media.currentTime)) return;
      void api("/api/playback/progress", {
        method: "POST",
        body: JSON.stringify({
          fileId,
          position: media.currentTime,
          duration: reportedDuration,
        }),
      }).catch(() => undefined);
    };

    const onMeta = () => {
      if (resumed.current || view.plan.mode !== "direct") return;
      resumed.current = true;
      if (view.resumeSeconds > 5 && (!media.duration || view.resumeSeconds < media.duration - 5)) {
        media.currentTime = view.resumeSeconds;
      }
      void media.play().catch(() => undefined);
    };

    media.addEventListener("loadedmetadata", onMeta);
    media.addEventListener("pause", send);
    media.addEventListener("play", () => setPaused(false));
    media.addEventListener("pause", () => setPaused(true));
    const timer = window.setInterval(send, 5000);
    const clock = window.setInterval(() => {
      setPosition(media.currentTime || 0);
      setDuration(media.duration || view.duration || 0);
    }, 500);

    return () => {
      send();
      media.removeEventListener("loadedmetadata", onMeta);
      media.removeEventListener("pause", send);
      window.clearInterval(timer);
      window.clearInterval(clock);
    };
  }, [view, fileId, play.started]);

  useEffect(() => {
    if (!fileId || !view || view.fileId !== fileId || view.plan.mode !== "direct") return;
    const media = videoRef.current;
    if (!media) return;
    media.src = streamUrl(fileId);
    return () => {
      media.removeAttribute("src");
      media.load();
    };
  }, [fileId, view]);

  useEffect(() => {
    if (!play.started || !fileId || !view || view.fileId !== fileId || view.plan.mode === "direct") return;
    const media = videoRef.current;
    if (!media) return;
    const src = hlsUrl(fileId);
    const start = view.resumeSeconds > 5 ? view.resumeSeconds : 0;
    const token = getConnection().token;

    if (!Hls.isSupported()) {
      if (media.canPlayType("application/vnd.apple.mpegurl")) {
        media.src = src;
        return;
      }
      setError("playback_failed");
      return;
    }

    const hls = new Hls({
      enableWorker: false,
      startPosition: start,
      lowLatencyMode: false,
      backBufferLength: Number.POSITIVE_INFINITY,
      liveSyncDurationCount: 1_000_000,
      xhrSetup: token
        ? (xhr) => {
            xhr.setRequestHeader("Authorization", `Bearer ${token}`);
          }
        : undefined,
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
    };
    const onParsed = () => {
      void media.play().catch(() => undefined);
    };
    media.addEventListener("seeking", onSeeking);
    media.addEventListener("playing", onPlaying);
    hls.on(Hls.Events.MANIFEST_PARSED, onParsed);
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      setError("playback_failed");
    });
    return () => {
      media.removeEventListener("seeking", onSeeking);
      media.removeEventListener("playing", onPlaying);
      hls.destroy();
    };
  }, [play.started, fileId, view]);

  function showChrome() {
    setChromeVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setChromeVisible(false), 4000);
  }

  function togglePlay() {
    const media = videoRef.current;
    if (!media) return;
    if (media.paused) void media.play().catch(() => undefined);
    else media.pause();
    showChrome();
  }

  function seekBy(delta: number) {
    const media = videoRef.current;
    if (!media || !Number.isFinite(media.duration)) return;
    media.currentTime = Math.max(0, Math.min(media.duration - 1, media.currentTime + delta));
    showChrome();
  }

  function leave() {
    const media = videoRef.current;
    if (media && view && fileId) {
      const reportedDuration = view.plan.mode === "direct" ? media.duration : (view.duration ?? media.duration);
      if (reportedDuration && Number.isFinite(reportedDuration)) {
        void api("/api/playback/progress", {
          method: "POST",
          body: JSON.stringify({ fileId, position: media.currentTime, duration: reportedDuration }),
        }).catch(() => undefined);
      }
    }
    navigate(-1);
  }

  useEffect(() => {
    showChrome();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Backspace") {
        event.preventDefault();
        leave();
        return;
      }
      if (event.key === "Enter" || event.key === " " || event.key === "MediaPlayPause" || event.key === "k") {
        event.preventDefault();
        togglePlay();
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "MediaRewind") {
        event.preventDefault();
        seekBy(-SEEK_STEP);
        return;
      }
      if (event.key === "ArrowRight" || event.key === "MediaFastForward") {
        event.preventDefault();
        seekBy(SEEK_STEP);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(hideTimer.current);
    };
    // leave/toggle/seek close over latest view/fileId via refs in practice; deps kept minimal for key binding lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, fileId]);

  if (error) {
    return (
      <div className="player-error">
        <p>
          {t.playbackFailed} ({error}).
        </p>
        <Focusable className="btn" focusOnMount onEnterPress={() => navigate(-1)}>
          {t.back}
        </Focusable>
      </div>
    );
  }

  if (!view || !fileId) return <p className="state-message player-loading">{t.preparing}</p>;
  if (!view.plan.available) {
    return (
      <div className="player-error">
        <p>{view.plan.reasonCode || t.noFile}</p>
        <Focusable className="btn" focusOnMount onEnterPress={() => navigate(-1)}>
          {t.back}
        </Focusable>
      </div>
    );
  }

  const waiting = preparing && !play.started;
  const progress = duration > 0 ? position / duration : 0;

  return (
    <div className="player" onMouseMove={showChrome}>
      <video ref={videoRef} className="player-video" playsInline autoPlay />
      {waiting ? (
        <div className="player-wait">
          <p>{t.preparing}</p>
          {play.status?.progress != null ? <p className="hint">{Math.round(play.status.progress * 100)}%</p> : null}
        </div>
      ) : null}
      <div className={chromeVisible || paused || waiting ? "player-chrome is-visible" : "player-chrome"}>
        <button type="button" className="player-back" onClick={leave}>
          ← {t.back}
        </button>
        <div className="player-meta">
          <h1>{view.title}</h1>
          {view.subtitle ? <p>{view.subtitle}</p> : null}
        </div>
        <div className="player-controls">
          <Focusable className="btn" focusKey="player-seek-back" onEnterPress={() => seekBy(-SEEK_STEP)}>
            −10s
          </Focusable>
          <Focusable className="btn primary" focusKey="player-toggle" focusOnMount onEnterPress={togglePlay}>
            {paused ? t.play : t.pause}
          </Focusable>
          <Focusable className="btn" focusKey="player-seek-fwd" onEnterPress={() => seekBy(SEEK_STEP)}>
            +10s
          </Focusable>
        </div>
        <div className="player-bar">
          <span>{formatClock(position)}</span>
          <div className="player-track">
            <i style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }} />
          </div>
          <span>{formatClock(duration)}</span>
        </div>
      </div>
    </div>
  );
}
