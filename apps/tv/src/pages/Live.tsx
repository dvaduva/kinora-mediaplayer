import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Hls from "hls.js";
import {
  CATEGORY_MOVIES,
  CATEGORY_MUSIC,
  CATEGORY_SERIES,
  channelColor,
  channelInitials,
  transcodePlaybackReady,
  type ChannelProgram,
  type LiveChannel,
  type LiveGuide,
  type LivePlayback,
  type TranscodeStatus,
} from "@kinora/shared";
import { apiUrl } from "@kinora/client";
import { api, getConnection } from "../api";
import { Focusable } from "../components/Focusable";
import { ScrollRail } from "../components/ScrollRail";
import { useLocale, type Copy, type Locale } from "../i18n";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Grid scale: pixels per minute; ~3 hours fit a desktop-width TV browser. */
const PPM = 7;
const CHANNEL_COLUMN = 220;
const FILTER_KEY = "kinora.tv.liveFilter";
const TAB_KEY = "kinora.tv.liveTab";

type ChannelFilter = { kind: "favorites" } | { kind: "all" } | { kind: "category"; value: string };
type Tab = "guide" | "whatson";

function readFilter(): ChannelFilter {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(FILTER_KEY) ?? "null");
    if (parsed && typeof parsed === "object" && "kind" in parsed) {
      const value = parsed as ChannelFilter;
      if (value.kind === "favorites" || value.kind === "all") return { kind: value.kind };
      if (value.kind === "category" && typeof value.value === "string") return value;
    }
  } catch {
    // Storage may be blocked.
  }
  return { kind: "all" };
}

function saveFilter(filter: ChannelFilter) {
  try {
    window.localStorage.setItem(FILTER_KEY, JSON.stringify(filter));
  } catch {
    // Not remembered.
  }
}

function categoryLabel(category: string, t: Copy) {
  if (category === CATEGORY_MOVIES) return t.liveCategoryMovies;
  if (category === CATEGORY_SERIES) return t.liveCategorySeries;
  if (category === CATEGORY_MUSIC) return t.liveCategoryMusic;
  return category;
}

function isFiller(program: Pick<ChannelProgram, "itemType"> | null | undefined) {
  return program?.itemType === "filler";
}

function programTitle(program: Pick<ChannelProgram, "itemType" | "title">, t: Copy) {
  return isFiller(program) ? t.liveFillerTitle : program.title;
}

function currentAndNext(list: ChannelProgram[], now: number) {
  const current = list.find((program) => program.start <= now && now < program.end) ?? null;
  const next = list.find((program) => program.start >= (current?.end ?? now) && !isFiller(program)) ?? null;
  return { current, next };
}

function programProgress(program: { start: number; end: number }, now: number) {
  if (program.end <= program.start) return 0;
  return Math.max(0, Math.min(1, (now - program.start) / (program.end - program.start)));
}

function byChannel(programs: ChannelProgram[]) {
  const map = new Map<string, ChannelProgram[]>();
  for (const program of programs) {
    const list = map.get(program.channelId);
    if (list) list.push(program);
    else map.set(program.channelId, [program]);
  }
  return map;
}

function filterChannels(channels: LiveChannel[], filter: ChannelFilter) {
  if (filter.kind === "favorites") return channels.filter((channel) => channel.favorite);
  if (filter.kind === "category") return channels.filter((channel) => channel.category === filter.value);
  return channels;
}

function channelCategories(channels: LiveChannel[], t: Copy) {
  const values = [...new Set(channels.flatMap((channel) => (channel.category ? [channel.category] : [])))];
  return values.sort((a, b) => categoryLabel(a, t).localeCompare(categoryLabel(b, t)));
}

function resolveUrl(path: string) {
  if (path.startsWith("http")) return path;
  return apiUrl(path);
}

function ChannelLogo(props: { channel: Pick<LiveChannel, "name" | "logoUrl">; className?: string }) {
  const { channel } = props;
  const className = `channel-logo${props.className ? ` ${props.className}` : ""}`;
  if (channel.logoUrl) {
    return (
      <span className={`${className} has-image`}>
        <img src={resolveUrl(channel.logoUrl)} alt="" decoding="async" />
      </span>
    );
  }
  return (
    <span className={className} style={{ background: channelColor(channel.name) }} aria-hidden="true">
      {channelInitials(channel.name)}
    </span>
  );
}

