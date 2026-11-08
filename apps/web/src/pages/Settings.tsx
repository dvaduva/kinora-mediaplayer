import { useEffect, useState, type FormEvent } from "react";
import type { AppSettings, LibraryType, LibraryView } from "@kinora/shared";
import { SUBTITLE_SIZES } from "@kinora/shared";
import { api } from "../api";
import { useLocale } from "../i18n";
import { formatBytes } from "../media";

const SUBTITLE_COLORS = ["#ffffff", "#ffe36e", "#9be7ff", "#b6f3a5", "#ffb3c7"];

export function SettingsPage() {
  const { t, locale } = useLocale();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [libraries, setLibraries] = useState<LibraryView[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState<LibraryType>("movie");
  const [roots, setRoots] = useState("");
  const [tmdb, setTmdb] = useState("");
  const [omdb, setOmdb] = useState("");
  const [access, setAccess] = useState("");
  const [bindHost, setBindHost] = useState("127.0.0.1");
  const [subtitleLanguage, setSubtitleLanguage] = useState("ro");
  const [subtitleSize, setSubtitleSize] = useState(100);
  const [subtitleColor, setSubtitleColor] = useState("#ffffff");
  const [cacheGb, setCacheGb] = useState("30");
  const [message, setMessage] = useState<string | null>(null);

  function reload() {
    api<AppSettings>("/api/settings").then((data) => {
      setSettings(data);
      setBindHost(data.bindHost);
      setSubtitleLanguage(data.subtitleLanguage);
      setSubtitleSize(data.subtitleStyle.size);
      setSubtitleColor(data.subtitleStyle.color);
      setCacheGb(String(data.transcodeCacheGb));
    }).catch(() => undefined);
    api<LibraryView[]>("/api/libraries").then(setLibraries).catch(() => setLibraries([]));
  }
  useEffect(() => {
    reload();
    const timer = window.setInterval(() => {
      api<LibraryView[]>("/api/libraries").then(setLibraries).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, []);

  async function addLibrary(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      await api("/api/libraries", {
        method: "POST",
        body: JSON.stringify({ name, type, roots: roots.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) }),
      });
      setName("");
      setRoots("");
      reload();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "error");
    }
  }

  async function clearCache() {
    await api("/api/cache/transcode/clear", { method: "POST" });
    reload();
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      await saveSettings();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "error");
    }
  }

  async function saveSettings() {
    await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        tmdbReadToken: tmdb,
        omdbApiKey: omdb,
        bindHost,
        accessToken: access,
        transcodeCacheGb: Number(cacheGb),
      }),
    });
    await api("/api/profile", { method: "PUT", body: JSON.stringify({ subtitleLanguage, subtitleSize, subtitleColor }) });
    setTmdb("");
    setOmdb("");
    setAccess("");
    setMessage(t.saved);
    reload();
  }

  return (
    <div className="stack">
      <h1>{t.settings}</h1>
      {settings && !settings.ffprobe ? <p className="banner">{t.ffprobeMissing}</p> : null}
      {settings && !settings.ffmpeg ? <p className="banner">{t.ffmpegMissing}</p> : null}
      <form className="stack" onSubmit={(event) => void addLibrary(event)}>
        <h2>{t.addLibrary}</h2>
        <label className="field">
          {t.libraryName}
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label className="field">
          {t.typeMovie}
          <select value={type} onChange={(event) => setType(event.target.value as LibraryType)}>
            <option value="movie">{t.typeMovie}</option>
            <option value="series">{t.typeSeries}</option>
            <option value="music">{t.typeMusic}</option>
          </select>
        </label>
        <label className="field">
          {t.folder}
          <textarea value={roots} onChange={(event) => setRoots(event.target.value)} required />
        </label>
        <button className="play" type="submit">{t.addLibrary}</button>
      </form>
      {libraries.map((library) => (
        <section className="library-block" key={library.id}>
          <h2>{library.name}</h2>
          <p className="muted">{library.roots.join(", ")}</p>
          <p className="muted">
            {library.scan.status === "running"
              ? `${t.scanning} ${library.scan.scanned}`
              : library.scan.message ?? scanSummary(locale, library.scan.scanned, library.scan.matched)}
          </p>
          <div className="actions">
            <button className="text-button" type="button" onClick={() => void api(`/api/libraries/${library.id}/scan`, { method: "POST" }).then(reload)}>
              {t.rescan}
            </button>
            <button
              className="text-button danger"
              type="button"
              onClick={() => void api(`/api/libraries/${library.id}`, { method: "DELETE" }).then(reload)}
            >
              {t.remove}
            </button>
          </div>
        </section>
      ))}
      <form className="stack" onSubmit={(event) => void save(event)}>
        <label className="field">
          {t.tmdb}
          <input value={tmdb} onChange={(event) => setTmdb(event.target.value)} placeholder={settings?.tmdbHint ?? ""} autoComplete="off" />
        </label>
        <p className="muted">{t.tmdbHelp}</p>
        <label className="field">
          {t.omdb}
          <input value={omdb} onChange={(event) => setOmdb(event.target.value)} placeholder={settings?.omdbHint ?? ""} autoComplete="off" />
        </label>
        <p className="muted">{t.omdbHelp}</p>
        <label className="field">
          {t.access}
          <input value={access} onChange={(event) => setAccess(event.target.value)} type="password" autoComplete="off" />
        </label>
        <p className="muted">{t.accessHelp}</p>
        <label className="field">
          {t.bind}
          <input value={bindHost} onChange={(event) => setBindHost(event.target.value)} />
        </label>
        <p className="muted">{t.bindHelp}</p>
        <label className="field">
          {t.subtitles}
          <select value={subtitleLanguage} onChange={(event) => setSubtitleLanguage(event.target.value)}>
            <option value="ro">Română</option>
            <option value="en">English</option>
            <option value="off">{t.off}</option>
          </select>
        </label>
        <fieldset className="field subtitle-look">
          <legend>{t.subtitleLook}</legend>
          <label className="field">
            {t.subtitleSize}
            <select value={subtitleSize} onChange={(event) => setSubtitleSize(Number(event.target.value))}>
              {(SUBTITLE_SIZES.includes(subtitleSize as (typeof SUBTITLE_SIZES)[number]) ? SUBTITLE_SIZES : [...SUBTITLE_SIZES, subtitleSize].sort((a, b) => a - b)).map((size) => (
                <option key={size} value={size}>{size}%</option>
              ))}
            </select>
          </label>
          <span>{t.subtitleColor}</span>
          <div className="swatches">
            {SUBTITLE_COLORS.map((color) => (
              <button
                key={color}
                className="swatch"
                type="button"
                style={{ background: color }}
                aria-label={color}
                aria-pressed={subtitleColor.toLowerCase() === color}
                onClick={() => setSubtitleColor(color)}
              />
            ))}
            <input type="color" value={subtitleColor} onChange={(event) => setSubtitleColor(event.target.value)} aria-label={t.subtitleColor} />
          </div>
          <div className="cue-preview" aria-hidden="true">
            <span style={{ color: subtitleColor, fontSize: `${(5 * subtitleSize) / 100}cqh` }}>{t.subtitlePreview}</span>
          </div>
        </fieldset>
        <label className="field">
          {t.cacheLimit}
          <input value={cacheGb} onChange={(event) => setCacheGb(event.target.value)} type="number" min={1} step={1} />
        </label>
        <p className="muted">{t.cacheHelp}</p>
        <div className="actions">
          <span className="muted">{t.cacheUsed.replace("{size}", formatBytes(settings?.transcodeCacheBytes ?? 0, locale))}</span>
          <button className="text-button" type="button" onClick={() => void clearCache()}>
            {t.clearCache}
          </button>
        </div>
        <button className="play" type="submit">{t.save}</button>
        {message ? <p className="muted">{message}</p> : null}
      </form>
    </div>
  );
}

function scanSummary(locale: string, scanned: number, matched: number) {
  if (locale === "ro") {
    const files = scanned === 1 ? "1 fișier" : `${scanned} fișiere`;
    const hits = matched === 1 ? "1 potrivit" : `${matched} potrivite`;
    return `${files}, ${hits}`;
  }
  const files = scanned === 1 ? "1 file" : `${scanned} files`;
  const hits = matched === 1 ? "1 matched" : `${matched} matched`;
  return `${files}, ${hits}`;
}
