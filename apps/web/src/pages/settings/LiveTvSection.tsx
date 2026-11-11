import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { ChannelAlign, ChannelFiller, ChannelInput, ChannelOptions, ChannelOrder, ChannelSource, ChannelSourceType, LiveChannel, LiveTvSettings } from "@kinora/shared";
import { CHANNEL_SOURCE_TYPES, deriveCategory } from "@kinora/shared";
import { api } from "@kinora/client";
import { useLocale, type Copy } from "../../i18n";
import { categoryLabel, ChannelLogo } from "../../liveTv";
import { Icon } from "../../ui";
import { errorText, SectionHead, Status, useReportDirty, type SectionProps } from "./common";
import { IptvSources, matchLabel } from "./IptvSources";

const MAX_LOGO_BYTES = 1024 * 1024;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];

type LogoChange = { kind: "upload"; dataUrl: string } | { kind: "remove" } | null;
type Editing = { channel: LiveChannel | null } | null;

function ruleLabel(type: ChannelSourceType, t: Copy) {
  switch (type) {
    case "genre":
      return t.liveRuleGenre;
    case "series":
      return t.liveRuleSeries;
    case "movie":
      return t.liveRuleMovie;
    case "library":
      return t.liveRuleLibrary;
    case "decade":
      return t.liveRuleDecade;
    case "person":
      return t.liveRulePerson;
    case "artist":
      return t.liveRuleArtist;
    case "album":
      return t.liveRuleAlbum;
    case "musicGenre":
      return t.liveRuleMusicGenre;
  }
}

function withYear(title: string, year: number | null) {
  return year ? `${title} (${year})` : title;
}

/** What a rule's value means to a person: the title instead of an id, "1990s" instead of 1990. */
function ruleValue(source: ChannelSource, options: ChannelOptions | null) {
  if (source.type === "series") {
    const show = options?.series.find((entry) => entry.id === source.value);
    return show ? withYear(show.title, show.year) : "…";
  }
  if (source.type === "movie") {
    const movie = options?.movies.find((entry) => entry.id === source.value);
    return movie ? withYear(movie.title, movie.year) : "…";
  }
  if (source.type === "library") return options?.libraries.find((entry) => entry.id === source.value)?.name ?? "…";
  if (source.type === "artist") return options?.artists.find((entry) => entry.id === source.value)?.name ?? "…";
  if (source.type === "album") {
    const album = options?.albums.find((entry) => entry.id === source.value);
    return album ? `${album.artist ? `${album.artist} — ` : ""}${withYear(album.title, album.year)}` : "…";
  }
  if (source.type === "decade") return `${source.value}s`;
  return source.value;
}

function liveError(t: Copy, reason: unknown) {
  const code = reason instanceof Error ? reason.message : "";
  if (code === "number_taken") return t.errNumberTaken;
  if (code === "bad_logo") return t.errBadLogo;
  if (code === "bad_category") return t.errBadCategory;
  if (code === "iptv_channel") return t.errIptvChannel;
  return errorText(t, reason);
}

function libraryTypeOf(options: ChannelOptions | null) {
  const types = new Map((options?.libraries ?? []).map((library) => [library.id, library.type]));
  return (id: string) => types.get(id);
}

