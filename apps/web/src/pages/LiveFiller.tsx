import { useEffect, useRef, useState } from "react";
import type { ChannelProgram, LiveFiller } from "@kinora/shared";
import { hideCaptions, loadYoutubeApi, type YTPlayer } from "@kinora/media-ui";
import type { Copy, Locale } from "../i18n";
import { clockTime, formatClock, imageUrl, useNow } from "@kinora/client";

const PLAYING = 1;
const ENDED = 0;
/** Browsers may refuse to start a video with sound; after this long it starts muted. */
const SOUND_GRACE_MS = 1500;

/**
 * Plays the filler's trailers and clips one after another, starting over when they run out. Clips that
 * fail (removed, not embeddable, offline) are skipped; `onGiveUp` fires when none of them plays.
 */
function FillerVideos(props: { videos: LiveFiller["videos"]; muted: boolean; paused: boolean; onTitle: (title: string | null) => void; onGiveUp: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const [shown, setShown] = useState(false);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const videos = props.videos;
    let disposed = false;
    let index = 0;
    let failures = 0;
    let soundTimer = 0;
    const playAt = (target: YTPlayer, next: number) => {
      index = next % videos.length;
      latest.current.onTitle(videos[index]!.title || null);
      target.loadVideoById(videos[index]!.key);
    };
    loadYoutubeApi()
      .then((YT) => {
        if (disposed || !host.current) return;
        const mount = document.createElement("div");
        host.current.append(mount);
        latest.current.onTitle(videos[0]!.title || null);
        player.current = new YT.Player(mount, {
          host: "https://www.youtube-nocookie.com",
          videoId: videos[0]!.key,
          playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, modestbranding: 1, playsinline: 1, rel: 0, cc_load_policy: 0 },
          events: {
            onReady: (event) => {
              if (latest.current.muted) event.target.mute();
              if (!latest.current.paused) event.target.playVideo();
              // Without a recent click the browser blocks sound; a muted trailer is better than none.
              soundTimer = window.setTimeout(() => {
                if (!disposed && event.target.getPlayerState() !== PLAYING && !latest.current.paused) {
                  event.target.mute();
                  event.target.playVideo();
                }
              }, SOUND_GRACE_MS);
            },
            onStateChange: (event) => {
              if (event.data === PLAYING) {
                failures = 0;
                hideCaptions(event.target);
                setShown(true);
              }
              if (event.data === ENDED) playAt(event.target, index + 1);
            },
            onError: () => {
              if (disposed || !player.current) return;
              failures += 1;
              if (failures >= videos.length) {
                setShown(false);
                latest.current.onGiveUp();
              } else playAt(player.current, index + 1);
            },
          },
        });
      })
      .catch(() => {
        if (!disposed) latest.current.onGiveUp();
      });
    return () => {
      disposed = true;
      window.clearTimeout(soundTimer);
      player.current?.destroy();
      player.current = null;
      if (host.current) host.current.textContent = "";
    };
  }, [props.videos]);

  useEffect(() => {
    const target = player.current;
    if (!target || typeof target.mute !== "function") return;
    if (props.muted) target.mute();
    else target.unMute();
  }, [props.muted]);

  useEffect(() => {
    const target = player.current;
    if (!target || typeof target.playVideo !== "function") return;
    if (props.paused) target.pauseVideo();
    else target.playVideo();
  }, [props.paused]);

  return <div className={`live-filler-video${shown ? " shown" : ""}`} ref={host} aria-hidden="true" />;
}

/** The gap before an aligned start: what comes next and when, over trailers or the next program's picture. */
export function FillerScreen(props: {
  filler: LiveFiller;
  program: ChannelProgram;
  next: ChannelProgram | null;
  muted: boolean;
  paused: boolean;
  t: Copy;
  locale: Locale;
}) {
  const { filler, next, t, locale } = props;
  const now = useNow(1000);
  const [gaveUp, setGaveUp] = useState(false);
  const [clipTitle, setClipTitle] = useState<string | null>(null);
  const withVideos = filler.kind === "media" && filler.videos.length > 0 && !gaveUp;
  const backdrop = imageUrl(next?.image ?? null, "w1280");
  const left = Math.max(0, (props.program.end - now) / 1000);
  return (
    <div className={`live-filler${withVideos ? " with-videos" : ""}`}>
      {!withVideos && backdrop ? <img className="live-filler-backdrop" src={backdrop} alt="" /> : null}
      {withVideos ? (
        <FillerVideos videos={filler.videos} muted={props.muted} paused={props.paused} onTitle={setClipTitle} onGiveUp={() => setGaveUp(true)} />
      ) : null}
      <div className="live-filler-card">
        <p className="live-filler-label">{t.liveFillerTitle}</p>
        {next ? (
          <>
            <h2>{next.title}</h2>
            {next.subtitle ? <p className="muted">{next.subtitle}</p> : null}
            <p className="live-filler-when">
              {t.liveFillerAt.replace("{time}", clockTime(next.start, locale))} · <strong>{formatClock(left) ?? "0:00"}</strong>
            </p>
          </>
        ) : (
          <p className="live-filler-when"><strong>{formatClock(left) ?? "0:00"}</strong></p>
        )}
        {withVideos && clipTitle ? <p className="live-filler-clip muted">{t.liveFillerPlaying.replace("{title}", clipTitle)}</p> : null}
      </div>
    </div>
  );
}
