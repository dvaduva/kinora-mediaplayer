import { useState, type FormEvent } from "react";
import { api } from "../../api";
import { useLocale } from "../../i18n";
import { SaveRow, SectionHead, Status, useReportDirty, useSave, type SectionProps } from "./common";

export function NetworkSection({ settings, reload, onDirty }: SectionProps) {
  const { t } = useLocale();
  const [bindHost, setBindHost] = useState(settings.bindHost);
  const [access, setAccess] = useState("");
  const save = useSave(t);
  const hostChanged = bindHost.trim() !== settings.bindHost;
  const dirty = hostChanged || Boolean(access.trim());
  useReportDirty(onDirty, dirty);

  function submit(event: FormEvent) {
    event.preventDefault();
    void save.run(async () => {
      // The access key goes in the same request, so a new network address and its key are checked together.
      const body: Record<string, string> = {};
      if (hostChanged) body.bindHost = bindHost;
      if (access.trim()) body.accessToken = access;
      await api("/api/settings", { method: "PUT", body: JSON.stringify(body) });
      setAccess("");
      reload();
      return hostChanged ? t.restartNeeded : undefined;
    });
  }

  return (
    <section className="settings-section">
      <SectionHead title={t.settingsNetwork} help={t.settingsNetworkHelp} />
      <form className="settings-card" onSubmit={submit}>
        <div className="settings-row">
          <label className="field">
            {t.bind}
            <input value={bindHost} onChange={(event) => setBindHost(event.target.value)} spellCheck={false} />
          </label>
          <p className="field-help">{t.bindHelp}</p>
        </div>
        <div className="settings-row">
          <label className="field">
            <span className="settings-label">
              {t.access}
              {settings.tokenRequired ? <Status tone="ok">{t.keySet}</Status> : null}
            </span>
            <input value={access} onChange={(event) => setAccess(event.target.value)} type="password" autoComplete="new-password" />
          </label>
          <p className="field-help">{t.accessHelp}{settings.tokenRequired ? ` ${t.keyKeepHint}` : ""}</p>
        </div>
        <SaveRow t={t} dirty={dirty} state={save.state} />
      </form>
    </section>
  );
}
