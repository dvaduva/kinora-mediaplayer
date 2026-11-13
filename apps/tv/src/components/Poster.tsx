import { memo } from "react";
import { useNavigate } from "react-router-dom";
import { Focusable } from "./Focusable";
import { imageUrl } from "@kinora/client";

type Props = {
  to: string;
  title: string;
  meta?: string | null;
  src: string | null;
  badge?: string | null;
  focusKey?: string;
  focusOnMount?: boolean;
  progress?: number | null;
  onFocus?: () => void;
  /** Replaces opening `to`, for items that act in place (a song starts in the music player). */
  onEnterPress?: () => void;
};

/**
 * Grids and rails re-render on focus moves; a card whose data did not change is skipped. Its callbacks
 * are left out of the comparison: callers recreate them on each render, with the same meaning.
 */
export const PosterCard = memo(PosterCardView, (previous, next) =>
  (Object.keys(next) as (keyof Props)[]).every((key) => typeof next[key] === "function" || previous[key] === next[key]) &&
  Object.keys(previous).length === Object.keys(next).length,
);

function PosterCardView(props: Props) {
  const navigate = useNavigate();
  const poster = imageUrl(props.src, "w342");
  return (
    <Focusable
      className="poster"
      focusKey={props.focusKey}
      focusOnMount={props.focusOnMount}
      onFocus={props.onFocus}
      onEnterPress={props.onEnterPress ?? (() => navigate(props.to))}
    >
      <div className="poster-art" style={poster ? { backgroundImage: `url(${poster})` } : undefined}>
        {!poster ? <span className="poster-fallback">{props.title.slice(0, 1)}</span> : null}
        {props.progress != null && props.progress > 0 && props.progress < 0.95 ? (
          <div className="poster-progress">
            <i style={{ width: `${Math.round(props.progress * 100)}%` }} />
          </div>
        ) : null}
      </div>
      <div className="poster-copy">
        <strong>{props.title}</strong>
        {props.meta ? <span>{props.meta}</span> : null}
        {props.badge ? <small className="poster-badge">{props.badge}</small> : null}
      </div>
    </Focusable>
  );
}
