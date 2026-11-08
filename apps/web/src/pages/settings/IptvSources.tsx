import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { GuideChannelOption, IptvPreset, IptvSource, IptvSourceInput, LiveChannel } from "@kinora/shared";
import { IPTV_PRESETS } from "@kinora/shared";
import { api } from "../../api";
import type { Copy, Locale } from "../../i18n";
import { ChannelLogo } from "../../liveTv";
import { errorText, Status } from "./common";

const MATCH_PAGE = 40;

/** Server error codes of a refresh, in words. */
export function iptvErrorText(t: Copy, code: string | null) {
  if (!code) return "";
  if (code === "timeout") return t.errIptvTimeout;
  if (code === "empty_playlist") return t.errIptvEmpty;
  if (code === "file_not_found") return t.errIptvNotFound;
  if (code === "playlist_too_large" || code === "guide_too_large") return t.errIptvTooLarge;
  return code;
}

export function iptvFormError(t: Copy, reason: unknown) {
  const code = reason instanceof Error ? reason.message : "";
  if (code === "bad_m3u_url") return t.errBadM3uUrl;
  if (code === "bad_xmltv_url") return t.errBadXmltvUrl;
  return errorText(t, reason);
}

/** Where a source reads from, without the path and query, which often carry the account's credentials. */
function shortLocation(value: string, t: Copy) {
  try {
    if (/^https?:\/\//i.test(value)) return new URL(value).host;
  } catch {
    // Shown as a file below.
  }
  return t.liveIptvFile;
}

function busy(source: IptvSource) {
  return source.status === "refreshing" || source.status === "pending";
}

export function matchLabel(channel: LiveChannel, t: Copy) {
  const how = channel.iptv?.epgMatch;
  if (how === "tvg-id") return t.liveEpgByTvg;
  if (how === "name") return t.liveEpgByName;
  if (how === "manual") return t.liveEpgManual;
  return t.liveIptvMatchNone;
}

/** The IPTV sources of the server, with refresh, editing and EPG matching. */
export function IptvSources(props: { t: Copy; locale: Locale; channels: LiveChannel[] | null; onChange: () => void }) {
  const { t } = props;
  const [sources, setSources] = useState<IptvSource[] | null>(null);
  const [editing, setEditing] = useState<{ source: IptvSource | null } | null>(null);
  const onChange = useRef(props.onChange);
  onChange.current = props.onChange;
  const wasBusy = useRef(new Set<string>());

  function load() {
    api<IptvSource[]>("/api/livetv/sources")
      .then((list) => {
        setSources(list);
        // A refresh that just finished brings new channels and programs.
        const now = new Set(list.filter(busy).map((source) => source.id));
        if ([...wasBusy.current].some((id) => !now.has(id))) onChange.current();
        wasBusy.current = now;
      })
      .catch(() => undefined);
  }
  useEffect(load, []);
  const anyBusy = sources?.some(busy) ?? false;
  useEffect(() => {
    if (!anyBusy) return;
    const timer = window.setInterval(load, 2000);
    return () => window.clearInterval(timer);
  }, [anyBusy]);

  return (
    <div className="settings-card iptv-sources">
      <div className="iptv-head">
        <div>
          <h3>{t.liveIptvTitle}</h3>
          <p className="field-help">{t.liveIptvHelp}</p>
        </div>
        {editing ? null : (
          <button className="secondary-button" type="button" onClick={() => setEditing({ source: null })}>+ {t.liveIptvAdd}</button>
        )}
      </div>
      {editing ? (
        <SourceForm
          key={editing.source?.id ?? "new"}
          source={editing.source}
          t={t}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      ) : null}
      {sources && !editing ? <PublicSources t={t} sources={sources} onAdded={load} /> : null}
      {sources && sources.length === 0 && !editing ? <p className="muted">{t.liveIptvNoSources}</p> : null}
      {sources?.map((source) =>
        editing?.source?.id === source.id ? null : (
          <SourceCard
            key={source.id}
            source={source}
            channels={(props.channels ?? []).filter((channel) => channel.iptv?.sourceId === source.id)}
            t={t}
            locale={props.locale}
            onEdit={() => setEditing({ source })}
            onChange={() => {
              load();
              props.onChange();
            }}
          />
        ),
      )}
    </div>
  );
}

function countryName(preset: IptvPreset, t: Copy) {
  if (preset.country === "RO") return t.liveIptvCountryRO;
  if (preset.country === "MD") return t.liveIptvCountryMD;
  return preset.country;
}

/** One click per public playlist; a playlist already added shows as such. */
function PublicSources(props: { t: Copy; sources: IptvSource[]; onAdded: () => void }) {
  const { t } = props;
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add(preset: IptvPreset) {
    setWorking(preset.id);
    setError(null);
    try {
      const name = t.liveIptvPublicName.replace("{country}", countryName(preset, t));
      await api("/api/livetv/sources/preset", { method: "POST", body: JSON.stringify({ id: preset.id, name }) });
      props.onAdded();
    } catch (reason) {
      // Added meanwhile (another tab): the reload shows it.
      if (reason instanceof Error && reason.message === "preset_exists") props.onAdded();
      else setError(errorText(t, reason));
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="iptv-public">
      <p className="field-help">
        <strong>{t.liveIptvPublic}.</strong> {t.liveIptvPublicHelp}
      </p>
      <div className="iptv-public-buttons">
        {IPTV_PRESETS.map((preset) => {
          const added = props.sources.some((source) => source.m3uUrl === preset.m3uUrl);
          const country = countryName(preset, t);
          return added ? (
            <span key={preset.id} className="iptv-public-added">✓ {t.liveIptvPublicAdded.replace("{country}", country)}</span>
          ) : (
            <button key={preset.id} className="secondary-button" type="button" disabled={working !== null} onClick={() => void add(preset)}>
              + {country}
            </button>
          );
        })}
        {error ? <span className="danger" role="alert">{error}</span> : null}
      </div>
    </div>
  );
}

function SourceCard(props: { source: IptvSource; channels: LiveChannel[]; t: Copy; locale: Locale; onEdit: () => void; onChange: () => void }) {
  const { source, t } = props;
  const [confirming, setConfirming] = useState(false);
  const [matching, setMatching] = useState(false);
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const when = source.refreshedAt
    ? new Intl.DateTimeFormat(props.locale === "ro" ? "ro-RO" : "en-GB", { dateStyle: "short", timeStyle: "short" }).format(source.refreshedAt)
    : null;

  async function refresh() {
    setWorking(true);
    setNote(null);
    try {
      await api(`/api/livetv/sources/${source.id}/refresh`, { method: "POST" });
      props.onChange();
    } catch (reason) {
      setNote(errorText(t, reason));
    } finally {
      setWorking(false);
    }
  }

  async function remove() {
    setWorking(true);
    try {
      await api(`/api/livetv/sources/${source.id}`, { method: "DELETE" });
      props.onChange();
    } catch (reason) {
      setNote(errorText(t, reason));
      setWorking(false);
    }
  }

  const refreshing = busy(source);
  return (
    <article className="iptv-source">
      <div className="iptv-source-head">
        <div>
          <h4>{source.name}</h4>
          <span className="library-type">
            {shortLocation(source.m3uUrl, t)} · {t.liveIptvChannels.replace("{count}", String(source.channelCount)).replace("{matched}", String(source.matchedCount))}
            {when ? ` · ${t.liveIptvRefreshed.replace("{time}", when)}` : ""}
          </span>
        </div>
        {refreshing ? (
          <Status tone="busy">{source.status === "pending" ? t.liveIptvPending : t.liveIptvRefreshing}</Status>
        ) : source.status === "error" ? (
          <Status tone="error">{t.liveIptvFailed}</Status>
        ) : source.epgError ? (
          <Status tone="warn">EPG</Status>
        ) : (
          <Status tone="ok">OK</Status>
        )}
      </div>
      {source.status === "error" && source.error ? <p className="danger">{t.liveIptvError.replace("{error}", iptvErrorText(t, source.error))}</p> : null}
      {source.epgError ? <p className="danger">{t.liveIptvEpgError.replace("{error}", iptvErrorText(t, source.epgError))}</p> : null}
      <div className="library-card-foot">
        <button className="text-button" type="button" onClick={() => void refresh()} disabled={working || refreshing}>{t.liveIptvRefresh}</button>
        <button className="text-button" type="button" onClick={props.onEdit} disabled={working}>{t.edit}</button>
        <button className="text-button" type="button" onClick={() => setMatching((open) => !open)} aria-expanded={matching} disabled={props.channels.length === 0}>
          {t.liveIptvMatch}
        </button>
        {confirming ? (
          <>
            <button className="text-button danger" type="button" onClick={() => void remove()} disabled={working}>{t.liveIptvConfirmDelete}</button>
            <button className="text-button" type="button" onClick={() => setConfirming(false)}>{t.cancel}</button>
          </>
        ) : (
          <button className="text-button danger" type="button" onClick={() => setConfirming(true)} disabled={working}>{t.liveIptvDelete}</button>
        )}
        {note ? <span className="danger" role="alert">{note}</span> : null}
      </div>
      {matching ? <EpgMatcher source={source} channels={props.channels} t={t} onChange={props.onChange} /> : null}
    </article>
  );
}

function SourceForm(props: { source: IptvSource | null; t: Copy; onCancel: () => void; onSaved: () => void }) {
  const { source, t } = props;
  const [name, setName] = useState(source?.name ?? "");
  const [m3uUrl, setM3uUrl] = useState(source?.m3uUrl ?? "");
  const [xmltvUrl, setXmltvUrl] = useState(source?.xmltvUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body: IptvSourceInput = { name: name.trim(), m3uUrl: m3uUrl.trim(), xmltvUrl: xmltvUrl.trim() || null };
    setSaving(true);
    setError(null);
    try {
      if (source) await api(`/api/livetv/sources/${source.id}`, { method: "PUT", body: JSON.stringify(body) });
      else await api("/api/livetv/sources", { method: "POST", body: JSON.stringify(body) });
      props.onSaved();
    } catch (reason) {
      setError(iptvFormError(t, reason));
      setSaving(false);
    }
  }

  return (
    <form className="iptv-form" onSubmit={(event) => void submit(event)}>
      <h4>{source ? t.liveIptvEdit : t.liveIptvAdd}</h4>
      <label className="field">
        {t.liveIptvName}
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} required />
      </label>
      <label className="field">
        {t.liveIptvM3u}
        <input value={m3uUrl} onChange={(event) => setM3uUrl(event.target.value)} maxLength={2000} required placeholder="https://…/playlist.m3u" spellCheck={false} autoComplete="off" />
      </label>
      <p className="field-help">{t.liveIptvM3uHelp}</p>
      <label className="field">
        {t.liveIptvXmltv}
        <input value={xmltvUrl} onChange={(event) => setXmltvUrl(event.target.value)} maxLength={2000} placeholder="https://…/guide.xml.gz" spellCheck={false} autoComplete="off" />
      </label>
      <p className="field-help">
        {t.liveIptvXmltvHelp}
        {source?.playlistEpgUrl && !xmltvUrl.trim() ? ` ${t.liveIptvAnnounced.replace("{url}", shortLocation(source.playlistEpgUrl, t))}` : ""}
      </p>
      <div className="settings-foot">
        {error ? <span className="danger" role="alert">{error}</span> : saving ? <span className="muted">{t.saving}</span> : null}
        <button className="text-button" type="button" onClick={props.onCancel} disabled={saving}>{t.cancel}</button>
        <button className="play" type="submit" disabled={saving}>{t.save}</button>
      </div>
    </form>
  );
}

/** Guide channel per playlist channel: automatic unless picked here. */
function EpgMatcher(props: { source: IptvSource; channels: LiveChannel[]; t: Copy; onChange: () => void }) {
  const { source, t } = props;
  const [guide, setGuide] = useState<GuideChannelOption[] | null>(null);
  const [query, setQuery] = useState("");
  const [unmatchedOnly, setUnmatchedOnly] = useState(true);
  const [shown, setShown] = useState(MATCH_PAGE);

  useEffect(() => {
    api<GuideChannelOption[]>(`/api/livetv/sources/${source.id}/guide-channels`).then(setGuide).catch(() => setGuide([]));
  }, [source.id, source.refreshedAt]);

  const names = useMemo(() => new Map((guide ?? []).map((entry) => [entry.id, entry.name])), [guide]);
  const needle = query.trim().toLowerCase();
  const rows = props.channels.filter(
    (channel) => !channel.iptv?.missing && (!unmatchedOnly || !channel.iptv?.epgMatch) && (!needle || channel.name.toLowerCase().includes(needle)),
  );
  const listId = `epg-${source.id}`;
  if (guide && guide.length === 0) return <p className="muted iptv-match-empty">{t.liveIptvNoGuide}</p>;
  return (
    <div className="iptv-match">
      <p className="field-help">{t.liveIptvMatchHelp}</p>
      <div className="iptv-match-tools">
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.liveIptvSearch} aria-label={t.liveIptvSearch} />
        <label className="radio">
          <input type="checkbox" checked={unmatchedOnly} onChange={(event) => setUnmatchedOnly(event.target.checked)} />
          {t.liveIptvUnmatchedOnly}
        </label>
      </div>
      <datalist id={listId}>
        {(guide ?? []).map((entry) => (
          <option key={entry.id} value={entry.id}>{entry.name}</option>
        ))}
      </datalist>
      <ul className="iptv-match-list">
        {rows.slice(0, shown).map((channel) => (
          <MatchRow key={channel.id} channel={channel} listId={listId} names={names} t={t} onChange={props.onChange} />
        ))}
      </ul>
      {rows.length > shown ? (
        <button className="text-button" type="button" onClick={() => setShown((count) => count + MATCH_PAGE)}>
          {t.liveIptvShowMore.replace("{count}", String(Math.min(MATCH_PAGE, rows.length - shown)))}
        </button>
      ) : null}
    </div>
  );
}

