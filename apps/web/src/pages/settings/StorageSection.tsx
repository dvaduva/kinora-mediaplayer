import { useState, type FormEvent } from "react";
import { api, formatBytes } from "@kinora/client";
import { useLocale } from "../../i18n";
import { SaveRow, SectionHead, useReportDirty, useSave, type SectionProps } from "./common";

const GB = 1024 ** 3;

export function StorageSection({ settings, reload, onDirty }: SectionProps) {
  const { t, locale } = useLocale();
  const [cacheGb, setCacheGb] = useState(String(settings.transcodeCacheGb));
  const [clearing, setClearing] = useState(false);
  const save = useSave(t);
  const dirty = Number(cacheGb) !== settings.transcodeCacheGb;
  useReportDirty(onDirty, dirty);

  const used = settings.transcodeCacheBytes;
  const limit = settings.transcodeCacheGb * GB;
  const share = limit > 0 ? Math.min(1, used / limit) : 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    void save.run(async () => {
      await api("/api/settings", { method: "PUT", body: JSON.stringify({ transcodeCacheGb: Number(cacheGb) }) });
      reload();
    });
  }

  async function clearCache() {
    setClearing(true);
    try {
      await api("/api/cache/transcode/clear", { method: "POST" });
      reload();
    } finally {
      setClearing(false);
    }
  }

  return (
    <section className="settings-section">
      <SectionHead title={t.settingsStorage} help={t.settingsStorageHelp} />
      <form className="settings-card" onSubmit={submit}>
        <div className="settings-meter">
          <div className="settings-meter-text">
            <strong>{t.cacheOf.replace("{used}", formatBytes(used, locale)).replace("{limit}", formatBytes(limit, locale))}</strong>
            <span className="muted">{Math.round(share * 100)}%</span>
          </div>
          <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used}>
            <span style={{ width: `${share * 100}%` }} />
          </div>
          <button className="secondary-button" type="button" disabled={clearing || used === 0} onClick={() => void clearCache()}>
            {t.clearCache}
          </button>
        </div>
        <div className="settings-row">
          <label className="field">
            {t.cacheLimit}
            <input value={cacheGb} onChange={(event) => setCacheGb(event.target.value)} type="number" min={1} step={1} />
          </label>
          <p className="field-help">{t.cacheHelp}</p>
        </div>
        <SaveRow t={t} dirty={dirty} state={save.state} />
      </form>
    </section>
  );
}
