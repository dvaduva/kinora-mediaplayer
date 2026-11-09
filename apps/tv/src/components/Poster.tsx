import { useNavigate } from "react-router-dom";
import { Focusable } from "./Focusable";
import { imageUrl } from "../media";

type Props = {
  to: string;
  title: string;
  meta?: string | null;
  src: string | null;
  badge?: string | null;
  focusKey?: string;
  focusOnMount?: boolean;
  progress?: number | null;
};

export function PosterCard(props: Props) {
  const navigate = useNavigate();
  const poster = imageUrl(props.src, "w342");
  return (
    <Focusable
      className="poster"
      focusKey={props.focusKey}
      focusOnMount={props.focusOnMount}
      onEnterPress={() => navigate(props.to)}
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
