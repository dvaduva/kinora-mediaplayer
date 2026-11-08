import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ChannelProgram, LiveChannel, LiveGuide } from "@kinora/shared";
import { api } from "../api";
import { useLocale, type Copy, type Locale } from "../i18n";
import {
  CategoryBar,
  ChannelLogo,
  clockTime,
  dayLabel,
  effectiveFilter,
  FavoriteButton,
  filterChannels,
  programProgress,
  serverNow,
  startOfDay,
  syncClock,
  useChannelFilter,
  useNow,
} from "../liveTv";
import { imageUrl } from "../media";
import { Icon } from "../ui";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Grid scale: pixels per minute, so a 30-minute slot is 210 px and about three hours fit a desktop screen. */
const PPM = 7;
const CHANNEL_COLUMN = 210;
const NARROW = "(max-width: 760px)";

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const query = window.matchMedia(NARROW);
    const change = () => setNarrow(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return narrow;
}

/** Midnight of each day the 72-hour program reaches, today first. */
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

function nextMidnight(day: number) {
  const date = new Date(day);
  date.setDate(date.getDate() + 1);
  return date.getTime();
}

function useGuide(from: number, to: number) {
  const [guide, setGuide] = useState<LiveGuide | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    const sentAt = Date.now();
    api<LiveGuide>(`/api/livetv/guide?from=${from}&to=${to}`)
      .then((data) => {
        syncClock(data.now, sentAt);
        setGuide(data);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [from, to]);
  useEffect(() => {
    load();
    // The program is fixed, but a channel can be edited or a missing file replaced meanwhile.
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);
  return { guide: guide && guide.from === from && guide.to === to ? guide : null, stale: guide, failed };
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

type Tab = "guide" | "whatson";
const TAB_KEY = "kinora.liveTab";

function readTab(): Tab {
  try {
    return window.localStorage.getItem(TAB_KEY) === "whatson" ? "whatson" : "guide";
  } catch {
    return "guide";
  }
}

export function LiveTvPage() {
  const { t, locale } = useLocale();
  const narrow = useNarrow();
  const now = useNow(30_000);
  const days = guideDays(now);
  const [tab, setTabState] = useState<Tab>(readTab);
  const [dayIndex, setDayIndex] = useState(0);
  // What's On and the phone list are about now, so they always load today.
  const day = narrow || tab === "whatson" ? days[0]! : (days[dayIndex] ?? days[0]!);
  const from = day;
  const to = nextMidnight(day);
  const { guide, stale, failed } = useGuide(from, to);
  const [selected, setSelected] = useState<ChannelProgram | null>(null);
  const [filterChoice, setFilter] = useChannelFilter();
  /** Stars toggled here, ahead of the next guide refresh. */
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});

  const setTab = (next: Tab) => {
    setTabState(next);
    try {
      window.localStorage.setItem(TAB_KEY, next);
    } catch {
      // Only remembered when storage works.
    }
  };

  const loaded = guide ?? stale;
  const allChannels = useMemo(
    () => (loaded ? loaded.channels.map((channel) => (channel.id in favorites ? { ...channel, favorite: favorites[channel.id]! } : channel)) : []),
    [loaded, favorites],
  );
  const filter = effectiveFilter(filterChoice, allChannels);
  const channels = filterChannels(allChannels, filter);
  const shown = loaded ? { ...loaded, channels } : null;
  const onFavorite = (id: string, favorite: boolean) => setFavorites((current) => ({ ...current, [id]: favorite }));
  const hasChannels = allChannels.length > 0;
  return (
    <section className="live-page">
      <header className="live-head">
        <h1>{t.liveTv}</h1>
        <div className="live-tabs" role="tablist" aria-label={t.liveTv}>
          <button type="button" role="tab" aria-selected={tab === "guide"} className={tab === "guide" ? "active" : undefined} onClick={() => setTab("guide")}>
            {t.liveGuide}
          </button>
          <button type="button" role="tab" aria-selected={tab === "whatson"} className={tab === "whatson" ? "active" : undefined} onClick={() => setTab("whatson")}>
            {t.liveWhatsOn}
          </button>
        </div>
      </header>
      {hasChannels ? <CategoryBar channels={allChannels} filter={filter} onChange={setFilter} t={t} /> : null}
      {!narrow && tab === "guide" && shown && shown.channels.length > 0 ? (
        <div className="live-days" role="group" aria-label={t.liveGuide}>
          {days.map((value, index) => (
            <button key={value} type="button" className={index === dayIndex ? "active" : undefined} aria-pressed={index === dayIndex} onClick={() => setDayIndex(index)}>
              {index === 0 ? t.liveToday : index === 1 ? t.liveTomorrow : dayLabel(value, locale)}
            </button>
          ))}
        </div>
      ) : null}
      {failed && !shown ? <p className="danger">{t.liveGuideFailed}</p> : null}
      {!shown && !failed ? <GuideSkeleton /> : null}
      {loaded && hasChannels && channels.length === 0 ? (
        <p className="muted live-filter-empty">{filter.kind === "favorites" ? t.liveNoFavorites : t.liveNothingHere}</p>
      ) : null}
      {loaded && !hasChannels ? (
        <div className="live-empty">
          <Icon name="live" />
          <p>{t.liveNoChannels}</p>
          <p className="muted">{t.liveNoChannelsHelp}</p>
          <Link className="play" to="/settings/livetv">{t.liveCreateChannel}</Link>
        </div>
      ) : null}
      {shown && shown.channels.length > 0 ? (
        tab === "whatson" ? (
          <WhatsOn guide={shown} now={now} t={t} locale={locale} />
        ) : narrow ? (
          <NowNextList guide={shown} now={now} t={t} locale={locale} onFavorite={onFavorite} />
        ) : (
          <GuideGrid guide={shown} from={from} to={to} now={now} locale={locale} onSelect={setSelected} onFavorite={onFavorite} t={t} />
        )
      ) : null}
      {selected ? <ProgramPanel program={selected} channel={shown?.channels.find((channel) => channel.id === selected.channelId) ?? null} now={now} onClose={() => setSelected(null)} /> : null}
    </section>
  );
}

function GuideSkeleton() {
  return (
    <div className="guide-skeleton" aria-busy="true" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        <span className="skeleton skeleton-field" key={index} />
      ))}
    </div>
  );
}