export function LiveTvSection({ onDirty }: SectionProps) {
  const { t, locale } = useLocale();
  const [channels, setChannels] = useState<LiveChannel[] | null>(null);
  const [options, setOptions] = useState<ChannelOptions | null>(null);
  const [editing, setEditing] = useState<Editing>(null);

  function load() {
    api<LiveChannel[]>("/api/livetv/channels").then(setChannels).catch(() => undefined);
    api<ChannelOptions>("/api/livetv/options").then(setOptions).catch(() => undefined);
  }
  useEffect(load, []);

  /** Saves the profile's order with one channel moved a place up or down. */
  async function move(index: number, step: -1 | 1) {
    if (!channels) return;
    const order = channels.map((channel) => channel.id);
    const target = index + step;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target]!, order[index]!];
    setChannels(order.map((id) => channels.find((channel) => channel.id === id)!));
    await api<LiveChannel[]>("/api/livetv/order", { method: "PUT", body: JSON.stringify({ ids: order }) })
      .then(setChannels)
      .catch(load);
  }

  function resetOrder() {
    api<LiveChannel[]>("/api/livetv/order", { method: "PUT", body: JSON.stringify({ ids: [] }) })
      .then(setChannels)
      .catch(load);
  }

  const empty = channels !== null && channels.length === 0;
  return (
    <section className="settings-section">
      <SectionHead title={t.settingsLiveTv} help={t.settingsLiveTvHelp}>
        {editing ? null : (
          <button className="secondary-button" type="button" onClick={() => setEditing({ channel: null })}>+ {t.liveAddChannel}</button>
        )}
      </SectionHead>

      {editing ? (
        <ChannelForm
          key={editing.channel?.id ?? "new"}
          channel={editing.channel}
          options={options}
          onDirty={onDirty}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      ) : null}

      {channels === null ? <div className="settings-card"><span className="skeleton skeleton-line" /></div> : null}
      {empty && !editing ? (
        <div className="settings-card">
          <p className="muted">{t.liveNoChannelsSettings}</p>
          <button className="play live-first" type="button" onClick={() => setEditing({ channel: null })}>{t.liveCreateChannel}</button>
        </div>
      ) : null}
      <AutoChannels t={t} onChange={load} />
      <IptvSources t={t} locale={locale} channels={channels} onChange={load} />
      {channels && channels.length > 1 ? (
        <p className="field-help">
          {t.liveOrderHelp}{" "}
          <button className="text-button inline" type="button" onClick={resetOrder}>{t.liveOrderReset}</button>
        </p>
      ) : null}
      <div className="library-list">
        {channels?.map((channel, index) =>
          editing?.channel?.id === channel.id ? null : (
            <ChannelCard
              key={channel.id}
              channel={channel}
              options={options}
              t={t}
              first={index === 0}
              last={index === channels.length - 1}
              onMove={(step) => void move(index, step)}
              onEdit={() => setEditing({ channel })}
              onChange={load}
            />
          ),
        )}
      </div>
      {channels && channels.length > 0 ? (
        <p className="field-help">
          <Link className="text-button inline" to="/live">{t.liveTv} → {t.liveGuide}</Link>
        </p>
      ) : null}
    </section>
  );
}

/** Server-wide switch for generated channels, the series threshold, and "generate now". */
function AutoChannels(props: { t: Copy; onChange: () => void }) {
  const { t } = props;
  const [settings, setSettings] = useState<LiveTvSettings | null>(null);
  const [threshold, setThreshold] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    api<LiveTvSettings>("/api/livetv/settings")
      .then((data) => {
        setSettings(data);
        setThreshold(String(data.autoSeriesMinEpisodes));
      })
      .catch(() => undefined);
  }, []);

  const report = (created: number) => {
    setNote({ tone: "ok", text: created > 0 ? t.liveAutoCreated.replace("{count}", String(created)) : t.liveAutoNone });
    if (created > 0) props.onChange();
  };

  async function save(change: Partial<LiveTvSettings>) {
    setBusy(true);
    setNote(null);
    try {
      const result = await api<{ settings: LiveTvSettings; created: number }>("/api/livetv/settings", { method: "PUT", body: JSON.stringify(change) });
      setSettings(result.settings);
      setThreshold(String(result.settings.autoSeriesMinEpisodes));
      if (result.settings.autoChannels) report(result.created);
    } catch (reason) {
      setNote({ tone: "error", text: liveError(t, reason) });
    } finally {
      setBusy(false);
    }
  }

  async function generate(restore: boolean) {
    setBusy(true);
    setNote(null);
    try {
      const result = await api<{ created: number }>("/api/livetv/auto/sync", { method: "POST", body: JSON.stringify({ restore }) });
      report(result.created);
    } catch (reason) {
      setNote({ tone: "error", text: liveError(t, reason) });
    } finally {
      setBusy(false);
    }
  }

  if (!settings) return null;
  const parsed = Number(threshold);
  const thresholdValid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 10_000;
  return (
    <div className="settings-card auto-channels">
      <h3>{t.liveAutoTitle}</h3>
      <p className="field-help">{t.liveAutoHelp}</p>
      <label className="radio">
        <input type="checkbox" checked={settings.autoChannels} disabled={busy} onChange={(event) => void save({ autoChannels: event.target.checked })} />
        {t.liveAutoEnable}
      </label>
      <div className="auto-channels-row">
        <label className="field">
          {t.liveAutoSeriesMin}
          <input type="number" min={1} max={10000} step={1} value={threshold} onChange={(event) => setThreshold(event.target.value)} />
        </label>
        {thresholdValid && parsed !== settings.autoSeriesMinEpisodes ? (
          <button className="secondary-button" type="button" disabled={busy} onClick={() => void save({ autoSeriesMinEpisodes: parsed })}>{t.save}</button>
        ) : null}
      </div>
      <div className="auto-channels-row">
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void generate(false)}>{t.liveAutoGenerateNow}</button>
        <button className="text-button" type="button" disabled={busy} onClick={() => void generate(true)}>{t.liveAutoRestore}</button>
        {note ? <span className={note.tone === "ok" ? "settings-saved" : "danger"} role="status">{note.text}</span> : null}
      </div>
      <h3>{t.livePrepareTitle}</h3>
      <label className="radio">
        <input type="checkbox" checked={settings.prepareNext} disabled={busy} onChange={(event) => void save({ prepareNext: event.target.checked })} />
        {t.livePrepareNext}
      </label>
      <p className="field-help">{t.livePrepareHelp}</p>
    </div>
  );
}

