import { useEffect, useState } from "react";
import { channelColor, channelInitials, type LiveChannel } from "@kinora/shared";
import type { Locale } from "./i18n";

/** An uploaded logo, or the channel's initials on a color derived from its name. */
export function ChannelLogo(props: { channel: Pick<LiveChannel, "name" | "logoUrl">; className?: string }) {
  const { channel } = props;
  const className = `channel-logo${props.className ? ` ${props.className}` : ""}`;
  if (channel.logoUrl) {
    return (
      <span className={`${className} has-image`}>
        <img src={channel.logoUrl} alt="" decoding="async" />
      </span>
    );
  }
  return (
    <span className={className} style={{ background: channelColor(channel.name) }} aria-hidden="true">
      {channelInitials(channel.name)}
    </span>
  );
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: Locale, options: Intl.DateTimeFormatOptions) {
  const key = `${locale}${JSON.stringify(options)}`;
  let value = formatters.get(key);
  if (!value) {
    value = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", options);
    formatters.set(key, value);
  }
  return value;
}

/** "21:45" */
export function clockTime(ms: number, locale: Locale) {
  return formatter(locale, { hour: "2-digit", minute: "2-digit" }).format(ms);
}

/** "Lu, 9 nov." */
export function dayLabel(ms: number, locale: Locale) {
  return formatter(locale, { weekday: "short", day: "numeric", month: "short" }).format(ms);
}

export function startOfDay(ms: number) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * The server's clock as seen from here: the browser's time corrected by the offset measured on the
 * last response, so "now" in the guide matches the schedule even if this device's clock drifts.
 */
let skew = 0;
export function syncClock(serverNow: number, sentAt: number, receivedAt = Date.now()) {
  skew = serverNow - (sentAt + receivedAt) / 2;
}

export function serverNow() {
  return Date.now() + skew;
}

/** Re-renders every `everyMs` and returns the server time. */
export function useNow(everyMs = 15_000) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(serverNow()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}

export function programProgress(program: { start: number; end: number }, now: number) {
  if (program.end <= program.start) return 0;
  return Math.max(0, Math.min(1, (now - program.start) / (program.end - program.start)));
}
