import { useEffect, useRef, useState, type RefObject } from "react";
import { Link, useParams } from "react-router-dom";
import Hls from "hls.js";
import type { PlaybackView, SubtitleStatus, TranscodeStatus } from "@kinora/shared";
import { transcodePlaybackReady } from "@kinora/shared";
import { api } from "../api";
import { useLocale } from "../i18n";
import { codecLabel, subtitleLabel } from "../media";

export function PlayerPage() {
  const { fileId } = useParams();
  const { t, locale } = useLocale();
  const [view, setView] = useState<PlaybackView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [play, setPlay] = useState<{ id: string | undefined; started: boolean; status: TranscodeStatus | null }>({
    id: undefined,
    started: false,
    status: null,
  });
  const [captions, setCaptions] = useState(false);
  const [subStatus, setSubStatus] = useState<{ id: string; status: SubtitleStatus } | null>(null);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);
  const resumed = useRef(false);
  const subtitleDirty = useRef(false);
  const copyRef = useRef(t);
  copyRef.current = t;
  if (play.id !== fileId) setPlay({ id: fileId, started: false, status: null });

  useEffect(() => {
    if (!fileId) return;
    resumed.current = false;
    subtitleDirty.current = false;
    setCaptions(false);
    api<PlaybackView>(`/api/playback/${fileId}`)
      .then((data) => {
        setView(data);
        setSelected(data.selectedSubtitleId);
        setError(null);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [fileId]);

  const selectedTrack = view?.subtitles.find((track) => track.id === selected && track.textBased) ?? null;
  const embeddedId = selectedTrack?.origin === "embedded" ? selectedTrack.id : null;

  useEffect(() => {
    if (!fileId || !embeddedId) return;
    let cancel = false;
    let timer = 0;
    const tick = () => {
      api<SubtitleStatus>(`/api/subtitles/${fileId}/${embeddedId}/status`)
        .then((status) => {
          if (cancel) return;
          setSubStatus({ id: embeddedId, status });
          if (status.state === "extracting") timer = window.setTimeout(tick, 2000);
        })
        .catch(() => {
          if (!cancel) timer = window.setTimeout(tick, 5000);
        });
    };
    tick();
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [fileId, embeddedId]);

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
    const media = mediaRef.current;
    if (!media || !view || view.fileId !== fileId) return;
    const apply = () => {
      const tracks = media instanceof HTMLVideoElement ? media.textTracks : null;
      const track = tracks?.[0];
      if (track) track.mode = selected ? "showing" : "disabled";
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
  }, [view, selected, fileId, play.started, captions, subStatus]);

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

  if (error) return <p className="danger">{error}</p>;
  if (!view) return <p className="muted">{t.play}</p>;
  const reason = reasonText(view, t.remux, t.transcode, t.missing);
  const textTracks = view.subtitles.filter((track) => track.textBased);
  const caption = textTracks.find((track) => track.id === selected);
  const embeddedStatus = caption?.origin === "embedded" ? (subStatus?.id === caption.id ? subStatus.status : { state: "extracting" as const, progress: null }) : null;
  const captionReady = !embeddedStatus || embeddedStatus.state === "ready";
  const showCaption = Boolean(caption && captionReady && (!preparing || captions));
  const showMedia = !preparing || play.started;
  const percent = play.status?.progress == null ? "" : `${Math.round(play.status.progress * 100)}%`;
  return (
    <article className="player-stage">
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
                {play.status?.progress != null ? <progress value={play.status.progress} max={1} /> : null}
              </div>
            ) : null}
            {play.status?.state === "error" ? <p className="danger">{play.status.error || t.transcodeFailed}</p> : null}
            {showMedia ? (
              <video
                ref={mediaRef as RefObject<HTMLVideoElement>}
                src={preparing ? undefined : `/api/stream/${view.fileId}`}
                controls
                autoPlay={!preparing}
                playsInline
                crossOrigin="anonymous"
              >
                {showCaption && caption ? (
                  <track key={caption.id} kind="subtitles" src={`/api/subtitles/${view.fileId}/${caption.id}`} srcLang={caption.language ?? undefined} label={subtitleLabel(caption, locale)} default />
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
          {embeddedStatus?.state === "extracting" ? (
            <span className="muted">
              {t.extractingSubtitles.replace("{progress}", embeddedStatus.progress == null ? "" : `${Math.round(embeddedStatus.progress * 100)}%`).trim()}
            </span>
          ) : null}
          {embeddedStatus?.state === "error" ? <span className="danger">{t.subtitlesFailed}</span> : null}
        </label>
      ) : null}
    </article>
  );
}

function reasonText(view: PlaybackView, remux: string, transcode: string, missing: string) {
  const video = codecLabel(view.plan.videoCodec) ?? view.plan.videoCodec ?? "—";
  const audio = codecLabel(view.plan.audioCodec) ?? view.plan.audioCodec ?? "—";
  const container = (view.plan.container ?? "file").toUpperCase();
  const template = view.plan.reasonCode === "remux_required" ? remux : view.plan.reasonCode === "missing" ? missing : transcode;
  return template.replace("{container}", container).replace("{video}", video).replace("{audio}", audio);
}