function ChannelCard(props: {
  channel: LiveChannel;
  options: ChannelOptions | null;
  t: Copy;
  first: boolean;
  last: boolean;
  onMove: (step: -1 | 1) => void;
  onEdit: () => void;
  onChange: () => void;
}) {
  const { channel, t } = props;
  const iptv = channel.iptv;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function regenerate() {
    setBusy(true);
    setNote(null);
    try {
      await api(`/api/livetv/channels/${channel.id}/regenerate`, { method: "POST" });
      setNote({ tone: "ok", text: t.liveRegenerated });
      props.onChange();
    } catch (reason) {
      setNote({ tone: "error", text: liveError(t, reason) });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api(`/api/livetv/channels/${channel.id}`, { method: "DELETE" });
      props.onChange();
    } catch (reason) {
      setNote({ tone: "error", text: liveError(t, reason) });
      setBusy(false);
    }
  }

  return (
    <article className="settings-card library-card channel-card">
      <div className="channel-card-head">
        <ChannelLogo channel={channel} />
        <div className="channel-card-title">
          <h3>
            <span className="guide-channel-number">{channel.number}</span> {channel.name} {channel.auto ? <span className="channel-auto">{t.liveAuto}</span> : null}
          </h3>
          {iptv ? (
            <span className="library-type">
              IPTV · {t.liveIptvSource}: {iptv.sourceName} · EPG: {matchLabel(channel, t)}
              {channel.category ? ` · ${t.liveCategory}: ${categoryLabel(channel.category, t)}` : ""}
            </span>
          ) : (
            <span className="library-type">
              {t.liveOrder}: {channel.orderMode === "shuffle" ? t.liveOrderShuffle : t.liveOrderSequentialShort}
              {channel.alignMinutes > 0 ? ` · ${channel.alignMinutes === 30 ? t.liveAlignHalfHour : t.liveAlignHour}` : ""}
              {channel.category ? ` · ${t.liveCategory}: ${categoryLabel(channel.category, t)}` : ""}
            </span>
          )}
        </div>
        <div className="channel-order-buttons">
          <button type="button" onClick={() => props.onMove(-1)} disabled={props.first} aria-label={`${t.liveMoveUp}: ${channel.name}`} title={t.liveMoveUp}>
            <Icon name="up" />
          </button>
          <button type="button" onClick={() => props.onMove(1)} disabled={props.last} aria-label={`${t.liveMoveDown}: ${channel.name}`} title={t.liveMoveDown}>
            <Icon name="down" />
          </button>
        </div>
        {!channel.enabled ? (
          <Status tone="busy">{t.liveOff}</Status>
        ) : iptv?.missing ? (
          <Status tone="warn">{t.liveIptvMissing}</Status>
        ) : channel.empty ? (
          <Status tone="warn">{t.liveNoProgram}</Status>
        ) : (
          <Status tone="ok">{t.liveActive}</Status>
        )}
      </div>
      {channel.enabled && channel.empty && !iptv ? <p className="danger channel-warning">{t.liveEmptyWarning}</p> : null}
      <ul className="rule-chips">
        {channel.sources.map((source, index) => (
          <li key={index}>
            <span>{ruleLabel(source.type, t)}</span> {ruleValue(source, props.options)}
          </li>
        ))}
      </ul>
      <div className="library-card-foot">
        <button className="text-button" type="button" onClick={props.onEdit} disabled={busy}>{t.edit}</button>
        {iptv ? null : (
          <button className="text-button" type="button" onClick={() => void regenerate()} disabled={busy}>{t.liveRegenerate}</button>
        )}
        {iptv ? null : confirming ? (
          <>
            <button className="text-button danger" type="button" onClick={() => void remove()} disabled={busy}>{t.liveConfirmDelete}</button>
            <button className="text-button" type="button" onClick={() => setConfirming(false)}>{t.cancel}</button>
          </>
        ) : (
          <button className="text-button danger" type="button" onClick={() => setConfirming(true)} disabled={busy}>{t.liveDeleteChannel}</button>
        )}
        {note ? <span className={note.tone === "ok" ? "settings-saved" : "danger"} role="status">{note.text}</span> : null}
      </div>
    </article>
  );
}

