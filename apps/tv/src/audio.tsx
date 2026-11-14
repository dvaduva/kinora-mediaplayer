import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useLocation } from "react-router-dom";
import { Focusable } from "./components/Focusable";
import { useLocale } from "./i18n";
import { remoteAction } from "./remote";
import { imageUrl, useAudioEngine, type AudioClips, type NowPlaying } from "@kinora/client";
import { MiniSpectrum, Visualizer } from "@kinora/media-ui";

export type { NowPlaying } from "@kinora/client";

type AudioApi = {
  play: (track: NowPlaying, queue?: NowPlaying[]) => void;
  pause: () => void;
  stop: () => void;
  /** Opens the full-screen player. */
  expand: () => void;
  toggle: () => void;
  previous: () => void;
  next: () => void;
  attachClips: (byFileId: AudioClips) => void;
  current: NowPlaying | null;
  playing: boolean;
  active: boolean;
};

const AudioCtx = createContext<AudioApi | null>(null);

export function AudioProvider({ children }: { children: ReactNode }) {
  const engine = useAudioEngine({ optimistic: true, fetchCrossOrigin: true });
  const { audioRef, current, position, active, playing, visual, setVisual, analyser, audioProps } = engine;
  const { play, pause, stop, toggle, previous, next, attachClips } = engine;
  const location = useLocation();
  const { t } = useLocale();

  /**
   * Over the visualizer the remote's Back closes it (the page under it must not go back too), and the
   * media keys drive the music. Capture phase on window: this runs before any page's own key handler.
   */
  useEffect(() => {
    if (!visual) return;
    const onKey = (event: KeyboardEvent) => {
      const action = remoteAction(event);
      if (!action) return;
      if (action === "back" || action === "stop") setVisual(false);
      else if (action === "playPause") toggle();
      else if (action === "play") toggle();
      else if (action === "pause") pause();
      else if (action === "next" || action === "fastForward") next();
      else if (action === "previous" || action === "rewind") previous();
      else return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visual, setVisual, toggle, pause, next, previous]);

  /**
   * With the bar only (no full-screen player), the remote's media keys still drive the music on every
   * page but the video and live players, which pause it and take those keys for themselves.
   */
  const onPlayerPage = location.pathname.startsWith("/play/") || location.pathname.startsWith("/live/");
  useEffect(() => {
    if (!active || visual || onPlayerPage) return;
    const onKey = (event: KeyboardEvent) => {
      const action = remoteAction(event);
      if (action === "playPause" || action === "play") toggle();
      else if (action === "pause") pause();
      else if (action === "next" || action === "fastForward") next();
      else if (action === "previous" || action === "rewind") previous();
      else if (action === "stop") stop();
      else return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, visual, onPlayerPage, toggle, pause, next, previous, stop]);

  /**
   * Minimize, Close or Stop removes the button that had the focus, which would leave the remote with
   * nothing focused: minimized, the focus goes to "Now playing" in the menu; closed, to the menu's
   * current page. The video and live players set their own focus.
   */
  const shown = useRef({ visual, active });
  useEffect(() => {
    const before = shown.current;
    shown.current = { visual, active };
    if (onPlayerPage) return;
    if (before.active && !active) setFocus("nav");
    else if (before.visual && !visual && active) setFocus("nav-now");
  }, [visual, active, onPlayerPage]);

  const [clipError, setClipError] = useState<string | null>(null);
  const clipKeyForError = current?.clip?.kind === "video" ? current.clip.key : null;
  useEffect(() => setClipError(null), [clipKeyForError]);

  // Video / live players take over the screen — pause music so both don't fight.
  useEffect(() => {
    if (!location.pathname.startsWith("/play/") && !location.pathname.startsWith("/live/")) return;
    pause();
    setVisual(false);
  }, [location.pathname, pause, setVisual]);

  const apiValue = useMemo<AudioApi>(
    () => ({ play, pause, stop, expand: () => setVisual(true), toggle, previous, next, attachClips, current, playing, active }),
    [play, pause, stop, setVisual, toggle, previous, next, attachClips, current, playing, active],
  );

  const cover = current?.cover ? imageUrl(current.cover, "w500") : null;
  const clipKey = current?.clip?.kind === "video" ? current.clip.key : null;

  return (
    <AudioCtx.Provider value={apiValue}>
      {children}
      <audio ref={audioRef} {...audioProps} />
      {active && current ? (
        <>
          <div className={`now-bar${visual ? " is-hidden" : ""}`}>
            <Focusable className="now-face" focusKey="now-expand" onEnterPress={() => setVisual(true)}>
              {cover ? <img src={cover} alt="" /> : <div className="now-face-empty" />}
              <div>
                <small>{t.nowPlaying}</small>
                <strong>{current.title}</strong>
                <span>{current.artist}</span>
              </div>
            </Focusable>
            <div className="now-controls">
              <Focusable className="btn now-btn" focusKey="now-prev" onEnterPress={previous}>
                ‹
              </Focusable>
              <Focusable className="btn primary now-btn" focusKey="now-toggle" onEnterPress={toggle}>
                {playing ? t.pause : t.play}
              </Focusable>
              <Focusable className="btn now-btn" focusKey="now-next" onEnterPress={next}>
                ›
              </Focusable>
              <Focusable className="btn now-btn" focusKey="now-open" onEnterPress={() => setVisual(true)}>
                {t.expand}
              </Focusable>
              <Focusable className="btn now-btn" focusKey="now-close" onEnterPress={stop}>
                {t.close}
              </Focusable>
            </div>
            {analyser ? (
              <MiniSpectrum
                analyser={visual ? null : analyser}
                playing={playing}
                onClick={() => setVisual(true)}
                label={clipKey ? t.visualizeClip : t.visualize}
              />
            ) : null}
            {position.total > 1 ? (
              <small className="now-count">
                {position.index + 1}/{position.total}
              </small>
            ) : null}
          </div>

          {visual ? (
            <Visualizer
              analyser={analyser}
              cover={cover}
              title={current.title}
              artist={current.artist}
              clipKey={clipKey}
              playing={playing}
              lite
              onClipError={setClipError}
              notice={clipError ? <small className="visualizer-notice">{t.clipFailed} ({clipError})</small> : null}
              closeLabel={t.close}
              onClose={() => setVisual(false)}
              actions={
                <>
                  <Focusable className="btn" focusKey="visual-close" onEnterPress={() => setVisual(false)}>
                    {t.minimize}
                  </Focusable>
                  <Focusable className="btn" focusKey="visual-stop" onEnterPress={stop}>
                    {t.close}
                  </Focusable>
                </>
              }
              controls={
                <>
                  <Focusable className="btn" focusKey="visual-prev" onEnterPress={previous}>
                    {t.previousTrack}
                  </Focusable>
                  <Focusable className="btn primary" focusKey="visual-toggle" focusOnMount onEnterPress={toggle}>
                    {playing ? t.pause : t.play}
                  </Focusable>
                  <Focusable className="btn" focusKey="visual-next" onEnterPress={next}>
                    {t.nextTrack}
                  </Focusable>
                </>
              }
            />
          ) : null}
        </>
      ) : null}
    </AudioCtx.Provider>
  );
}

export function useAudio() {
  const value = useContext(AudioCtx);
  if (!value) throw new Error("AudioProvider missing");
  return value;
}
