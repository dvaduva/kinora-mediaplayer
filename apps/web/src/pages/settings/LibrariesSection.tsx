import { useEffect, useRef, useState, type FormEvent } from "react";
import type { DirectoryListing, LibraryType, LibraryView } from "@kinora/shared";
import { api } from "@kinora/client";
import { useLocale, type Copy } from "../../i18n";
import { Icon } from "../../ui";
import { errorText, SectionHead, Status, useReportDirty, type SectionProps } from "./common";

export function LibrariesSection({ onDirty }: SectionProps) {
  const { t, locale } = useLocale();
  const [libraries, setLibraries] = useState<LibraryView[] | null>(null);
  const [adding, setAdding] = useState(false);

  function load() {
    api<LibraryView[]>("/api/libraries").then(setLibraries).catch(() => undefined);
  }
  // Scans report progress through the library list, so it is polled only while this section is open.
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 2000);
    return () => window.clearInterval(timer);
  }, []);

  const empty = libraries !== null && libraries.length === 0;
  const showForm = adding || empty;

  return (
    <section className="settings-section">
      <SectionHead title={t.settingsLibraries} help={t.settingsLibrariesHelp}>
        {showForm ? null : (
          <button className="secondary-button" type="button" onClick={() => setAdding(true)}>+ {t.addLibrary}</button>
        )}
      </SectionHead>

      {showForm ? (
        <AddLibrary
          t={t}
          intro={empty ? t.noLibraries : null}
          onDirty={onDirty}
          onCancel={empty ? null : () => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            load();
          }}
        />
      ) : null}

      {libraries === null ? <div className="settings-card"><span className="skeleton skeleton-line" /></div> : null}
      <div className="library-list">
        {libraries?.map((library) => (
          <LibraryCard key={library.id} library={library} t={t} locale={locale} onChange={load} />
        ))}
      </div>
    </section>
  );
}

