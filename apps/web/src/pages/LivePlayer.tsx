import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Hls from "hls.js";
import type { LiveChannel, LivePlayback, TranscodeStatus } from "@kinora/shared";
import { transcodePlaybackReady } from "@kinora/shared";
import { api } from "../api";
import { useAudio } from "../audio";
import { useLocale } from "../i18n";
import { ChannelLogo, clockTime, FavoriteButton, programProgress, serverNow, syncClock, useNow } from "../liveTv";
import { formatClock, imageUrl } from "../media";
import { Icon } from "../ui";
import { LiveMusicVisual, MiniGuide, useMediaAnalyser } from "./LiveExtras";

/** Within this many seconds of the live point, playback counts as live. */
const LIVE_SLACK = 15;
const SEEK_STEP = 10;
const BANNER_MS = 5000;
const CHROME_MS = 3000;

function programSeconds(session: LivePlayback) {
  return (session.program.end - session.program.start) / 1000;
}

/** Seconds into the program that are airing right now. */
function liveSeconds(session: LivePlayback) {
  return Math.min(programSeconds(session), Math.max(0, (serverNow() - session.program.start) / 1000));
}

export function LivePlayerPage() {
  const { channelId } = useParams();
  const navigate = useNavigate();
  const { t, locale } = useLocale();
  const [channels, setChannels] = useState<LiveChannel[] | null>(null);
  const [session, setSession] = useState<LivePlayback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [position, setPosition] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [banner, setBanner] = useState(true);
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const tuning = useRef(0);
  /** Fatal stream errors on this channel; the first few re-tune instead of giving up. */
  const retries = useRef(0);
  const copy = useRef(t);
  copy.current = t;
  const [miniGuide, setMiniGuide] = useState(false);
  const miniGuideOpen = useRef(false);
  miniGuideOpen.current = miniGuide;
  /** Stars toggled in this player, per channel, ahead of the next fetch. */
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  const audio = useAudio();

  // Live TV takes over the sound: music playing elsewhere in the app stops.
  useEffect(() => {
    audio.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api<LiveChannel[]>("/api/livetv/channels")
      .then((list) => setChannels(list.filter((channel) => channel.enabled && !channel.empty)))
      .catch(() => setChannels([]));
  }, []);

  const flashBanner = useCallback(() => setBanner(true), []);
  useEffect(() => {
    if (!banner) return;
    const timer = window.setTimeout(() => setBanner(false), BANNER_MS);
    return () => window.clearTimeout(timer);
  }, [banner, session]);

  const showChrome = useCallback(() => setChrome(true), []);
  useEffect(() => {
    if (!chrome || paused) return;
    const timer = window.setTimeout(() => setChrome(false), CHROME_MS);
    return () => window.clearTimeout(timer);
  }, [chrome, paused, position]);

  /** Asks the server what airs now (or from `after` on) and switches to it. */
  const tune = useCallback((id: string, after?: number) => {
    const token = ++tuning.current;
    setStarted(false);
    setError(null);
    const sentAt = Date.now();
    api<LivePlayback>(`/api/livetv/channels/${id}/play`, { method: "POST", body: JSON.stringify(after ? { after } : {}) })
      .then((data) => {
        if (token !== tuning.current) return;
        syncClock(data.now, sentAt);
        setSession(data);
        setPosition(data.offset);
      })
      .catch((reason: Error) => {
        if (token !== tuning.current) return;
        setSession(null);
        setError(reason.message === "channel_empty" ? copy.current.liveChannelEmpty : reason.message === "not_found" ? copy.current.liveChannelGone : reason.message);
      });
  }, []);

  useEffect(() => {
    if (!channelId) return;
    retries.current = 0;
    tune(channelId);
    flashBanner();
  }, [channelId, tune, flashBanner]);

  // Starts the stream of a session: a direct file seeks to the live point, HLS waits for its conversion first.
  useEffect(() => {
    const media = video.current;
    if (!session || !media) return;
    let cancelled = false;
    let hls: Hls | null = null;
    let timer = 0;
    let corrections = 0;
    let target = 0;
    const onMeta = () => {
      media.currentTime = target;
      void media.play().catch(() => undefined);
    };
    // hls.js may jump to the live edge of the growing playlist; bring it back to the start point a few times.
    const onSeeking = () => {
      if (session.mode !== "hls" || corrections >= 3 || media.currentTime <= target + 8) return;
      corrections += 1;
      media.currentTime = target;
    };
    const onPlaying = () => {
      corrections = 3;
    };
    /** `at` is program time; a conversion that is still catching up starts a little behind live. */
    const begin = (at = liveSeconds(session)) => {
      if (cancelled) return;
      target = Math.max(0, at - session.mediaStart);
      media.addEventListener("seeking", onSeeking);
      media.addEventListener("playing", onPlaying);
      if (session.mode === "direct" || !Hls.isSupported()) {
        if (session.mode === "hls" && !media.canPlayType("application/vnd.apple.mpegurl")) {
          setError(copy.current.playbackFailed);
          return;
        }
        media.addEventListener("loadedmetadata", onMeta, { once: true });
        media.src = session.src;
      } else {
        hls = new Hls({
          enableWorker: false,
          startPosition: target,
          lowLatencyMode: false,
          maxLiveSyncPlaybackRate: 1,
          backBufferLength: Number.POSITIVE_INFINITY,
          liveSyncDurationCount: 1_000_000,
        });
        hls.loadSource(session.src);
        hls.attachMedia(media);
        hls.on(Hls.Events.MANIFEST_PARSED, () => void media.play().catch(() => undefined));
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal || cancelled) return;
          // The conversion may have been replaced (another viewer, a server restart): ask again where live is.
          if (retries.current < 3 && channelId) {
            retries.current += 1;
            tune(channelId);
          } else setError(copy.current.playbackFailed);
        });
      }
      setStarted(true);
    };
    if (session.mode === "direct" || !session.statusUrl) {
      begin();
    } else {
      const poll = () => {
        api<TranscodeStatus>(session.statusUrl!)
          .then((status) => {
            if (cancelled) return;
            if (status.state === "error") {
              setError(status.error || copy.current.transcodeFailed);
              return;
            }
            const live = liveSeconds(session);
            if (transcodePlaybackReady(status, live)) begin(live);
            // Waiting for the encoder to pass a moving live point can take long; start with what is ready.
            else if (status.playlist && status.seconds >= session.mediaStart + 8) begin(Math.min(live, status.seconds - 4));
            else timer = window.setTimeout(poll, 500);
          })
          .catch(() => {
            if (!cancelled) timer = window.setTimeout(poll, 1500);
          });
      };
      poll();
    }
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      media.removeEventListener("loadedmetadata", onMeta);
      media.removeEventListener("seeking", onSeeking);
      media.removeEventListener("playing", onPlaying);
      hls?.destroy();
      media.pause();
      media.removeAttribute("src");
      media.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Keeps the position, holds playback behind the live point, and moves on when the program ends.
  useEffect(() => {
    const media = video.current;
    if (!session || !media) return;
    let advanced = false;
    const advance = () => {
      if (advanced || !channelId) return;
      advanced = true;
      tune(channelId, session.program.end);
      flashBanner();
    };
    const onTime = () => {
      // Nothing loaded yet (still tuning): keep the offset the server reported.
      if (media.readyState === HTMLMediaElement.HAVE_NOTHING) return;
      const at = session.mediaStart + media.currentTime;
      const live = liveSeconds(session);
      if (at > live + 3 && !media.seeking) {
        media.currentTime = Math.max(0, live - session.mediaStart);
        return;
      }
      setPosition(at);
      if (at >= programSeconds(session) - 0.25) advance();
    };
    const onPlayState = () => setPaused(media.paused);
    const onVolume = () => setMuted(media.muted);
    media.addEventListener("timeupdate", onTime);
    media.addEventListener("ended", advance);
    media.addEventListener("play", onPlayState);
    media.addEventListener("pause", onPlayState);
    media.addEventListener("volumechange", onVolume);
    // A program can also end while its stream is still being prepared.
    const timer = window.setInterval(() => {
      if (media.readyState === HTMLMediaElement.HAVE_NOTHING && liveSeconds(session) >= programSeconds(session)) advance();
    }, 2000);
    return () => {
      media.removeEventListener("timeupdate", onTime);
      media.removeEventListener("ended", advance);
      media.removeEventListener("play", onPlayState);
      media.removeEventListener("pause", onPlayState);
      media.removeEventListener("volumechange", onVolume);
      window.clearInterval(timer);
    };
  }, [session, channelId, tune, flashBanner]);

  const seekTo = useCallback(
    (programTime: number) => {
      const media = video.current;
      if (!session || !media || !started) return;
      const clamped = Math.max(session.mediaStart, Math.min(liveSeconds(session), programTime));
      media.currentTime = clamped - session.mediaStart;
    },
    [session, started],
  );

  /** Relative to where the video actually is, so quick repeated presses add up. */
  const seekBy = useCallback(
    (step: number) => {
      const media = video.current;
      if (session && media) seekTo(session.mediaStart + media.currentTime + step);
    },
    [session, seekTo],
  );

  const goLive = useCallback(() => {
    if (!session) return;
    seekTo(liveSeconds(session));
    void video.current?.play().catch(() => undefined);
  }, [session, seekTo]);

  const togglePlay = useCallback(() => {
    const media = video.current;
    if (!media) return;
    if (media.paused) void media.play().catch(() => undefined);
    else media.pause();
  }, []);

  const zap = useCallback(
    (step: 1 | -1) => {
      if (!channels || channels.length === 0) return;
      const index = channels.findIndex((channel) => channel.id === channelId);
      const next = channels[(index + step + channels.length) % channels.length];
      if (next && next.id !== channelId) navigate(`/live/${next.id}`, { replace: true });
    },
    [channels, channelId, navigate],
  );

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void stage.current?.requestFullscreen().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const key = event.key;
      // The quick guide handles its own keys (and closes on Escape or g).
      if (miniGuideOpen.current) return;
      if (key === "g") setMiniGuide(true);
      else if (key === "ArrowUp" || key === "PageUp") zap(1);
      else if (key === "ArrowDown" || key === "PageDown") zap(-1);
      else if (key === "ArrowLeft") seekBy(-SEEK_STEP);
      else if (key === "ArrowRight") seekBy(SEEK_STEP);
      else if (key === " " || key === "k") togglePlay();
      else if (key === "m" && video.current) video.current.muted = !video.current.muted;
      else if (key === "f") toggleFullscreen();
      else if (key === "l") goLive();
      else if (key === "i") flashBanner();
      else return;
      event.preventDefault();
      showChrome();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zap, seekBy, togglePlay, toggleFullscreen, goLive, flashBanner, showChrome]);

  // The live point keeps moving while paused; redraw the bar and the "behind" time every second.
  useNow(1000);
  const baseChannel = session?.channel ?? channels?.find((entry) => entry.id === channelId) ?? null;
  const channel = baseChannel && baseChannel.id in favorites ? { ...baseChannel, favorite: favorites[baseChannel.id]! } : baseChannel;
  const onFavorite = (favorite: boolean) => {
    if (channel) setFavorites((current) => ({ ...current, [channel.id]: favorite }));
  };
  const music = session?.program.itemType === "track";
  const analyser = useMediaAnalyser(video, music);
  const duration = session ? programSeconds(session) : 0;
  const live = session ? liveSeconds(session) : 0;
  const behind = Math.max(0, live - position);
  const atLive = !started || behind < LIVE_SLACK;

  const onBarPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    const box = event.currentTarget.getBoundingClientRect();
    seekTo(((event.clientX - box.left) / box.width) * duration);
  };

  return (
    <div className="live-player">
      <p className="crumb">
        <Link to="/live">{t.liveGuide}</Link>
      </p>
      <div
        ref={stage}
        className={`live-stage${chrome || paused ? " show-chrome" : ""}`}
        onPointerMove={showChrome}
        onPointerDown={showChrome}
      >
        <video ref={video} className="live-video" playsInline autoPlay onClick={togglePlay} onDoubleClick={toggleFullscreen} />
        {session && music && started ? <LiveMusicVisual analyser={analyser} cover={imageUrl(session.program.image)} /> : null}
        {!started && !error ? (
          <div className="live-tuning">
            {channel ? <ChannelLogo channel={channel} className="large" /> : null}
            <p>{t.liveTuning}</p>
            <progress />
          </div>
        ) : null}
        {error ? (
          <div className="live-tuning">
            <p className="danger">{error}</p>
            <Link className="secondary-button" to="/live">{t.liveGuide}</Link>
          </div>
        ) : null}
        {session && (banner || chrome || paused) && !miniGuide ? <LiveBanner session={session} t={t} locale={locale} /> : null}
        {miniGuide ? (
          <MiniGuide
            currentId={channelId}
            t={t}
            locale={locale}
            onClose={() => setMiniGuide(false)}
            onPick={(picked) => {
              setMiniGuide(false);
              if (picked.id !== channelId) navigate(`/live/${picked.id}`, { replace: true });
            }}
          />
        ) : null}
        <button className="live-zap up" type="button" onClick={() => zap(1)} aria-label={t.liveChannelUp} title={t.liveChannelUp}>
          <Icon name="up" />
        </button>
        <button className="live-zap down" type="button" onClick={() => zap(-1)} aria-label={t.liveChannelDown} title={t.liveChannelDown}>
          <Icon name="down" />
        </button>
        <div className="live-controls">
          <div
            className="live-bar"
            role="slider"
            tabIndex={0}
            aria-label={session?.program.title ?? t.liveTv}
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(position)}
            aria-valuetext={`${formatClock(position) ?? "0:00"} / ${formatClock(duration) ?? "0:00"}`}
            onPointerDown={onBarPointer}
          >
            <span className="live-bar-aired" style={{ width: `${duration ? (live / duration) * 100 : 0}%` }} />
            <span className="live-bar-played" style={{ width: `${duration ? (position / duration) * 100 : 0}%` }} />
            <span className="live-bar-head" style={{ left: `${duration ? (position / duration) * 100 : 0}%` }} />
          </div>
          <div className="live-buttons">
            <button type="button" onClick={togglePlay} aria-label={paused ? t.play : t.livePause} title={paused ? t.play : t.livePause}>
              <Icon name={paused ? "play" : "pause"} />
            </button>
            <button type="button" onClick={() => seekBy(-SEEK_STEP)} aria-label={t.liveRewind} title={t.liveRewind}>
              <Icon name="rewind" />
            </button>
            <button type="button" onClick={() => seekBy(SEEK_STEP)} aria-label={t.liveForward} title={t.liveForward} disabled={atLive}>
              <Icon name="forward" />
            </button>
            <span className="live-clock">
              {formatClock(position) ?? "0:00"} / {formatClock(duration) ?? "0:00"}
            </span>
            {atLive ? (
              <span className="live-badge">{t.liveBadge}</span>
            ) : (
              <button type="button" className="live-back" onClick={goLive}>
                {t.liveBackToLive} <small>−{formatClock(behind)}</small>
              </button>
            )}
            <span className="live-spacer" />
            {channel ? <FavoriteButton channel={channel} t={t} onChange={onFavorite} /> : null}
            <button type="button" onClick={() => setMiniGuide((open) => !open)} aria-label={t.liveMiniGuide} title={`${t.liveMiniGuide} (G)`} aria-pressed={miniGuide}>
              <Icon name="guide" />
            </button>
            <button
              type="button"
              onClick={() => {
                if (video.current) video.current.muted = !video.current.muted;
              }}
              aria-label={muted ? t.liveUnmute : t.liveMute}
              title={muted ? t.liveUnmute : t.liveMute}
            >
              <Icon name={muted ? "muted" : "volume"} />
            </button>
            <button type="button" onClick={toggleFullscreen} aria-label={t.liveFullscreen} title={t.liveFullscreen}>
              <Icon name="fullscreen" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LiveBanner(props: { session: LivePlayback; t: ReturnType<typeof useLocale>["t"]; locale: ReturnType<typeof useLocale>["locale"] }) {
  const { session, t, locale } = props;
  const now = useNow(5000);
  const { channel, program, next } = session;
  const left = Math.max(0, Math.round((program.end - now) / 60_000));
  return (
    <div className="live-banner">
      <ChannelLogo channel={channel} className="large" />
      <div className="live-banner-text">
        <p className="live-banner-channel">
          <span className="guide-channel-number">{channel.number}</span> {channel.name}
        </p>
        <p className="live-banner-now">
          <em>{t.liveNow}</em> <strong>{program.title}</strong>
          {program.subtitle ? <span className="muted"> · {program.subtitle}</span> : null}
        </p>
        <div className="live-banner-progress">
          <span>{clockTime(program.start, locale)}</span>
          <span className="meter small"><span style={{ width: `${programProgress(program, now) * 100}%` }} /></span>
          <span>{clockTime(program.end, locale)}</span>
          <small className="muted">{t.liveMinutesLeft.replace("{min}", String(left))}</small>
        </div>
        {next ? (
          <p className="live-banner-next muted">
            <em>{t.liveNext}</em> {clockTime(next.start, locale)} · {next.title}
            {next.subtitle ? ` · ${next.subtitle}` : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}
