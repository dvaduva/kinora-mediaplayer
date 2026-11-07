import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import { imageUrl } from "./media";
import { useLocale } from "./i18n";

interface NowPlaying {
  fileId: string;
  title: string;
  artist: string;
  cover: string | null;
}

const AudioContext = createContext<{ play: (track: NowPlaying) => void } | null>(null);

export function AudioProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentRef = useRef<NowPlaying | null>(null);
  const [current, setCurrent] = useState<NowPlaying | null>(null);
  const [active, setActive] = useState(false);
  const { t } = useLocale();
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const finish = () => setActive(false);
    audio.addEventListener("ended", finish);
    audio.addEventListener("error", finish);
    return () => {
      audio.removeEventListener("ended", finish);
      audio.removeEventListener("error", finish);
    };
  }, []);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const send = () => {
      const track = currentRef.current;
      if (!track || !audio.duration) return;
      void api("/api/playback/progress", {
        method: "POST",
        body: JSON.stringify({
          fileId: track.fileId,
          position: audio.currentTime,
          duration: audio.duration,
          subtitleChoice: null,
        }),
      }).catch(() => undefined);
    };
    audio.addEventListener("pause", send);
    audio.addEventListener("ended", send);
    const timer = window.setInterval(send, 5000);
    return () => {
      audio.removeEventListener("pause", send);
      audio.removeEventListener("ended", send);
      window.clearInterval(timer);
    };
  }, []);
  function play(track: NowPlaying) {
    currentRef.current = track;
    setCurrent(track);
    setActive(true);
    const audio = audioRef.current;
    if (!audio) return;
    audio.src = `/api/stream/${track.fileId}`;
    void audio.play().catch(() => undefined);
  }
  return (
    <AudioContext.Provider value={{ play }}>
      {children}
      <div className="now" hidden={!active}>
        {current?.cover ? <img src={imageUrl(current.cover) ?? ""} alt="" /> : <div className="face" />}
        <div>
          <small className="muted">{t.nowPlaying}</small>
          <div>{current ? `${current.title}` : "—"}</div>
          {current ? <small className="muted">{current.artist}</small> : null}
        </div>
        <audio ref={audioRef} controls />
      </div>
    </AudioContext.Provider>
  );
}

export function useAudio() {
  const value = useContext(AudioContext);
  if (!value) throw new Error("audio");
  return value;
}