function AddLibrary(props: { t: Copy; intro: string | null; onDirty: (dirty: boolean) => void; onCancel: (() => void) | null; onAdded: () => void }) {
  const { t } = props;
  const [name, setName] = useState("");
  const [type, setType] = useState<LibraryType>("movie");
  const [roots, setRoots] = useState<string[]>([""]);
  const [browsing, setBrowsing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filled = roots.map((root) => root.trim()).filter(Boolean);
  useReportDirty(props.onDirty, Boolean(name.trim() || filled.length));

  function setRoot(index: number, value: string) {
    setRoots((current) => current.map((root, at) => (at === index ? value : root)));
  }

  function removeRoot(index: number) {
    setRoots((current) => current.filter((_, at) => at !== index));
    setBrowsing(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/libraries", { method: "POST", body: JSON.stringify({ name, type, roots: filled }) });
      props.onAdded();
    } catch (reason) {
      setError(errorText(t, reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="settings-card" onSubmit={(event) => void submit(event)}>
      <h3>{t.addLibrary}</h3>
      {props.intro ? <p className="muted">{props.intro}</p> : null}
      <div className="settings-pair">
        <label className="field">
          {t.libraryName}
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label className="field">
          {t.libraryType}
          <select value={type} onChange={(event) => setType(event.target.value as LibraryType)}>
            <option value="movie">{t.typeMovie}</option>
            <option value="series">{t.typeSeries}</option>
            <option value="music">{t.typeMusic}</option>
          </select>
        </label>
      </div>
      <fieldset className="folder-rows">
        <legend>{t.folder}</legend>
        <p className="field-help">{t.folderHelp}</p>
        {roots.map((root, index) => (
          <div className="folder-row" key={index}>
            <div className="folder-row-line">
              <input
                className="folder-input"
                value={root}
                onChange={(event) => setRoot(index, event.target.value)}
                placeholder={t.folderPlaceholder}
                aria-label={`${t.folder} ${index + 1}`}
                required={index === 0}
                spellCheck={false}
                autoComplete="off"
              />
              <button
                className="secondary-button"
                type="button"
                aria-expanded={browsing === index}
                onClick={() => setBrowsing(browsing === index ? null : index)}
              >
                <Icon name="folder" />
                {t.browseFolders}
              </button>
              {roots.length > 1 ? (
                <button className="folder-icon-button" type="button" onClick={() => removeRoot(index)} aria-label={t.removeFolder} title={t.removeFolder}>
                  <Icon name="close" />
                </button>
              ) : null}
            </div>
            {browsing === index ? (
              <FolderBrowser
                t={t}
                start={root}
                onChoose={(chosen) => {
                  setRoot(index, chosen);
                  setBrowsing(null);
                }}
                onClose={() => setBrowsing(null)}
              />
            ) : null}
          </div>
        ))}
        <button
          className="text-button inline folder-add"
          type="button"
          onClick={() => {
            setRoots((current) => [...current, ""]);
            setBrowsing(null);
          }}
        >
          + {t.addFolderRow}
        </button>
      </fieldset>
      <div className="settings-foot">
        {error ? <span className="danger" role="alert">{error}</span> : null}
        {props.onCancel ? <button className="text-button" type="button" onClick={props.onCancel}>{t.cancel}</button> : null}
        <button className="play" type="submit" disabled={busy}>{t.addLibrary}</button>
      </div>
    </form>
  );
}

/** Walks the server's folders one level at a time; the chosen path goes back into the row's text box. */
function FolderBrowser(props: { t: Copy; start: string; onChoose: (path: string) => void; onClose: () => void }) {
  const { t } = props;
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);

  function open(target: string, fallback?: string) {
    const ticket = ++request.current;
    setLoading(true);
    setError(null);
    api<DirectoryListing>(`/api/folders?path=${encodeURIComponent(target)}`)
      .then((next) => {
        if (ticket === request.current) setListing(next);
      })
      .catch((reason) => {
        if (ticket !== request.current) return;
        // A half-typed path should not leave the picker empty: fall back to the top level.
        if (fallback !== undefined) open(fallback);
        else setError(errorText(t, reason));
      })
      .finally(() => {
        if (ticket === request.current) setLoading(false);
      });
  }

  // Opens once, from whatever the row held when the picker was opened.
  useEffect(() => {
    const start = props.start.trim();
    open(start, start ? "" : undefined);
  }, []);

  const current = listing?.path ?? null;
  const parent = listing?.parent ?? null;
  return (
    <div className="folder-browser" role="group" aria-label={t.browseFolders}>
      <div className="folder-browser-head">
        <button
          className="folder-icon-button"
          type="button"
          disabled={parent === null || loading}
          onClick={() => parent !== null && open(parent)}
          aria-label={t.folderUp}
          title={t.folderUp}
        >
          <Icon name="back" />
        </button>
        <span className="folder-browser-path">{current ?? t.computerRoot}</span>
      </div>
      <ul className="folder-browser-list" aria-busy={loading}>
        {error ? <li className="folder-browser-note danger" role="alert">{error}</li> : null}
        {!error && listing && listing.entries.length === 0 ? <li className="folder-browser-note muted">{t.noSubfolders}</li> : null}
        {!listing && !error ? <li className="folder-browser-note"><span className="skeleton skeleton-line" /></li> : null}
        {listing?.entries.map((entry) => (
          <li key={entry.path}>
            <button type="button" className="folder-browser-item" disabled={loading} onClick={() => open(entry.path)}>
              <Icon name="folder" />
              <span>{entry.name}</span>
              <Icon name="chevron" />
            </button>
          </li>
        ))}
      </ul>
      <div className="folder-browser-foot">
        <button className="text-button" type="button" onClick={props.onClose}>{t.cancel}</button>
        <button className="play" type="button" disabled={!current || loading} onClick={() => current && props.onChoose(current)}>
          {t.chooseFolder}
        </button>
      </div>
    </div>
  );
}

function LibraryCard(props: { library: LibraryView; t: Copy; locale: string; onChange: () => void }) {
  const { library, t, locale } = props;
  const [confirming, setConfirming] = useState(false);
  const { scan } = library;
  const typeName = library.type === "movie" ? t.typeMovie : library.type === "series" ? t.typeSeries : t.typeMusic;

  let status;
  if (scan.status === "running") status = <Status tone="busy">{t.scanning} · {scan.scanned}</Status>;
  else if (scan.status === "error") status = <Status tone="error">{scan.message ?? "error"}</Status>;
  else status = <Status tone="ok">{scan.message ?? scanSummary(locale, scan.scanned, scan.matched)}</Status>;

  return (
    <article className="settings-card library-card">
      <div className="library-card-head">
        <h3>{library.name}</h3>
        <span className="library-type">{typeName}</span>
      </div>
      <ul className="library-roots">
        {library.roots.map((root) => <li key={root}>{root}</li>)}
      </ul>
      <div className="library-card-foot">
        {status}
        <span className="spacer" />
        {confirming ? (
          <>
            <button className="text-button" type="button" onClick={() => setConfirming(false)}>{t.cancel}</button>
            <button
              className="text-button danger"
              type="button"
              onClick={() => void api(`/api/libraries/${library.id}`, { method: "DELETE" }).then(props.onChange)}
            >
              {t.confirmRemove}
            </button>
          </>
        ) : (
          <>
            <button
              className="text-button"
              type="button"
              disabled={scan.status === "running"}
              onClick={() => void api(`/api/libraries/${library.id}/scan`, { method: "POST" }).then(props.onChange)}
            >
              {t.rescan}
            </button>
            <button className="text-button danger" type="button" onClick={() => setConfirming(true)}>{t.remove}</button>
          </>
        )}
      </div>
    </article>
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