function MatchRow(props: { channel: LiveChannel; listId: string; names: Map<string, string>; t: Copy; onChange: () => void }) {
  const { channel, t } = props;
  const saved = channel.iptv?.epgChannel ?? "";
  const [value, setValue] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setValue(saved), [saved]);

  async function save(next: string | null) {
    setSaving(true);
    setError(null);
    try {
      await api(`/api/livetv/channels/${channel.id}/epg`, { method: "PUT", body: JSON.stringify({ epgChannel: next }) });
      props.onChange();
    } catch (reason) {
      setError(errorText(t, reason));
    } finally {
      setSaving(false);
    }
  }

  const changed = value.trim() !== saved;
  const picked = props.names.get(value.trim());
  return (
    <li className="iptv-match-row">
      <ChannelLogo channel={channel} />
      <span className="iptv-match-name">
        <span className="guide-channel-number">{channel.number}</span> {channel.name}
        <small className="muted"> · {matchLabel(channel, t)}</small>
      </span>
      <input
        list={props.listId}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={t.liveIptvMatchAuto}
        aria-label={`${t.liveIptvMatch}: ${channel.name}`}
        title={picked}
        spellCheck={false}
      />
      {changed ? (
        <button className="secondary-button" type="button" disabled={saving} onClick={() => void save(value.trim() || null)}>{t.save}</button>
      ) : saved ? (
        <button className="text-button" type="button" disabled={saving} onClick={() => void save(null)}>{t.liveIptvMatchAuto}</button>
      ) : null}
      {error ? <span className="danger" role="alert">{error}</span> : null}
    </li>
  );
}