function emptyRule(type: ChannelSourceType): ChannelSource {
  return { type, value: "" };
}

function sameSources(a: ChannelSource[], b: ChannelSource[]) {
  return a.length === b.length && a.every((source, index) => source.type === b[index]!.type && source.value === b[index]!.value);
}

function ChannelForm(props: {
  channel: LiveChannel | null;
  options: ChannelOptions | null;
  onDirty: (dirty: boolean) => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const { channel, options } = props;
  const iptv = channel?.iptv ?? null;
  const [name, setName] = useState(channel?.name ?? "");
  const [number, setNumber] = useState(channel ? String(channel.number) : "");
  const [enabled, setEnabled] = useState(channel?.enabled ?? true);
  const [sources, setSources] = useState<ChannelSource[]>(channel?.sources.length || iptv ? (channel?.sources ?? []) : [emptyRule("genre")]);
  const [order, setOrder] = useState<ChannelOrder | null>(channel?.orderMode ?? null);
  const [category, setCategory] = useState(channel?.categoryOverride ?? "");
  const [align, setAlign] = useState<ChannelAlign>(channel?.alignMinutes ?? 0);
  const [filler, setFiller] = useState<ChannelFiller>(channel?.filler ?? "media");
  const [logo, setLogo] = useState<LogoChange>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new channel gets the next free number once the options arrive.
  useEffect(() => {
    if (!channel && options && number === "") setNumber(String(options.nextNumber));
  }, [channel, options, number]);

  const filled = sources.filter((source) => source.value.trim());
  // Until chosen by hand, series play in order and movies shuffle.
  const orderMode: ChannelOrder = order ?? (filled.some((source) => source.type === "series") ? "sequential" : "shuffle");
  const derived = iptv ? iptv.group : deriveCategory(filled, libraryTypeOf(options));
  const dirty = channel
    ? name !== channel.name ||
      number !== String(channel.number) ||
      enabled !== channel.enabled ||
      orderMode !== channel.orderMode ||
      align !== channel.alignMinutes ||
      filler !== channel.filler ||
      !sameSources(filled, channel.sources) ||
      logo !== null ||
      category.trim() !== (channel.categoryOverride ?? "")
    : Boolean(name.trim() || filled.length > 0 || logo || category.trim());
  useReportDirty(props.onDirty, dirty);

  const preview = {
    name: name.trim() || "TV",
    logoUrl: logo?.kind === "upload" ? logo.dataUrl : logo?.kind === "remove" ? null : (channel?.logoUrl ?? null),
  };

  function setRule(index: number, change: Partial<ChannelSource>) {
    setSources((current) => current.map((source, at) => (at === index ? { ...source, ...change, ...(change.type ? { value: "" } : {}) } : source)));
  }

  function pickLogo(file: File | undefined) {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type) || file.size > MAX_LOGO_BYTES) {
      setError(t.errBadLogo);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setLogo({ kind: "upload", dataUrl: reader.result });
        setError(null);
      }
    };
    reader.readAsDataURL(file);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (filled.length === 0 && !iptv) {
      setError(t.errNoRules);
      return;
    }
    const body: ChannelInput = {
      name: name.trim(),
      number: Number(number),
      orderMode,
      enabled,
      sources: filled,
      categoryOverride: category.trim() || null,
      alignMinutes: align,
      filler,
    };
    setBusy(true);
    setError(null);
    try {
      const saved = channel
        ? await api<LiveChannel>(`/api/livetv/channels/${channel.id}`, { method: "PUT", body: JSON.stringify(body) })
        : await api<LiveChannel>("/api/livetv/channels", { method: "POST", body: JSON.stringify(body) });
      if (logo?.kind === "upload") await api(`/api/livetv/channels/${saved.id}/logo`, { method: "POST", body: JSON.stringify({ data: logo.dataUrl }) });
      if (logo?.kind === "remove") await api(`/api/livetv/channels/${saved.id}/logo`, { method: "DELETE" });
      props.onDirty(false);
      props.onSaved();
    } catch (reason) {
      setError(liveError(t, reason));
      setBusy(false);
    }
  }

  return (
    <form className="settings-card channel-form" onSubmit={(event) => void submit(event)}>
      <h3>{channel ? t.liveEditChannel : t.liveAddChannel}</h3>
      <div className="channel-form-top">
        <div className="channel-logo-field">
          <ChannelLogo channel={preview} className="large" />
          <div className="channel-logo-actions">
            <label className="secondary-button">
              {t.liveLogoUpload}
              <input type="file" accept={LOGO_TYPES.join(",")} hidden onChange={(event) => pickLogo(event.target.files?.[0])} />
            </label>
            {preview.logoUrl ? (
              <button className="text-button small" type="button" onClick={() => setLogo(channel?.logoUrl ? { kind: "remove" } : null)}>
                {t.liveLogoRemove}
              </button>
            ) : null}
          </div>
        </div>
        <div className="channel-form-fields">
          <div className="settings-pair channel-name-row">
            <label className="field">
              {t.liveChannelName}
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} required />
            </label>
            <label className="field">
              {t.liveChannelNumber}
              <input type="number" min={1} max={9999} step={1} value={number} onChange={(event) => setNumber(event.target.value)} required />
            </label>
          </div>
          <p className="field-help">{t.liveLogoHelp}</p>
        </div>
      </div>

      {iptv ? <p className="field-help">IPTV · {t.liveIptvSource}: {iptv.sourceName}{iptv.group ? ` · ${t.liveIptvGroup}: ${iptv.group}` : ""}. {t.liveIptvNoDelete}</p> : null}

      {iptv ? null : (
      <fieldset className="folder-rows">
        <legend>{t.liveRules}</legend>
        <p className="field-help">{t.liveRulesHelp}</p>
        {sources.map((source, index) => (
          <div className="rule-row" key={index}>
            <select value={source.type} onChange={(event) => setRule(index, { type: event.target.value as ChannelSourceType })} aria-label={t.liveRules}>
              {CHANNEL_SOURCE_TYPES.map((type) => (
                <option key={type} value={type}>{ruleLabel(type, t)}</option>
              ))}
            </select>
            <RuleValue source={source} options={options} t={t} onChange={(value) => setRule(index, { value })} />
            <button className="folder-icon-button" type="button" onClick={() => setSources((current) => current.filter((_, at) => at !== index))} aria-label={t.liveRemoveRule} title={t.liveRemoveRule}>
              <Icon name="close" />
            </button>
          </div>
        ))}
        <button className="text-button folder-add" type="button" onClick={() => setSources((current) => [...current, emptyRule(current[current.length - 1]?.type ?? "genre")])}>
          + {t.liveAddRule}
        </button>
      </fieldset>
      )}

      {iptv ? null : (
      <fieldset className="field order-field">
        <legend>{t.liveOrder}</legend>
        <label className="radio">
          <input type="radio" name="order" checked={orderMode === "shuffle"} onChange={() => setOrder("shuffle")} />
          {t.liveOrderShuffle}
        </label>
        <label className="radio">
          <input type="radio" name="order" checked={orderMode === "sequential"} onChange={() => setOrder("sequential")} />
          {t.liveOrderSequential}
        </label>
      </fieldset>
      )}

      {iptv ? null : (
      <fieldset className="field order-field">
        <legend>{t.liveAlign}</legend>
        <p className="field-help">{t.liveAlignHelp}</p>
        <select value={align} onChange={(event) => setAlign(Number(event.target.value) as ChannelAlign)} aria-label={t.liveAlign}>
          <option value={0}>{t.liveAlignOff}</option>
          <option value={30}>{t.liveAlignHalfHour}</option>
          <option value={60}>{t.liveAlignHour}</option>
        </select>
        {align > 0 ? (
          <>
            <label className="radio">
              <input type="radio" name="filler" checked={filler === "media"} onChange={() => setFiller("media")} />
              {t.liveFillerMedia}
            </label>
            <label className="radio">
              <input type="radio" name="filler" checked={filler === "upnext"} onChange={() => setFiller("upnext")} />
              {t.liveFillerUpNext}
            </label>
          </>
        ) : null}
      </fieldset>
      )}

      <label className="field">
        {t.liveCategory}
        <input
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          maxLength={40}
          list="live-categories"
          placeholder={derived ? categoryLabel(derived, t) : t.liveCategoryNone}
        />
        <datalist id="live-categories">
          {[...new Set([...(options?.categories ?? []), ...(options?.genres ?? [])])].map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
      </label>
      <p className="field-help">
        {iptv
          ? t.liveIptvCategoryHelp.replace("{group}", derived ?? t.liveCategoryNone)
          : t.liveCategoryHelp.replace("{derived}", derived ? categoryLabel(derived, t) : t.liveCategoryNone)}
      </p>

      <label className="radio">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        {t.liveEnabled}
      </label>

      <div className="settings-foot">
        {error ? <span className="danger" role="alert">{error}</span> : busy ? <span className="muted">{t.saving}</span> : null}
        <button className="text-button" type="button" onClick={props.onCancel} disabled={busy}>{t.cancel}</button>
        <button className="play" type="submit" disabled={busy || (channel != null && !dirty)}>{t.save}</button>
      </div>
    </form>
  );
}

