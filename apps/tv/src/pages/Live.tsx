import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Hls from "hls.js";
import type { LiveChannel, LivePlayback } from "@kinora/shared";
import { api, getConnection } from "../api";
import { Focusable } from "../components/Focusable";
import { useLocale } from "../i18n";
import { apiUrl } from "../connection";

export function LivePage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [channels, setChannels] = useState<LiveChannel[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<LiveChannel[]>("/api/livetv/channels")
      .then(setChannels)
      .catch((reason: Error) => setError(reason.message));
  }, []);

  if (error) return <p className="state-message">{t.error}: {error}</p>;
  if (!channels) return <p className="state-message">{t.loading}</p>;

  const visible = channels.filter((channel) => channel.enabled && !channel.empty);

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t.live}</h1>
        <p className="count">
          {visible.length} {t.channels.toLowerCase()}
        </p>
      </header>
      {visible.length === 0 ? <p className="hint">{t.noLive}</p> : null}
      <div className="episode-list live-list">
        {visible.map((channel, index) => (
          <Focusable
            key={channel.id}
            className="episode"
            focusKey={`live-${channel.id}`}
            focusOnMount={index === 0}
            onEnterPress={() => navigate(`/live/${channel.id}`)}
          >
            <strong>{channel.number}</strong>
            <span>{channel.name}</span>
            <em>{channel.category || ""}</em>
          </Focusable>
        ))}
      </div>
    </div>
  );
}

export function LivePlayerPage() {
  const { channelId } = useParams();
  const { t } = useLocale();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    let hls: Hls | null = null;

    api<LivePlayback>(`/api/livetv/channels/${channelId}/play`, { method: "POST", body: "{}" })
      .then((playback) => {
        if (cancelled) return;
        const media = videoRef.current;
        setTitle(playback.program?.title || playback.channel.name);
        if (playback.mode === "filler" || !playback.src) {
          setError(t.playbackFailed);
          return;
        }
        const base = getConnection().baseUrl;
        const token = getConnection().token;
        const src = playback.src.startsWith("http") ? playback.src : apiUrl(base, playback.src);
        if (!media) return;

        if (playback.mode === "direct") {
          media.src = src;
          void media.play().catch(() => undefined);
          return;
        }

        if (!Hls.isSupported()) {
          if (media.canPlayType("application/vnd.apple.mpegurl")) {
            media.src = src;
            void media.play().catch(() => undefined);
            return;
          }
          setError(t.playbackFailed);
          return;
        }

        hls = new Hls({
          enableWorker: false,
          xhrSetup: token
            ? (xhr) => {
                xhr.setRequestHeader("Authorization", `Bearer ${token}`);
              }
            : undefined,
        });
        hls.loadSource(src);
        hls.attachMedia(media);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          void media.play().catch(() => undefined);
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) setError(t.playbackFailed);
        });
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      });

    return () => {
      cancelled = true;
      hls?.destroy();
      const media = videoRef.current;
      if (media) {
        media.removeAttribute("src");
        media.load();
      }
    };
  }, [channelId, t.playbackFailed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Backspace") {
        event.preventDefault();
        navigate("/live");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  if (error) {
    return (
      <div className="player-error">
        <p>
          {t.playbackFailed} ({error}).
        </p>
        <Focusable className="btn" focusOnMount onEnterPress={() => navigate("/live")}>
          {t.back}
        </Focusable>
      </div>
    );
  }

  return (
    <div className="player">
      <video ref={videoRef} className="player-video" playsInline autoPlay />
      <div className="player-chrome is-visible">
        <Focusable className="btn" focusKey="live-back" focusOnMount onEnterPress={() => navigate("/live")}>
          ← {t.back}
        </Focusable>
        <div className="player-meta">
          <h1>{title || t.live}</h1>
        </div>
      </div>
    </div>
  );
}
