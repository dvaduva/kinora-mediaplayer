import { createContext, useContext, useMemo, type ReactNode } from "react";
import { imageUrl, useAudioEngine, type AudioClips, type NowPlaying } from "@kinora/client";
import { useLocale } from "./i18n";
import { MiniSpectrum, Visualizer } from "@kinora/media-ui";

const AudioContext = createContext<{
  /** Plays `track`; with `queue` (e.g. the whole album), carries on through the tracks after it. */
  play: (track: NowPlaying, queue?: NowPlaying[]) => void;
  pause: () => void;
  /** Attaches YouTube clips that arrived after playback started (keyed by file id). */
  attachClips: (byFileId: AudioClips) => void;
} | null>(null);

export function AudioProvider({ children }: { children: ReactNode }) {
  const engine = useAudioEngine();
  const { audioRef, current, position, active, playing, visual, setVisual, analyser, previous, step, audioProps } = engine;
  const { play, pause, attachClips } = engine;
  const value = useMemo(() => ({ play, pause, attachClips }), [play, pause, attachClips]);
  const { t } = useLocale();
  // Only real music videos make a good loop; plain uploads are usually a still image.
  const clipKey = current?.clip?.kind === "video" ? current.clip.key : null;
  return (
    <AudioContext.Provider value={value}>
      {children}
      <div className="now" hidden={!active}>
        {current?.cover ? <img src={imageUrl(current.cover) ?? ""} alt="" /> : <div className="face" />}
        <div>
          <small className="muted">{t.nowPlaying}</small>
          <div>{current ? `${current.title}` : "—"}</div>
          {current ? <small className="muted">{current.artist}</small> : null}
        </div>
        {position.total > 1 ? (
          <div className="now-steps">
            <button type="button" onClick={previous} aria-label={t.previousTrack} title={t.previousTrack}>
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 2h2v12H3zM14 2v12L6 8z" fill="currentColor" /></svg>
            </button>
            <small className="muted">{position.index + 1}/{position.total}</small>
            <button type="button" onClick={() => step(1)} disabled={position.index >= position.total - 1} aria-label={t.nextTrack} title={t.nextTrack}>
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M11 2h2v12h-2zM2 2v12l8-6z" fill="currentColor" /></svg>
            </button>
          </div>
        ) : null}
        {analyser ? (
          <MiniSpectrum analyser={visual ? null : analyser} playing={playing} onClick={() => setVisual(true)} label={clipKey ? t.visualizeClip : t.visualize} />
        ) : null}
        <audio ref={audioRef} controls {...audioProps} />
      </div>
      {visual && active && current ? (
        <Visualizer
          analyser={analyser}
          cover={current.cover ? imageUrl(current.cover) : null}
          title={current.title}
          artist={current.artist}
          clipKey={clipKey}
          playing={playing}
          closeLabel={t.close}
          onClose={() => setVisual(false)}
        />
      ) : null}
    </AudioContext.Provider>
  );
}

export function useAudio() {
  const value = useContext(AudioContext);
  if (!value) throw new Error("audio");
  return value;
}