function RuleValue(props: { source: ChannelSource; options: ChannelOptions | null; t: Copy; onChange: (value: string) => void }) {
  const { source, options, t } = props;
  if (source.type === "person") {
    return (
      <>
        <input
          className="folder-input rule-value"
          list="live-people"
          value={source.value}
          onChange={(event) => props.onChange(event.target.value)}
          placeholder={t.liveRulePersonPlaceholder}
          aria-label={t.liveRulePerson}
        />
        <datalist id="live-people">
          {options?.people.map((person) => <option key={person} value={person} />)}
        </datalist>
      </>
    );
  }
  const choices: { value: string; label: string }[] =
    source.type === "genre"
      ? (options?.genres ?? []).map((genre) => ({ value: genre, label: genre }))
      : source.type === "series"
        ? (options?.series ?? []).map((show) => ({ value: show.id, label: withYear(show.title, show.year) }))
        : source.type === "movie"
          ? (options?.movies ?? []).map((movie) => ({ value: movie.id, label: withYear(movie.title, movie.year) }))
          : source.type === "library"
            ? (options?.libraries ?? []).map((library) => ({ value: library.id, label: library.name }))
            : source.type === "artist"
              ? (options?.artists ?? []).map((artist) => ({ value: artist.id, label: artist.name }))
              : source.type === "album"
                ? (options?.albums ?? []).map((album) => ({ value: album.id, label: ruleValue({ type: "album", value: album.id }, options) }))
                : source.type === "musicGenre"
                  ? (options?.musicGenres ?? []).map((genre) => ({ value: genre, label: genre }))
                  : (options?.decades ?? []).map((decade) => ({ value: String(decade), label: `${decade}s` }));
  // A saved value the library no longer offers stays selectable, so editing does not drop it silently.
  if (source.value && !choices.some((choice) => choice.value === source.value)) choices.unshift({ value: source.value, label: ruleValue(source, options) });
  return (
    <select className="rule-value" value={source.value} onChange={(event) => props.onChange(event.target.value)} aria-label={ruleLabel(source.type, t)}>
      <option value="">{t.liveRuleChoose}</option>
      {choices.map((choice) => (
        <option key={choice.value} value={choice.value}>{choice.label}</option>
      ))}
    </select>
  );
}