function clockTime(ms: number, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { hour: "2-digit", minute: "2-digit" }).format(ms);
}

function dayLabel(ms: number, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { weekday: "short", day: "numeric", month: "short" }).format(ms);
}

function startOfDay(ms: number) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function nextMidnight(day: number) {
  const date = new Date(day);
  date.setDate(date.getDate() + 1);
  return date.getTime();
}

function guideDays(now: number) {
  const days: number[] = [];
  const first = startOfDay(now);
  for (let index = 0; index < 4; index += 1) {
    const date = new Date(first);
    date.setDate(date.getDate() + index);
    if (date.getTime() < now + 72 * HOUR) days.push(date.getTime());
  }
  return days;
}

function readTab(): Tab {
  try {
    return window.localStorage.getItem(TAB_KEY) === "whatson" ? "whatson" : "guide";
  } catch {
    return "guide";
  }
}

function liveSeconds(program: ChannelProgram | null, now: number) {
  if (!program) return 0;
  return Math.min((program.end - program.start) / 1000, Math.max(0, (now - program.start) / 1000));
}

function programSeconds(program: ChannelProgram | null) {
  return program ? (program.end - program.start) / 1000 : 0;
}

export function LivePage() {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const [guide, setGuide] = useState<LiveGuide | null>(null);
  const [stale, setStale] = useState<LiveGuide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilterState] = useState<ChannelFilter>(readFilter);
  const [tab, setTabState] = useState<Tab>(readTab);
  const [dayIndex, setDayIndex] = useState(0);
  const [now, setNow] = useState(Date.now());

  const setFilter = (next: ChannelFilter) => {
    setFilterState(next);
    saveFilter(next);
  };
  const setTab = (next: Tab) => {
    setTabState(next);
    try {
      window.localStorage.setItem(TAB_KEY, next);
    } catch {
      // Only remembered when storage works.
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const days = guideDays(now);
  const day = tab === "whatson" ? days[0]! : (days[dayIndex] ?? days[0]!);
  const from = day;
  const to = nextMidnight(day);

  const load = useCallback(() => {
    api<LiveGuide>(`/api/livetv/guide?from=${from}&to=${to}`)
      .then((data) => {
        setGuide(data);
        setStale(data);
        setError(null);
        setNow(data.now);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [from, to]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const loaded = guide && guide.from === from && guide.to === to ? guide : null;
  const display = loaded ?? (stale && stale.from === from && stale.to === to ? stale : null);
  const channels = useMemo(() => (display ? display.channels.filter((channel) => channel.enabled && !channel.empty) : []), [display]);
  const effective =
    filter.kind === "category" && !channels.some((channel) => channel.category === filter.value) ? ({ kind: "all" } as ChannelFilter) : filter;
  const visible = filterChannels(channels, effective);
  const programs = useMemo(() => (display ? byChannel(display.programs) : new Map<string, ChannelProgram[]>()), [display]);
  const categories = channelCategories(channels, t);
  const categoryTabs: { filter: ChannelFilter; label: string }[] = [
    { filter: { kind: "favorites" }, label: t.liveFavorites },
    { filter: { kind: "all" }, label: t.liveAll },
    ...categories.map((value) => ({ filter: { kind: "category" as const, value }, label: categoryLabel(value, t) })),
  ];
  const isActive = (other: ChannelFilter) =>
    other.kind === effective.kind && (other.kind !== "category" || (effective.kind === "category" && effective.value === other.value));
  const shown = display ? { ...display, channels: visible } : null;

  if (error && !display) return <p className="state-message">{t.liveGuideFailed}</p>;
  if (!display) return <p className="state-message">{t.loading}</p>;

  return (
    <div className={`page live-page${tab === "guide" && shown && shown.channels.length > 0 ? " has-guide" : ""}`}>
      <header className="page-head live-head">
        <div className="live-head-title">
          <h1>{t.live}</h1>
          <p className="count">
            {visible.length} {t.channels.toLowerCase()}
          </p>
        </div>
        <div className="live-tabs" role="tablist" aria-label={t.live}>
          <Focusable
            className={`chip${tab === "guide" ? " is-active" : ""}`}
            focusKey="live-tab-guide"
            onEnterPress={() => setTab("guide")}
          >
            {t.liveGuide}
          </Focusable>
          <Focusable
            className={`chip${tab === "whatson" ? " is-active" : ""}`}
            focusKey="live-tab-whatson"
            onEnterPress={() => setTab("whatson")}
          >
            {t.liveWhatsOn}
          </Focusable>
        </div>
      </header>

      {channels.length > 0 ? (
        <div className="live-category-rail" role="group" aria-label={t.liveCategories}>
          <ScrollRail className="live-categories">
            {categoryTabs.map((entry) => (
              <Focusable
                key={entry.filter.kind === "category" ? `c:${entry.filter.value}` : entry.filter.kind}
                className={`chip${isActive(entry.filter) ? " is-active" : ""}`}
                focusKey={`live-filter-${entry.filter.kind === "category" ? entry.filter.value : entry.filter.kind}`}
                onEnterPress={() => setFilter(entry.filter)}
              >
                {entry.label}
              </Focusable>
            ))}
          </ScrollRail>
        </div>
      ) : null}

      {tab === "guide" && channels.length > 0 ? (
        <div className="live-days" role="group" aria-label={t.liveGuide}>
          {days.map((value, index) => (
            <Focusable
              key={value}
              className={`chip${index === dayIndex ? " is-active" : ""}`}
              focusKey={`live-day-${index}`}
              onEnterPress={() => setDayIndex(index)}
            >
              {index === 0 ? t.liveToday : index === 1 ? t.liveTomorrow : dayLabel(value, locale)}
            </Focusable>
          ))}
        </div>
      ) : null}

      {channels.length === 0 ? <p className="hint">{t.noLive}</p> : null}
      {channels.length > 0 && visible.length === 0 ? (
        <p className="hint">{effective.kind === "favorites" ? t.liveNoFavorites : t.liveNothingHere}</p>
      ) : null}

      {shown && shown.channels.length > 0 ? (
        tab === "whatson" ? (
          <div className="live-list">
            {shown.channels.map((channel, index) => {
              const { current, next } = currentAndNext(programs.get(channel.id) ?? [], now);
              return (
                <Focusable
                  key={channel.id}
                  className="live-row"
                  focusKey={`live-now-${channel.id}`}
                  focusOnMount={index === 0}
                  onEnterPress={() => navigate(`/live/${channel.id}`)}
                >
                  <ChannelLogo channel={channel} />
                  <span className="live-row-body">
                    <span className="live-row-channel">
                      <span className="live-row-number">{channel.number}</span>
                      <strong>{channel.name}</strong>
                      {channel.category ? <em>{categoryLabel(channel.category, t)}</em> : null}
                    </span>
                    {current ? (
                      <>
                        <span className="live-row-now">
                          <span className="live-tag">{t.liveNow}</span> {programTitle(current, t)}
                        </span>
                        <span className="meter small" aria-hidden="true">
                          <span style={{ width: `${programProgress(current, now) * 100}%` }} />
                        </span>
                      </>
                    ) : (
                      <span className="live-row-now muted">{t.liveNoProgram}</span>
                    )}
                    {next ? (
                      <small className="muted">
                        {t.liveNext} {clockTime(next.start, locale)} · {next.title}
                      </small>
                    ) : null}
                  </span>
                </Focusable>
              );
            })}
          </div>
        ) : (
          <GuideGrid guide={shown} from={from} to={to} now={now} locale={locale} t={t} />
        )
      ) : null}
    </div>
  );
}

function GuideGrid(props: { guide: LiveGuide; from: number; to: number; now: number; locale: Locale; t: Copy }) {
  const { guide, from, to, now, locale, t } = props;
  const navigate = useNavigate();
  const scroller = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<number | null>(null);
  const programs = useMemo(() => byChannel(guide.programs), [guide.programs]);
  const width = ((to - from) / MINUTE) * PPM;
  const nowX = now >= from && now < to ? ((now - from) / MINUTE) * PPM : null;
  const slots = useMemo(() => {
    const list: number[] = [];
    for (let time = from; time < to; time += 30 * MINUTE) list.push(time);
    return list;
  }, [from, to]);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || scrolledFor.current === from) return;
    scrolledFor.current = from;
    const target = nowX == null ? 0 : nowX - 30 * PPM;
    element.scrollLeft = Math.max(0, target);
  }, [from, nowX]);

  const style = { "--guide-width": `${width}px`, "--channel-column": `${CHANNEL_COLUMN}px` } as CSSProperties;
  let firstFocus = true;

  return (
    <div className="guide" style={style}>
      <div className="guide-scroll" ref={scroller}>
        <div className="guide-times" aria-hidden="true">
          <span className="guide-corner" />
          <div className="guide-time-track">
            {slots.map((slot) => (
              <span key={slot} className="guide-slot" style={{ left: ((slot - from) / MINUTE) * PPM }}>
                {clockTime(slot, locale)}
              </span>
            ))}
          </div>
        </div>
        <div className="guide-body">
          {guide.channels.map((channel) => {
            const channelPrograms = programs.get(channel.id) ?? [];
            const focusThis = firstFocus;
            if (firstFocus) firstFocus = false;
            return (
              <div className="guide-row" key={channel.id}>
                <Focusable
                  className="guide-channel"
                  focusKey={`guide-ch-${channel.id}`}
                  focusOnMount={focusThis}
                  onEnterPress={() => navigate(`/live/${channel.id}`)}
                >
                  <ChannelLogo channel={channel} />
                  <span className="guide-channel-number">{channel.number}</span>
                  <span className="guide-channel-name">{channel.name}</span>
                </Focusable>
                <div className="guide-track">
                  {channelPrograms.map((program) => {
                    const left = ((Math.max(program.start, from) - from) / MINUTE) * PPM;
                    const right = ((Math.min(program.end, to) - from) / MINUTE) * PPM;
                    const live = program.start <= now && now < program.end;
                    const past = program.end <= now;
                    const filler = isFiller(program);
                    const title = programTitle(program, t);
                    const widthPx = Math.max(2, right - left);
                    if (filler && !live) {
                      return (
                        <div
                          key={program.id}
                          className="guide-program filler past"
                          style={{ left, width: widthPx }}
                          aria-hidden="true"
                        >
                          <strong>{title}</strong>
                        </div>
                      );
                    }
                    return (
                      <Focusable
                        key={program.id}
                        className={`guide-program${live ? " live" : ""}${past ? " past" : ""}${filler ? " filler" : ""}`}
                        focusKey={`guide-p-${program.id}`}
                        style={{ left, width: widthPx }}
                        onEnterPress={() => navigate(`/live/${channel.id}`)}
                      >
                        <strong>{title}</strong>
                        <small>
                          {clockTime(program.start, locale)}–{clockTime(program.end, locale)}
                          {program.subtitle ? ` · ${program.subtitle}` : ""}
                        </small>
                        {live ? <span className="guide-program-progress" style={{ width: `${programProgress(program, now) * 100}%` }} /> : null}
                      </Focusable>
                    );
                  })}
                  {channelPrograms.length === 0 ? (
                    <Focusable
                      className="guide-program empty"
                      focusKey={`guide-empty-${channel.id}`}
                      style={{ left: Math.max(0, (nowX ?? 0) - 20), width: Math.max(140, 45 * PPM) }}
                      onEnterPress={() => navigate(`/live/${channel.id}`)}
                    >
                      <strong>{t.liveNoProgram}</strong>
                    </Focusable>
                  ) : null}
                </div>
              </div>
            );
          })}
          {nowX != null ? <span className="guide-now" style={{ left: CHANNEL_COLUMN + nowX }} aria-hidden="true" /> : null}
        </div>
      </div>
    </div>
  );
}

export function LivePlayerPage() {
  const { channelId } = useParams();
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const tuning = useRef(0);
  const retries = useRef(0);
  const copy = useRef(t);
  copy.current = t;

  const [channels, setChannels] = useState<LiveChannel[] | null>(null);
  const [session, setSession] = useState<LivePlayback | null>(null);
  const [info, setInfo] = useState<{ program: ChannelProgram | null; next: ChannelProgram | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [banner, setBanner] = useState(true);
  const [now, setNow] = useState(Date.now());
  const infoRef = useRef(info);
  infoRef.current = info;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    api<LiveChannel[]>("/api/livetv/channels")
      .then((list) => setChannels(list.filter((channel) => channel.enabled && !channel.empty)))
      .catch(() => setChannels([]));
  }, []);

  useEffect(() => {
    if (!banner) return;
    const timer = window.setTimeout(() => setBanner(false), 5000);
    return () => window.clearTimeout(timer);
  }, [banner, session]);

  const watchedId = session && session.mode !== "live" ? session.channel.id : null;
  useEffect(() => {
    if (!watchedId) return;
    const timer = window.setInterval(() => {
      void api(`/api/livetv/channels/${watchedId}/watching`, { method: "POST", body: "{}" }).catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [watchedId]);

  const tune = useCallback((id: string, after?: number) => {
    const token = ++tuning.current;
    setStarted(false);
    setError(null);
    api<LivePlayback>(`/api/livetv/channels/${id}/play`, { method: "POST", body: JSON.stringify(after ? { after } : {}) })
      .then((data) => {
        if (token !== tuning.current) return;
        setSession(data);
        setInfo({ program: data.program, next: data.next });
        setNow(data.now);
      })
      .catch((reason: Error) => {
        if (token !== tuning.current) return;
        setSession(null);
        setError(
          reason.message === "channel_empty"
            ? copy.current.liveChannelEmpty
            : reason.message === "not_found"
              ? copy.current.liveChannelGone
              : reason.message,
        );
      });
  }, []);

  useEffect(() => {
    if (!channelId) return;
    retries.current = 0;
    tune(channelId);
    setBanner(true);
  }, [channelId, tune]);

  useEffect(() => {
    const media = videoRef.current;
    if (!session || !media) return;

    if (session.mode === "filler") {
      setStarted(true);
      return;
    }

    let cancelled = false;
    let hls: Hls | null = null;
    let timer = 0;
    let corrections = 0;
    let target = 0;
    const token = getConnection().token;
    const src = resolveUrl(session.src);
    const statusUrl = session.statusUrl ? resolveUrl(session.statusUrl) : null;
    const program = session.program;

    const onMeta = () => {
      if (session.mode !== "live") media.currentTime = target;
      void media.play().catch(() => undefined);
    };
    const onSeeking = () => {
      if (session.mode !== "hls" || corrections >= 3 || media.currentTime <= target + 8) return;
      corrections += 1;
      media.currentTime = target;
    };
    const onPlaying = () => {
      corrections = 3;
    };
    const onFatal = () => {
      if (retries.current < 3 && channelId) {
        retries.current += 1;
        tune(channelId);
      } else setError(copy.current.playbackFailed);
    };
    const xhrSetup = token
      ? (xhr: XMLHttpRequest) => {
          xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        }
      : undefined;

    const attachHls = (config: Partial<Hls["config"]>) => {
      hls = new Hls({ enableWorker: false, lowLatencyMode: false, maxLiveSyncPlaybackRate: 1, xhrSetup, ...config });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(media);
      hls.on(Hls.Events.MANIFEST_PARSED, () => void media.play().catch(() => undefined));
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal && !cancelled) onFatal();
      });
    };

    const beginLive = () => {
      if (cancelled) return;
      if (Hls.isSupported()) attachHls({ backBufferLength: 300, liveSyncDurationCount: 3 });
      else if (media.canPlayType("application/vnd.apple.mpegurl")) {
        media.addEventListener("loadedmetadata", onMeta, { once: true });
        media.src = src;
      } else {
        setError(copy.current.playbackFailed);
        return;
      }
      setStarted(true);
    };

    const begin = (at = liveSeconds(program, Date.now())) => {
      if (cancelled) return;
      target = Math.max(0, at - session.mediaStart);
      media.addEventListener("seeking", onSeeking);
      media.addEventListener("playing", onPlaying);
      if (session.mode === "direct" || !Hls.isSupported()) {
        if (session.mode === "hls" && !media.canPlayType("application/vnd.apple.mpegurl")) {
          setError(copy.current.playbackFailed);
          return;
        }
        media.addEventListener("loadedmetadata", onMeta, { once: true });
        media.src = src;
      } else {
        attachHls({ startPosition: target, backBufferLength: Number.POSITIVE_INFINITY, liveSyncDurationCount: 1_000_000 });
      }
      setStarted(true);
    };

    if (session.mode === "direct" || !statusUrl) {
      begin();
    } else {
      const poll = () => {
        api<TranscodeStatus>(session.statusUrl!)
          .then((status) => {
            if (cancelled) return;
            if (status.state === "error") {
              if (session.mode === "live") setError(status.error === "ffmpeg_missing" ? copy.current.errIptvFfmpeg : copy.current.errIptvStream);
              else setError(status.error || copy.current.transcodeFailed);
              return;
            }
            if (session.mode === "live") {
              if (status.playlist) beginLive();
              else timer = window.setTimeout(poll, 500);
              return;
            }
            const live = liveSeconds(program, Date.now());
            if (transcodePlaybackReady(status, live)) begin(live);
            else if (status.playlist && status.seconds >= session.mediaStart + 8) begin(Math.min(live, status.seconds - 4));
            else timer = window.setTimeout(poll, 500);
          })
          .catch(() => {
            if (!cancelled) timer = window.setTimeout(poll, 1500);
          });
      };
      poll();
    }

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      media.removeEventListener("loadedmetadata", onMeta);
      media.removeEventListener("seeking", onSeeking);
      media.removeEventListener("playing", onPlaying);
      hls?.destroy();
      if (hlsRef.current === hls) hlsRef.current = null;
      media.pause();
      media.removeAttribute("src");
      media.load();
    };
  }, [session, channelId, tune]);

  // Filler clock and IPTV guide refresh; library programs advance when they end.
  useEffect(() => {
    if (!session || !channelId) return;

    if (session.mode === "filler") {
      const timer = window.setInterval(() => {
        const program = session.program;
        if (!program) return;
        if (Date.now() >= program.end) {
          window.clearInterval(timer);
          tune(channelId, program.end);
          setBanner(true);
        }
      }, 500);
      return () => window.clearInterval(timer);
    }

    if (session.mode === "live") {
      let asking = false;
      let checkedAt = Date.now();
      const refresh = () => {
        if (asking) return;
        asking = true;
        checkedAt = Date.now();
        api<{ current: ChannelProgram | null; next: ChannelProgram | null }>(`/api/livetv/channels/${channelId}/now`)
          .then((data) => setInfo({ program: data.current, next: data.next }))
          .catch(() => undefined)
          .finally(() => {
            asking = false;
          });
      };
      const timer = window.setInterval(() => {
        const current = infoRef.current?.program ?? null;
        if (current ? Date.now() >= current.end : Date.now() - checkedAt > 60_000) {
          refresh();
          setBanner(true);
        }
      }, 2000);
      return () => window.clearInterval(timer);
    }

    const media = videoRef.current;
    if (!media || !session.program) return;
    let advanced = false;
    const advance = () => {
      if (advanced || !session.program) return;
      advanced = true;
      tune(channelId, session.program.end);
      setBanner(true);
    };
    const onTime = () => {
      if (media.readyState === HTMLMediaElement.HAVE_NOTHING) return;
      const at = session.mediaStart + media.currentTime;
      const live = liveSeconds(session.program, Date.now());
      if (at > live + 3 && !media.seeking) {
        media.currentTime = Math.max(0, live - session.mediaStart);
        return;
      }
      if (at >= programSeconds(session.program) - 0.25) advance();
    };
    media.addEventListener("timeupdate", onTime);
    media.addEventListener("ended", advance);
    const timer = window.setInterval(() => {
      if (media.readyState === HTMLMediaElement.HAVE_NOTHING && liveSeconds(session.program, Date.now()) >= programSeconds(session.program)) {
        advance();
      }
    }, 2000);
    return () => {
      media.removeEventListener("timeupdate", onTime);
      media.removeEventListener("ended", advance);
      window.clearInterval(timer);
    };
  }, [session, channelId, tune]);

  const zap = useCallback(
    (step: 1 | -1) => {
      if (!channels || channels.length === 0) return;
      const index = channels.findIndex((channel) => channel.id === channelId);
      const next = channels[(index + step + channels.length) % channels.length];
      if (next && next.id !== channelId) navigate(`/live/${next.id}`, { replace: true });
    },
    [channels, channelId, navigate],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Backspace") {
        event.preventDefault();
        navigate("/live");
        return;
      }
      if (event.key === "ArrowUp" || event.key === "PageUp") {
        event.preventDefault();
        zap(1);
        setBanner(true);
      } else if (event.key === "ArrowDown" || event.key === "PageDown") {
        event.preventDefault();
        zap(-1);
        setBanner(true);
      } else if (event.key === " " || event.key === "k") {
        event.preventDefault();
        const media = videoRef.current;
        if (!media || session?.mode === "filler") return;
        if (media.paused) void media.play().catch(() => undefined);
        else media.pause();
      } else if (event.key === "i") {
        event.preventDefault();
        setBanner(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, zap, session?.mode]);

  const channel = session?.channel ?? channels?.find((entry) => entry.id === channelId) ?? null;
  const isLive = session?.mode === "live";
  const program = isLive ? (info?.program ?? null) : (session?.program ?? null);
  const next = isLive ? (info?.next ?? null) : (session?.next ?? null);
  const fillerEndsIn = session?.mode === "filler" && program ? Math.max(0, Math.ceil((program.end - now) / 1000)) : null;

  if (error) {
    return (
      <div className="player-error">
        <p>{error}</p>
        <Focusable className="btn" focusOnMount onEnterPress={() => navigate("/live")}>
          {t.back}
        </Focusable>
      </div>
    );
  }

  return (
    <div className="player live-player">
      <video ref={videoRef} className="player-video" playsInline autoPlay />
      {session?.mode === "filler" ? (
        <div className="live-filler-card">
          <p className="live-tag">{t.liveFillerTitle}</p>
          {next ? (
            <>
              <h1>{next.title}</h1>
              {next.subtitle ? <p className="muted">{next.subtitle}</p> : null}
              <p className="muted">
                {t.liveFillerAt.replace("{time}", clockTime(next.start, locale))}
                {fillerEndsIn != null ? ` · ${fillerEndsIn}s` : ""}
              </p>
            </>
          ) : (
            <h1>{channel?.name ?? t.live}</h1>
          )}
        </div>
      ) : null}
      {!started ? (
        <div className="player-wait">
          {channel ? <ChannelLogo channel={channel} className="large" /> : null}
          <p>{t.liveTuning}</p>
        </div>
      ) : null}
      <div className={`player-chrome${banner || !started ? " is-visible" : ""}`}>
        <Focusable className="btn" focusKey="live-back" focusOnMount onEnterPress={() => navigate("/live")}>
          ← {t.back}
        </Focusable>
        <div className="player-meta live-banner">
          {channel ? (
            <div className="live-banner-channel">
              <ChannelLogo channel={channel} />
              <div>
                <small className="muted">
                  {channel.number} · {channel.name}
                </small>
                <h1>{program ? programTitle(program, t) : t.liveNoProgram}</h1>
                {next ? (
                  <p className="muted">
                    {t.liveNext} {clockTime(next.start, locale)} · {next.title}
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <h1>{t.live}</h1>
          )}
        </div>
        <div className="live-zap-hint muted">
          ↑↓ {t.channels}
        </div>
      </div>
    </div>
  );
}
