import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { SUBTITLE_DELAY_LIMIT } from "@kinora/shared";
import { Focusable } from "../components/Focusable";
import { SubtitleOverlay } from "../components/SubtitleOverlay";
import { useLocale } from "../i18n";
import { remoteAction } from "../remote";
import { playerBackend, type AudioTrackInfo, type PlayerAdapter } from "../player";
import {
  cueStyleSheet,
  formatClock,
  formatDelay,
  hlsUrl,
  reportPlaybackProgress,
  resumeStart,
  setSubtitleDelay,
  shiftCues,
  streamUrl,
  subtitleLabel,
  subtitleUrl,
  usePlaybackView,
  useTranscodeStart,
} from "@kinora/client";

const SEEK_STEP = 10;
const DELAY_STEPS = [-0.5, -0.1, 0.1, 0.5];

export function PlayerPage() {
  const { fileId } = useParams();
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const backend = playerBackend();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<PlayerAdapter | null>(null);
  const [paused, setPaused] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [subsOpen, setSubsOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [delay, setDelay] = useState(0);
  const [audioTracks, setAudioTracks] = useState<AudioTrackInfo[]>([]);
  const audioKey = useRef("");
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
  const setErrorRef = useRef(setError);
  setErrorRef.current = setError;
  const hasView = view != null;

  // One adapter for the page's <video> (rendered once a view is loaded); the effects below hand it a file or an HLS stream.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const player = backend.create(video, {
      onFatal: () => setErrorRef.current("playback_failed"),
      onUnsupported: () => setErrorRef.current("playback_failed"),
    });
    playerRef.current = player;
    return () => {
      player.destroy();
      playerRef.current = null;
    };
  }, [hasView]);

  useEffect(() => {
    if (!fileId) return;
    resumed.current = false;
    subtitleDirty.current = false;
    setSubsOpen(false);
  }, [fileId]);

  const selectedTrack = view?.subtitles.find((track) => track.id === selected && track.textBased && track.available) ?? null;
  const showExternalTrack = Boolean(selectedTrack && selectedTrack.origin !== "embedded");

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !view || view.fileId !== fileId) return;

    const onMeta = () => {
      if (resumed.current || view.plan.mode !== "direct") return;
      resumed.current = true;
      const resume = view.resumeSeconds;
      if (resume > 5 && (!player.duration || resume < player.duration - 5)) player.seek(resume);
      player.play();
    };
    const report = () => reportPlaybackProgress(fileId, player, view, { dirty: subtitleDirty.current, selected, delay: delayRef.current });

    const off = [
      player.on("loadedmetadata", onMeta),
      player.on("pause", report),
      player.on("play", () => setPaused(false)),
      player.on("pause", () => setPaused(true)),
    ];
    const progress = window.setInterval(report, 5000);
    const clock = window.setInterval(() => {
      setPosition(player.currentTime);
      setDuration(player.duration || view.duration || 0);
      const tracks = player.audioTracks();
      const key = tracks.map((track) => `${track.id}${track.enabled ? "*" : ""}`).join(",");
      if (key !== audioKey.current) {
        audioKey.current = key;
        setAudioTracks(tracks);
      }
    }, 500);

    return () => {
      report();
      for (const unsubscribe of off) unsubscribe();
      window.clearInterval(progress);
      window.clearInterval(clock);
    };
  }, [view, fileId, play.started, selected, hasView]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !fileId || !view || view.fileId !== fileId || view.plan.mode !== "direct") return;
    player.load({ kind: "file", url: streamUrl(fileId) });
    return () => player.unload();
  }, [fileId, view, hasView]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !play.started || !fileId || !view || view.fileId !== fileId || view.plan.mode === "direct") return;
    player.load({ kind: "hls", url: hlsUrl(fileId), start: resumeStart(view.resumeSeconds) });
    return () => player.unload();
  }, [play.started, fileId, view, hasView]);

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
    const player = playerRef.current;
    if (!player) return;
    if (player.paused) player.play();
    else player.pause();
    showChrome();
  }

  function setPlaying(playing: boolean) {
    const player = playerRef.current;
    if (!player) return;
    if (playing) player.play();
    else player.pause();
    showChrome();
  }

  function seekBy(delta: number) {
    const player = playerRef.current;
    if (!player || !Number.isFinite(player.duration)) return;
    player.seek(Math.max(0, Math.min(player.duration - 1, player.currentTime + delta)));
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
    const player = playerRef.current;
    if (player && view && fileId) {
      reportPlaybackProgress(fileId, player, view, { dirty: subtitleDirty.current, selected, delay: delayRef.current });
    }
    navigate(-1);
  }

  useEffect(() => {
    showChrome();
    const onKey = (event: KeyboardEvent) => {
      const action = remoteAction(event);
      if (action === "back") {
        event.preventDefault();
        if (subsOpen) {
          setSubsOpen(false);
          return;
        }
        leave();
        return;
      }
      if (action === "stop") {
        event.preventDefault();
        leave();
        return;
      }
      // Media keys work even with the subtitle panel open; arrows and Enter belong to the panel then.
      if (action === "play" || action === "pause" || action === "playPause") {
        event.preventDefault();
        if (action === "playPause") togglePlay();
        else setPlaying(action === "play");
        return;
      }
      if (action === "rewind" || action === "fastForward") {
        event.preventDefault();
        seekBy(action === "rewind" ? -SEEK_STEP : SEEK_STEP);
        return;
      }
      if (subsOpen) return;
      if (event.key === "c" || event.key === "C") {
        event.preventDefault();
        setSubsOpen(true);
        showChrome();
        return;
      }
      if (event.key === "Enter" || event.key === " " || event.key === "k") {
        event.preventDefault();
        togglePlay();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        seekBy(-SEEK_STEP);
        return;
      }
      if (event.key === "ArrowRight") {
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
      {backend.textTracks ? <style>{cueStyleSheet("video.player-video", view.subtitleStyle)}</style> : null}
      <video ref={videoRef} className="player-video" playsInline autoPlay crossOrigin="anonymous">
        {backend.textTracks && showExternalTrack && selectedTrack ? (
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
      {!backend.textTracks ? (
        <SubtitleOverlay
          url={showExternalTrack && selectedTrack ? subtitleUrl(fileId, selectedTrack.id) : null}
          delay={delay}
          style={view.subtitleStyle}
          currentTime={() => playerRef.current?.currentTime ?? 0}
        />
      ) : null}
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
              {audioTracks.length > 1 ? (
                <>
                  <p className="player-subs-title">{t.audioTrack}</p>
                  <div className="player-subs-list">
                    {audioTracks.map((track) => (
                      <Focusable
                        key={track.id}
                        className={track.enabled ? "subs-option is-active" : "subs-option"}
                        focusKey={`audio-${track.id}`}
                        onEnterPress={() => playerRef.current?.selectAudioTrack(track.id)}
                      >
                        {track.label}
                      </Focusable>
                    ))}
                  </div>
                </>
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
