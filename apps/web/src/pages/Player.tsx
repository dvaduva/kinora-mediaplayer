import { useEffect, useRef, useState, type RefObject } from "react";
import { Link, useParams } from "react-router-dom";
import type { PlaybackView } from "@kinora/shared";
import { api } from "../api";
import { useLocale } from "../i18n";
import { codecLabel, subtitleLabel } from "../media";

export function PlayerPage() {
  const { fileId } = useParams();
  const { t, locale } = useLocale();
  const [view, setView] = useState<PlaybackView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);
  const resumed = useRef(false);
  const subtitleDirty = useRef(false);

  useEffect(() => {
    if (!fileId) return;
    resumed.current = false;
    api<PlaybackView>(`/api/playback/${fileId}`)
      .then((data) => {
        setView(data);
        setSelected(data.selectedSubtitleId);
        setError(null);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [fileId]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media || !view) return;
    const textTracks = view.subtitles.filter((track) => track.textBased);
    const apply = () => {
      const tracks = media instanceof HTMLVideoElement ? media.textTracks : null;
      if (!tracks) return;
      for (let index = 0; index < tracks.length; index += 1) {
        const track = tracks[index];
        if (!track) continue;
        track.mode = textTracks[index]?.id === selected ? "showing" : "disabled";
      }
    };
    const resume = () => {
      if (resumed.current) return;
      resumed.current = true;
      if (view.resumeSeconds > 5 && (!media.duration || view.resumeSeconds < media.duration - 5)) {
        media.currentTime = view.resumeSeconds;
      }
      apply();
    };
    const send = () => {
      if (!fileId || !media.duration) return;
      void api("/api/playback/progress", {
        method: "POST",
        body: JSON.stringify({
          fileId,
          position: media.currentTime,
          duration: media.duration,
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
  }, [view, selected, fileId]);

  if (error) return <p className="danger">{error}</p>;
  if (!view) return <p className="muted">{t.play}</p>;
  const reason = reasonText(view, t.remux, t.transcode, t.missing);
  const textTracks = view.subtitles.filter((track) => track.textBased);
  return (
    <article className="player-stage">
      <p className="crumb"><Link to="/">{t.home}</Link></p>
      <h1>{view.title}</h1>
      {view.subtitle ? <p className="muted">{view.subtitle}</p> : null}
      {view.plan.available ? (
        view.kind === "track" ? (
          <audio ref={mediaRef as RefObject<HTMLAudioElement>} src={`/api/stream/${view.fileId}`} controls autoPlay />
        ) : (
          <video ref={mediaRef as RefObject<HTMLVideoElement>} src={`/api/stream/${view.fileId}`} controls autoPlay crossOrigin="anonymous">
            {textTracks.map((track) => (
              <track key={track.id} kind="subtitles" src={`/api/subtitles/${view.fileId}/${track.id}`} srcLang={track.language ?? undefined} label={subtitleLabel(track, locale)} />
            ))}
          </video>
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