function GuideGrid(props: {
  guide: LiveGuide;
  from: number;
  to: number;
  now: number;
  locale: Locale;
  t: Copy;
  onSelect: (program: ChannelProgram) => void;
  onFavorite: (channelId: string, favorite: boolean) => void;
}) {
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

  // Open on the current hour (half an hour of past to the left), once per day shown.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || scrolledFor.current === from) return;
    scrolledFor.current = from;
    const target = nowX == null ? 0 : nowX - 30 * PPM;
    element.scrollLeft = Math.max(0, target);
  }, [from, nowX]);

  const style = { "--guide-width": `${width}px`, "--channel-column": `${CHANNEL_COLUMN}px` } as CSSProperties;
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
        {guide.channels.map((channel) => (
          <div className="guide-row" key={channel.id}>
            <div className="guide-channel">
              <Link className="guide-channel-link" to={`/live/${channel.id}`} title={`${t.liveWatch}: ${channel.name}`}>
                <ChannelLogo channel={channel} />
                <span className="guide-channel-number">{channel.number}</span>
                <span className="guide-channel-name">{channel.name}</span>
              </Link>
              <FavoriteButton channel={channel} t={t} onChange={(favorite) => props.onFavorite(channel.id, favorite)} />
            </div>
            <div className="guide-track">
              {(programs.get(channel.id) ?? []).map((program) => {
                const left = ((Math.max(program.start, from) - from) / MINUTE) * PPM;
                const right = ((Math.min(program.end, to) - from) / MINUTE) * PPM;
                const live = program.start <= now && now < program.end;
                const past = program.end <= now;
                return (
                  <button
                    key={program.id}
                    type="button"
                    className={`guide-program${live ? " live" : ""}${past ? " past" : ""}`}
                    style={{ left, width: Math.max(2, right - left) }}
                    onClick={() => (live ? navigate(`/live/${channel.id}`) : props.onSelect(program))}
                    title={`${program.title}${program.subtitle ? ` · ${program.subtitle}` : ""}`}
                  >
                    <strong>{program.title}</strong>
                    <small>
                      {clockTime(program.start, locale)}–{clockTime(program.end, locale)}
                      {program.subtitle ? ` · ${program.subtitle}` : ""}
                    </small>
                    {live ? <span className="guide-program-progress" style={{ width: `${programProgress(program, now) * 100}%` }} /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {nowX != null ? <span className="guide-now" style={{ left: CHANNEL_COLUMN + nowX }} aria-hidden="true" /> : null}
        </div>
      </div>
    </div>
  );
}

function currentAndNext(list: ChannelProgram[], now: number) {
  const current = list.find((program) => program.start <= now && now < program.end) ?? null;
  const next = list.find((program) => program.start >= (current?.end ?? now)) ?? null;
  return { current, next };
}

/** Cards of what airs right now, one per channel. */
function WhatsOn(props: { guide: LiveGuide; now: number; t: Copy; locale: Locale }) {
  const { guide, now, t, locale } = props;
  const programs = useMemo(() => byChannel(guide.programs), [guide.programs]);
  return (
    <ul className="whats-on">
      {guide.channels.map((channel) => {
        const { current, next } = currentAndNext(programs.get(channel.id) ?? [], now);
        if (!current) return null;
        const image = imageUrl(current.image, "w780");
        const left = Math.max(0, Math.round((current.end - now) / MINUTE));
        return (
          <li key={channel.id}>
            <Link className="whats-on-card" to={`/live/${channel.id}`}>
              <span className="whats-on-image">
                {image ? <img src={image} alt="" loading="lazy" decoding="async" /> : <span className="whats-on-blank" />}
                <ChannelLogo channel={channel} />
                <span className="whats-on-progress"><span style={{ width: `${programProgress(current, now) * 100}%` }} /></span>
              </span>
              <span className="whats-on-text">
                <small className="muted">
                  <span className="guide-channel-number">{channel.number}</span> {channel.name}
                </small>
                <strong>{current.title}</strong>
                {current.subtitle ? <small className="muted">{current.subtitle}</small> : null}
                <small className="whats-on-time">
                  {clockTime(current.start, locale)}–{clockTime(current.end, locale)} · {t.liveMinutesLeft.replace("{min}", String(left))}
                </small>
                {next ? (
                  <small className="muted">
                    {t.liveNext} {clockTime(next.start, locale)} · {next.title}
                  </small>
                ) : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function NowNextList(props: { guide: LiveGuide; now: number; t: Copy; locale: Locale; onFavorite: (channelId: string, favorite: boolean) => void }) {
  const { guide, now, t, locale } = props;
  const programs = useMemo(() => byChannel(guide.programs), [guide.programs]);
  return (
    <ul className="guide-list">
      {guide.channels.map((channel) => {
        const { current, next } = currentAndNext(programs.get(channel.id) ?? [], now);
        return (
          <li key={channel.id} className="guide-list-row">
            <Link className="guide-list-item" to={`/live/${channel.id}`}>
              <ChannelLogo channel={channel} />
              <span className="guide-list-text">
                <span className="guide-list-channel">
                  <span className="guide-channel-number">{channel.number}</span> {channel.name}
                </span>
                {current ? (
                  <>
                    <span className="guide-list-now">
                      <em>{t.liveNow}</em> {current.title}
                    </span>
                    <span className="meter small"><span style={{ width: `${programProgress(current, now) * 100}%` }} /></span>
                  </>
                ) : null}
                {next ? (
                  <small className="muted">
                    {t.liveNext} {clockTime(next.start, locale)} · {next.title}
                  </small>
                ) : null}
              </span>
            </Link>
            <FavoriteButton channel={channel} t={t} onChange={(favorite) => props.onFavorite(channel.id, favorite)} />
          </li>
        );
      })}
    </ul>
  );
}

function ProgramPanel(props: { program: ChannelProgram; channel: LiveChannel | null; now: number; onClose: () => void }) {
  const { t, locale } = useLocale();
  const { program, channel } = props;
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose.current();
    };
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [program.id]);
  const past = program.end <= serverNow();
  const live = !past && program.start <= serverNow();
  const image = imageUrl(program.image, "w780");
  const minutes = Math.round((program.end - program.start) / MINUTE);
  return (
    <>
      <div className="live-panel-scrim" onClick={props.onClose} />
      <aside className="live-panel" ref={panel} tabIndex={-1} aria-label={program.title}>
        <button className="dialog-close" type="button" aria-label={t.close} onClick={props.onClose}>
          <Icon name="close" />
        </button>
        {image ? <img className="live-panel-image" src={image} alt="" /> : <div className="live-panel-image empty" />}
        <div className="live-panel-body">
          {channel ? (
            <p className="live-panel-channel">
              <ChannelLogo channel={channel} /> {channel.number} · {channel.name}
            </p>
          ) : null}
          <h2>{program.title}</h2>
          {program.subtitle ? <p className="muted">{program.subtitle}</p> : null}
          <p className="live-panel-time">
            {past ? `${t.liveAired} · ` : live ? `${t.liveOnAir} · ` : ""}
            {dayLabel(program.start, locale)}, {clockTime(program.start, locale)}–{clockTime(program.end, locale)} · {minutes} min
          </p>
          {program.description ? <p className="live-panel-text">{program.description}</p> : null}
          <div className="actions">
            {live && channel ? (
              <Link className="play" to={`/live/${channel.id}`}>{t.liveWatch}</Link>
            ) : null}
            {past && program.fileId ? (
              <Link className="play" to={`/play/${program.fileId}`}>{t.livePlayFromLibrary}</Link>
            ) : null}
            {program.libraryPath ? (
              <Link className={past || live ? "secondary-button" : "play"} to={program.libraryPath}>{t.liveSeeInLibrary}</Link>
            ) : null}
          </div>
        </div>
      </aside>
    </>
  );
}
