import { Link } from "react-router-dom";
import { imageUrl } from "./media";

export function Mark() {
  return (
    <svg className="reel" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="12" fill="none" stroke="#d2ae62" strokeWidth="1.6" />
      <circle cx="16" cy="16" r="3" fill="#d2ae62" />
    </svg>
  );
}

export function Poster(props: { src: string | null; alt: string; size?: string }) {
  const url = imageUrl(props.src, props.size ?? "w342");
  if (!url) return <div className="poster empty" />;
  return <img className="poster" src={url} alt={props.alt} />;
}

export function PosterLink(props: { to: string; src: string | null; title: string; meta?: string | null; badge?: string | null }) {
  return (
    <Link className="poster-card" to={props.to}>
      <Poster src={props.src} alt="" />
      <span>{props.title}</span>
      {props.meta ? <small>{props.meta}</small> : null}
      {props.badge ? <small>{props.badge}</small> : null}
    </Link>
  );
}
