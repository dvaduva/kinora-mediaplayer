import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { SUBTITLE_DELAY_LIMIT } from "@kinora/shared";
import { Focusable } from "../components/Focusable";
import { useLocale } from "../i18n";
import {
  attachHls,
  formatClock,
  formatDelay,
  hlsUrl,
  reportPlaybackProgress,
  resumeStart,
  seekToResume,
  setSubtitleDelay,
  shiftCues,
  streamUrl,
  subtitleLabel,
  subtitleUrl,
  usePlaybackView,
  useTranscodeStart,
  watchPlaybackProgress,
} from "@kinora/client";

const SEEK_STEP = 10;
const DELAY_STEPS = [-0.5, -0.1, 0.1, 0.5];

export function PlayerPage() {
  const { fileId } = useParams();
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [paused, setPaused] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [subsOpen, setSubsOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [delay, setDelay] = useState(0);
  const resumed = useRef(false);
  const hideTimer = useRef(0);
  const subtitleDirty = useRef(false);
  const delayRef = useRef(0);
  delayRef.current = delay;

  const { view, error, setError } = usePlaybackView(fileId, (data) => {
    setSelected(data.selectedSubtitleId);
    setDelay(data.subtitleDelay);
  });
  const { preparing, ...play } = useTranscodeStart(fileId, view, setError);

  useEffect(() => {
    if (!fileId) return;
    resumed.current = false;
    subtitleDirty.current = false;
    setSubsOpen(false);
  }, [fileId]);

  const selectedTrack = view?.subtitles.find((track) => track.id === selected && track.textBased && track.available) ?? null;
  const showExternalTrack = Boolean(selectedTrack && selectedTrack.origin !== "embedded");

  useEffect(() => {
    const media = videoRef.current;
    if (!media || !view || view.fileId !== fileId) return;

    const onMeta = () => {
      if (resumed.current || view.plan.mode !== "direct") return;
      resumed.current = true;
      seekToResume(media, view.resumeSeconds);
      void media.play().catch(() => undefined);
    };

    media.addEventListener("loadedmetadata", onMeta);
    const stopProgress = watchPlaybackProgress(media, () =>
      reportPlaybackProgress(fileId, media, view, { dirty: subtitleDirty.current, selected, delay: delayRef.current }),
    );
    media.addEventListener("play", () => setPaused(false));
    media.addEventListener("pause", () => setPaused(true));
    const clock = window.setInterval(() => {
      setPosition(media.currentTime || 0);
      setDuration(media.duration || view.duration || 0);
    }, 500);

    return () => {
      stopProgress();
      media.removeEventListener("loadedmetadata", onMeta);
      window.clearInterval(clock);
    };
  }, [view, fileId, play.started, selected]);

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
    return attachHls(media, hlsUrl(fileId), {
      start: resumeStart(view.resumeSeconds),
      onUnsupported: () => setError("playback_failed"),
      onFatal: () => setError("playback_failed"),
    });
  }, [play.started, fileId, view]);

  useEffect(() => {
    const media = videoRef.current;
    if (!media) return;
    for (const track of Array.from(media.textTracks)) {
      track.mode = selected && track.id === selected ? "showing" : "disabled";
    }
  }, [selected, showExternalTrack, play.started]);

  useEffect(() => {
    const media = videoRef.current;
    if (!media) return;
    setSubtitleDelay(media, delay);
    const elements = Array.from(media.querySelectorAll("track"));
    const onLoad = (event: Event) => shiftCues((event.currentTarget as HTMLTrackElement).track, delayRef.current);
    for (const element of elements) element.addEventListener("load", onLoad);
    return () => {
      for (const element of elements) element.removeEventListener("load", onLoad);
    };
  }, [delay, selected, showExternalTrack, play.started]);

  const showChrome = useCallback(() => {
    setChromeVisible(true);
    window.clearTimeout(hideTimer.current);
    if (!subsOpen) hideTimer.current = window.setTimeout(() => setChromeVisible(false), 4000);
  }, [subsOpen]);

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

  function changeDelay(step: number | null) {
    setDelay((current) => {
      if (step === null) return 0;
      const next = Math.round((current + step) * 10) / 10;
      return Math.max(-SUBTITLE_DELAY_LIMIT, Math.min(SUBTITLE_DELAY_LIMIT, next));
    });
  }

  function leave() {
    const media = videoRef.current;
    if (media && view && fileId) {
      reportPlaybackProgress(fileId, media, view, { dirty: subtitleDirty.current, selected, delay: delayRef.current });
    }
    navigate(-1);
  }

  useEffect(() => {
    showChrome();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Backspace") {
        event.preventDefault();
        if (subsOpen) {
          setSubsOpen(false);
          return;
        }
        leave();
        return;
      }
      if (subsOpen) return;
      if (event.key === "c" || event.key === "C") {
        event.preventDefault();
        setSubsOpen(true);
        showChrome();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, fileId, subsOpen, showChrome]);

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
  const textTracks = view.subtitles.filter((track) => track.textBased);

  return (
    <div
      className="player"
      onMouseMove={showChrome}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest(".player-back, .player-subs, .player-cc, .player-bar")) return;
        if (subsOpen) {
          setSubsOpen(false);
          return;
        }
        togglePlay();
      }}
    >
      <video ref={videoRef} className="player-video" playsInline autoPlay crossOrigin="anonymous">
        {showExternalTrack && selectedTrack ? (
          <track
            key={selectedTrack.id}
            id={selectedTrack.id}
            kind="subtitles"
            src={subtitleUrl(fileId, selectedTrack.id)}
            srcLang={selectedTrack.language ?? undefined}
            label={subtitleLabel(selectedTrack, locale)}
            default
          />
        ) : null}
      </video>
      {waiting ? (
        <div className="player-wait">
          <p>{t.preparing}</p>
          {play.status?.progress != null ? <p className="hint">{Math.round(play.status.progress * 100)}%</p> : null}
        </div>
      ) : null}
      <div className={chromeVisible || waiting || subsOpen ? "player-chrome is-visible" : "player-chrome"}>
        <div className="player-top">
          <Focusable
            className="player-back"
            focusKey="player-back"
            onEnterPress={() => leave()}
          >
            ← {t.back}
          </Focusable>
          <div className="player-meta">
            <h1>{view.title}</h1>
            {view.subtitle ? <p>{view.subtitle}</p> : null}
            {paused ? <p className="player-paused-label">{t.pause}</p> : null}
          </div>
        </div>
        <div className="player-bottom">
          {subsOpen ? (
            <div className="player-subs" role="dialog" aria-label={t.subtitles}>
              <p className="player-subs-title">{t.subtitles}</p>
              <div className="player-subs-list">
                <Focusable
                  className={!selected ? "subs-option is-active" : "subs-option"}
                  focusKey="sub-off"
                  focusOnMount={!selected}
                  onEnterPress={() => {
                    subtitleDirty.current = true;
                    setSelected(null);
                  }}
                >
                  {t.subtitleOff}
                </Focusable>
                {textTracks.map((track) => (
                  <Focusable
                    key={track.id}
                    className={selected === track.id ? "subs-option is-active" : "subs-option"}
                    focusKey={`sub-${track.id}`}
                    focusOnMount={selected === track.id}
                    onEnterPress={() => {
                      if (!track.available || track.origin === "embedded") return;
                      subtitleDirty.current = true;
                      setSelected(track.id);
                    }}
                  >
                    {subtitleLabel(track, locale)}
                    {!track.available || track.origin === "embedded" ? " *" : ""}
                  </Focusable>
                ))}
              </div>
              {selectedTrack && selectedTrack.origin !== "embedded" ? (
                <div className="player-subs-delay">
                  <p className="player-subs-title">{t.subtitleDelay}</p>
                  <div className="player-subs-delay-row">
                    {DELAY_STEPS.slice(0, 2).map((step) => (
                      <Focusable key={step} className="chip" focusKey={`delay-${step}`} onEnterPress={() => changeDelay(step)}>
                        {formatDelay(step, locale)}
                      </Focusable>
                    ))}
                    <output>{formatDelay(delay, locale)}</output>
                    {DELAY_STEPS.slice(2).map((step) => (
                      <Focusable key={step} className="chip" focusKey={`delay-${step}`} onEnterPress={() => changeDelay(step)}>
                        {formatDelay(step, locale)}
                      </Focusable>
                    ))}
                    <Focusable className="chip" focusKey="delay-reset" onEnterPress={() => changeDelay(null)}>
                      {t.reset}
                    </Focusable>
                  </div>
                  <p className="hint">{t.subtitleDelayHelp}</p>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="player-bar-row">
            <Focusable
              className={`player-cc${selected ? " is-on" : ""}`}
              focusKey="player-cc"
              onEnterPress={() => {
                setSubsOpen((open) => !open);
                showChrome();
              }}
            >
              CC
            </Focusable>
            <div className="player-bar">
              <span>{formatClock(position, { hours: true, fallback: "0:00" })}</span>
              <div className="player-track">
                <i style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }} />
              </div>
              <span>{formatClock(duration, { hours: true, fallback: "0:00" })}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
