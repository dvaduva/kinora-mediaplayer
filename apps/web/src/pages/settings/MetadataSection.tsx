import { useState, type FormEvent } from "react";
import { api } from "@kinora/client";
import { useLocale } from "../../i18n";
import { SaveRow, SectionHead, Status, useReportDirty, useSave, type SectionProps } from "./common";

export function MetadataSection({ settings, reload, onDirty }: SectionProps) {
  const { t } = useLocale();
  const [tmdb, setTmdb] = useState("");
  const [omdb, setOmdb] = useState("");
  const [language, setLanguage] = useState(settings.metadataLanguage);
  const save = useSave(t);
  const dirty = Boolean(tmdb.trim() || omdb.trim() || language !== settings.metadataLanguage);
  useReportDirty(onDirty, dirty);

  function submit(event: FormEvent) {
    event.preventDefault();
    void save.run(async () => {
      await api("/api/settings", { method: "PUT", body: JSON.stringify({ tmdbReadToken: tmdb, omdbApiKey: omdb, metadataLanguage: language }) });
      setTmdb("");
      setOmdb("");
      reload();
    });
  }

  return (
    <section className="settings-section">
      <SectionHead title={t.settingsMetadata} help={t.settingsMetadataHelp} />
      <form className="settings-card" onSubmit={submit}>
        <KeyField
          label={t.tmdb}
          help={t.tmdbHelp}
          value={tmdb}
          onChange={setTmdb}
          configured={settings.tmdbConfigured}
          hint={settings.tmdbHint}
        />
        <KeyField
          label={t.omdb}
          help={t.omdbHelp}
          value={omdb}
          onChange={setOmdb}
          configured={settings.omdbConfigured}
          hint={settings.omdbHint}
        />
        <div className="settings-row">
          <label className="field">
            <span className="settings-label">{t.metadataLanguage}</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value === "ro" ? "ro" : "en")}>
              <option value="en">English</option>
              <option value="ro">Română</option>
            </select>
          </label>
          <p className="field-help">{t.metadataLanguageHelp}</p>
        </div>
        <SaveRow t={t} dirty={dirty} state={save.state} />
      </form>
    </section>
  );
}

function KeyField(props: { label: string; help: string; value: string; onChange: (value: string) => void; configured: boolean; hint: string | null }) {
  const { t } = useLocale();
  return (
    <div className="settings-row">
      <label className="field">
        <span className="settings-label">
          {props.label}
          {props.configured ? <Status tone="ok">{t.keySet}</Status> : <Status tone="warn">{t.keyMissing}</Status>}
        </span>
        <input value={props.value} onChange={(event) => props.onChange(event.target.value)} placeholder={props.hint ?? ""} autoComplete="off" spellCheck={false} />
      </label>
      <p className="field-help">{props.help}{props.configured ? ` ${t.keyKeepHint}` : ""}</p>
    </div>
  );
}
